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

import { GobanEngine } from "../engine";
import { MoveTree } from "../engine/MoveTree";
import { GobanSelectedThemes } from "./Goban";
import { ResolvedThemes } from "./NativeThemeAssets";
import { GobanTheme } from "./themes";
import { callbacks } from "./callbacks";
import {
    allocateCanvasOrError,
    getRelativeEventPosition,
    resizeDeviceScaledCanvas,
} from "./canvas_utils";

declare let ResizeObserver: any;

interface ViewPortInterface {
    offset_x: number;
    offset_y: number;
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
}

/**
 * The slice of a renderer the move tree canvas drives. Kept as an interface
 * so the move tree can be built and tested without a full renderer.
 */
export interface MoveTreeHost {
    engine: GobanEngine;
    destroyed: boolean;
    square_size: number;
    present_next_move: boolean;
    clickJumpTarget(node: MoveTree): MoveTree;
    syncReviewMove(): void;
    setLabelCharacterFromMarks(): void;
    updateTitleAndStonePlacement(): void;
    emit(event: "update"): void;
    emit(event: "played-by-click", player: { player_id: number; x: number; y: number }): void;
    redraw(force?: boolean): void;
    on(event: "destroy", cb: () => void): void;
}

/**
 * Standalone canvas move tree, extracted from the canvas renderer so
 * GobanNativeRenderer (which owns no pixels of the board itself) can present
 * one from the same code. The widget owns its own `<canvas>` and inner
 * container inside the scrolling element the host hands it.
 */
export class MoveTreeCanvas {
    private readonly host: MoveTreeHost;
    private readonly resolved: () => ResolvedThemes;
    private readonly themes: () => GobanSelectedThemes;

    private _container?: HTMLElement;
    private inner_container?: HTMLDivElement;
    private canvas?: HTMLCanvasElement;

    /** Pre-rendered stones at `MoveTree.stone_radius`, keyed by theme name.
     *  The theme instance is kept alongside so a re-themed host (a new theme
     *  object under the same name, as "Custom" does) re-renders. */
    private stone_cache: { [key: string]: { theme: GobanTheme; stones: any } } = {};

    constructor(
        host: MoveTreeHost,
        resolved: () => ResolvedThemes,
        themes: () => GobanSelectedThemes,
    ) {
        this.host = host;
        this.resolved = resolved;
        this.themes = themes;
    }

    public get container(): HTMLElement | undefined {
        return this._container;
    }

    public setContainer(container: HTMLElement | null): void {
        if (this._container !== (container ?? undefined)) {
            this.removeFromDOM();
        }
        this._container = container ?? undefined;
        this.redraw();
    }

    /**
     * Removes this goban's move tree elements from the container so another
     * goban can take the container over without our stale tree lingering
     * behind its own.
     */
    private removeFromDOM(): void {
        if (this.inner_container) {
            this.inner_container.remove();
        }
        delete this.inner_container;
        delete this.canvas;
    }

    public destroy(): void {
        this.removeFromDOM();
        delete this._container;
        this.stone_cache = {};
    }

    public redraw(no_warp?: boolean): void {
        if (this.host.destroyed || !this._container) {
            return;
        }

        let do_init = false;
        if (!this.inner_container) {
            do_init = true;
            this.inner_container = document.createElement("div");
            this.canvas = allocateCanvasOrError();
            this.inner_container.appendChild(this.canvas);
            this._container.appendChild(this.inner_container);
            this.bindCanvasEvents(this.canvas);
            this._container.style.position = "relative";
            this.canvas.style.position = "absolute";

            try {
                const observer = new ResizeObserver(() => {
                    this.redraw(true);
                });
                observer.observe(this._container);
                this.host.on("destroy", () => {
                    observer.disconnect();
                });
            } catch (e) {
                // ResizeObserver is still fairly new and might not exist
            }
        }

        if (!this.canvas) {
            console.warn(`move_tree_redraw called without move_tree_canvas set`);
            return;
        }

        if (do_init || this.inner_container.parentNode !== this._container) {
            const move_tree_on_scroll = (event: Event) => {
                try {
                    this.redraw(true);
                } catch (e) {
                    console.error(e);
                }
            };

            this._container.appendChild(this.inner_container);
            this._container.style.position = "relative";
            this._container.removeEventListener("scroll", move_tree_on_scroll);
            this._container.addEventListener("scroll", move_tree_on_scroll);
            const mt = this._container;
            this.host.on("destroy", () => {
                mt.removeEventListener("scroll", move_tree_on_scroll);
            });
        }

        const engine = this.host.engine;

        engine.move_tree.recomputeIsobranches();
        const active_path_end =
            this.host.present_next_move && engine.cur_move.trunk_next
                ? engine.cur_move.trunk_next
                : engine.cur_move;

        engine.move_tree_layout_dirty = false;

        active_path_end.setActivePath(++MoveTree.active_path_number);

        const canvas = this.canvas;

        engine.move_tree_layout_vector = [];
        const layout_hash = {};
        engine.move_tree.layout(0, 0, layout_hash, 0);
        engine.move_tree_layout_hash = layout_hash;
        let max_height = 0;
        for (let i = 0; i < engine.move_tree_layout_vector.length; ++i) {
            max_height = Math.max(engine.move_tree_layout_vector[i] + 1, max_height);
        }

        const div_clientWidth = this._container.clientWidth;
        const div_clientHeight = this._container.clientHeight;
        const width = Math.max(
            div_clientWidth,
            engine.move_tree_layout_vector.length * MoveTree.stone_square_size,
        );
        const height = Math.max(div_clientHeight, max_height * MoveTree.stone_square_size);

        let div_scroll_top = this._container.scrollTop;
        let div_scroll_left = this._container.scrollLeft;

        if (canvas.width !== div_clientWidth || canvas.height !== div_clientHeight) {
            resizeDeviceScaledCanvas(canvas, div_clientWidth, div_clientHeight);
        }

        this.inner_container.style.width = width + "px";
        this.inner_container.style.height = height + "px";

        if (!no_warp) {
            /* make sure our active stone is visible, but don't scroll around unnecessarily */
            if (
                div_scroll_left > active_path_end.layout_cx ||
                div_scroll_left + div_clientWidth - 20 < active_path_end.layout_cx ||
                div_scroll_top > active_path_end.layout_cy ||
                div_scroll_top + div_clientHeight - 20 < active_path_end.layout_cy
            ) {
                this._container.scrollLeft = active_path_end.layout_cx - div_clientWidth / 2;
                this._container.scrollTop = active_path_end.layout_cy - div_clientHeight / 2;
                div_scroll_top = this._container.scrollTop;
                div_scroll_left = this._container.scrollLeft;
            }
        }

        canvas.style.top = div_scroll_top + "px";
        canvas.style.left = div_scroll_left + "px";

        const viewport = {
            offset_x: div_scroll_left,
            offset_y: div_scroll_top,
            minx: div_scroll_left - MoveTree.stone_square_size,
            miny: div_scroll_top - MoveTree.stone_square_size,
            maxx: div_scroll_left + div_clientWidth + MoveTree.stone_square_size,
            maxy: div_scroll_top + div_clientHeight + MoveTree.stone_square_size,
        };

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
            throw new Error(`Failed to get drawing context for move tree canvas`);
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        this.hilightNode(ctx, active_path_end, "#6BAADA", viewport);

        if (engine.cur_review_move && engine.cur_review_move.id !== active_path_end.id) {
            this.hilightNode(ctx, engine.cur_review_move, "#6BDA6B", viewport);
        }

        ctx.save();
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = this.resolved().board.getLineColor();
        this.recursiveDrawPath(ctx, engine.move_tree, viewport);
        ctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        const text_size = 10;
        ctx.font = `bold ${text_size}px Verdana,Arial,sans-serif`;
        ctx.textBaseline = "middle";
        this.drawRecursive(ctx, engine.move_tree, MoveTree.active_path_number, viewport);
        ctx.restore();
    }

    private bindCanvasEvents(canvas: HTMLCanvasElement): void {
        const handler = (event: TouchEvent | MouseEvent) => {
            try {
                if (!this._container) {
                    throw new Error(`move_tree_container was not set`);
                }

                const ox = this._container.scrollLeft;
                const oy = this._container.scrollTop;
                const pos = getRelativeEventPosition(event);
                pos.x += ox;
                pos.y += oy;
                const i = Math.floor(pos.x / MoveTree.stone_square_size);
                const j = Math.floor(pos.y / MoveTree.stone_square_size);
                const node = this.host.engine.move_tree.getNodeAtLayoutPosition(i, j);

                if (node) {
                    const target = this.host.clickJumpTarget(node);
                    if (this.host.engine.cur_move.id !== target.id) {
                        this.host.engine.jumpTo(target);
                        this.host.setLabelCharacterFromMarks();
                        this.host.updateTitleAndStonePlacement();
                        this.host.emit("update");
                        this.host.syncReviewMove();
                        this.host.redraw();
                    }
                    if (node.played_by) {
                        // note that getRelativeEventPosition handles various
                        // nasty looking things to do with Touch etc, so using it here
                        // gets around that kind of thing, even though in theory it
                        // might be nicer to sent the client absolute coords, maybe.
                        const rpos = getRelativeEventPosition(event);
                        this.host.emit("played-by-click", {
                            player_id: node.played_by,
                            x: rpos.x,
                            y: rpos.y,
                        });
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        canvas.addEventListener("touchstart", handler);
        canvas.addEventListener("mousedown", handler);

        this.host.on("destroy", () => {
            canvas.removeEventListener("touchstart", handler);
            canvas.removeEventListener("mousedown", handler);
        });
    }

    /** Pre-renders (and caches) the tree-sized stones for one of the
     *  currently selected stone themes. */
    private getStones(color: "black" | "white"): any {
        const theme = color === "black" ? this.resolved().black : this.resolved().white;
        const key = `${color}-${this.themes()[color]}-${MoveTree.stone_radius}`;
        const cached = this.stone_cache[key];
        if (cached && cached.theme === theme) {
            return cached.stones;
        }

        const on_deferred = () => this.redraw();
        const stones =
            color === "black"
                ? theme.preRenderBlack(MoveTree.stone_radius, 2081, on_deferred)
                : theme.preRenderWhite(MoveTree.stone_radius, 23434, on_deferred);
        this.stone_cache[key] = { theme, stones };
        return stones;
    }

    private drawStone(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        active_path_number: number,
        viewport: ViewPortInterface,
    ): void {
        const stone_idx = node.move_number * 31;
        const cx = node.layout_cx - viewport.offset_x;
        const cy = node.layout_cy - viewport.offset_y;
        const color = node.player;
        const on_path = node.active_path_number === active_path_number;

        if (!on_path) {
            ctx.save();
            ctx.globalAlpha = 0.4;
        }

        const theme_white_stones = this.getStones("white");
        const theme_black_stones = this.getStones("black");

        if (!theme_white_stones || !theme_black_stones) {
            throw new Error("Failed to load stone images for given radius" + MoveTree.stone_radius);
        }

        if (color === 1) {
            const stone = theme_black_stones[stone_idx % theme_black_stones.length];
            this.resolved().black.placeBlackStone(ctx, null, stone, cx, cy, MoveTree.stone_radius);
        } else if (color === 2) {
            const stone = theme_white_stones[stone_idx % theme_white_stones.length];
            this.resolved().white.placeWhiteStone(ctx, null, stone, cx, cy, MoveTree.stone_radius);
        } else {
            return;
        }

        const text_color =
            color === 1
                ? this.resolved().black.getBlackTextColor()
                : this.resolved().white.getWhiteTextColor();

        let label = "";
        switch (callbacks.getMoveTreeNumbering ? callbacks.getMoveTreeNumbering() : "move-number") {
            case "move-coordinates":
                label = node.pretty_coordinates;
                break;

            case "none":
                label = "";
                break;

            case "move-number":
            default:
                if (node.pretty_coordinates === "pass") {
                    label = String(".");
                } else {
                    label = String(node.move_number);
                }
                break;
        }

        if (node.label !== label) {
            node.label = label;
            delete node.label_metrics;
        }

        ctx.fillStyle = text_color;
        //ctx.strokeStyle=text_outline_color;
        if (!node.label_metrics) {
            node.label_metrics = ctx.measureText(node.label);
        }
        const metrics = node.label_metrics;
        const xx = cx - metrics.width / 2;
        const yy =
            cy +
            (/WebKit|Trident/.test(navigator.userAgent)
                ? MoveTree.stone_radius * -0.01
                : 1); /* middle centering is different on firefox */
        //ctx.strokeText(node.label, xx, yy);
        ctx.fillText(node.label, xx, yy);

        if (!on_path) {
            ctx.restore();
        }

        let ring_color = null;

        if (node.text) {
            ring_color = "#3333ff";
        }
        if (node.correct_answer) {
            ring_color = "#33ff33";
        }
        if (node.wrong_answer) {
            ring_color = "#ff3333";
        }
        if (ring_color) {
            ctx.beginPath();
            ctx.strokeStyle = ring_color;
            ctx.lineWidth = 2.0;
            ctx.arc(cx, cy, MoveTree.stone_radius, 0, 2 * Math.PI, true);
            ctx.stroke();
        }
    }

    private drawRecursive(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        active_path_number: number,
        viewport: ViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.drawRecursive(ctx, node.trunk_next, active_path_number, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.drawRecursive(ctx, node.branches[i], active_path_number, viewport);
        }

        if (
            !viewport ||
            (node.layout_cx >= viewport.minx &&
                node.layout_cx <= viewport.maxx &&
                node.layout_cy >= viewport.miny &&
                node.layout_cy <= viewport.maxy)
        ) {
            this.drawStone(ctx, node, active_path_number, viewport);
        }
    }

    private hilightNode(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        color: string,
        viewport: ViewPortInterface,
    ): void {
        ctx.beginPath();
        const sx =
            Math.round(node.layout_cx - MoveTree.stone_square_size * 0.5) - viewport.offset_x;
        const sy =
            Math.round(node.layout_cy - MoveTree.stone_square_size * 0.5) - viewport.offset_y;
        ctx.rect(sx, sy, MoveTree.stone_square_size, MoveTree.stone_square_size);
        ctx.fillStyle = color;
        ctx.fill();
    }

    private drawPath(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        viewport: ViewPortInterface,
    ): void {
        if (node.parent) {
            if (node.parent.layout_cx < viewport.minx && node.layout_cx < viewport.minx) {
                return;
            }
            if (node.parent.layout_cy < viewport.miny && node.layout_cy < viewport.miny) {
                return;
            }
            if (node.parent.layout_cx > viewport.maxx && node.layout_cx > viewport.maxx) {
                return;
            }
            if (node.parent.layout_cy > viewport.maxy && node.layout_cy > viewport.maxy) {
                return;
            }

            ctx.beginPath();
            ctx.strokeStyle = node.trunk ? "#000000" : MoveTree.line_colors[node.line_color];
            const ox = viewport.offset_x;
            const oy = viewport.offset_y;
            ctx.moveTo(node.parent.layout_cx - ox, node.parent.layout_cy - oy);
            ctx.quadraticCurveTo(
                node.layout_cx - MoveTree.stone_square_size * 0.5 - ox,
                node.layout_cy - oy,
                node.layout_cx - ox,
                node.layout_cy - oy,
            );
            ctx.stroke();
        }
    }

    private drawIsoBranchTo(
        ctx: CanvasRenderingContext2D,
        from_node: MoveTree,
        to_node: MoveTree,
        viewport: ViewPortInterface,
    ): void {
        let A: MoveTree = from_node;
        let B: MoveTree = to_node;

        /* don't render if it's off screen */
        if (A.layout_cx < viewport.minx && B.layout_cx < viewport.minx) {
            return;
        }
        if (A.layout_cy < viewport.miny && B.layout_cy < viewport.miny) {
            return;
        }
        if (A.layout_cx > viewport.maxx && B.layout_cx > viewport.maxx) {
            return;
        }
        if (A.layout_cy > viewport.maxy && B.layout_cy > viewport.maxy) {
            return;
        }

        /*
        let isStrong = (a, b):boolean => {
            return a.trunk_next === null && a.branches.length === 0 && (b.trunk_next != null || b.branches.length !== 0);
        };
        */

        // isStrong(B, A)) {
        if (
            B.trunk_next === null &&
            B.branches.length === 0 &&
            (A.trunk_next !== null || A.branches.length !== 0)
        ) {
            const t = A;
            A = B;
            B = t;
        }

        //isStrong(A, B);
        const strong =
            A.trunk_next == null &&
            A.branches.length === 0 &&
            (B.trunk_next !== null || B.branches.length !== 0);

        const ox = viewport.offset_x;
        const oy = viewport.offset_y;
        ctx.beginPath();
        ctx.strokeStyle = MoveTree.isobranch_colors[strong ? "strong" : "weak"];
        const cur_line_width = ctx.lineWidth;
        ctx.lineWidth = 2;
        ctx.moveTo(B.layout_cx - ox, B.layout_cy - oy);
        const my = strong ? B.layout_cy : (A.layout_cy + B.layout_cy) / 2;
        const mx = (A.layout_cx + B.layout_cx) / 2 + MoveTree.stone_square_size * 0.5;
        ctx.quadraticCurveTo(mx - ox, my - oy, A.layout_cx - ox, A.layout_cy - oy);
        ctx.stroke();
        ctx.lineWidth = cur_line_width;
    }

    private recursiveDrawPath(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        viewport: ViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.recursiveDrawPath(ctx, node.trunk_next, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.recursiveDrawPath(ctx, node.branches[i], viewport);
        }

        if (node.isobranches) {
            for (let i = 0; i < node.isobranches.length; ++i) {
                this.drawIsoBranchTo(ctx, node, node.isobranches[i], viewport);
            }
        }

        /* only consider x, since lines can extend awhile on the y */
        //if (this.layout_cx >= viewport.minx && this.layout_cx <= viewport.maxx) {
        this.drawPath(ctx, node, viewport);
        //}
    }
}
