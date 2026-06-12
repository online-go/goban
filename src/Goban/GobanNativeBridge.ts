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

import { GobanCanvas, CanvasRendererGobanConfig } from "./CanvasRenderer";
import { GobanSelectedThemes } from "./Goban";
import { AdHocFormat } from "../engine/formats/AdHocFormat";
import { JGOF } from "../engine/formats/JGOF";
import { JGOFNumericPlayerColor } from "../engine/formats/JGOF";
import {
    GobanNativeBridgeTransport,
    NativeBridgeRect,
    NativeBridgeTheme,
    NativeBridgeUpdateOptions,
} from "./NativeBridgeTransport";

export interface NativeBridgeGobanConfig extends CanvasRendererGobanConfig {
    /** Injected platform transport (see NativeBridgeTransport.ts). When
     *  absent the bridge behaves exactly like the canvas renderer. */
    native_transport?: GobanNativeBridgeTransport;
}

/**
 * The lifecycle of the native side of one bridge instance:
 *
 * - "pending":   transport present, native view not created yet (waiting
 *                for the board to be v1-serviceable).
 * - "attaching": `attach()` in flight.
 * - "active":    native view visible; the web canvas is kept in sync but
 *                hidden underneath it.
 * - "bailed":    the board needs something contract v1 cannot draw (marks,
 *                analysis, score states, non-square, ...); the native view
 *                is hidden and the always-current web canvas is shown. The
 *                bridge re-engages automatically when the board becomes
 *                serviceable again (e.g. leaving analyze mode).
 * - "fallback":  permanent web canvas for this instance (no transport,
 *                attach rejected, or the instance was destroyed).
 */
export type NativeBridgeState = "pending" | "attaching" | "active" | "bailed" | "fallback";

/**
 * Renderer backend that drives a native (out-of-DOM) draw layer through an
 * injected {@link GobanNativeBridgeTransport}, per the GobanNative plugin
 * contract v1.
 *
 * Design: the bridge *extends the web canvas renderer* rather than
 * replacing it. The canvas stays fully functional (and fully in sync) at
 * all times -- it is merely hidden while the native view is active. This
 * makes the contract-mandated capability fallback trivial and lossless:
 * anything v1 native cannot draw simply unhides the canvas and hides the
 * native view, with no re-construction and no state transfer. Input from
 * the native side (`intentPlace`) is routed through `tapAt()`, the exact
 * entry point a canvas tap uses, so the engine treats both identically.
 */
export class GobanNativeBridge extends GobanCanvas {
    private native_transport?: GobanNativeBridgeTransport;
    private native_state: NativeBridgeState = "fallback";
    /** True while the embedding app has suspended the native view so DOM
     *  overlays (modals, popovers, drawer) can stack above the board. */
    private native_overlay_suspended = false;
    /** Serial queue for transport calls, so attach/update/suspend/...
     *  never race each other. */
    private native_op_queue: Promise<void> = Promise.resolve();
    private native_unsubscribe_intent?: () => void;
    private native_resize_observer?: ResizeObserver;
    private native_window_listeners_bound = false;
    private native_attached_size = 0;
    private native_last_rect?: NativeBridgeRect;
    private native_last_update_json = "";
    private native_sync_scheduled = false;
    private readonly native_window_listener = () => this.scheduleNativeSync();

    constructor(config: NativeBridgeGobanConfig, preloaded_data?: AdHocFormat | JGOF) {
        super(config, preloaded_data);

        if (config.native_transport && !this.no_display) {
            this.native_transport = config.native_transport;
            this.native_state = "pending";

            this.native_unsubscribe_intent = this.native_transport.onIntentPlace((event) => {
                if (event.id !== this.nativeId() || this.native_state !== "active") {
                    return;
                }
                /* Exactly the code path a canvas tap takes; the engine
                 * decides everything. */
                this.tapAt(event.x, event.y, false);
            });

            /* Renderer-level changes that don't flow through set()/
             * setState()/redraw() overrides. */
            this.on("update", () => this.scheduleNativeSync());
            this.on("mode", () => this.scheduleNativeSync());
            this.on("load", () => this.scheduleNativeSync());
            this.on("cur_move", () => this.scheduleNativeSync());

            if (typeof ResizeObserver !== "undefined") {
                this.native_resize_observer = new ResizeObserver(() => this.scheduleNativeSync());
                this.native_resize_observer.observe(this.board);
                this.native_resize_observer.observe(this.parent);
            }
            if (typeof window !== "undefined") {
                window.addEventListener("resize", this.native_window_listener);
                window.addEventListener("scroll", this.native_window_listener, { passive: true });
                this.native_window_listeners_bound = true;
            }

            this.scheduleNativeSync();
        }
    }

    /* ------------ public surface used by the embedding app ------------ */

    /** True when the native view is currently the visible board. */
    public get nativeBoardActive(): boolean {
        return this.native_state === "active";
    }

    /** Terminal-state inspection, primarily for tests and diagnostics. */
    public get nativeBridgeState(): NativeBridgeState {
        return this.native_state;
    }

    /** The native view's content-coordinate rect (CSS px), or null when
     *  the native view is not attached. */
    public nativeBoardRect(): NativeBridgeRect | null {
        if (this.native_state !== "active" && this.native_state !== "bailed") {
            return null;
        }
        return this.native_last_rect ?? null;
    }

    /**
     * Overlay coordination: snapshot the native view as a PNG data-URL and
     * hide it, so site overlays (modals, popovers, the drawer) can stack
     * above the board. The caller places the snapshot in the DOM and calls
     * {@link resumeNativeView} when the overlay closes. Returns null when
     * there is nothing to suspend (native view not active); the suspension
     * is still recorded, so a native view that attaches or re-engages while
     * the overlay is open stays hidden (with the canvas left visible as the
     * board) until {@link resumeNativeView}.
     */
    public suspendNativeView(): Promise<string | null> {
        const transport = this.native_transport;
        if (!transport || this.native_state === "fallback") {
            return Promise.resolve(null);
        }
        const was_suspended = this.native_overlay_suspended;
        /* Record the suspension in every non-fallback state so a native
         * view that attaches/re-engages while an overlay is open stays
         * hidden until resumeNativeView(). */
        this.native_overlay_suspended = true;
        if (this.native_state !== "active" || was_suspended) {
            return Promise.resolve(null);
        }
        return new Promise<string | null>((resolve) => {
            this.enqueueNativeOp(async () => {
                const { snapshot } = await transport.suspend({ id: this.nativeId() });
                resolve(snapshot);
            }, "suspend").catch(() => resolve(null));
        });
    }

    /** Show the native view again after {@link suspendNativeView}. */
    public resumeNativeView(): void {
        if (!this.native_overlay_suspended) {
            return;
        }
        this.native_overlay_suspended = false;
        if (this.native_state === "active" && this.native_transport) {
            const transport = this.native_transport;
            this.enqueueNativeOp(() => transport.resume({ id: this.nativeId() }), "resume").catch(
                () => this.recoverFromActiveTransportFailure("resume"),
            );
            /* The canvas may have been left visible by a suspension that
             * predated the attach/re-engage (no snapshot covered the board
             * then); the native view owns the pixels again now. */
            this.setCanvasVisible(false);
        }
        this.scheduleNativeSync();
    }

    /* --------------------- renderer overrides --------------------- */

    public override set(x: number, y: number, player: JGOFNumericPlayerColor): void {
        super.set(x, y, player);
        this.scheduleNativeSync();
    }

    public override setState(): void {
        super.setState();
        this.scheduleNativeSync();
    }

    public override redraw(force_clear?: boolean): void {
        super.redraw(force_clear);
        this.scheduleNativeSync();
    }

    public override setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void {
        super.setTheme(themes, dont_redraw);
        /* setTheme runs during the super() constructor, before our fields
         * exist; the post-construction scheduleNativeSync covers that. */
        if (!this.native_transport) {
            return;
        }
        if (this.native_state === "active" && !this.native_overlay_suspended) {
            /* setTheme may have re-created the shadow layer; keep it
             * hidden while the native view owns the pixels. (While an
             * overlay suspension is in effect the canvas may be serving
             * as the visible board, so leave it alone.) */
            this.setCanvasVisible(false);
        }
        if (this.native_state === "active" || this.native_state === "bailed") {
            const transport = this.native_transport;
            this.enqueueNativeOp(
                () => transport.setTheme({ id: this.nativeId(), theme: this.resolveNativeTheme() }),
                "setTheme",
            ).catch(() => undefined);
        }
        this.scheduleNativeSync();
    }

    public override destroy(): void {
        if (this.native_unsubscribe_intent) {
            this.native_unsubscribe_intent();
            delete this.native_unsubscribe_intent;
        }
        this.native_resize_observer?.disconnect();
        delete this.native_resize_observer;
        if (this.native_window_listeners_bound && typeof window !== "undefined") {
            window.removeEventListener("resize", this.native_window_listener);
            window.removeEventListener("scroll", this.native_window_listener);
            this.native_window_listeners_bound = false;
        }
        if (
            this.native_transport &&
            (this.native_state === "active" ||
                this.native_state === "bailed" ||
                this.native_state === "attaching")
        ) {
            const transport = this.native_transport;
            this.enqueueNativeOp(() => transport.detach({ id: this.nativeId() }), "detach").catch(
                () => undefined,
            );
        }
        this.native_state = "fallback";
        delete this.native_transport;
        super.destroy();
    }

    /* ------------------------ internals ------------------------ */

    private nativeId(): string {
        return `goban-${this.goban_id}`;
    }

    private nativeLog(...args: unknown[]): void {
        /* "silent, logged in dev" per the contract: debug level keeps
         * production consoles clean. */
        console.debug("[GobanNativeBridge]", ...args);
    }

    private enqueueNativeOp(op: () => Promise<unknown>, label: string): Promise<void> {
        const next = this.native_op_queue.then(async () => {
            await op();
        });
        /* Keep the queue alive after failures; surface them per-op. */
        this.native_op_queue = next.catch((err) => {
            this.nativeLog(`${label} failed`, err);
        });
        return next;
    }

    private scheduleNativeSync(): void {
        if (!this.native_transport || this.native_sync_scheduled || this.destroyed) {
            return;
        }
        this.native_sync_scheduled = true;
        Promise.resolve()
            .then(() => {
                this.native_sync_scheduled = false;
                if (!this.destroyed) {
                    this.syncNative();
                }
            })
            .catch((err) => this.nativeLog("sync failed", err));
    }

    /** Single driver for the native state machine; coalesced to a
     *  microtask so bursts of renderer calls produce one transport
     *  round-trip. */
    private syncNative(): void {
        if (!this.native_transport || this.native_state === "fallback") {
            return;
        }
        const serviceable = this.isV1Serviceable();

        switch (this.native_state) {
            case "attaching":
                /* attach completion re-schedules a sync */
                return;

            case "pending":
                if (serviceable) {
                    this.attemptNativeAttach();
                }
                return;

            case "active":
                if (!serviceable) {
                    this.bailToCanvas();
                } else if (this.engine.width !== this.native_attached_size) {
                    this.reattachNative();
                } else {
                    this.pushNativeGeometry();
                    this.pushNativeUpdate();
                }
                return;

            case "bailed":
                if (serviceable) {
                    if (this.engine.width !== this.native_attached_size) {
                        this.reattachNative();
                    } else {
                        this.reengageNative();
                    }
                }
                return;
        }
    }

    /**
     * What contract v1 can draw: a square play-mode board with stones, the
     * color to move, and the last-move ring. Everything else (analysis and
     * conditional modes, score/removal states, marks/labels, AI heatmaps
     * and circles, pen marks, non-square boards) falls back to the web
     * canvas; non-"play" engine phases (stone removal, finished) need
     * removal/score drawing, so they fall back too.
     */
    private isV1Serviceable(): boolean {
        const cur_move = this.engine.cur_move;
        return (
            this.mode === "play" &&
            this.engine.phase === "play" &&
            this.engine.width === this.engine.height &&
            !this.scoring_mode &&
            !this.heatmap &&
            !this.colored_circles &&
            !(cur_move && cur_move.pen_marks && cur_move.pen_marks.length > 0) &&
            !(cur_move && cur_move.hasMarks())
        );
    }

    private attemptNativeAttach(): void {
        const transport = this.native_transport;
        if (!transport) {
            return;
        }
        this.native_state = "attaching";
        const size = this.engine.width;
        const rect = this.measureNativeRect();
        this.enqueueNativeOp(async () => {
            if (this.destroyed || !this.native_transport) {
                /* destroy() ran while this op was queued. */
                return;
            }
            try {
                await transport.attach({
                    id: this.nativeId(),
                    rect,
                    size,
                    board: this.flattenBoard(),
                    colorToMove: this.engine.player === 2 ? 2 : 1,
                    lastMove: this.nativeLastMove(),
                    interactive: this.interactive,
                    theme: this.resolveNativeTheme(),
                    showCoordinates:
                        this.draw_top_labels ||
                        this.draw_bottom_labels ||
                        this.draw_left_labels ||
                        this.draw_right_labels,
                });
            } catch (err) {
                if (this.destroyed) {
                    return;
                }
                /* Plugin absent/old rim/bad args: permanent canvas
                 * fallback for this instance (capability probe, never
                 * version sniffing). */
                this.native_state = "fallback";
                this.setCanvasVisible(true);
                this.nativeLog("attach rejected; falling back to canvas", err);
                return;
            }
            if (this.destroyed) {
                /* destroy() ran while attach was in flight; it already
                 * queued a detach behind us, so just don't resurrect any
                 * state (the board elements are gone). */
                return;
            }
            this.native_state = "active";
            this.native_attached_size = size;
            this.native_last_rect = rect;
            this.native_last_update_json = "";
            if (this.native_overlay_suspended) {
                /* An overlay opened while we were attaching. The
                 * coordinator's suspendNativeView() resolved null before we
                 * were active, so it has no snapshot covering the board:
                 * hide the fresh native view but keep the canvas visible
                 * as the board until resumeNativeView(). */
                await transport.suspend({ id: this.nativeId() }).catch(() => undefined);
                this.setCanvasVisible(true);
            } else {
                this.setCanvasVisible(false);
            }
            this.scheduleNativeSync();
        }, "attach").catch(() => undefined);
    }

    private reattachNative(): void {
        const transport = this.native_transport;
        if (!transport) {
            return;
        }
        /* Board size changed (new engine config): contract v1 has no
         * resize, so detach and attach fresh. */
        this.enqueueNativeOp(() => transport.detach({ id: this.nativeId() }), "detach").catch(
            () => undefined,
        );
        this.native_state = "pending";
        this.setCanvasVisible(true);
        this.scheduleNativeSync();
    }

    private bailToCanvas(): void {
        const transport = this.native_transport;
        this.native_state = "bailed";
        this.setCanvasVisible(true);
        this.nativeLog("board needs features beyond contract v1; showing web canvas");
        if (transport && !this.native_overlay_suspended) {
            /* suspend() hides the native view; we have no use for the
             * snapshot here since the live canvas takes over. */
            this.enqueueNativeOp(() => transport.suspend({ id: this.nativeId() }), "suspend").catch(
                () => undefined,
            );
        }
    }

    private reengageNative(): void {
        const transport = this.native_transport;
        if (!transport) {
            return;
        }
        this.native_state = "active";
        this.native_last_update_json = "";
        this.pushNativeGeometry(true);
        this.pushNativeUpdate();
        if (this.native_overlay_suspended) {
            /* An overlay is open: the native view stays hidden and the
             * canvas stays visible as the board until resumeNativeView()
             * (the coordinator has no snapshot covering us -- its suspend
             * resolved null while we were bailed). */
            this.nativeLog("board v1-serviceable again; native re-engage deferred to resume");
            return;
        }
        this.enqueueNativeOp(() => transport.resume({ id: this.nativeId() }), "resume").catch(() =>
            this.recoverFromActiveTransportFailure("resume"),
        );
        this.setCanvasVisible(false);
        this.nativeLog("board v1-serviceable again; native view re-engaged");
    }

    /**
     * A transport rejection while the native view owns the pixels must
     * never be swallowed: the native bitmap would silently freeze over a
     * hidden canvas with no recovery path. Show the canvas immediately and
     * re-probe with a fresh attach (the reattach path): transient failures
     * recover on the next sync, persistent ones surface as an attach
     * rejection and become a permanent canvas fallback.
     */
    private recoverFromActiveTransportFailure(label: string): void {
        if (this.destroyed || this.native_state !== "active") {
            return;
        }
        this.nativeLog(`${label} rejected while active; showing canvas and re-probing`);
        this.reattachNative();
    }

    private pushNativeUpdate(): void {
        const transport = this.native_transport;
        if (!transport) {
            return;
        }
        const update: NativeBridgeUpdateOptions = {
            id: this.nativeId(),
            board: this.flattenBoard(),
            colorToMove: this.engine.player === 2 ? 2 : 1,
            lastMove: this.nativeLastMove(),
        };
        const json = JSON.stringify(update);
        if (json === this.native_last_update_json) {
            return;
        }
        this.native_last_update_json = json;
        this.enqueueNativeOp(() => transport.update(update), "update").catch(() =>
            this.recoverFromActiveTransportFailure("update"),
        );
    }

    private pushNativeGeometry(force: boolean = false): void {
        const transport = this.native_transport;
        if (!transport) {
            return;
        }
        const rect = this.measureNativeRect();
        const last = this.native_last_rect;
        if (
            !force &&
            last &&
            last.x === rect.x &&
            last.y === rect.y &&
            last.width === rect.width &&
            last.height === rect.height
        ) {
            return;
        }
        this.native_last_rect = rect;
        this.enqueueNativeOp(() => transport.move({ id: this.nativeId(), rect }), "move").catch(
            () => this.recoverFromActiveTransportFailure("move"),
        );
    }

    /** The board canvas's rect in CSS px content coordinates (client rect
     *  plus scroll offsets), per the geometry contract. */
    private measureNativeRect(): NativeBridgeRect {
        const r = this.board.getBoundingClientRect();
        const scroll_x = typeof window !== "undefined" ? window.scrollX : 0;
        const scroll_y = typeof window !== "undefined" ? window.scrollY : 0;
        return {
            x: r.left + scroll_x,
            y: r.top + scroll_y,
            width: r.width,
            height: r.height,
        };
    }

    /** Flat row-major 0/1/2 stones per the contract. */
    private flattenBoard(): number[] {
        const { width, height, board } = this.engine;
        const flat: number[] = new Array(width * height);
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                flat[y * width + x] = board[y][x];
            }
        }
        return flat;
    }

    private nativeLastMove(): { x: number; y: number } | undefined {
        if (this.dont_draw_last_move) {
            return undefined;
        }
        const m = this.engine.cur_move;
        if (m && m.x >= 0 && m.y >= 0) {
            return { x: m.x, y: m.y };
        }
        return undefined;
    }

    /** Resolve the selected goban theme down to the five colors contract
     *  v1 understands. Image-based board/stone themes degrade to their
     *  underlying flat colors; the native side shades procedurally. */
    private resolveNativeTheme(): NativeBridgeTheme {
        const board_color = this.theme_board?.getBackgroundCSS()["background-color"] || "#DCB35C";
        return {
            boardColor: normalizeColor(board_color),
            lineColor: normalizeColor(this.theme_board?.getLineColor() || "#000000"),
            blackStoneColor: normalizeColor(this.theme_black?.getBlackStoneColor() || "#000000"),
            whiteStoneColor: normalizeColor(this.theme_white?.getWhiteStoneColor() || "#ffffff"),
            backgroundColor: this.resolveSurroundColor(),
        };
    }

    /** The page color behind the board edges: first non-transparent
     *  background-color walking up from the board container. */
    private resolveSurroundColor(): string {
        try {
            let el: HTMLElement | null = this.parent;
            while (el) {
                const bg = getComputedStyle(el).backgroundColor;
                if (
                    bg &&
                    bg !== "transparent" &&
                    !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)
                ) {
                    return normalizeColor(bg);
                }
                el = el.parentElement;
            }
        } catch {
            // jsdom and detached elements: fall through to the default
        }
        return "#000000";
    }

    private setCanvasVisible(visible: boolean): void {
        const visibility = visible ? "" : "hidden";
        this.board.style.visibility = visibility;
        if (this.shadow_layer) {
            this.shadow_layer.style.visibility = visibility;
        }
    }
}

/** Normalize a CSS color to six-digit hex where cheaply possible
 *  (contract: "six-digit hex preferred"); pass through anything a canvas
 *  cannot normalize (or when no 2d context is available, e.g. jsdom). */
export function normalizeColor(color: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
        return color;
    }
    try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return color;
        }
        ctx.fillStyle = color;
        const normalized = ctx.fillStyle;
        if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
            return normalized;
        }
        const m = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const hex = (s: string) => parseInt(s, 10).toString(16).padStart(2, "0");
            return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
        }
        return normalized;
    } catch {
        return color;
    }
}
