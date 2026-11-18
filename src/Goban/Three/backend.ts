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

import type { JGOFClock } from "../../engine";
import type { BoardPoint, BoardView, BoardViewState } from "../BoardView";
import type { GobanSelectedThemes } from "../Goban";
import type { SVGRenderer } from "../SVGRenderer";
import type { ThreeRenderer, ThreeRendererOptions } from "../ThreeConfig";
import { resolveAppearance, type Appearance } from "./appearance";
import { lightingPresets } from "./lighting";
import { BoardOverlays } from "./overlays";
import { BoardProjection } from "./projection";
import { BoardScene } from "./scene";

const installed = new WeakMap<SVGRenderer, ThreeController>();

class ThreeBoardView implements BoardView {
    public readonly element: HTMLCanvasElement;
    private readonly scene: BoardScene;
    private readonly ink: BoardOverlays;
    private readonly listeners = new AbortController();
    private readonly resize: ResizeObserver;
    private readonly restorePosition?: () => void;
    private media?: MediaQueryList;
    private frame = 0;
    private boardDirty = true;
    private state?: BoardViewState;
    private revision = 0;
    private disposed = false;
    private projection?: BoardProjection;
    private geometry = "";
    private boundsKey = "";
    private inkKey = "";
    private viewKey = "";
    /** Hold the previous frame after a rotation or mirror until the relabelled ink is ready. */
    private holdView = false;
    private appearance?: Appearance;
    private frames = 0;
    private clock: JGOFClock | null;

    public constructor(
        private readonly goban: SVGRenderer,
        private readonly owner: ThreeController,
    ) {
        this.element = document.createElement("canvas");
        this.element.className = "goban-three-board";
        this.element.style.cssText =
            "position:absolute;inset:0;width:100%;height:100%;touch-action:none";
        this.element.setAttribute("aria-hidden", "true");
        this.scene = new BoardScene(this.element);
        try {
            this.clock = goban.last_emitted_clock ?? null;
            this.ink = new BoardOverlays(
                owner.options.annotationInspection,
                this.scene.annotations,
            );
            this.element.dataset.context = "ready";
            this.resize = new ResizeObserver(() => this.invalidate());
            const host = goban.config.board_div!;
            if (getComputedStyle(host).position === "static") {
                const previous = host.style.position;
                host.style.position = "relative";
                this.restorePosition = () => {
                    if (host.style.position === "relative") {
                        host.style.position = previous;
                    }
                };
            }
            this.resize.observe(host);
            const { signal } = this.listeners;
            document.addEventListener("visibilitychange", this.onVisibility, { signal });
            this.element.addEventListener("webglcontextlost", this.onContextLost, { signal });
            this.watchPixelRatio();
            this.configure();
            this.goban.on("clock", this.onClock);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    public configure(): void {
        const options = this.owner.options;
        const settings = options.lighting;
        const preset = settings?.preset ?? "studio";
        const azimuth = Number.isFinite(settings?.azimuth)
            ? settings!.azimuth!
            : lightingPresets[preset].azimuth;
        const intensity = Number.isFinite(settings?.intensity)
            ? Math.min(2, Math.max(0, settings!.intensity!))
            : 1;
        this.scene.setLighting({ preset, azimuth, intensity });
        this.geometry = "";
        this.invalidate();
    }

    public setTheme(themes: GobanSelectedThemes): void {
        this.appearance = resolveAppearance(themes);
        this.scene.applyTheme(this.appearance, this.invalidate);
        this.boundsKey = "";
        this.invalidate();
    }

    public invalidate = (): void => {
        this.boardDirty = true;
        this.invalidateHover();
    };

    public invalidateHover = (): void => {
        if (!this.disposed && !this.frame && !document.hidden && this.goban.boardDrawingEnabled) {
            this.frame = requestAnimationFrame(this.draw);
        }
    };

    private draw = (): void => {
        this.frame = 0;
        if (
            this.disposed ||
            document.hidden ||
            !this.appearance ||
            !this.goban.boardDrawingEnabled
        ) {
            return;
        }
        try {
            this.render();
        } catch (error) {
            this.owner.fallback(error);
        }
    };

    private render(): void {
        if (this.goban.engine.width > 25 || this.goban.engine.height > 25) {
            throw new Error("3D supports boards up to 25 intersections per side");
        }
        const frameStart = performance.now();
        const { width, height } = this.element.getBoundingClientRect();
        if (!width || !height) {
            return;
        }
        const appearance = this.appearance!;
        const [black, white] = appearance.stones;
        const colors = {
            black_stone: black.color,
            white_stone: white.color,
            black_text: black.text,
            white_text: white.text,
            blank_text: appearance.board.text,
        };
        const updateBoard = this.boardDirty || !this.state;
        if (updateBoard) {
            this.state = this.goban.getBoardViewState(colors);
            this.boardDirty = false;
        }
        const state = this.state!;
        const style = this.owner.options.boardStyle ?? "tabletop";
        const room = this.owner.options.room ?? false;
        const bounds = JSON.stringify([state.bounds, style, room]);
        const view = [this.owner.options.rotation ?? 0, !!this.owner.options.mirror];
        const geometry = [bounds, width, height, devicePixelRatio, ...view].join("/");
        if (!this.projection || this.geometry !== geometry) {
            this.projection = new BoardProjection(state.bounds, this.owner.options);
            const tilt = this.owner.options.tilt ?? (style === "floor" ? 35 : 15);
            this.projection.fit(width, height, tilt);
            this.geometry = geometry;
            const viewKey = view.join("/");
            this.holdView = !!this.viewKey && viewKey !== this.viewKey;
            this.viewKey = viewKey;
            this.scene.setMirror(this.projection.mirror, this.projection.mirrorX);
            const fixed = !!this.owner.options.fixedCoordinates;
            const textRotation = fixed ? this.projection.rotation : 0;
            if (
                this.ink.mirror !== this.projection.mirror ||
                this.ink.textRotation !== textRotation ||
                this.ink.fixedCoordinates !== fixed
            ) {
                this.ink.mirror = this.projection.mirror;
                this.ink.textRotation = textRotation;
                this.ink.fixedCoordinates = fixed;
                this.inkKey = "";
            }
            this.element.dataset.rotation = String(this.projection.rotation);
            this.element.dataset.mirror = String(this.projection.mirror);
            this.scene.resize(
                width,
                height,
                Math.min(devicePixelRatio, Math.max(1, this.owner.options.maxPixelRatio ?? 1.75)),
            );
            const camera = this.projection.camera;
            this.element.dataset.tilt = String(tilt);
            this.element.dataset.viewport = `${width}x${height}`;
            this.element.dataset.distance = String(
                camera.position.y / Math.cos((tilt * Math.PI) / 180),
            );
            this.element.dataset.focalPixels = String(
                (height * camera.zoom) / (2 * Math.tan((camera.fov * Math.PI) / 360)),
            );
        }
        this.projection.stoneScale = appearance.scale;
        if (bounds !== this.boundsKey) {
            this.boundsKey = bounds;
            this.scene.rebuild(state.bounds, style, room);
            this.element.dataset.boardStyle = style;
            this.inkKey = "";
        }
        if (updateBoard || !this.inkKey) {
            const key = JSON.stringify([
                this.goban.engine.board,
                state.overlays,
                state.lastMove,
                state.pen,
                state.labels,
                state.labelSystem,
                appearance.scale,
                appearance.board.text,
            ]);
            if (key !== this.inkKey) {
                this.inkKey = key;
                this.scene.update(
                    state.bounds,
                    state.width,
                    state.overlays,
                    state.stoneAt,
                    state.height,
                );
                this.element.dataset.ink = "pending";
                const revision = ++this.revision;
                void this.ink
                    .redraw(
                        this.projection,
                        state,
                        appearance.board.text,
                        state.overlays,
                        state.lastMove,
                        state.pen,
                    )
                    .then(() => {
                        if (!this.disposed && revision === this.revision) {
                            this.element.dataset.ink = "uploaded";
                            this.invalidateHover();
                        }
                    })
                    .catch((error: unknown) => {
                        if (!this.disposed && revision === this.revision) {
                            this.owner.fallback(error);
                        }
                    });
            }
        }
        const hover = this.goban.boardViewHover;
        const ghost = hover
            ? updateBoard
                ? state.ghost
                : this.goban.getBoardViewGhost(colors)
            : null;
        const occupied = !!(hover && state.stoneAt(hover));
        const eligible =
            hover &&
            (!ghost?.only ||
                ghost.only.some((point) => point.x === hover.x && point.y === hover.y));
        this.scene.preview(eligible && !occupied ? hover : null, ghost?.stone);
        this.ink.preview(eligible ? hover : null, ghost, occupied, this.invalidateHover);
        this.element.dataset.hover = hover ? `${hover.x},${hover.y}` : "";
        this.scene.updateCaptures(
            this.goban.engine.getBlackPrisoners(),
            this.goban.engine.getWhitePrisoners(),
        );
        this.scene.updateClock(this.clock);
        if (this.holdView && this.element.dataset.ink === "pending") {
            return;
        }
        this.holdView = false;
        this.scene.draw(this.projection);
        if (this.element.dataset.ink === "uploaded") {
            this.element.dataset.ink = "drawn";
        }
        this.element.dataset.frames = String(++this.frames);
        this.element.dataset.cpu = (performance.now() - frameStart).toFixed(2);
        this.element.dataset.calls = String(this.scene.renderer.info.render.calls);
        this.element.dataset.triangles = String(this.scene.renderer.info.render.triangles);
        this.element.dataset.textures = String(this.scene.renderer.info.memory.textures);
        this.element.dataset.geometries = String(this.scene.renderer.info.memory.geometries);
    }

    public pick(point: BoardPoint, antiSlip: boolean): BoardPoint | null {
        return (
            this.projection?.pick(
                point,
                ({ x, y }) => !!this.goban.engine.board[y]?.[x],
                antiSlip,
            ) ?? null
        );
    }

    public unproject(point: BoardPoint): BoardPoint | null {
        const hit = this.projection?.unproject(point);
        const bounds = this.projection?.bounds;
        return hit &&
            bounds &&
            hit.x >= bounds.left - 0.5 &&
            hit.x <= bounds.right + 0.5 &&
            hit.y >= bounds.top - 0.5 &&
            hit.y <= bounds.bottom + 0.5
            ? hit
            : null;
    }

    private watchPixelRatio = (): void => {
        this.media?.removeEventListener("change", this.watchPixelRatio);
        this.media = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
        this.media.addEventListener("change", this.watchPixelRatio);
        this.invalidate();
    };

    private onClock = (clock: JGOFClock | null): void => {
        this.clock = clock;
        if (this.scene.updateClock(clock)) {
            this.invalidateHover();
        }
    };

    private onVisibility = (): void => {
        if (document.hidden) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        } else {
            this.invalidate();
        }
    };

    private onContextLost = (event: Event): void => {
        event.preventDefault();
        this.owner.fallback(new Error("WebGL context lost"));
    };

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.listeners.abort();
        this.goban.off("clock", this.onClock);
        cancelAnimationFrame(this.frame);
        this.media?.removeEventListener("change", this.watchPixelRatio);
        try {
            this.resize?.disconnect();
            this.restorePosition?.();
            this.ink?.dispose();
            this.scene.dispose();
        } finally {
            this.scene.renderer.forceContextLoss();
        }
    }
}

class ThreeController implements ThreeRenderer {
    private view?: ThreeBoardView;
    public constructor(
        public readonly goban: SVGRenderer,
        public options: ThreeRendererOptions,
    ) {
        goban.on("destroy", () => {
            this.view = undefined;
            installed.delete(goban);
        });
    }
    public get active(): boolean {
        return !!this.view && !this.goban.destroyed;
    }
    public enable(): boolean {
        if (this.active) {
            return true;
        }
        if (this.goban.destroyed || !this.goban.config.board_div) {
            return false;
        }
        try {
            if (this.goban.engine.width > 25 || this.goban.engine.height > 25) {
                throw new Error("3D supports boards up to 25 intersections per side");
            }
            this.view = new ThreeBoardView(this.goban, this);
            if (this.goban.switchBoardView(this.view)) {
                return true;
            }
            this.view = undefined;
            return false;
        } catch (error) {
            this.fallback(error);
            return false;
        }
    }
    public disable(): void {
        if (!this.view) {
            return;
        }
        const view = this.view;
        this.view = undefined;
        this.goban.switchBoardView();
        view.dispose();
    }
    public configure(options: ThreeRendererOptions): void {
        this.options = { ...this.options, ...options };
        this.view?.configure();
    }
    public fallback(error: unknown): void {
        this.disable();
        this.options.onFallback?.(error);
    }
}

export function attachThree(goban: SVGRenderer, options: ThreeRendererOptions): ThreeRenderer {
    let controller = installed.get(goban);
    if (controller) {
        controller.configure(options);
    } else {
        controller = new ThreeController(goban, options);
        installed.set(goban, controller);
    }
    controller.enable();
    return controller;
}
