/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Goban, GobanSelectedThemes } from "./Goban";
import { GobanConfig } from "../GobanBase";
import { GobanEngine } from "../engine";
import { AdHocFormat } from "../engine/formats/AdHocFormat";
import { JGOF, JGOFNumericPlayerColor } from "../engine/formats/JGOF";
import { MoveTreePenMarks } from "../engine/MoveTree";
import { formatMessage, MessageID } from "../engine/messages";
import { callbacks } from "./callbacks";
import {
    GobanNativeTransport,
    NativeAttachOptions,
    NativeBoardSpec,
    NativeIntentPenEvent,
    NativeIntentPlaceEvent,
    NativeRect,
    NativeStone,
    NativeTheme,
    NativeUpdateOptions,
} from "./NativeTransport";
import {
    boardUnitsToPenPoints,
    buildGhost,
    buildLastMove,
    buildOverlays,
    penMarksToBoardUnits,
    SpecSource,
} from "./NativeSpec";
import {
    buildNativeTheme,
    forgetPreRenderedStones,
    resolveThemes,
    ResolvedThemes,
} from "./NativeThemeAssets";
import { MoveTreeCanvas } from "./MoveTreeCanvas";

export interface NativeRendererGobanConfig extends GobanConfig {
    native_transport: GobanNativeTransport;
    last_move_opacity?: number;
}

export type NativeRendererState = "pending" | "attaching" | "active" | "destroyed";

/** How long to wait before re-syncing after a transport call is rejected.
 *  Long enough that a rim rejecting everything backs off instead of spinning
 *  the event loop. */
const RETRY_DELAY_MS = 250;

/** How long after a viewport-level change (rotation, the visual viewport
 *  resizing) to take one last measurement. Two animation frames catch the
 *  common case; this catches the tail of an animated rotation. */
const VIEWPORT_SETTLE_MS = 250;

/** The renderer state changes that make the spec stale. */
const SYNC_EVENTS = [
    "update",
    "mode",
    "load",
    "cur_move",
    "analyze_tool",
    "analyze_subtool",
    "submit_move",
    "score_estimate",
    "set-for-removal",
] as const;

/**
 * The third goban renderer. Owns no pixels: it sizes `board_div` exactly as
 * the canvas renderer would (so page layout and rect measurement match),
 * computes a NativeBoardSpec from the engine and the renderer state, and
 * drives an out-of-DOM draw layer through `native_transport`. Input arrives
 * as intents and takes the same tapAtImpl path as a canvas click.
 */
export class GobanNativeRenderer extends Goban {
    public engine: GobanEngine;

    private transport: GobanNativeTransport;
    private state: NativeRendererState = "pending";
    private op_queue: Promise<void> = Promise.resolve();
    private sync_scheduled = false;
    private ready = false;
    private drawing_enabled = true;
    private last_sent?: NativeBoardSpec;
    private last_rect?: NativeRect;
    private attached_size?: { width: number; height: number };
    private unsubscribe: Array<() => void> = [];
    private resize_observer?: ResizeObserver;
    private readonly window_listener = () => this.scheduleSync();
    private readonly viewport_listener = () => this.remeasureAfterViewportChange();
    private viewport_frames: number[] = [];
    private viewport_timeout?: ReturnType<typeof setTimeout>;

    private themes: GobanSelectedThemes;
    private resolved!: ResolvedThemes;
    private theme_stone_radius = 10;
    private theme_sent_for?: string;
    private colors = {
        black_stone: "#000000",
        white_stone: "#ffffff",
        black_text: "#ffffff",
        white_text: "#000000",
        blank_text: "#000000",
    };

    private last_move_opacity: number;
    private byoyomi_label = "";
    private message_timeout?: number;
    /** The last message text handed to the rim, so a redundant clear (e.g.
     *  the one showMessage does first) doesn't round-trip. `undefined` means
     *  "unknown" (the last push was rejected), which forces the next one
     *  through. */
    private message_sent: string | null | undefined = null;
    private retry_timeout?: ReturnType<typeof setTimeout>;
    private overlay_suspended = false;
    private snapshot_img?: HTMLImageElement;
    private move_tree: MoveTreeCanvas;

    constructor(config: NativeRendererGobanConfig, preloaded_data?: AdHocFormat | JGOF) {
        /* TODO: Need to reconcile the clock fields before we can get rid of this `any` cast */
        super(config, preloaded_data as any);
        /* Size the board div before anything that can throw, so a failure
         * further down still leaves a correctly sized box in the layout
         * rather than a 0x0 one that collapses the page around it. */
        const initial_metrics = this.computeMetrics();
        this.parent.style.width = `${initial_metrics.width}px`;
        this.parent.style.height = `${initial_metrics.height}px`;
        this.transport = config.native_transport;
        this.last_move_opacity = config.last_move_opacity ?? 1;
        this.themes = this.getSelectedThemes();
        this.applyThemes(this.themes);
        this.move_tree = new MoveTreeCanvas(this, () => this.resolved);

        const watcher = this.watchSelectedThemes((themes) => this.setTheme(themes, false));
        this.on("destroy", () => watcher.remove());

        this.engine = this.post_config_constructor();
        this.emit("engine.updated", this.engine);

        this.move_tree.setContainer(config.move_tree_container ?? null);
        this.ready = true;

        for (const ev of SYNC_EVENTS) {
            this.on(ev, () => this.scheduleSync());
        }
        this.unsubscribe.push(this.transport.onIntentPlace((e) => this.onIntentPlace(e)));
        this.unsubscribe.push(this.transport.onIntentPen((e) => this.onIntentPen(e)));
        if (typeof ResizeObserver !== "undefined") {
            this.resize_observer = new ResizeObserver(() => this.scheduleSync());
            this.resize_observer.observe(this.parent);
        }
        if (typeof window !== "undefined") {
            window.addEventListener("resize", this.window_listener);
            window.addEventListener("scroll", this.window_listener, { passive: true });
            window.addEventListener("orientationchange", this.viewport_listener);
            window.visualViewport?.addEventListener("resize", this.viewport_listener);
        }
        this.redraw(true);
    }

    /* ---------------- public surface ---------------- */

    public get nativeState(): NativeRendererState {
        return this.state;
    }

    public setByoYomiLabel(label: string): void {
        if (this.byoyomi_label !== label) {
            this.byoyomi_label = label;
            this.scheduleSync();
        }
    }

    public setLastMoveOpacity(opacity: number): void {
        this.last_move_opacity = opacity;
        this.scheduleSync();
    }

    /** Snapshot the native view and hide it so DOM overlays can stack above
     *  the board; the snapshot <img> is placed in the board div. */
    public suspendNativeView(): Promise<string | null> {
        this.overlay_suspended = true;
        if (this.state !== "active") {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this.enqueue(async () => {
                const { snapshot } = await this.transport.suspend({ id: this.id() });
                this.placeSnapshot(snapshot);
                resolve(snapshot);
            }, "suspend").catch(() => resolve(null));
        });
    }

    public resumeNativeView(): void {
        if (!this.overlay_suspended) {
            return;
        }
        this.overlay_suspended = false;
        this.removeSnapshot();
        if (this.state === "active") {
            this.enqueue(() => this.transport.resume({ id: this.id() }), "resume").catch(
                () => undefined,
            );
        }
        this.scheduleSync();
    }

    /* ---------------- abstract renderer methods ---------------- */

    public drawSquare(_i: number, _j: number): void {
        this.scheduleSync();
    }

    public redraw(_force_clear?: boolean): void {
        if (!this.ready || this.destroyed || !this.drawing_enabled || this.no_display) {
            return;
        }
        const metrics = this.computeMetrics();
        this.parent.style.width = `${metrics.width}px`;
        this.parent.style.height = `${metrics.height}px`;
        const radius = this.computeThemeStoneRadius();
        if (radius !== this.theme_stone_radius) {
            this.theme_stone_radius = radius;
            this.theme_sent_for = undefined;
        }
        this.scheduleSync();
        this.move_tree.redraw();
    }

    public override set(x: number, y: number, player: JGOFNumericPlayerColor): void {
        super.set(x, y, player);
        this.scheduleSync();
    }

    public override setState(): void {
        super.setState();
        this.scheduleSync();
    }

    public override setForRemoval(
        x: number,
        y: number,
        removed: boolean,
        emit_stone_removal_updated: boolean = true,
    ): void {
        super.setForRemoval(x, y, removed, emit_stone_removal_updated);
        this.scheduleSync();
    }

    public override updateScoreEstimation(): void {
        super.updateScoreEstimation();
        this.scheduleSync();
    }

    /** The ghost stone is gated on `stone_placement_enabled`, which the base
     *  flips without emitting anything the sync events cover. */
    public override enableStonePlacement(): void {
        super.enableStonePlacement();
        this.scheduleSync();
    }

    public override disableStonePlacement(): void {
        super.disableStonePlacement();
        this.scheduleSync();
    }

    public enablePen(): void {
        this.scheduleSync();
    }

    public disablePen(): void {
        this.scheduleSync();
    }

    public clearAnalysisDrawing(): void {
        this.pen_marks = [];
        this.scheduleSync();
    }

    public drawPenMarks(pen_marks: MoveTreePenMarks): void {
        if (this.review_id && !this.done_loading_review) {
            return;
        }
        this.pen_marks = pen_marks;
        this.scheduleSync();
    }

    public showMessage(
        message_id_or_error: MessageID,
        parameters?: { [key: string]: any },
        timeout: number = 5000,
    ): void {
        this.clearMessage();

        const message_id = parameters?.error?.message_id || message_id_or_error;
        const html = formatMessage(message_id, parameters);
        this.emit("show-message", { formatted: html, message_id, parameters });

        if (!this.config.dont_show_messages) {
            this.pushMessage(html.replace(/<[^>]*>/g, "").trim());
        }

        if (!timeout) {
            timeout = 5000;
        }
        if (timeout > 0) {
            this.message_timeout = window.setTimeout(() => this.clearMessage(), timeout);
        }
    }

    public clearMessage(): void {
        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }
        this.pushMessage(null);
        this.emit("clear-message");
    }

    public move_tree_redraw(no_warp?: boolean): void {
        this.move_tree.redraw(no_warp);
    }

    public setMoveTreeContainer(container: HTMLElement | null): void {
        this.move_tree.setContainer(container);
    }

    protected setTitle(title: string): void {
        this.title = title;
        if (this.title_div) {
            this.title_div.innerHTML = title;
        }
    }

    protected enableDrawing(): void {
        this.drawing_enabled = true;
        this.scheduleSync();
    }

    protected disableDrawing(): void {
        this.drawing_enabled = false;
    }

    protected tapAt(x: number, y: number, double_tap: boolean): void {
        this.tapAtImpl(x, y, double_tap, false, false, 0);
    }

    protected setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void {
        this.themes = themes;
        /* The "Custom" stones are drawn from user settings rather than from
         * the theme name the shared cache keys on, so a theme change has to
         * bust them explicitly. */
        forgetPreRenderedStones("Custom");
        this.applyThemes(themes);
        this.theme_sent_for = undefined;
        if (!dont_redraw) {
            this.redraw(true);
        } else {
            this.scheduleSync();
        }
    }

    protected watchSelectedThemes(cb: (themes: GobanSelectedThemes) => void): {
        remove: () => any;
    } {
        if (callbacks.watchSelectedThemes) {
            return callbacks.watchSelectedThemes(cb);
        }
        return { remove: () => undefined };
    }

    public override destroy(): void {
        for (const u of this.unsubscribe) {
            u();
        }
        this.unsubscribe = [];
        this.resize_observer?.disconnect();
        delete this.resize_observer;
        if (typeof window !== "undefined") {
            window.removeEventListener("resize", this.window_listener);
            window.removeEventListener("scroll", this.window_listener);
            window.removeEventListener("orientationchange", this.viewport_listener);
            window.visualViewport?.removeEventListener("resize", this.viewport_listener);
        }
        for (const handle of this.viewport_frames) {
            cancelAnimationFrame(handle);
        }
        this.viewport_frames = [];
        if (this.viewport_timeout !== undefined) {
            clearTimeout(this.viewport_timeout);
            delete this.viewport_timeout;
        }
        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }
        if (this.retry_timeout !== undefined) {
            clearTimeout(this.retry_timeout);
            delete this.retry_timeout;
        }
        const was_attached = this.state === "active" || this.state === "attaching";
        this.state = "destroyed";
        if (was_attached) {
            this.enqueue(() => this.transport.detach({ id: this.id() }), "detach").catch(
                () => undefined,
            );
        }
        this.removeSnapshot();
        this.move_tree.destroy();
        super.destroy();
    }

    /* ---------------- internals ---------------- */

    private id(): string {
        return `goban-${this.goban_id}`;
    }

    /** Read through a method so tsc doesn't narrow `state` across the awaits
     *  in `attach`, where the transport can outlive a destroy. */
    private isDestroyed(): boolean {
        return this.state === "destroyed";
    }

    private log(...args: unknown[]): void {
        console.error("[GobanNativeRenderer]", ...args);
    }

    /** Every transport call goes through one serial queue, so the rim never
     *  sees an update for a board it hasn't attached yet. */
    private enqueue(op: () => Promise<unknown>, label: string): Promise<void> {
        const next = this.op_queue.then(async () => {
            await op();
        });
        this.op_queue = next.catch((err) => this.log(`${label} failed`, err));
        return next;
    }

    /** A transport call was rejected: the rim never received the field, so
     *  drop the bookkeeping that claims it did and re-sync shortly. Without
     *  this the next diff compares against state the rim never saw and the
     *  change is lost forever. */
    private retryAfterFailure(invalidate: () => void): void {
        invalidate();
        if (this.isDestroyed() || this.retry_timeout !== undefined) {
            return;
        }
        this.retry_timeout = setTimeout(() => {
            delete this.retry_timeout;
            this.scheduleSync();
        }, RETRY_DELAY_MS);
    }

    private pushMessage(text: string | null): void {
        if (this.message_sent === text || this.isDestroyed()) {
            return;
        }
        this.message_sent = text;
        this.enqueue(() => this.transport.setMessage({ id: this.id(), text }), "setMessage").catch(
            () => {
                /* The rim never got it; a sync won't re-push messages, but the
                 * next show/clear must not be deduplicated away. */
                this.message_sent = undefined;
            },
        );
    }

    private applyThemes(themes: GobanSelectedThemes): void {
        this.resolved = resolveThemes(themes);
        this.colors = {
            black_stone: this.resolved.black.getBlackStoneColor(),
            white_stone: this.resolved.white.getWhiteStoneColor(),
            black_text: this.resolved.black.getBlackTextColor(),
            white_text: this.resolved.white.getWhiteTextColor(),
            blank_text: this.resolved.board.getBlankTextColor(),
        };
    }

    private computeThemeStoneRadius(): number {
        let r = this.square_size * 0.488;
        if (this.square_size % 2 === 0) {
            r = Math.min(r, (this.square_size - 1) / 2);
        }
        const scale = this.themes["stone-scale"];
        return Math.max(1, r * Math.min(Number.isFinite(scale) ? scale : 1.0, 1.0));
    }

    private scheduleSync(): void {
        if (this.state === "destroyed" || this.sync_scheduled || !this.ready) {
            return;
        }
        this.sync_scheduled = true;
        Promise.resolve()
            .then(() => {
                this.sync_scheduled = false;
                if (this.state !== "destroyed") {
                    this.sync();
                }
            })
            .catch((err) => this.log("sync failed", err));
    }

    private sync(): void {
        if (this.no_display || !this.drawing_enabled) {
            return;
        }
        switch (this.state) {
            case "attaching":
            case "destroyed":
                return;
            case "pending":
                this.attach();
                return;
            case "active": {
                if (
                    this.attached_size &&
                    (this.attached_size.width !== this.engine.width ||
                        this.attached_size.height !== this.engine.height)
                ) {
                    this.state = "pending";
                    this.enqueue(() => this.transport.detach({ id: this.id() }), "detach").catch(
                        () => undefined,
                    );
                    /* The rim drops the old view and the message it was
                     * showing with it, so forget having sent it and push it
                     * again behind the re-attach. */
                    const message = this.message_sent ?? null;
                    this.message_sent = null;
                    this.attach();
                    if (message !== null) {
                        this.pushMessage(message);
                    }
                    return;
                }
                if (!this.pushGeometry()) {
                    return;
                }
                this.pushTheme();
                this.pushSpec();
                return;
            }
        }
    }

    private attach(): void {
        const rect = this.measureRect();
        if (rect.width <= 0 || rect.height <= 0) {
            /* Nothing to attach to yet — a board mounted into a hidden column
             * or before layout. Staying "pending" leaves the ResizeObserver on
             * `parent` to re-sync the moment it gets a size; attaching now
             * would hand the rim a degenerate rect it has to reject. */
            return;
        }
        this.state = "attaching";
        this.enqueue(async () => {
            if (this.isDestroyed()) {
                return;
            }
            try {
                const spec = this.buildSpec();
                /* Claim the theme key before building the theme: an image
                 * theme that finishes loading during the build clears it
                 * again, and that deferred re-push must survive. */
                this.theme_sent_for = this.themeKey();
                const payload: NativeAttachOptions = {
                    ...spec,
                    id: this.id(),
                    rect,
                    interactive: this.interactive,
                    theme: this.buildTheme(),
                };
                await this.transport.attach(payload);
                if (this.isDestroyed()) {
                    return;
                }
                this.state = "active";
                this.attached_size = { width: spec.width, height: spec.height };
                this.last_rect = payload.rect;
                this.last_sent = spec;
                if (this.overlay_suspended) {
                    await this.transport
                        .suspend({ id: this.id() })
                        .then((r) => this.placeSnapshot(r.snapshot))
                        .catch(() => undefined);
                }
                this.scheduleSync();
            } catch (err) {
                /* Anything at all — a rejected attach, a theme that could not
                 * be built, a spec the engine could not produce. Whatever it
                 * was, the rim has nothing, so drop every claim that it does
                 * and go back to "pending" so a later sync tries again. There
                 * is no fallback renderer to fall back to. */
                if (!this.isDestroyed()) {
                    this.state = "pending";
                }
                this.log("attach failed; will retry", err);
                this.emit("error", err);
                this.retryAfterFailure(() => {
                    delete this.last_rect;
                    delete this.last_sent;
                    this.theme_sent_for = undefined;
                });
            }
        }, "attach").catch(() => undefined);
    }

    /**
     * A viewport-level change settles over several frames: on the event
     * itself the DOM box is still the pre-rotation one, and on some devices
     * the transition animates. Re-measure on each of the next two animation
     * frames and once more after the transition should be over, pushing a
     * `move` whenever the rect actually differs from the last one sent.
     */
    private remeasureAfterViewportChange(): void {
        if (this.isDestroyed()) {
            return;
        }
        this.scheduleSync();
        if (typeof requestAnimationFrame !== "undefined") {
            const tick = (remaining: number): void => {
                const handle = requestAnimationFrame(() => {
                    this.viewport_frames = this.viewport_frames.filter((h) => h !== handle);
                    if (this.isDestroyed()) {
                        return;
                    }
                    this.remeasure();
                    if (remaining > 1) {
                        tick(remaining - 1);
                    }
                });
                this.viewport_frames.push(handle);
            };
            tick(2);
        }
        if (this.viewport_timeout !== undefined) {
            clearTimeout(this.viewport_timeout);
        }
        this.viewport_timeout = setTimeout(() => {
            delete this.viewport_timeout;
            if (!this.isDestroyed()) {
                this.remeasure();
            }
        }, VIEWPORT_SETTLE_MS);
    }

    /** Push the board div's current box at the rim if it moved. */
    private remeasure(): void {
        if (this.state === "active") {
            this.pushGeometry();
        } else {
            this.scheduleSync();
        }
    }

    private measureRect(): NativeRect {
        const r = this.parent.getBoundingClientRect();
        const sx = typeof window !== "undefined" ? window.scrollX : 0;
        const sy = typeof window !== "undefined" ? window.scrollY : 0;
        return { x: r.left + sx, y: r.top + sy, width: r.width, height: r.height };
    }

    /** Returns false when the board no longer has a box and has been torn
     *  down, so the caller must not go on pushing state at the rim. */
    private pushGeometry(): boolean {
        const rect = this.measureRect();
        if (rect.width <= 0 || rect.height <= 0) {
            /* The board div lost its box — a responsive column dropping out of
             * the layout is the usual way. There is no rect to move to, and a
             * rim that rejects the degenerate one (both of ours do) would be
             * asked again on every retry, forever. Tear the view down instead
             * and wait: the ResizeObserver on `parent` re-attaches the moment
             * the box comes back. */
            this.detachUntilLaidOut();
            return false;
        }
        const l = this.last_rect;
        if (
            l &&
            l.x === rect.x &&
            l.y === rect.y &&
            l.width === rect.width &&
            l.height === rect.height
        ) {
            return true;
        }
        this.last_rect = rect;
        this.enqueue(() => this.transport.move({ id: this.id(), rect }), "move").catch(() =>
            this.retryAfterFailure(() => delete this.last_rect),
        );
        return true;
    }

    /** Drop the rim's view of a board that currently has no box on the page,
     *  back to the same state a board starts in. */
    private detachUntilLaidOut(): void {
        this.state = "pending";
        delete this.last_rect;
        delete this.last_sent;
        delete this.attached_size;
        this.theme_sent_for = undefined;
        this.message_sent = null;
        this.enqueue(() => this.transport.detach({ id: this.id() }), "detach").catch(
            () => undefined,
        );
    }

    private themeKey(): string {
        return `${JSON.stringify(this.themes)}:${this.theme_stone_radius}:${this.square_size}`;
    }

    private pushTheme(): void {
        const key = this.themeKey();
        if (this.theme_sent_for === key) {
            return;
        }
        this.theme_sent_for = key;
        const theme = this.buildTheme();
        this.enqueue(() => this.transport.setTheme({ id: this.id(), theme }), "setTheme").catch(
            () => this.retryAfterFailure(() => (this.theme_sent_for = undefined)),
        );
    }

    private buildTheme(): NativeTheme {
        return buildNativeTheme(
            this.resolved,
            this.theme_stone_radius,
            this.square_size,
            this.surroundColor(),
            () => {
                /* A deferred (image backed) theme finished loading: re-push. */
                this.theme_sent_for = undefined;
                this.scheduleSync();
            },
        );
    }

    /** The page color behind the board, so the rim can letterbox with it. */
    private surroundColor(): string {
        try {
            let el: HTMLElement | null = this.parent;
            while (el) {
                const bg = getComputedStyle(el).backgroundColor;
                if (
                    bg &&
                    bg !== "transparent" &&
                    !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)
                ) {
                    return bg;
                }
                el = el.parentElement;
            }
        } catch {
            /* jsdom / detached */
        }
        return "#000000";
    }

    private specSource(): SpecSource {
        return {
            engine: this.engine,
            mode: this.mode,
            analyze_tool: this.analyze_tool,
            analyze_subtool: this.analyze_subtool,
            edit_color: this.edit_color,
            move_selected: this.move_selected,
            player_id: this.player_id,
            stone_placement_enabled: this.stone_placement_enabled,
            scoring_mode: this.scoring_mode,
            score_estimator: this.score_estimator,
            stalling_score_estimate: this.stalling_score_estimate,
            heatmap: this.heatmap,
            colored_circles: this.colored_circles,
            highlight_movetree_moves: this.highlight_movetree_moves,
            show_variation_move_numbers: this.show_variation_move_numbers,
            show_undo_request_indicator: this.getShowUndoRequestIndicator(),
            dont_draw_last_move: this.dont_draw_last_move,
            last_move_radius: this.last_move_radius,
            circle_radius: this.circle_radius,
            last_move_opacity: this.last_move_opacity,
            submit_move_pending: !!this.submit_move,
            variation_stone_opacity: this.variation_stone_opacity,
            byoyomi_label: this.byoyomi_label,
            label_character: this.label_character,
            getPuzzlePlacementSetting: this.getPuzzlePlacementSetting,
            removal_graphic: this.themes["removal-graphic"] === "square" ? "square" : "x",
            colors: this.colors,
        };
    }

    private buildSpec(): NativeBoardSpec {
        const src = this.specSource();
        const { width, height, board } = this.engine;
        const flat: NativeStone[] = new Array(width * height);
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                flat[y * width + x] = board[y][x] as NativeStone;
            }
        }
        const full_bounds =
            this.bounds.left === 0 &&
            this.bounds.top === 0 &&
            this.bounds.right === width - 1 &&
            this.bounds.bottom === height - 1;
        const pen = this.mode === "analyze" && this.analyze_tool === "draw";
        return {
            width,
            height,
            bounds: full_bounds ? null : { ...this.bounds },
            labels: {
                top: this.draw_top_labels && this.bounds.top === 0,
                bottom: this.draw_bottom_labels && this.bounds.bottom === height - 1,
                left: this.draw_left_labels && this.bounds.left === 0,
                right: this.draw_right_labels && this.bounds.right === width - 1,
            },
            labelSystem: this.getCoordinateDisplaySystem(),
            board: flat,
            colorToMove: this.engine.player === 2 ? 2 : 1,
            lastMove: buildLastMove(src),
            ghost: buildGhost(src),
            inputMode: pen ? "pen" : "place",
            penColor: pen ? String(this.analyze_subtool) : null,
            overlays: buildOverlays(src),
            penMarks: penMarksToBoardUnits(this.pen_marks),
            penWidth: 0.1,
        };
    }

    /** Sends only the spec fields that actually changed. */
    private pushSpec(): void {
        const spec = this.buildSpec();
        const update: NativeUpdateOptions = { id: this.id() };
        let changed = false;
        for (const key of Object.keys(spec) as Array<keyof NativeBoardSpec>) {
            const a = JSON.stringify(spec[key]);
            const b = this.last_sent ? JSON.stringify(this.last_sent[key]) : undefined;
            if (a !== b) {
                (update as any)[key] = spec[key];
                changed = true;
            }
        }
        if (!changed) {
            return;
        }
        this.last_sent = spec;
        this.enqueue(() => this.transport.update(update), "update").catch(() =>
            this.retryAfterFailure(() => delete this.last_sent),
        );
    }

    private onIntentPlace(event: NativeIntentPlaceEvent): void {
        if (event.id !== this.id() || this.state !== "active") {
            return;
        }
        this.tapAt(event.x, event.y, false);
    }

    /** A finished pen stroke: replay it through the same review-sync path
     *  the canvas's onPenStart/onPenMove use. */
    private onIntentPen(event: NativeIntentPenEvent): void {
        if (event.id !== this.id() || this.state !== "active" || event.points.length < 2) {
            return;
        }
        const points = boardUnitsToPenPoints(event.points);
        const mark = { color: event.color, points: [points[0], points[1]] as number[] };
        this.pen_marks.push(mark);
        this.syncReviewMove({ pen: event.color, pp: [points[0], points[1]] });
        for (let k = 2; k < points.length; k += 2) {
            mark.points.push(points[k], points[k + 1]);
            this.syncReviewMove({ pp: [points[k], points[k + 1]] });
        }
        this.scheduleSync();
    }

    private placeSnapshot(snapshot: string): void {
        /* The suspend may have been in flight when a resume (or a destroy)
         * came in; pinning this now would leave an opaque image over a board
         * the rim has already started drawing again. */
        if (!this.overlay_suspended || this.isDestroyed()) {
            return;
        }
        this.removeSnapshot();
        const img = document.createElement("img");
        img.src = snapshot;
        img.style.position = "absolute";
        img.style.left = "0";
        img.style.top = "0";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.pointerEvents = "none";
        if (getComputedStyle(this.parent).position === "static") {
            this.parent.style.position = "relative";
        }
        this.parent.appendChild(img);
        this.snapshot_img = img;
    }

    private removeSnapshot(): void {
        this.snapshot_img?.remove();
        delete this.snapshot_img;
    }
}
