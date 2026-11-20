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

import { _ } from "../../engine/translate";
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
/** Free orbit may drop well below the preset angles, but stops short of edge-on. */
const maxOrbitTilt = 75;
/** How long the camera takes to settle on the fitted distance after an orbit drag. */
const settleMs = 320;

class ThreeBoardView implements BoardView {
    public readonly element: HTMLCanvasElement;
    private readonly scene: BoardScene;
    private readonly ink: BoardOverlays;
    private readonly listeners = new AbortController();
    private readonly resize: ResizeObserver;
    private readonly restorePosition?: () => void;
    private media?: MediaQueryList;
    private frame = 0;
    private orbitKeyHeld = false;
    private cameraMode = false;
    private restoreTouchAction?: () => void;
    private cameraButton?: HTMLButtonElement;
    private orbitPointer?: { id: number; x: number; y: number };
    private orbitHost?: HTMLElement;
    private suppressOrbitClick = false;
    private previousOrbitPress = false;
    private orbitRotation?: number;
    private orbitTilt?: number;
    /** Camera distance held while an orbit drag is in progress. */
    private orbitDistance?: number;
    /** Easing back to the fitted distance after an orbit drag. */
    private orbitSettle?: { from: number; start: number };
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
            this.orbitHost = host;
            const touchInput = matchMedia("(any-pointer: coarse)");
            touchInput.addEventListener("change", this.updateCameraButton, { signal });
            this.updateCameraButton(touchInput);
            window.addEventListener("keydown", this.onOrbitKeyDown, { signal });
            window.addEventListener("keyup", this.onOrbitKeyUp, { signal });
            window.addEventListener("blur", this.stopOrbit, { signal });
            const capture = { capture: true, signal };
            host.addEventListener("pointerdown", this.onOrbitStart, capture);
            host.addEventListener("pointermove", this.onOrbitMove, capture);
            host.addEventListener("pointerup", this.onOrbitEnd, capture);
            host.addEventListener("pointercancel", this.onOrbitEnd, capture);
            host.addEventListener("lostpointercapture", this.onOrbitEnd, capture);
            host.addEventListener("mousemove", this.onOrbitMouseMove, capture);
            host.addEventListener("mouseup", this.onOrbitClick, capture);
            host.addEventListener("click", this.onOrbitClick, capture);
            host.addEventListener("dblclick", this.onOrbitClick, capture);
            const touchCapture = { ...capture, passive: false };
            host.addEventListener("touchstart", this.onOrbitTouch, touchCapture);
            host.addEventListener("touchmove", this.onOrbitTouch, touchCapture);
            host.addEventListener("touchend", this.onOrbitTouch, touchCapture);
            host.addEventListener("touchcancel", this.onOrbitTouch, touchCapture);
            this.watchPixelRatio();
            this.configure();
            this.goban.on("clock", this.onClock);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    private updateCameraButton = (input: MediaQueryList | MediaQueryListEvent): void => {
        if (!input.matches || this.owner.options.fixedCoordinates) {
            this.setCameraMode(false);
            this.cameraButton?.remove();
            this.cameraButton = undefined;
            this.stopOrbit();
            return;
        }
        if (this.cameraButton) {
            return;
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "goban-three-camera";
        button.style.cssText =
            "position:absolute;top:6px;right:6px;z-index:2;min-width:34px;height:34px;" +
            "margin:0;padding:0 7px;display:flex;align-items:center;justify-content:center;" +
            "gap:5px;border:1px solid #ffffff70;border-radius:6px;background:#202027df;" +
            "color:white;cursor:pointer;touch-action:manipulation;font:600 13px system-ui";
        button.setAttribute("aria-label", _("Camera mode"));
        button.setAttribute("aria-pressed", "false");
        button.title = _("Camera mode");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("width", "18");
        icon.setAttribute("height", "18");
        icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(icon.namespaceURI, "path");
        path.setAttribute(
            "d",
            "M8 5l1.5-2h5L16 5h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm4 3a5 5 0 100 10 5 5 0 000-10zm0 2a3 3 0 110 6 3 3 0 010-6z",
        );
        path.setAttribute("fill", "currentColor");
        icon.append(path);
        const done = document.createElement("span");
        done.textContent = _("Done");
        done.hidden = true;
        button.append(icon, done);
        button.addEventListener(
            "click",
            (event) => {
                event.stopPropagation();
                this.setCameraMode(!this.cameraMode);
                button.setAttribute("aria-pressed", String(this.cameraMode));
                button.title = this.cameraMode ? _("Done") : _("Camera mode");
                button.style.background = this.cameraMode ? "#175ca8" : "#202027df";
                done.hidden = !this.cameraMode;
                this.invalidateHover();
            },
            { signal: this.listeners.signal },
        );
        this.cameraButton = button;
        (this.orbitHost?.shadowRoot ?? this.orbitHost)?.append(button);
    };

    private setCameraMode(enabled: boolean): void {
        this.cameraMode = enabled;
        const host = this.orbitHost;
        if (enabled && host) {
            const previous = host.style.touchAction;
            host.style.touchAction = "none";
            this.restoreTouchAction = () => {
                if (host.style.touchAction === "none") {
                    host.style.touchAction = previous;
                }
            };
        } else {
            this.restoreTouchAction?.();
            this.restoreTouchAction = undefined;
            this.stopOrbit();
        }
    }

    private onOrbitTouch = (event: TouchEvent): void => {
        const onButton = this.cameraButton && event.composedPath().includes(this.cameraButton);
        if (onButton || this.cameraMode) {
            if (!onButton) {
                event.preventDefault();
            }
            event.stopImmediatePropagation();
        }
    };

    private get orbitEnabled(): boolean {
        return !!this.owner.options.mouseOrbit && !this.owner.options.fixedCoordinates;
    }

    private onOrbitKeyDown = (event: KeyboardEvent): void => {
        if (
            this.orbitEnabled &&
            event.key.toLowerCase() === "v" &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.isComposing &&
            !event.defaultPrevented &&
            !(
                event.target instanceof Element &&
                event.target.closest("input, textarea, select, [contenteditable], [role=textbox]")
            )
        ) {
            this.orbitKeyHeld = true;
        }
    };

    private onOrbitKeyUp = (event: KeyboardEvent): void => {
        if (event.key.toLowerCase() === "v") {
            this.orbitKeyHeld = false;
        }
    };

    private onOrbitStart = (event: PointerEvent): void => {
        this.previousOrbitPress = this.suppressOrbitClick;
        this.suppressOrbitClick = false;
        const onButton = this.cameraButton && event.composedPath().includes(this.cameraButton);
        const canOrbit =
            this.cameraMode ||
            (event.pointerType === "mouse" && this.orbitEnabled && this.orbitKeyHeld);
        if (
            onButton ||
            !canOrbit ||
            !this.projection ||
            !event.isPrimary ||
            event.button !== 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        this.orbitHost?.setPointerCapture(event.pointerId);
        this.orbitPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        // Hold the current distance (mid-settle included) so the board doesn't zoom while turning.
        this.orbitDistance = this.projection.distance;
        this.orbitSettle = undefined;
        this.suppressOrbitClick = true;
        this.invalidateHover();
    };

    private onOrbitMove = (event: PointerEvent): void => {
        const pointer = this.orbitPointer;
        if (!pointer || pointer.id !== event.pointerId) {
            return;
        }
        event.stopImmediatePropagation();
        const rotation = this.orbitRotation ?? this.owner.options.rotation ?? 0;
        const tilt = this.orbitTilt ?? this.defaultTilt;
        // Drag as if grabbing the board, like Blender's turntable orbit: dragging right turns
        // the near edge right, and dragging down tips the top towards the viewer. Mouse and
        // touch behave the same.
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        this.orbitRotation = (((rotation - dx * 0.4) % 360) + 360) % 360;
        this.orbitTilt = Math.max(0, Math.min(maxOrbitTilt, tilt - dy * 0.3));
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        this.invalidateHover();
    };

    private onOrbitEnd = (event: PointerEvent): void => {
        if (this.orbitPointer?.id === event.pointerId) {
            this.orbitPointer = undefined;
            this.releaseOrbitDistance();
            this.invalidateHover();
        }
    };

    /** Ease from the held orbit distance to the fitted one. */
    private releaseOrbitDistance(): void {
        if (this.orbitDistance !== undefined) {
            this.orbitSettle = { from: this.orbitDistance, start: performance.now() };
            this.orbitDistance = undefined;
        }
    }

    /** Distance override for this frame, or undefined to use the fitted distance. */
    private chooseOrbitDistance(fitted: number): number {
        if (this.orbitDistance !== undefined) {
            return this.orbitDistance;
        }
        const settle = this.orbitSettle;
        if (!settle) {
            return fitted;
        }
        const t = Math.min(1, (performance.now() - settle.start) / settleMs);
        if (t >= 1) {
            this.orbitSettle = undefined;
            return fitted;
        }
        const eased = 1 - (1 - t) ** 3;
        return settle.from + (fitted - settle.from) * eased;
    }

    private onOrbitMouseMove = (event: MouseEvent): void => {
        if (this.orbitPointer) {
            event.stopImmediatePropagation();
        }
    };

    private onOrbitClick = (event: MouseEvent): void => {
        if (
            event.button === 0 &&
            (event.type === "mouseup" || event.detail > 0) &&
            (this.suppressOrbitClick || (event.type === "dblclick" && this.previousOrbitPress))
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };

    private stopOrbit = (): void => {
        this.orbitKeyHeld = false;
        const id = this.orbitPointer?.id;
        this.orbitPointer = undefined;
        this.releaseOrbitDistance();
        if (id !== undefined && this.orbitHost?.hasPointerCapture(id)) {
            this.orbitHost.releasePointerCapture(id);
        }
    };

    private get defaultTilt(): number {
        return this.owner.options.tilt ?? (this.owner.options.boardStyle === "floor" ? 35 : 15);
    }

    public cameraSettingsChanged(previous: ThreeRendererOptions): void {
        if (previous.rotation !== this.owner.options.rotation) {
            this.orbitRotation = undefined;
        }
        if (previous.tilt !== this.owner.options.tilt) {
            this.orbitTilt = undefined;
        }
        if (!this.orbitEnabled && !this.cameraMode) {
            this.stopOrbit();
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
        const rotation = this.orbitRotation ?? this.owner.options.rotation ?? 0;
        const view = [rotation, !!this.owner.options.mirror];
        const tilt = this.orbitTilt ?? this.defaultTilt;
        // While held or settling, the distance changes without the view inputs changing.
        const distanceKey = this.orbitDistance ?? (this.orbitSettle ? performance.now() : "fit");
        const geometry = [bounds, width, height, devicePixelRatio, tilt, distanceKey, ...view].join(
            "/",
        );
        if (!this.projection || this.geometry !== geometry) {
            this.projection = new BoardProjection(state.bounds, {
                ...this.owner.options,
                rotation,
            });
            this.projection.fit(width, height, tilt, (fitted) => this.chooseOrbitDistance(fitted));
            if (this.orbitSettle) {
                this.invalidateHover();
            }
            this.geometry = geometry;
            const viewKey = view.join("/");
            this.holdView =
                !!this.owner.options.fixedCoordinates && !!this.viewKey && viewKey !== this.viewKey;
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
        const hover = this.cameraMode || this.orbitPointer ? undefined : this.goban.boardViewHover;
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
            this.stopOrbit();
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
        this.setCameraMode(false);
        this.listeners.abort();
        this.cameraButton?.remove();
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
        const previous = this.options;
        this.options = { ...this.options, ...options };
        this.view?.cameraSettingsChanged(previous);
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
