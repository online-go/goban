/*
 * Copyright 2012-2020 Online-Go.com
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

import { JGOF, JGOFNumericPlayerColor } from "./JGOF";
import { AdHocFormat } from "./AdHocFormat";

import {
    GobanCore,
    GobanConfig,
    GobanSelectedThemes,
    GobanMetrics,
    SCORE_ESTIMATION_TRIALS,
    SCORE_ESTIMATION_TOLERANCE,
} from "./GobanCore";
import { GoEngine, encodeMove, encodeMoves } from "./GoEngine";
import { GoMath, Group } from "./GoMath";
import { MarkInterface, MoveTree } from "./MoveTree";
import { GoTheme } from "./GoTheme";
import { GoThemes } from "./GoThemes";

import { MoveTreePenMarks } from "./MoveTree";
import { createDeviceScaledCanvas, resizeDeviceScaledCanvas } from "./GoUtil";
import { getRelativeEventPosition, getRandomInt } from "./GoUtil";
import { _ } from "./translate";

const __theme_cache: {
    [bw: string]: { [name: string]: { [size: string]: any } };
} = {
    black: {},
    white: {},
};

declare let ResizeObserver: any;

export interface GobanCanvasConfig extends GobanConfig {
    board_div?: HTMLElement;
    title_div?: HTMLElement;
    move_tree_container?: HTMLElement;
}

interface ViewPortInterface {
    offset_x: number;
    offset_y: number;
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
}

interface DrawingInfo {
    ctx: CanvasRenderingContext2D;
    stoneColor: number;
    size: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    radius: number;
    xCenter: number;
    yCenter: number;
    xOffset: number;
    yOffset: number;
    marks: MarkInterface;
    altmarking: string | undefined;
    textColor: string;
    movetree_contains_this_square: boolean;
    have_text_to_draw: boolean;
    draw_last_move: boolean;
    i: number; // board coordinates
    j: number;
    fullSquareDraw: boolean;
    hasMarks: boolean;
}

const HOT_PINK = "#ff69b4";

export class GobanCanvas extends GobanCore {
    public engine: GoEngine;
    private parent: HTMLElement;
    //private board_div: HTMLElement;
    private board: HTMLCanvasElement;
    private __set_board_height: number = -1;
    private __set_board_width: number = -1;
    private ready_to_draw: boolean = false;
    private message_div?: HTMLDivElement;
    private message_td?: HTMLElement;
    private message_text?: HTMLDivElement;
    private message_timeout?: number;
    private shadow_layer?: HTMLCanvasElement;
    private shadow_ctx?: CanvasRenderingContext2D;
    private grid_layer: HTMLCanvasElement; // for the board lines, coordinates, hoshi etc that do not change much
    private grid_ctx: CanvasRenderingContext2D;

    private handleShiftKey: (ev: KeyboardEvent) => void;

    public move_tree_container?: HTMLElement;
    private move_tree_inner_container?: HTMLDivElement;
    private move_tree_canvas?: HTMLCanvasElement;

    private __borders_initialized: boolean = false;
    private autoplaying_puzzle_move: boolean = false;
    private byoyomi_label: string = "";
    private ctx: CanvasRenderingContext2D;
    private current_pen_mark?: { color: string; points: [number, number] };
    private labeling_mode?: "put" | "clear";
    private last_label_position: { i: number; j: number } = { i: NaN, j: NaN };
    private last_pen_position?: [number, number];
    protected metrics: GobanMetrics = { width: NaN, height: NaN, mid: NaN, offset: NaN };

    private previous_marks: Array<Array<string>>;
    private previous_board: Array<Array<string>>;
    private drawQueue: any = {}; // a associative array of drawInfos indexed by coordinate

    private layer_offset_left: number = 0;
    private layer_offset_top: number = 0;
    private pattern_search_color: JGOFNumericPlayerColor = 0;

    private drawing_enabled: boolean = true;
    private pen_ctx?: CanvasRenderingContext2D;
    private pen_layer?: HTMLCanvasElement;
    public title: string = "";
    protected title_div?: HTMLElement;

    private themes: GobanSelectedThemes = {
        board: "Plain",
        black: "Plain",
        white: "Plain",
    };
    private theme_black: GoTheme;
    private theme_black_stones: Array<any> = [];
    private theme_black_text_color: string = HOT_PINK;
    private theme_blank_text_color: string = HOT_PINK;
    private theme_board: GoTheme;
    private theme_line_color: string = "";
    private theme_star_color: string = "";
    private theme_stone_radius: number = 10;
    private theme_white: GoTheme;
    private theme_white_stones: Array<any> = [];
    private theme_white_text_color: string = HOT_PINK;

    constructor(config: GobanCanvasConfig, preloaded_data?: AdHocFormat | JGOF) {
        super(config, preloaded_data);

        // console.log("Goban canvas v 0.5.74.debug 5"); // GaJ: I use this to be sure I have linked & loaded the updates
        if (config.board_div) {
            this.parent = config["board_div"];
        } else {
            this.no_display = true;
            this.parent =
                document.createElement(
                    "div",
                ); /* let a div dangle in no-mans land to prevent null pointer refs */
        }

        this.title_div = config["title_div"];

        this.grid_layer = createDeviceScaledCanvas(10, 10);
        this.grid_layer.setAttribute("id", "grid-canvas");
        this.grid_layer.className = "StoneLayer";

        const under_ctx = this.grid_layer.getContext("2d");

        if (under_ctx) {
            this.grid_ctx = under_ctx;
        } else {
            throw new Error(`Failed to obtain drawing context for board grid & coordinates`);
        }

        this.grid_layer.style.left = this.layer_offset_left + "px";
        this.grid_layer.style.top = this.layer_offset_top + "px";

        this.parent.appendChild(this.grid_layer);
        this.bindPointerBindings(this.grid_layer);

        this.board = createDeviceScaledCanvas(10, 10);
        this.board.setAttribute("id", "board-canvas");
        this.board.className = "StoneLayer";
        const ctx = this.board.getContext("2d");
        if (ctx) {
            this.ctx = ctx;
        } else {
            throw new Error(`Failed to obtain drawing context for board`);
        }

        this.parent.appendChild(this.board);
        this.bindPointerBindings(this.board);

        this.move_tree_container = config.move_tree_container;

        this.handleShiftKey = (ev) => {
            try {
                if (ev.shiftKey !== this.shift_key_is_down) {
                    this.shift_key_is_down = ev.shiftKey;
                    if (this.last_hover_square) {
                        this.__drawSquare(this.last_hover_square.x, this.last_hover_square.y);
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };
        window.addEventListener("keydown", this.handleShiftKey);
        window.addEventListener("keyup", this.handleShiftKey);

        let first_pass = true;
        this.theme_board = new GoThemes["board"][this.themes.board]();
        this.theme_white = new GoThemes["white"][this.themes.white](this.theme_board);
        this.theme_black = new GoThemes["black"][this.themes.black](this.theme_board);
        const watcher = this.watchSelectedThemes((themes: GobanSelectedThemes) => {
            this.setThemes(themes, first_pass ? true : false);
            first_pass = false;
        });
        this.on("destroy", () => watcher.remove());

        this.engine = this.post_config_constructor();
        this.previous_marks = GoMath.makeObjectMatrix<string>(
            this.engine.width,
            this.engine.height,
        );
        this.previous_board = GoMath.makeObjectMatrix<string>(
            this.engine.width,
            this.engine.height,
        );

        this.ready_to_draw = true;
        this.redraw(true);
    }
    public enablePen(): void {
        this.attachPenCanvas();
    }
    public disablePen(): void {
        this.detachPenCanvas();
    }

    public destroy(): void {
        super.destroy();

        if (this.grid_layer && this.board.parentNode) {
            this.board.parentNode.removeChild(this.grid_layer);
        }
        if (this.board && this.board.parentNode) {
            this.board.parentNode.removeChild(this.board);
        }
        this.detachPenCanvas();
        this.detachShadowLayer();

        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }

        window.removeEventListener("keydown", this.handleShiftKey);
        window.removeEventListener("keyup", this.handleShiftKey);
    }

    private detachShadowLayer(): void {
        if (this.shadow_layer) {
            if (this.shadow_layer.parentNode) {
                this.shadow_layer.parentNode.removeChild(this.shadow_layer);
            }
            delete this.shadow_layer;
            delete this.shadow_ctx;
        }
    }

    private attachShadowLayer(): void {
        if (!this.shadow_layer && this.parent) {
            this.shadow_layer = createDeviceScaledCanvas(this.metrics.width, this.metrics.height);
            this.shadow_layer.setAttribute("id", "shadow-canvas");
            this.shadow_layer.className = "ShadowLayer";

            try {
                this.parent.insertBefore(this.shadow_layer, this.board);
            } catch (e) {
                // I'm not really sure how we ever get into this state, but sentry.io reports that we do
                console.warn("Error inserting shadow layer before board");
                console.warn(e);
                try {
                    this.parent.appendChild(this.shadow_layer);
                } catch (e) {
                    console.error(e);
                }
            }
            //this.shadow_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
            this.shadow_layer.style.left = this.layer_offset_left + "px";
            this.shadow_layer.style.top = this.layer_offset_top + "px";

            const ctx = this.shadow_layer.getContext("2d");
            if (ctx) {
                this.shadow_ctx = ctx;
            } else {
                //throw new Error(`Failed to obtain shadow layer drawing context`);
                console.error(new Error(`Failed to obtain shadow layer drawing context`));
                return;
            }
            this.bindPointerBindings(this.shadow_layer);
        }
    }
    private detachPenCanvas(): void {
        if (this.pen_layer) {
            if (this.pen_layer.parentNode) {
                this.pen_layer.parentNode.removeChild(this.pen_layer);
            }
            delete this.pen_layer;
            delete this.pen_ctx;
        }
    }
    private attachPenCanvas(): void {
        if (!this.pen_layer) {
            this.pen_layer = createDeviceScaledCanvas(this.metrics.width, this.metrics.height);
            this.pen_layer.setAttribute("id", "pen-canvas");
            this.pen_layer.className = "PenLayer";
            this.parent.appendChild(this.pen_layer);
            //this.pen_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
            this.pen_layer.style.left = this.layer_offset_left + "px";
            this.pen_layer.style.top = this.layer_offset_top + "px";
            const ctx = this.pen_layer.getContext("2d");
            if (ctx) {
                this.pen_ctx = ctx;
            } else {
                throw new Error(`Failed to obtain pen drawing context`);
            }
            this.bindPointerBindings(this.pen_layer);
        }
    }
    private bindPointerBindings(canvas: HTMLCanvasElement): void {
        if (!this.interactive) {
            return;
        }

        if (canvas.getAttribute("data-pointers-bound") === "true") {
            return;
        }

        canvas.setAttribute("data-pointers-bound", "true");

        let dragging = false;

        let last_click_square = this.xy2ij(0, 0);

        const pointerUp = (ev: MouseEvent | TouchEvent, double_clicked: boolean): void => {
            try {
                if (!dragging) {
                    /* if we didn't start the click in the canvas, don't respond to it */
                    return;
                }
                let right_click = false;
                if (ev instanceof MouseEvent) {
                    if (ev.button === 2) {
                        right_click = true;
                        ev.preventDefault();
                    }
                }

                dragging = false;

                if (this.scoring_mode) {
                    const pos = getRelativeEventPosition(ev);
                    const pt = this.xy2ij(pos.x, pos.y);
                    if (pt.i >= 0 && pt.i < this.width && pt.j >= 0 && pt.j < this.height) {
                        if (this.score_estimate) {
                            this.score_estimate.handleClick(
                                pt.i,
                                pt.j,
                                ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey,
                            );
                        }
                        this.emit("update");
                    }
                    return;
                }

                if (ev.ctrlKey || ev.metaKey || ev.altKey) {
                    try {
                        const pos = getRelativeEventPosition(ev);
                        const pt = this.xy2ij(pos.x, pos.y);
                        if (GobanCore.hooks.addCoordinatesToChatInput) {
                            GobanCore.hooks.addCoordinatesToChatInput(
                                this.engine.prettyCoords(pt.i, pt.j),
                            );
                        }
                    } catch (e) {
                        console.error(e);
                    }
                    return;
                }

                if (this.mode === "analyze" && this.analyze_tool === "draw") {
                    /* might want to interpret this as a start/stop of a line segment */
                } else {
                    const pos = getRelativeEventPosition(ev);
                    const pt = this.xy2ij(pos.x, pos.y);
                    if (!double_clicked) {
                        last_click_square = pt;
                    } else {
                        if (last_click_square.i !== pt.i || last_click_square.j !== pt.j) {
                            this.onMouseOut(ev);
                            return;
                        }
                    }

                    this.onTap(ev, double_clicked, right_click);
                    this.onMouseOut(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };

        const pointerDown = (ev: MouseEvent | TouchEvent): void => {
            try {
                dragging = true;
                if (this.mode === "analyze" && this.analyze_tool === "draw") {
                    this.onPenStart(ev);
                } else if (this.mode === "analyze" && this.analyze_tool === "label") {
                    if (ev.shiftKey) {
                        if (this.analyze_subtool === "letters") {
                            const label_char = prompt(
                                _("Enter the label you want to add to the board"),
                                "",
                            );
                            if (label_char) {
                                this.label_character = label_char.substring(0, 3);
                                dragging = false;
                                return;
                            }
                        }
                    }

                    this.onLabelingStart(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };

        const pointerMove = (ev: MouseEvent | TouchEvent): void => {
            try {
                if (this.mode === "analyze" && this.analyze_tool === "draw") {
                    if (!dragging) {
                        return;
                    }
                    this.onPenMove(ev);
                } else if (dragging && this.mode === "analyze" && this.analyze_tool === "label") {
                    this.onLabelingMove(ev);
                } else {
                    this.onMouseMove(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };

        const pointerOut = (ev: MouseEvent | TouchEvent): void => {
            try {
                dragging = false;
                this.onMouseOut(ev);
            } catch (e) {
                console.error(e);
            }
        };

        let mousedisabled: any = 0;

        canvas.addEventListener("click", (ev) => {
            if (!mousedisabled) {
                dragging = true;
                pointerUp(ev, false);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("dblclick", (ev) => {
            if (!mousedisabled) {
                dragging = true;
                pointerUp(ev, true);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mousedown", (ev) => {
            if (!mousedisabled) {
                pointerDown(ev);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mousemove", (ev) => {
            if (!mousedisabled) {
                pointerMove(ev);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mouseout", (ev) => {
            if (!mousedisabled) {
                pointerOut(ev);
            } else {
                ev.preventDefault();
            }
            return false;
        });
        canvas.addEventListener("contextmenu", (ev) => {
            if (!mousedisabled) {
                pointerUp(ev, false);
            } else {
                ev.preventDefault();
            }
            return false;
        });
        canvas.addEventListener("focus", (ev) => {
            ev.preventDefault();
            return false;
        });

        let lastX = 0;
        let lastY = 0;
        let startX = 0;
        let startY = 0;

        const onTouchStart = (ev: TouchEvent) => {
            try {
                if (mousedisabled) {
                    clearTimeout(mousedisabled);
                }
                mousedisabled = setTimeout(() => {
                    mousedisabled = 0;
                }, 5000);
                getRelativeEventPosition(ev); // enables tracking of last ev position so on touch end can always tell where we released from

                if (ev.target === canvas) {
                    lastX = ev.touches[0].clientX;
                    lastY = ev.touches[0].clientY;
                    startX = ev.touches[0].clientX;
                    startY = ev.touches[0].clientY;
                    pointerDown(ev);
                } else if (dragging) {
                    pointerOut(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };
        const onTouchEnd = (ev: TouchEvent) => {
            try {
                if (mousedisabled) {
                    clearTimeout(mousedisabled);
                }
                mousedisabled = setTimeout(() => {
                    mousedisabled = 0;
                }, 5000);

                if (ev.target === canvas) {
                    if (
                        Math.sqrt(
                            (startX - lastX) * (startX - lastX) +
                                (startY - lastY) * (startY - lastY),
                        ) > 10
                    ) {
                        pointerOut(ev);
                    } else {
                        pointerUp(ev, false);
                    }
                } else if (dragging) {
                    pointerOut(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };
        const onTouchMove = (ev: TouchEvent) => {
            try {
                if (mousedisabled) {
                    clearTimeout(mousedisabled);
                }
                mousedisabled = setTimeout(() => {
                    mousedisabled = 0;
                }, 5000);
                getRelativeEventPosition(ev); // enables tracking of last ev position so on touch end can always tell where we released from

                if (ev.target === canvas) {
                    lastX = ev.touches[0].clientX;
                    lastY = ev.touches[0].clientY;
                    if (this.mode === "analyze" && this.analyze_tool === "draw") {
                        pointerMove(ev);
                        ev.preventDefault();
                        return false;
                    }
                } else if (dragging) {
                    pointerOut(ev);
                }
            } catch (e) {
                console.error(e);
            }
            return undefined;
        };

        document.addEventListener("touchstart", onTouchStart);
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchmove", onTouchMove);
        this.on("destroy", () => {
            document.removeEventListener("touchstart", onTouchStart);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchmove", onTouchMove);
        });
    }
    public clearAnalysisDrawing(): void {
        this.pen_marks = [];
        if (this.pen_ctx) {
            this.pen_ctx.clearRect(0, 0, this.metrics.width, this.metrics.height);
        }
    }
    private xy2pen(x: number, y: number): [number, number] {
        const lx = this.draw_left_labels ? 0.0 : 1.0;
        const ly = this.draw_top_labels ? 0.0 : 1.0;
        return [
            Math.round((x / this.square_size + lx) * 64),
            Math.round((y / this.square_size + ly) * 64),
        ];
    }
    private pen2xy(x: number, y: number): [number, number] {
        const lx = this.draw_left_labels ? 0.0 : 1.0;
        const ly = this.draw_top_labels ? 0.0 : 1.0;

        return [(x / 64 - lx) * this.square_size, (y / 64 - ly) * this.square_size];
    }
    private setPenStyle(color: string): void {
        if (!this.pen_ctx) {
            throw new Error(`setPenStyle called with null pen_ctx`);
        }

        this.pen_ctx.strokeStyle = color;
        this.pen_ctx.lineWidth = Math.max(1, Math.round(this.square_size * 0.1));
        this.pen_ctx.lineCap = "round";
    }
    private onPenStart(ev: MouseEvent | TouchEvent): void {
        this.attachPenCanvas();

        const pos = getRelativeEventPosition(ev);
        this.last_pen_position = this.xy2pen(pos.x, pos.y);
        this.current_pen_mark = { color: this.analyze_subtool, points: this.xy2pen(pos.x, pos.y) };
        this.pen_marks.push(this.current_pen_mark);
        this.setPenStyle(this.analyze_subtool);

        this.syncReviewMove({ pen: this.analyze_subtool, pp: this.xy2pen(pos.x, pos.y) });
    }
    private onPenMove(ev: MouseEvent | TouchEvent): void {
        if (!this.pen_ctx) {
            throw new Error(`onPenMove called with null pen_ctx`);
        }
        if (!this.last_pen_position || !this.current_pen_mark) {
            throw new Error(`onPenMove called with invalid last pen position or current pen mark`);
        }

        const pos = getRelativeEventPosition(ev);
        const start = this.last_pen_position;
        const s = this.pen2xy(start[0], start[1]);
        const end = this.xy2pen(pos.x, pos.y);
        const e = this.pen2xy(end[0], end[1]);

        const dx = end[0] - start[0];
        const dy = end[1] - start[1];

        if (dx * dx + dy * dy < 64) {
            return;
        }

        this.last_pen_position = end;
        this.current_pen_mark.points.push(dx);
        this.current_pen_mark.points.push(dy);

        this.pen_ctx.beginPath();
        this.pen_ctx.moveTo(s[0], s[1]);
        this.pen_ctx.lineTo(e[0], e[1]);
        this.pen_ctx.stroke();

        this.syncReviewMove({ pp: [dx, dy] });
    }
    public drawPenMarks(penmarks: MoveTreePenMarks): void {
        if (this.review_id && !this.done_loading_review) {
            return;
        }
        if (!penmarks.length) {
            return;
        }
        this.attachPenCanvas();
        if (!this.pen_ctx) {
            throw new Error(`onPenMove called with null pen_ctx`);
        }
        this.clearAnalysisDrawing();
        this.pen_marks = penmarks;
        for (let i = 0; i < penmarks.length; ++i) {
            const stroke = penmarks[i];
            this.setPenStyle(stroke.color);

            let px = stroke.points[0];
            let py = stroke.points[1];
            this.pen_ctx.beginPath();
            const pt = this.pen2xy(px, py);
            this.pen_ctx.moveTo(pt[0], pt[1]);
            for (let j = 2; j < stroke.points.length; j += 2) {
                px += stroke.points[j];
                py += stroke.points[j + 1];
                const pt = this.pen2xy(px, py);
                this.pen_ctx.lineTo(pt[0], pt[1]);
            }
            this.pen_ctx.stroke();
        }
    }
    private onTap(event: MouseEvent | TouchEvent, double_tap: boolean, right_click: boolean): void {
        if (
            !(
                this.stone_placement_enabled &&
                (this.player_id ||
                    !this.engine.players.black.id ||
                    this.mode === "analyze" ||
                    this.mode === "pattern search" ||
                    this.mode === "puzzle")
            )
        ) {
            return;
        }

        const pos = getRelativeEventPosition(event);
        const xx = pos.x;
        const yy = pos.y;

        const pt = this.xy2ij(xx, yy);
        const x = pt.i;
        const y = pt.j;

        if (x < 0 || y < 0 || x >= this.engine.width || y >= this.engine.height) {
            return;
        }

        if (!this.double_click_submit) {
            double_tap = false;
        }

        if (
            this.mode === "analyze" &&
            event.shiftKey &&
            /* don't warp to move tree position when shift clicking in stone edit mode */
            !(
                this.analyze_tool === "stone" &&
                (this.analyze_subtool === "black" || this.analyze_subtool === "white")
            ) &&
            /* nor when in labeling mode */
            this.analyze_tool !== "label"
        ) {
            const m = this.engine.getMoveByLocation(x, y);
            if (m) {
                this.engine.jumpTo(m);
                this.emit("update");
            }
            return;
        }

        if (this.mode === "analyze" && this.analyze_tool === "label") {
            return;
        }

        this.setSubmit(undefined);
        if (this.submitBlinkTimer) {
            clearTimeout(this.submitBlinkTimer);
        }
        this.submitBlinkTimer = null;

        const tap_time = Date.now();
        const submit = () => {
            const submit_time = Date.now();
            if (!this.one_click_submit && (!this.double_click_submit || !double_tap)) {
                /* then submit button was pressed, so check to make sure this didn't happen too quick */
                const delta = submit_time - tap_time;
                if (delta <= 50) {
                    console.info(
                        "Submit button pressed only ",
                        delta,
                        "ms after stone was placed, presuming bad click",
                    );
                    return;
                }
            }
            this.playMovementSound();
            this.sendMove({
                auth: this.config.auth,
                game_id: this.config.game_id,
                player_id: this.config.player_id,
                move: encodeMove(x, y),
            });
            this.setTitle(_("Submitting..."));
            this.disableStonePlacement();
            delete this.move_selected;
        };
        /* we disable clicking if we've been initialized with the view user,
         * unless the board is a demo board (thus black_player_id is 0).  */
        try {
            let force_redraw = false;

            if (
                (this.engine.phase === "stone removal" || this.scoring_mode) &&
                this.engine.isActivePlayer(this.player_id)
            ) {
                let arrs: Array<[-1 | 0 | 1, Group]>;
                if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
                    const removed: 0 | 1 = !this.engine.removal[y][x] ? 1 : 0;
                    arrs = [[removed, [{ x: x, y: y }]]];
                } else {
                    arrs = this.engine.toggleMetaGroupRemoval(x, y);
                }

                for (let i = 0; i < arrs.length; ++i) {
                    const arr: [-1 | 0 | 1, Group] = arrs[i];

                    const removed = arr[0];
                    const group = arr[1];
                    if (group.length && !this.scoring_mode) {
                        this.socket.send("game/removed_stones/set", {
                            auth: this.config.auth,
                            game_id: this.config.game_id,
                            player_id: this.config.player_id,
                            removed: removed,
                            stones: encodeMoves(group),
                        });
                    }
                    if (this.scoring_mode) {
                        this.score_estimate = this.engine.estimateScore(
                            SCORE_ESTIMATION_TRIALS,
                            SCORE_ESTIMATION_TOLERANCE,
                        );
                        this.redraw(true);
                    }
                }
            } else if (this.mode === "pattern search") {
                let color: JGOFNumericPlayerColor = ((this.engine.board[y][x] + 1) %
                    3) as JGOFNumericPlayerColor; /* cycle through the colors */
                if (this.pattern_search_color) {
                    color = this.pattern_search_color;
                    if (this.engine.board[y][x] === this.pattern_search_color) {
                        color = 0;
                    }
                }
                if (event.shiftKey && color === 1) {
                    /* if we're going to place a black on an empty square but we're holding down shift, place white */
                    color = 2;
                }
                if (event.shiftKey && color === 2) {
                    /* if we're going to place a black on an empty square but we're holding down shift, place white */
                    color = 1;
                }
                if (!double_tap) {
                    /* we get called for each tap, then once for the final double tap so we only want to process this x2 */
                    this.engine.editPlace(x, y, color);
                }
                this.emit("update");
            } else if (this.mode === "puzzle") {
                let puzzle_mode = "place";
                let color: JGOFNumericPlayerColor = 0;
                if (this.getPuzzlePlacementSetting) {
                    const s = this.getPuzzlePlacementSetting();
                    puzzle_mode = s.mode;
                    if (s.mode === "setup") {
                        color = s.color;
                        if (this.shift_key_is_down || right_click) {
                            color = color === 1 ? 2 : 1;
                        }
                    }
                }

                if (puzzle_mode === "place") {
                    if (!double_tap) {
                        /* we get called for each tap, then once for the final double tap so we only want to process this x2 */
                        this.engine.place(x, y, true, false, true, false, false);
                        this.emit("puzzle-place", {
                            x,
                            y,
                            width: this.engine.width,
                            height: this.engine.height,
                            color: this.engine.colorToMove(),
                        });
                    }
                }
                if (puzzle_mode === "play") {
                    /* we get called for each tap, then once for the final double tap so we only want to process this x2 */
                    /* Also, if we just placed a piece and the computer is waiting to place it's piece (autoplaying), then
                     * don't allow anything to be placed. */
                    if (!double_tap && !this.autoplaying_puzzle_move) {
                        let calls = 0;

                        if (
                            this.engine.puzzle_player_move_mode !== "fixed" ||
                            this.engine.cur_move.lookupMove(x, y, this.engine.player, false)
                        ) {
                            const puzzle_place = (mv_x: number, mv_y: number): void => {
                                ++calls;

                                this.engine.place(mv_x, mv_y, true, false, true, false, false);
                                this.emit("puzzle-place", {
                                    x: mv_x,
                                    y: mv_y,
                                    width: this.engine.width,
                                    height: this.engine.height,
                                    color: this.engine.colorToMove(),
                                });
                                if (this.engine.cur_move.wrong_answer) {
                                    this.emit("puzzle-wrong-answer");
                                }
                                if (this.engine.cur_move.correct_answer) {
                                    this.emit("puzzle-correct-answer");
                                }

                                if (this.engine.cur_move.branches.length === 0) {
                                    const isobranches =
                                        this.engine.cur_move.findStrongIsobranches();
                                    if (isobranches.length > 0) {
                                        const w = getRandomInt(0, isobranches.length);
                                        const which = isobranches[w];
                                        console.info(
                                            "Following isomorphism (" +
                                                (w + 1) +
                                                " of " +
                                                isobranches.length +
                                                ")",
                                        );
                                        this.engine.jumpTo(which);
                                        this.emit("update");
                                    }
                                }

                                if (this.engine.cur_move.branches.length) {
                                    const next =
                                        this.engine.cur_move.branches[
                                            getRandomInt(0, this.engine.cur_move.branches.length)
                                        ];

                                    if (
                                        calls === 1 &&
                                        /* only move if it's the "ai" turn.. if we undo we can get into states where we
                                         * are playing for the ai for some moves so don't automove blindly */ ((next.player ===
                                            2 &&
                                            this.engine.config.initial_player === "black") ||
                                            (next.player === 1 &&
                                                this.engine.config.initial_player === "white")) &&
                                        this.engine.puzzle_opponent_move_mode !== "manual"
                                    ) {
                                        this.autoplaying_puzzle_move = true;
                                        setTimeout(() => {
                                            this.autoplaying_puzzle_move = false;
                                            puzzle_place(next.x, next.y);
                                            this.emit("update");
                                        }, this.puzzle_autoplace_delay);
                                    }
                                } else {
                                    /* default to wrong answer, but only if there are no nodes prior to us that were marked
                                     * as correct */
                                    let c: MoveTree | null = this.engine.cur_move;
                                    let parent_was_correct = false;
                                    while (c) {
                                        if (c.correct_answer) {
                                            parent_was_correct = true;
                                            break;
                                        }
                                        c = c.parent;
                                    }
                                    if (!parent_was_correct) {
                                        /* default to wrong answer - we say ! here because we will have already emitted
                                         * puzzle-wrong-answer if wrong_answer was true above. */
                                        if (!this.engine.cur_move.wrong_answer) {
                                            this.emit("puzzle-wrong-answer");
                                        }
                                        //break;
                                    }
                                }
                            };
                            puzzle_place(x, y);
                        }
                    }
                }
                if (puzzle_mode === "setup") {
                    if (this.engine.board[y][x] === color) {
                        this.engine.initialStatePlace(x, y, 0);
                    } else {
                        this.engine.initialStatePlace(x, y, color);
                    }
                }
                this.emit("update");
            } else if (
                this.engine.phase === "play" ||
                (this.engine.phase === "finished" && this.mode === "analyze")
            ) {
                if (this.move_selected) {
                    if (this.mode === "play") {
                        this.engine.cur_move.removeIfNoChildren();
                    }

                    /* If same stone is clicked again, simply remove it */
                    let same_stone_clicked = false;
                    if (this.move_selected.x === x && this.move_selected.y === y) {
                        delete this.move_selected;
                        same_stone_clicked = true;
                    }

                    this.engine.jumpTo(this.engine.last_official_move);

                    /* If same stone is clicked again, simply remove it */
                    if (same_stone_clicked) {
                        this.updatePlayerToMoveTitle();
                        if (!double_tap) {
                            this.emit("update");
                            return;
                        }
                    }
                }
                this.move_selected = { x: x, y: y };

                /* Place our stone */
                try {
                    if (
                        (this.mode !== "edit" || !this.edit_color) &&
                        !(
                            this.mode === "analyze" &&
                            this.analyze_tool === "stone" &&
                            this.analyze_subtool !== "alternate"
                        )
                    ) {
                        this.engine.place(x, y, true, true);

                        if (this.mode === "analyze") {
                            if (this.engine.handicapMovesLeft() > 0) {
                                this.engine.place(-1, -1);
                            }
                        }
                    } else {
                        if (!this.edit_color) {
                            throw new Error(`Edit place called with invalid edit_color value`);
                        }

                        let edit_color = this.engine.playerByColor(this.edit_color);
                        if (event.shiftKey && edit_color === 1) {
                            /* if we're going to place a black on an empty square but we're holding down shift, place white */
                            edit_color = 2;
                        } else if (event.shiftKey && edit_color === 2) {
                            /* if we're going to place a black on an empty square but we're holding down shift, place white */
                            edit_color = 1;
                        }
                        if (this.engine.board[y][x] === edit_color) {
                            this.engine.editPlace(x, y, 0);
                        } else {
                            this.engine.editPlace(x, y, edit_color);
                        }
                    }

                    if (this.mode === "analyze" && this.analyze_tool === "stone") {
                        let c: MoveTree | null = this.engine.cur_move;
                        while (c && !c.trunk) {
                            let mark: any = c.getMoveNumberDifferenceFromTrunk();
                            if (c.edited) {
                                mark = "triangle";
                            }

                            if (c.x >= 0 && c.y >= 0 && !this.engine.board[c.y][c.x]) {
                                this.clearTransientMark(c.x, c.y, mark);
                            } else {
                                this.setTransientMark(c.x, c.y, mark, true);
                            }
                            c = c.parent;
                        }
                    }

                    if (this.isPlayerController()) {
                        this.syncReviewMove();
                        force_redraw = true;
                    }
                } catch (e) {
                    delete this.move_selected;
                    this.updatePlayerToMoveTitle();
                    throw e;
                }

                switch (this.mode) {
                    case "play":
                        //if (this.one_click_submit || double_tap || this.engine.game_type === "temporary") {
                        if (this.one_click_submit || double_tap) {
                            submit();
                        } else {
                            this.setSubmit(submit);
                        }
                        break;
                    case "analyze":
                        delete this.move_selected;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");
                        this.playMovementSound();
                        break;
                    case "conditional":
                        this.followConditionalSegment(x, y);
                        delete this.move_selected;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");
                        this.playMovementSound();
                        break;
                    case "edit":
                        delete this.move_selected;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");

                        this.playMovementSound();
                        this.sendMove({
                            auth: this.config.auth,
                            game_id: this.config.game_id,
                            player_id: this.config.player_id,
                            move: "!" + this.engine.board[y][x] + encodeMove(x, y),
                        });
                        break;
                }

                if (force_redraw) {
                    this.redraw();
                }
            }
        } catch (e) {
            delete this.move_selected;
            // stone already placed is just to be ignored, it's not really an error.
            if (e.message_id !== "stone_already_placed_here") {
                console.info(e);
                this.errorHandler(e);
                this.emit("error");
            }
            this.emit("update");
        }
    }
    private onMouseMove(event: MouseEvent | TouchEvent): void {
        if (
            !(
                this.stone_placement_enabled &&
                (this.player_id ||
                    !this.engine.players.black.id ||
                    this.mode === "analyze" ||
                    this.scoring_mode)
            )
        ) {
            return;
        }

        const pos = getRelativeEventPosition(event);
        const pt = this.xy2ij(pos.x, pos.y);

        if (this.__last_pt.i === pt.i && this.__last_pt.j === pt.j) {
            return;
        }

        if (this.__last_pt.valid) {
            const last_hover = this.last_hover_square;
            delete this.last_hover_square;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }

        this.__last_pt = pt;

        if (pt.valid) {
            this.last_hover_square = { x: pt.i, y: pt.j };
            this.drawSquare(pt.i, pt.j);
        }
    }
    private onMouseOut(event: MouseEvent | TouchEvent): void {
        if (this.__last_pt.valid) {
            const last_hover = this.last_hover_square;
            delete this.last_hover_square;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }
        this.__last_pt = this.xy2ij(-1, -1);
    }
    protected enableDrawing(): void {
        this.drawing_enabled = true;
    }
    protected disableDrawing(): void {
        this.drawing_enabled = false;
    }
    public setByoYomiLabel(label: string): void {
        if (this.byoyomi_label !== label) {
            this.byoyomi_label = label;
            if (this.last_hover_square) {
                this.drawSquare(this.last_hover_square.x, this.last_hover_square.y);
            }
        }
    }
    private getDrawInfo(
        i: number,
        j: number,
        target_ctx: CanvasRenderingContext2D | undefined = undefined,
    ): DrawingInfo {
        /* get a structure holding info needed to draw a square  at i,j */
        const d = {} as DrawingInfo;
        d.i = i;
        d.j = j;

        d.draw_last_move = !this.dont_draw_last_move;

        d.ctx = this.ctx;
        if (target_ctx) {
            d.ctx = target_ctx;
        }

        d.marks = this.getMarks(i, j);
        if (!d.marks) {
            console.error("No position for ", j, i);
            d.marks = {};
        }

        d.hasMarks = false;
        for (const m in d.marks) {
            if (d.marks[m]) {
                d.hasMarks = true;
                break;
            }
        }

        /*
        // not really needed because these already obscure the lines
        via heatmap
        if (this.heatmap && this.heatmap[j][i] > 0.001)
            d.hasMarks = true;

        if (this.highlight_movetree_moves && d.movetree_contains_this_square)
            d.hasMarks = true;
        */

        d.have_text_to_draw = false;
        for (const key in d.marks) {
            if (key.length <= 3) {
                d.have_text_to_draw = true;
            }
        }
        if (
            d.marks.circle ||
            d.marks.triangle ||
            d.marks.chat_triangle ||
            d.marks.sub_triangle ||
            d.marks.cross ||
            d.marks.square
        ) {
            d.have_text_to_draw = true;
        }
        if (d.marks.letter && d.marks.letter.length > 0) {
            d.have_text_to_draw = true;
        }
        if (d.marks.subscript && d.marks.subscript.length > 0) {
            d.have_text_to_draw = true;
        }

        d.movetree_contains_this_square = false;
        if (this.engine && this.engine.cur_move.lookupMove(i, j, this.engine.player, false)) {
            d.movetree_contains_this_square = true;
        }

        d.stoneColor = 0;
        if (this.engine) {
            d.stoneColor = this.engine.board[j][i];
        }

        d.altmarking = undefined;
        if (
            this.engine &&
            this.engine.cur_move &&
            (this.mode !== "play" ||
                (typeof this.isInPushedAnalysis() !== "undefined" && this.isInPushedAnalysis()))
        ) {
            let cur: MoveTree | null = this.engine.cur_move;
            for (; cur && !cur.trunk; cur = cur.parent) {
                if (cur.x === i && cur.y === j) {
                    const move_diff = cur.getMoveNumberDifferenceFromTrunk();
                    if (move_diff !== cur.move_number) {
                        if (!cur.edited && this.show_move_numbers) {
                            d.altmarking = cur.getMoveNumberDifferenceFromTrunk().toString();
                        }
                    }
                }
            }
        }

        d.textColor = this.theme_blank_text_color;
        if (d.stoneColor) {
            d.textColor =
                d.stoneColor === 1 ? this.theme_black_text_color : this.theme_white_text_color;
        }

        d.size = this.square_size;
        d.xOffset = this.draw_left_labels ? d.size : 0;
        d.yOffset = this.draw_top_labels ? d.size : 0;

        if (this.bounds.left > 0) {
            d.xOffset = -d.size * this.bounds.left;
        }
        if (this.bounds.top > 0) {
            d.yOffset = -d.size * this.bounds.top;
        }

        d.left = d.xOffset + i * d.size;
        d.right = d.xOffset + (i + 1) * d.size;
        d.top = d.yOffset + j * d.size;
        d.bottom = d.yOffset + (j + 1) * d.size;

        d.xCenter = d.left + this.metrics.mid;
        d.yCenter = d.top + this.metrics.mid;

        d.radius = Math.floor(this.square_size * 0.5) - 0.5; // hm, do not understand -0.5

        return d;
    }

    public makeSquareClip(
        ctx: CanvasRenderingContext2D | undefined,
        i: number,
        j: number,
        d: DrawingInfo,
    ) {
        /*
        clip around the current square at an enlarged size for shadows, etc.
        */

        if (!ctx) {
            return;
        }

        ctx.save();
        ctx.beginPath();

        // extend beyond the square, limit should be next intersection point - grid line width
        ctx.rect(
            Math.floor(i * d.size + d.xOffset - d.size / 2),
            Math.floor(j * d.size + d.yOffset - d.size / 2),
            Math.floor(d.size * 2),
            Math.floor(d.size * 2),
        );

        ctx.clip();
    }

    public restoreSquareClip(ctx: CanvasRenderingContext2D | undefined) {
        if (!ctx) {
            return;
        }
        ctx.restore();
    }

    public cleanSquareRect(i: number, j: number, d: DrawingInfo) {
        /*
        erase the entire contents of this square
        at an enlarged size to accomodate shadows, etc.
        */

        this.ctx.clearRect(
            Math.floor(i * d.size + d.xOffset - d.size / 2),
            Math.floor(j * d.size + d.yOffset - d.size / 2),
            Math.floor(d.size * 2),
            Math.floor(d.size * 2),
        );

        if (this.shadow_ctx) {
            this.shadow_ctx.clearRect(
                Math.floor(i * d.size + d.xOffset - d.size / 2),
                Math.floor(j * d.size + d.yOffset - d.size / 2),
                Math.floor(d.size * 2),
                Math.floor(d.size * 2),
            );
        }
    }

    public queueDrawSquare(i: number, j: number): void {
        for (let ii = i - 1; ii <= i + 1; ++ii) {
            for (let jj = j - 1; jj <= j + 1; ++jj) {
                if (jj < 0 || ii < 0 || ii >= this.width || jj >= this.height) {
                    continue;
                }
                let d: DrawingInfo;
                const maybeDraw = this.drawQueue[jj * 30 + ii];
                if (!maybeDraw) {
                    d = this.getDrawInfo(ii, jj);
                } else {
                    d = maybeDraw;
                }

                if (d.hasMarks || (ii === i && j === jj)) {
                    d.fullSquareDraw = true;
                }
                if (d.fullSquareDraw || d.stoneColor !== 0) {
                    this.drawQueue[jj * 30 + ii] = d; // 30x30 board seems large enough
                }
            }
        }
    }

    public drawQueuedSquares() {
        const contexts = [this.ctx];
        if (this.shadow_ctx) {
            contexts.push(this.shadow_ctx);
        }

        for (const ctx of contexts) {
            ctx.save();
            ctx.beginPath();
            for (const coord in this.drawQueue) {
                const d = this.drawQueue[coord];
                if (d.fullSquareDraw) {
                    // only clip full square draws
                    // other squares are "support squares" that help cover glitches
                    // and are clipped by this box
                    ctx.rect(
                        Math.floor(d.i * d.size + d.xOffset - d.size / 2),
                        Math.floor(d.j * d.size + d.yOffset - d.size / 2),
                        Math.floor(d.size * 2),
                        Math.floor(d.size * 2),
                    );
                }
            }
            ctx.clip();
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }

        for (const coord in this.drawQueue) {
            const d = this.drawQueue[coord];
            //this.cleanSquareRect(d.i, d.j, d);
            this.__drawSquare(d.i, d.j, d);
        }

        for (const ctx of contexts) {
            ctx.restore();
        }

        this.drawQueue = {};
    }

    public drawSquare(i: number, j: number): void {
        if (i < 0 || j < 0) {
            return;
        }

        if (!this.drawing_enabled) {
            return;
        }
        if (this.no_display) {
            return;
        }
        const ctx = this.ctx;
        if (!ctx) {
            return;
        }

        // make a detour to the previous move coordinates if it's showing a "last move mark"
        // and remove it
        if (this.last_move && this.engine && !this.last_move.is(this.engine.cur_move)) {
            const m = this.last_move;
            delete this.last_move;
            this.drawSquare(m.x, m.y);
        }

        // draw surrounding stones to cover up glitches caused by erase
        // FIXME: this really only needs to be done for shadows that extend
        //        however, expanding the drawing box also alows prettier visualizations and "jostled" stones
        //        if desired. Also, since there is no separate layer for labels & markings right now,
        //        everything has to be redrawn from bottom up

        // oversized rect clear. This will be the clip box we draw the surrounding stones into
        const d = this.getDrawInfo(i, j);
        this.makeSquareClip(this.ctx, i, j, d);
        this.makeSquareClip(this.shadow_ctx, i, j, d);
        this.cleanSquareRect(i, j, d);

        for (let ii = Math.max(i - 1, 0); ii <= Math.min(i + 1, this.bounds.right); ii++) {
            for (let jj = Math.max(j - 1, 0); jj <= Math.min(j + 1, this.bounds.bottom); jj++) {
                // if (ii == i && jj == j) continue
                this.__drawSquare(ii, jj);
            }
        }

        // this.__drawSquare(i, j);

        this.restoreSquareClip(this.ctx);
        this.restoreSquareClip(this.shadow_ctx);
    }

    private fadeTheLines(i: number, j: number, d: drawingInfo): boolean {
        if (d.hasMarks) {
            // fade the lines
            const stroke = d.ctx.strokeStyle;
            const alpha = d.ctx.globalAlpha;

            const bcss = this.theme_board.getBackgroundCSS();
            if (bcss && bcss["background-color"]) {
                d.ctx.strokeStyle = bcss["background-color"];
            }

            d.ctx.globalAlpha = 0.6;
            d.ctx.beginPath();
            d.ctx.moveTo(d.left + d.size / 2, d.top + d.size / 4);
            d.ctx.lineTo(d.left + d.size / 2, d.bottom - d.size / 4);
            d.ctx.moveTo(d.left + d.size / 4, d.top + d.size / 2);
            d.ctx.lineTo(d.right - d.size / 4, d.top + d.size / 2);
            d.ctx.stroke();
            d.ctx.strokeStyle = stroke;
            d.ctx.globalAlpha = alpha;
            return true;
        }
        return false;
    }

    private drawHeatmap(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw heatmap visualization for square i,j
        Return true if visualization was drawn
        */
        if (this.heatmap && this.heatmap[j][i] > 0.001) {
            const color = "#00FF00";
            d.ctx.lineCap = "square";
            d.ctx.save();
            d.ctx.beginPath();
            d.ctx.globalAlpha = Math.min(this.heatmap[j][i], 0.5);
            d.ctx.moveTo(d.xCenter - d.radius, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter + d.radius, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter + d.radius, d.yCenter + d.radius);
            d.ctx.lineTo(d.xCenter - d.radius, d.yCenter + d.radius);
            d.ctx.lineTo(d.xCenter - d.radius, d.yCenter - d.radius);
            d.ctx.fillStyle = color;
            d.ctx.fill();
            d.ctx.restore();
            return true;
        }
        return false;
    }

    private drawSquareHighlights(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw square highlights if any
        Return true if square highlight was drawn
        */

        if (
            d.marks.hint ||
            (this.highlight_movetree_moves && d.movetree_contains_this_square) ||
            d.marks.color
        ) {
            const color = d.marks.color ? d.marks.color : d.marks.hint ? "#8EFF0A" : "#FF8E0A";

            d.ctx.lineCap = "square";
            d.ctx.save();
            d.ctx.beginPath();
            d.ctx.globalAlpha = 0.6;
            d.ctx.moveTo(d.xCenter - d.radius, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter + d.radius, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter + d.radius, d.yCenter + d.radius);
            d.ctx.lineTo(d.xCenter - d.radius, d.yCenter + d.radius);
            d.ctx.lineTo(d.xCenter - d.radius, d.yCenter - d.radius);
            d.ctx.fillStyle = color;
            d.ctx.fill();
            d.ctx.restore();
            return true;
        }
        return false;
    }

    private drawColoredStone(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw user-colored stones if used & needed
        Return true if a stone was drawn
        */

        if (this.colored_circles && this.colored_circles[j][i]) {
            const circle = this.colored_circles[j][i];
            const color = circle.color;

            d.ctx.save();
            d.ctx.globalAlpha = 1.0;

            //const radius = Math.floor(this.square_size * 0.5) - 0.5;
            let lineWidth = d.radius * (circle.border_width || 0.1);

            if (lineWidth < 0.3) {
                lineWidth = 0;
            }
            d.ctx.fillStyle = color;
            d.ctx.strokeStyle = circle.border_color || "#000000";
            if (lineWidth > 0) {
                d.ctx.lineWidth = lineWidth;
            }
            d.ctx.beginPath();
            d.ctx.arc(
                d.xCenter,
                d.yCenter,
                d.radius - lineWidth / 2,
                0.001,
                2 * Math.PI,
                false,
            ); /* 0.001 to workaround fucked up chrome bug */
            if (lineWidth > 0) {
                d.ctx.stroke();
            }
            d.ctx.fill();
            d.ctx.restore();
            return true;
        }
        return false;
    }

    private drawStone(i: number, j: number, d: DrawingInfo) {
        // NOTE: this also draws hover marks like last move marker

        if (
            d.stoneColor /* if there is really a stone here */ ||
            (this.stone_placement_enabled &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j &&
                (this.mode !== "analyze" || this.analyze_tool === "stone") &&
                this.engine &&
                !this.scoring_mode &&
                (this.engine.phase === "play" ||
                    (this.engine.phase === "finished" && this.mode === "analyze")) &&
                (this.engine.puzzle_player_move_mode !== "fixed" ||
                    d.movetree_contains_this_square ||
                    (this.getPuzzlePlacementSetting &&
                        this.getPuzzlePlacementSetting().mode === "play"))) ||
            (this.scoring_mode &&
                this.score_estimate &&
                this.score_estimate.board[j][i] &&
                this.score_estimate.removal[j][i]) ||
            (this.engine &&
                this.engine.phase === "stone removal" &&
                this.engine.board[j][i] &&
                this.engine.removal[j][i]) ||
            d.marks.black ||
            d.marks.white
        ) {
            let transparent = false;
            let stoneAlphaTransparencyValue = 0.6;
            let color;

            if (
                this.scoring_mode &&
                this.score_estimate &&
                this.score_estimate.board[j][i] &&
                this.score_estimate.removal[j][i]
            ) {
                color = this.score_estimate.board[j][i];
                transparent = true;
            } else if (
                this.engine &&
                (this.engine.phase === "stone removal" ||
                    (this.engine.phase === "finished" && this.mode !== "analyze")) &&
                this.engine.board &&
                this.engine.removal &&
                this.engine.board[j][i] &&
                this.engine.removal[j][i]
            ) {
                color = this.engine.board[j][i];
                transparent = true;
            } else if (d.stoneColor) {
                color = d.stoneColor;
            } else if (
                this.mode === "edit" ||
                (this.mode === "analyze" &&
                    this.analyze_tool === "stone" &&
                    this.analyze_subtool !== "alternate")
            ) {
                color = this.edit_color === "black" ? 1 : 2;
                if (this.shift_key_is_down) {
                    color = this.edit_color === "black" ? 2 : 1;
                }
            } else if (this.move_selected) {
                if (this.engine.handicapMovesLeft() <= 0) {
                    color = this.engine.otherPlayer();
                } else {
                    color = this.engine.player;
                }
            } else if (this.mode === "puzzle") {
                if (this.getPuzzlePlacementSetting) {
                    const s = this.getPuzzlePlacementSetting();
                    if (s.mode === "setup") {
                        color = s.color;
                        if (this.shift_key_is_down) {
                            color = color === 1 ? 2 : 1;
                        }
                    } else {
                        color = this.engine.player;
                    }
                } else {
                    color = this.engine.player;
                }
            } else if (d.marks.black || d.marks.white) {
                color = d.marks.black ? 1 : 2;
                transparent = true;
                stoneAlphaTransparencyValue = this.variation_stone_transparency;
            } else {
                color = this.engine.player;

                if (this.mode === "pattern search" && this.pattern_search_color) {
                    color = this.pattern_search_color;
                }
            }

            if (!(this.autoplaying_puzzle_move && !d.stoneColor)) {
                /* text_color =
                    color === 1 ? this.theme_black_text_color : this.theme_white_text_color;
                */

                if (!this.theme_black_stones) {
                    const err = new Error(
                        `Goban.theme_black_stones not set. Current themes is ${JSON.stringify(
                            this.themes,
                        )}`,
                    );
                    setTimeout(() => {
                        throw err;
                    }, 1);
                    return;
                }
                if (!this.theme_white_stones) {
                    const err = new Error(
                        `Goban.theme_white_stones not set. Current themes is ${JSON.stringify(
                            this.themes,
                        )}`,
                    );
                    setTimeout(() => {
                        throw err;
                    }, 1);
                    return;
                }

                d.ctx.save();
                let shadow_ctx: CanvasRenderingContext2D | null | undefined = this.shadow_ctx;
                if (!d.stoneColor || transparent) {
                    d.ctx.globalAlpha = stoneAlphaTransparencyValue;
                    shadow_ctx = null;
                }
                if (shadow_ctx === undefined) {
                    shadow_ctx = null;
                }
                if (color === 1) {
                    const stone =
                        this.theme_black_stones[
                            ((i + 1) * 53 * ((j + 1) * 97)) % this.theme_black_stones.length
                        ];
                    this.theme_black.placeBlackStone(
                        d.ctx,
                        shadow_ctx,
                        stone,
                        d.xCenter,
                        d.yCenter,
                        this.theme_stone_radius,
                    );
                } else {
                    const stone =
                        this.theme_white_stones[
                            ((i + 1) * 53 * ((j + 1) * 97)) % this.theme_white_stones.length
                        ];
                    this.theme_white.placeWhiteStone(
                        d.ctx,
                        shadow_ctx,
                        stone,
                        d.xCenter,
                        d.yCenter,
                        this.theme_stone_radius,
                    );
                }
                d.ctx.restore();
            }

            if (
                d.marks.blue_move &&
                this.colored_circles &&
                this.colored_circles[j] &&
                this.colored_circles[j][i]
            ) {
                const circle = this.colored_circles[j][i];

                d.ctx.save();
                d.ctx.globalAlpha = 1.0;
                let lineWidth = d.radius * (circle.border_width || 0.1);

                if (lineWidth < 0.3) {
                    lineWidth = 0;
                }
                d.ctx.strokeStyle = circle.border_color || "#000000";
                if (lineWidth > 0) {
                    d.ctx.lineWidth = lineWidth;
                }
                d.ctx.beginPath();
                d.ctx.arc(
                    d.xOffset,
                    d.yOffset,
                    d.radius - lineWidth / 2,
                    0.001,
                    2 * Math.PI,
                    false,
                ); /* 0.001 to workaround fucked up chrome bug */
                if (lineWidth > 0) {
                    d.ctx.stroke();
                }
                d.ctx.restore();
            }
        }
    }

    private drawScoring(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw the Score indicator for this square, if needed.
        Return true if scoring indicator was drawn
        */

        let draw_x = false;
        let transparent_x = false;
        let did_draw = false;

        if (
            this.engine &&
            (this.scoring_mode || this.engine.phase === "stone removal") &&
            this.stone_placement_enabled &&
            this.last_hover_square &&
            this.last_hover_square.x === i &&
            this.last_hover_square.y === j &&
            (this.mode !== "analyze" || this.analyze_tool === "stone")
        ) {
            draw_x = true;
            transparent_x = true;
        }

        if (d.marks.mark_x) {
            draw_x = true;
            transparent_x = false;
        }

        draw_x = false;

        if (draw_x) {
            d.ctx.beginPath();
            d.ctx.save();
            d.ctx.strokeStyle = "#ff0000";
            d.ctx.lineWidth = this.square_size * 0.175;
            if (transparent_x) {
                d.ctx.globalAlpha = 0.6;
            }
            const r = Math.max(1, this.metrics.mid * 0.7);
            d.ctx.moveTo(d.xCenter - r, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter + r, d.yCenter + d.radius);
            d.ctx.moveTo(d.xCenter + r, d.yCenter - d.radius);
            d.ctx.lineTo(d.xCenter - r, d.yCenter + d.radius);
            d.ctx.stroke();
            d.ctx.restore();
            did_draw = true;
        }

        /* Draw Scores */
        if (
            (d.marks.score && (this.engine.phase !== "finished" || this.mode === "play")) ||
            (this.scoring_mode &&
                this.score_estimate &&
                (this.score_estimate.territory[j][i] ||
                    (this.score_estimate.removal[j][i] &&
                        this.score_estimate.board[j][i] === 0))) ||
            ((this.engine.phase === "stone removal" ||
                (this.engine.phase === "finished" && this.mode === "play")) &&
                this.engine.board[j][i] === 0 &&
                this.engine.removal[j][i])
        ) {
            d.ctx.beginPath();
            d.ctx.save();
            let color = d.marks.score;
            if (
                this.scoring_mode &&
                this.score_estimate &&
                (this.score_estimate.territory[j][i] ||
                    (this.score_estimate.removal[j][i] && this.score_estimate.board[j][i] === 0))
            ) {
                color = this.score_estimate.territory[j][i] === 1 ? "black" : "white";
                if (this.score_estimate.board[j][i] === 0 && this.score_estimate.removal[j][i]) {
                    color = "dame";
                }
            }

            if (
                (this.engine.phase === "stone removal" ||
                    (this.engine.phase === "finished" && this.mode === "play")) &&
                this.engine.board[j][i] === 0 &&
                this.engine.removal[j][i]
            ) {
                color = "dame";
            }

            if (color === "white") {
                d.ctx.fillStyle = this.theme_black_text_color;
                d.ctx.strokeStyle = "#777777";
            } else if (color === "black") {
                d.ctx.fillStyle = this.theme_white_text_color;
                d.ctx.strokeStyle = "#888888";
            } else if (color === "dame") {
                d.ctx.fillStyle = "#ff0000";
                d.ctx.strokeStyle = "#365FE6";
            }
            d.ctx.lineWidth = Math.ceil(this.square_size * 0.065) - 0.5;

            const r = this.square_size * 0.15;
            d.ctx.rect(d.xCenter - r, d.yCenter - r, r * 2, r * 2);
            if (color !== "dame") {
                d.ctx.fill();
            }
            d.ctx.stroke();
            d.ctx.restore();

            did_draw = true;
        }
        return did_draw;
    }

    private drawTextLabels(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw text labels, if any.
        return true if letter was drawn
        */

        let letter_was_drawn = false;
        let letter: string | undefined;
        let subscript: string | undefined;
        let transparent = false;
        const font = this.theme_board.getLabelFont();

        if (d.marks.letter) {
            letter = d.marks.letter;
        }
        if (d.marks.subscript) {
            subscript = d.marks.subscript;
        }

        if (
            this.mode === "play" &&
            this.byoyomi_label &&
            this.last_hover_square &&
            this.last_hover_square.x === i &&
            this.last_hover_square.y === j
        ) {
            letter = this.byoyomi_label;
        }
        if (
            this.mode === "analyze" &&
            this.analyze_tool === "label" &&
            (this.analyze_subtool === "letters" || this.analyze_subtool === "numbers") &&
            this.last_hover_square &&
            this.last_hover_square.x === i &&
            this.last_hover_square.y === j
        ) {
            transparent = true;
            letter = this.label_character;
        }
        if (!letter && d.altmarking !== "triangle") {
            letter = d.altmarking;
        }

        if (
            this.show_variation_move_numbers &&
            !letter &&
            !(
                d.marks.circle ||
                d.marks.triangle ||
                d.marks.chat_triangle ||
                d.marks.sub_triangle ||
                d.marks.cross ||
                d.marks.square
            )
        ) {
            const m = this.engine.getMoveByLocation(i, j);
            if (m && !m.trunk) {
                if (m.edited) {
                    //letter = "triangle";
                    if (this.engine.board[j][i]) {
                        d.altmarking = "triangle"; // FIXME: modifies passed drawinfo
                    }
                } else {
                    letter = m.getMoveNumberDifferenceFromTrunk().toString();
                }
            }
        }

        if (letter) {
            letter_was_drawn = true;
            d.ctx.save();
            d.ctx.fillStyle = d.textColor;
            const [, , metrics] = fitText(
                d.ctx,
                letter,
                `bold FONT_SIZEpx ${font}`,
                this.square_size * 0.4,
                this.square_size * 0.8 * (subscript ? 0.9 : 1.0),
            );

            const xx = d.xCenter - metrics.width / 2;
            let yy =
                d.yCenter +
                (/WebKit|Trident/.test(navigator.userAgent)
                    ? this.square_size * -0.03
                    : 1); /* middle centering is different on firefox */

            if (subscript) {
                yy -= this.square_size * 0.15;
            }

            d.ctx.textBaseline = "middle";
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            d.ctx.fillText(letter, xx, yy);
            d.ctx.restore();
        }

        if (subscript) {
            letter_was_drawn = true;
            d.ctx.save();
            d.ctx.fillStyle = d.textColor;
            if (letter && subscript === "0") {
                subscript = "0.0"; // clarifies the markings on the blue move typically
            }

            const [, , metrics] = fitText(
                d.ctx,
                subscript,
                `bold FONT_SIZEpx ${font}`,
                this.square_size * 0.4,
                this.square_size * 0.8 * (letter ? 0.9 : 1.0),
            );

            const xx = d.xCenter - metrics.width / 2;
            let yy =
                d.yCenter +
                (/WebKit|Trident/.test(navigator.userAgent)
                    ? this.square_size * -0.03
                    : 1); /* middle centering is different on firefox */

            if (letter) {
                yy += this.square_size * 0.3;
            }

            d.ctx.textBaseline = "middle";
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            d.ctx.fillText(subscript, xx, yy);
            d.ctx.restore();
        }

        return letter_was_drawn;
    }

    private drawSymbols(i: number, j: number, transparent: boolean, d: DrawingInfo): boolean {
        /*
        Draw symbols if any,
        return whether a symbol was actually drawn
        */

        let symbol_was_drawn = false;

        let hovermark: string | undefined;
        const symbol_color = // FIXME: pretty much the same as d.textColor anyway
            d.stoneColor === 1
                ? this.theme_black_text_color
                : d.stoneColor === 2
                ? this.theme_white_text_color
                : d.textColor;

        if (
            this.analyze_tool === "label" &&
            this.last_hover_square &&
            this.last_hover_square.x === i &&
            this.last_hover_square.y === j
        ) {
            if (
                this.analyze_subtool === "triangle" ||
                this.analyze_subtool === "square" ||
                this.analyze_subtool === "cross" ||
                this.analyze_subtool === "circle"
            ) {
                transparent = true;
                hovermark = this.analyze_subtool;
            }
        }

        if (d.marks.circle || hovermark === "circle") {
            d.ctx.lineCap = "round";
            d.ctx.save();
            d.ctx.beginPath();
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            d.ctx.strokeStyle = symbol_color;
            d.ctx.lineWidth = this.square_size * 0.075;
            d.ctx.arc(d.xCenter, d.yCenter, this.square_size * 0.25, 0, 2 * Math.PI, false);
            d.ctx.stroke();
            d.ctx.restore();
            symbol_was_drawn = true;
        }
        if (
            d.marks.triangle ||
            d.marks.chat_triangle ||
            d.marks.sub_triangle ||
            d.altmarking === "triangle" ||
            hovermark === "triangle"
        ) {
            let scale = 1.0;
            let oy = 0.0;
            if (d.marks.sub_triangle) {
                scale = 0.5;
                oy = this.square_size * 0.3;
                transparent = false;
            }
            d.ctx.lineCap = "round";
            d.ctx.save();
            d.ctx.beginPath();
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            d.ctx.strokeStyle = symbol_color;
            if (d.marks.chat_triangle) {
                d.ctx.strokeStyle = "#00aaFF";
            }
            d.ctx.lineWidth = this.square_size * 0.075 * scale;
            let theta = -(Math.PI * 2) / 4;
            const r = this.square_size * 0.3 * scale;
            d.ctx.moveTo(d.xCenter + r * Math.cos(theta), d.yCenter + oy + r * Math.sin(theta));
            theta += (Math.PI * 2) / 3;
            d.ctx.lineTo(d.xCenter + r * Math.cos(theta), d.yCenter + oy + r * Math.sin(theta));
            theta += (Math.PI * 2) / 3;
            d.ctx.lineTo(d.xCenter + r * Math.cos(theta), d.yCenter + oy + r * Math.sin(theta));
            theta += (Math.PI * 2) / 3;
            d.ctx.lineTo(d.xCenter + r * Math.cos(theta), d.yCenter + oy + r * Math.sin(theta));
            d.ctx.stroke();
            d.ctx.restore();
            symbol_was_drawn = true;
        }
        if (d.marks.cross || hovermark === "cross") {
            d.ctx.lineCap = "square";
            d.ctx.save();
            d.ctx.beginPath();
            d.ctx.lineWidth = this.square_size * 0.075;
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            const r = Math.max(1, this.metrics.mid * 0.35);
            d.ctx.moveTo(d.xCenter - r, d.yCenter - r);
            d.ctx.lineTo(d.xCenter + r, d.yCenter + r);
            d.ctx.moveTo(d.xCenter + r, d.yCenter - r);
            d.ctx.lineTo(d.xCenter - r, d.yCenter + r);
            d.ctx.strokeStyle = symbol_color;
            d.ctx.stroke();
            d.ctx.restore();
            symbol_was_drawn = true;
        }

        if (d.marks.square || hovermark === "square") {
            d.ctx.lineCap = "square";
            d.ctx.save();
            d.ctx.beginPath();
            d.ctx.lineWidth = this.square_size * 0.075;
            if (transparent) {
                d.ctx.globalAlpha = 0.6;
            }
            const r = Math.max(1, this.metrics.mid * 0.4);
            d.ctx.moveTo(d.xCenter - r, d.yCenter - r);
            d.ctx.lineTo(d.xCenter + r, d.yCenter - r);
            d.ctx.lineTo(d.xCenter + r, d.yCenter + r);
            d.ctx.lineTo(d.xCenter - r, d.yCenter + r);
            d.ctx.lineTo(d.xCenter - r, d.yCenter - r);
            d.ctx.strokeStyle = symbol_color;
            d.ctx.stroke();
            d.ctx.restore();
            symbol_was_drawn = true;
        }
        return symbol_was_drawn;
    }

    private drawLastMove(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Mark the latest move, and return whether or not
        the mark was made
        */

        let drawn = false;

        if (this.engine && this.engine.cur_move) {
            if (
                this.engine.cur_move.x === i &&
                this.engine.cur_move.y === j &&
                this.engine.board[j][i] &&
                (this.engine.phase === "play" || this.engine.phase === "finished")
            ) {
                this.last_move = this.engine.cur_move;

                if (i >= 0 && j >= 0) {
                    const color =
                        d.stoneColor === 1
                            ? this.theme_black_text_color
                            : this.theme_white_text_color;

                    if (this.submit_move) {
                        d.ctx.lineCap = "square";
                        d.ctx.save();
                        d.ctx.beginPath();
                        d.ctx.lineWidth = this.square_size * 0.075;
                        //ctx.globalAlpha = 0.6;
                        const r = Math.max(1, this.metrics.mid * 0.35) * 0.8;
                        d.ctx.moveTo(d.xCenter - r, d.yCenter);
                        d.ctx.lineTo(d.xCenter + r, d.yCenter);
                        d.ctx.moveTo(d.xCenter, d.yCenter - r);
                        d.ctx.lineTo(d.xCenter, d.yCenter + r);
                        d.ctx.strokeStyle = color;
                        d.ctx.stroke();
                        d.ctx.restore();
                        drawn = true;
                    } else {
                        if (
                            this.engine.undo_requested &&
                            this.visual_undo_request_indicator &&
                            this.engine.undo_requested === this.engine.cur_move.move_number
                        ) {
                            const letter = "?";
                            d.ctx.save();
                            d.ctx.fillStyle = color;
                            const metrics = d.ctx.measureText(letter);
                            const xx = d.xCenter - metrics.width / 2;
                            const yy =
                                d.yCenter +
                                (/WebKit|Trident/.test(navigator.userAgent)
                                    ? this.square_size * -0.03
                                    : 1); /* middle centering is different on firefox */
                            d.ctx.textBaseline = "middle";
                            d.ctx.fillText(letter, xx, yy);
                            drawn = true;
                            d.ctx.restore();
                            drawn = true;
                        } else {
                            d.ctx.beginPath();
                            d.ctx.strokeStyle = color;
                            d.ctx.lineWidth = this.square_size * 0.075;
                            let r = this.square_size * 0.25;
                            if (this.submit_move) {
                                //ctx.globalAlpha = 0.6;
                                r = this.square_size * 0.3;
                            }
                            d.ctx.arc(d.xCenter, d.yCenter, r, 0, 2 * Math.PI, false);
                            d.ctx.stroke();
                            drawn = true;
                        }
                    }
                }
            }
        }
        return drawn;
    }

    private drawScoreEstimate(i: number, j: number, d: DrawingInfo): boolean {
        /*
        Draw the score estimation for this square
        and return true if it was in fact drawn
        */

        if (this.scoring_mode && this.score_estimate) {
            const est = this.score_estimate.heat[j][i];

            d.ctx.beginPath();

            const color = est < 0 ? "white" : "black";

            if (color === "white") {
                d.ctx.fillStyle = this.theme_black_text_color;
                d.ctx.strokeStyle = "#777777";
            } else if (color === "black") {
                d.ctx.fillStyle = this.theme_white_text_color;
                d.ctx.strokeStyle = "#888888";
            }
            d.ctx.lineWidth = Math.ceil(this.square_size * 0.035) - 0.5;
            const radius = this.square_size * 0.2 * Math.abs(est);
            d.ctx.rect(d.xCenter - radius, d.yCenter - radius, radius * 2, radius * 2);
            d.ctx.fill();
            d.ctx.stroke();
            return true;
        }
        return false;
    }

    private drawGrid(ctx: CanvasRenderingContext2D): void {
        /*
        Draw the board's grid into the cxt provided, which should be its own layer
        */

        const s = this.square_size;
        let ox = this.draw_left_labels ? s : 0;
        let oy = this.draw_top_labels ? s : 0;

        // accomodate puzzle cropping
        if (this.bounds.left > 0) {
            ox = -s * this.bounds.left;
        }
        if (this.bounds.top > 0) {
            oy = -s * this.bounds.top;
        }

        ctx.save();

        if (this.square_size < 5) {
            ctx.lineWidth = 0.2;
        } else {
            ctx.lineWidth = 1;
        }

        ctx.strokeStyle = this.theme_line_color;
        ctx.fillStyle = this.theme_star_color;

        // FIXME: line/star fading needs to move into __drawSquare()
        /*
        if (have_text_to_draw) {
            ctx.strokeStyle = this.theme_faded_line_color;
        }
        */

        // continue lines off-board during zoom in puzzles
        // this helps the player see that it's not the edge of the board

        const midlineTweak = -0.5; // draw between-pixels to get crisp lines
        // vertical
        for (let i = 0; i < this.width; i++) {
            ctx.beginPath();
            ctx.moveTo(
                Math.floor(i * s + ox + this.metrics.mid + 0.5) + midlineTweak,
                Math.floor(oy + this.metrics.mid + 0.5),
            );
            ctx.lineTo(
                Math.floor(i * s + ox + this.metrics.mid + 0.5) + midlineTweak,
                Math.floor(oy + this.metrics.mid + (this.height - 1) * s + 0.5) + midlineTweak,
            );
            ctx.stroke();
        }

        //horizontal
        for (let j = 0; j < this.height; j++) {
            ctx.beginPath();
            ctx.moveTo(
                Math.floor(ox + this.metrics.mid),
                Math.floor(j * s + oy + this.metrics.mid + 0.5) + midlineTweak,
            );
            ctx.lineTo(
                Math.floor(ox + this.metrics.mid + (this.width - 1) * s + 0.5) + midlineTweak,
                Math.floor(j * s + oy + this.metrics.mid + 0.5) + midlineTweak,
            );
            ctx.stroke();
        }

        ctx.restore();
    }

    private drawStars(ctx: CanvasRenderingContext2D): void {
        /* draw the board's stars into the cxt provided, which should be the grid layer */
        const s = this.square_size;
        const ox = this.draw_left_labels ? s : 0;
        const oy = this.draw_top_labels ? s : 0;

        ctx.save();
        ctx.fillStyle = this.theme_star_color;

        /* Draw star points */
        let star_radius;
        if (this.square_size < 5) {
            star_radius = 0.5;
        } else {
            star_radius = Math.max(2, (this.metrics.mid - 1.5) * 0.16);
        }
        //let draw_star_point = false;

        let points: any = [];

        if (this.width === 19 && this.height === 19) {
            points = [
                [3, 3],
                [3, 9],
                [3, 15],
                [9, 3],
                [9, 9],
                [9, 15],
                [15, 3],
                [15, 9],
                [15, 15],
            ];
        }

        if (this.width === 13 && this.height === 13) {
            points = [
                [3, 3],
                [3, 9],
                [6, 6],
                [9, 3],
                [9, 9],
            ];
        }

        if (this.width === 9 && this.height === 9) {
            points = [
                [2, 2],
                [2, 6],
                [4, 4],
                [6, 2],
                [6, 6],
            ];
        }

        const midlineTweak = -0.5;
        for (const p of points) {
            // accomodate puzzle cropping:
            if (p[0] > this.bounded_width) {
                continue;
            }
            if (p[1] > this.bounded_height) {
                continue;
            }

            const cx = Math.floor(p[0] * s + ox + this.metrics.mid + 0.5) + midlineTweak;
            const cy = Math.floor(p[1] * s + oy + this.metrics.mid + 0.5) + midlineTweak;

            ctx.beginPath();
            ctx.fillStyle = this.theme_star_color;

            // FIXME: line/star fading needs to be done in __drawSquare()
            /*
            if (have_text_to_draw) {
                ctx.fillStyle = this.theme_faded_star_color;
            }
            */
            ctx.arc(
                cx,
                cy,
                star_radius,
                0.001,
                2 * Math.PI,
                false,
            ); /* 0.001 to workaround fucked up chrome 27 bug */
            ctx.fill();
        }

        ctx.restore();
    }

    public placeText(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number): void {
        /* places centered (horizontally & veritcally) text at x,y */
        const metrics = ctx.measureText(ch);
        const xx = x - metrics.width / 2;
        const yy = y;
        ctx.fillText(ch, xx, yy);
    }

    public vplaceText(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number): void {
        /* places centered (horizontally & veritcally) text at x,y, with text going down vertically. */
        for (let i = 0; i < ch.length; ++i) {
            const metrics = this.ctx.measureText(ch[i]);
            const xx = x - metrics.width / 2;
            let yy = y;
            const H =
                metrics.width; /* should be height in an ideal world, measureText doesn't seem to return it though. For our purposes this works well enough though. */

            if (ch.length === 2) {
                yy = yy - H + i * H;
            }
            if (ch.length === 3) {
                yy = yy - H * 1.5 + i * H;
            }

            ctx.fillText(ch[i], xx, yy);
        }
    }

    public drawHorizontalCoordinates(ctx: CanvasRenderingContext2D, i: number, j: number): void {
        switch (this.getCoordinateDisplaySystem()) {
            case "A1":
                for (let c = 0; c < this.bounded_width; ++i, ++c) {
                    const x =
                        c * this.square_size +
                        this.square_size / 2 +
                        +this.draw_left_labels * this.square_size;
                    const y = j * this.square_size + this.square_size / 2;
                    this.placeText(ctx, "ABCDEFGHJKLMNOPQRSTUVWXYZ"[c], x, y);
                }
                break;
            case "1-1":
                for (let c = 0; i <= this.bounded_width; ++i, ++c) {
                    const x =
                        c * this.square_size +
                        this.square_size / 2 +
                        +this.draw_left_labels * this.square_size;
                    const y = j * this.square_size + this.square_size / 2;
                    this.placeText(ctx, "" + (c + 1), x, y);
                }
                break;
        }
    }

    public drawVerticalCoordinates(ctx: CanvasRenderingContext2D, i: number, j: number): void {
        switch (this.getCoordinateDisplaySystem()) {
            case "A1":
                for (let c = 0; c < this.bounded_height; ++j, ++c) {
                    const x = i * this.square_size + this.square_size / 2;
                    const y =
                        c * this.square_size +
                        this.square_size / 2 +
                        +this.draw_top_labels * this.square_size;
                    this.placeText(ctx, "" + (this.bounded_height - c), x, y);
                }
                break;
            case "1-1":
                const chinese_japanese_numbers = [
                    "一",
                    "二",
                    "三",
                    "四",
                    "五",
                    "六",
                    "七",
                    "八",
                    "九",
                    "十",
                    "十一",
                    "十二",
                    "十三",
                    "十四",
                    "十五",
                    "十六",
                    "十七",
                    "十八",
                    "十九",
                    "二十",
                    "二十一",
                    "二十二",
                    "二十三",
                    "二十四",
                    "二十五",
                ];
                for (let c = 0; c < this.bounded_height; ++j, ++c) {
                    const x = i * this.square_size + this.square_size / 2;
                    const y =
                        c * this.square_size +
                        this.square_size / 2 +
                        +this.draw_top_labels * this.square_size;
                    this.vplaceText(ctx, chinese_japanese_numbers[c], x, y);
                }
                break;
        }
    }

    private drawCoordinates(ctx: CanvasRenderingContext2D): void {
        /* draw the board's coordinates into the cxt provided, which should be the grid layer */
        let text_size = Math.round(this.square_size * 0.5);
        let bold = "bold";
        const font = this.theme_board.getCoordinateFont();

        if (this.getCoordinateDisplaySystem() === "1-1") {
            text_size *= 0.7;
            bold = "";

            if (this.height > 20) {
                text_size *= 0.7;
            }
        }

        ctx.save();
        ctx.font = `${bold} ${text_size}px ${font}`;
        ctx.textBaseline = "middle";
        ctx.fillStyle = this.theme_board.getLabelTextColor();

        if (this.draw_top_labels && this.bounds.top === 0) {
            this.drawHorizontalCoordinates(ctx, this.draw_left_labels ? 1 : 0, 0);
        }
        if (this.draw_bottom_labels && this.bounds.bottom === this.height - 1) {
            this.drawHorizontalCoordinates(
                ctx,
                this.draw_left_labels ? 1 : 0,
                +this.draw_top_labels + this.bounded_height,
            );
        }

        if (this.draw_left_labels && this.bounds.left === 0) {
            this.drawVerticalCoordinates(ctx, 0, this.draw_top_labels ? 1 : 0);
        }
        if (this.draw_right_labels && this.bounds.right === this.width - 1) {
            this.drawVerticalCoordinates(
                ctx,
                +this.draw_left_labels + this.bounded_width,
                +this.draw_top_labels,
            );
        }

        ctx.restore();
    }

    private drawGridLayer(ctx: CanvasRenderingContext2D): void {
        ctx.clearRect(0, 0, this.grid_layer.width, this.grid_layer.height);
        this.drawGrid(ctx);
        this.drawStars(ctx);
        this.drawCoordinates(ctx);
    }

    private __drawSquare(i: number, j: number, d: DrawingInfo | null = null): void {
        if (i < 0 || j < 0) {
            return;
        }

        if (!d) {
            d = this.getDrawInfo(i, j);
        }

        let drawn = false;

        this.fadeTheLines(i, j, d);
        this.drawHeatmap(i, j, d);
        this.drawSquareHighlights(i, j, d);

        this.drawColoredStone(i, j, d);
        this.drawStone(i, j, d);
        this.drawScoring(i, j, d);

        if (this.drawTextLabels(i, j, d)) {
            drawn = this.drawSymbols(i, j, true, d); // request transparent draw
        } else {
            drawn = this.drawSymbols(i, j, false, d);
        }

        if (!drawn && d.draw_last_move) {
            this.drawLastMove(i, j, d);
        }

        this.drawScoreEstimate(i, j, d);
    }

    private drawingHash(i: number, j: number): string {
        if (i < 0 || j < 0) {
            return "..";
        }

        let ret = this.square_size + ",";

        const draw_last_move = !this.dont_draw_last_move;
        let stone_color = 0;
        if (this.engine) {
            stone_color = this.engine.board[j][i];
        }

        ret += stone_color + ",";

        /* Draw heatmap */
        if (this.heatmap) {
            if (this.heatmap[j][i] > 0.001) {
                ret += "heat " + this.heatmap[j][i] + ",";
            }
        }

        /* Colored stones */
        if (this.colored_circles) {
            if (this.colored_circles[j][i]) {
                const circle = this.colored_circles[j][i];
                ret += "circle " + circle.color;
            }
        }

        /* Figure out marks for this spot */
        let pos = this.getMarks(i, j);
        if (!pos) {
            console.error("No position for ", j, i);
            pos = {};
        }
        let altmarking: string | undefined;
        if (
            this.engine &&
            this.engine.cur_move &&
            (this.mode !== "play" ||
                (typeof this.isInPushedAnalysis() !== "undefined" && this.isInPushedAnalysis()))
        ) {
            let cur: MoveTree | null = this.engine.cur_move;
            for (; cur && !cur.trunk; cur = cur.parent) {
                if (cur.x === i && cur.y === j) {
                    const move_diff = cur.getMoveNumberDifferenceFromTrunk();
                    if (move_diff !== cur.move_number) {
                        if (!cur.edited && this.show_move_numbers) {
                            altmarking = cur.getMoveNumberDifferenceFromTrunk().toString();
                        }
                    }
                }
            }
        }

        let movetree_contains_this_square = false;
        if (this.engine && this.engine.cur_move.lookupMove(i, j, this.engine.player, false)) {
            movetree_contains_this_square = true;
        }

        /* Draw stones & hovers */
        {
            if (
                stone_color /* if there is really a stone here */ ||
                (this.stone_placement_enabled &&
                    this.last_hover_square &&
                    this.last_hover_square.x === i &&
                    this.last_hover_square.y === j &&
                    (this.mode !== "analyze" || this.analyze_tool === "stone") &&
                    this.engine &&
                    !this.scoring_mode &&
                    (this.engine.phase === "play" ||
                        (this.engine.phase === "finished" && this.mode === "analyze")) &&
                    (this.engine.puzzle_player_move_mode !== "fixed" ||
                        movetree_contains_this_square ||
                        (this.getPuzzlePlacementSetting &&
                            this.getPuzzlePlacementSetting().mode !== "play"))) ||
                (this.scoring_mode &&
                    this.score_estimate &&
                    this.score_estimate.board[j][i] &&
                    this.score_estimate.removal[j][i]) ||
                (this.engine &&
                    this.engine.phase === "stone removal" &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]) ||
                pos.black ||
                pos.white
            ) {
                let transparent = false;
                let color;
                if (
                    this.scoring_mode &&
                    this.score_estimate &&
                    this.score_estimate.board[j][i] &&
                    this.score_estimate.removal[j][i]
                ) {
                    color = this.score_estimate.board[j][i];
                    transparent = true;
                } else if (
                    this.engine &&
                    this.engine.phase === "stone removal" &&
                    this.engine.board &&
                    this.engine.removal &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]
                ) {
                    color = this.engine.board[j][i];
                    transparent = true;
                } else if (stone_color) {
                    color = stone_color;
                } else if (
                    this.mode === "edit" ||
                    (this.mode === "analyze" &&
                        this.analyze_tool === "stone" &&
                        this.analyze_subtool !== "alternate")
                ) {
                    color = this.edit_color === "black" ? 1 : 2;
                } else if (this.move_selected) {
                    if (this.engine.handicapMovesLeft() <= 0) {
                        color = this.engine.otherPlayer();
                    } else {
                        color = this.engine.player;
                    }
                } else if (pos.black || pos.white) {
                    color = pos.black ? 1 : 2;
                    transparent = true;
                } else {
                    color = this.engine.player;
                }

                ret += (transparent ? "T" : "") + color + ",";
            }
        }

        /* Draw square highlights if any */
        {
            if (pos.hint || (this.highlight_movetree_moves && movetree_contains_this_square)) {
                if (pos.hint) {
                    ret += "hint,";
                } else {
                    ret += "highlight,";
                }
            }
        }

        /* Draw delete X's */
        {
            let draw_x = false;
            let transparent = false;
            if (
                this.engine &&
                (this.scoring_mode || this.engine.phase === "stone removal") &&
                this.stone_placement_enabled &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j &&
                (this.mode !== "analyze" || this.analyze_tool === "stone")
            ) {
                draw_x = true;
                transparent = true;
            }

            if (pos.mark_x) {
                draw_x = true;
                transparent = false;
            }

            if (this.scoring_mode && this.score_estimate && this.score_estimate.removal[j][i]) {
                draw_x = true;
                transparent = false;
            }

            if (pos.remove && this.mode !== "analyze") {
                draw_x = true;
                transparent = false;
            }

            ret += draw_x + "," + transparent;
        }

        /* Draw Scores */
        {
            if (
                (pos.score && (this.engine.phase !== "finished" || this.mode === "play")) ||
                (this.scoring_mode &&
                    this.score_estimate &&
                    (this.score_estimate.territory[j][i] ||
                        (this.score_estimate.removal[j][i] &&
                            this.score_estimate.board[j][i] === 0))) ||
                ((this.engine.phase === "stone removal" ||
                    (this.engine.phase === "finished" && this.mode === "play")) &&
                    this.engine.board[j][i] === 0 &&
                    this.engine.removal[j][i])
            ) {
                let color = pos.score;
                if (
                    this.scoring_mode &&
                    this.score_estimate &&
                    (this.score_estimate.territory[j][i] ||
                        (this.score_estimate.removal[j][i] &&
                            this.score_estimate.board[j][i] === 0))
                ) {
                    color = this.score_estimate.territory[j][i] === 1 ? "black" : "white";
                    if (
                        this.score_estimate.board[j][i] === 0 &&
                        this.score_estimate.removal[j][i]
                    ) {
                        color = "dame";
                    }
                }

                if (
                    (this.engine.phase === "stone removal" ||
                        (this.engine.phase === "finished" && this.mode === "play")) &&
                    this.engine.board[j][i] === 0 &&
                    this.engine.removal[j][i]
                ) {
                    color = "dame";
                }

                if (
                    this.scoring_mode &&
                    this.score_estimate &&
                    this.score_estimate.territory[j][i]
                ) {
                    color = this.score_estimate.territory[j][i] === 1 ? "black" : "white";
                }
                ret += "score " + color + ",";
            }
        }

        /* Draw letters and numbers */
        {
            let letter: string | undefined;
            let transparent = false;
            if (pos.letter) {
                letter = pos.letter;
            }
            if (
                this.mode === "play" &&
                this.byoyomi_label &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j
            ) {
                //transparent = true;
                letter = this.byoyomi_label;
            }
            if (
                this.mode === "analyze" &&
                this.analyze_tool === "label" &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j
            ) {
                transparent = true;
                letter = this.label_character;
            }
            if (!letter && altmarking !== "triangle") {
                letter = altmarking;
            }

            if (
                this.show_variation_move_numbers &&
                !letter &&
                !(pos.circle || pos.triangle || pos.chat_triangle || pos.cross || pos.square)
            ) {
                const m = this.engine.getMoveByLocation(i, j);
                if (m && !m.trunk) {
                    if (m.edited) {
                        //letter = "triangle";
                        if (this.engine.board[j][i]) {
                            altmarking = "triangle";
                        }
                    } else {
                        letter = m.getMoveNumberDifferenceFromTrunk().toString();
                    }
                }
            }

            if (letter) {
                ret += letter + (transparent ? " fade" : "") + ",";
            }
            if (pos.subscript) {
                ret += " _ " + pos.subscript + (transparent ? " fade" : "") + ",";
            }
        }

        /* draw special symbols */
        {
            if (
                this.analyze_tool === "label" &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j
            ) {
                if (
                    this.analyze_subtool === "triangle" ||
                    this.analyze_subtool === "square" ||
                    this.analyze_subtool === "cross" ||
                    this.analyze_subtool === "circle"
                ) {
                    ret += "hover " + this.analyze_subtool + ",";
                }
            }

            if (pos.circle) {
                ret += "circle,";
            }
            if (pos.triangle || pos.chat_triangle || altmarking === "triangle") {
                ret += "triangle,";
            }
            if (pos.cross) {
                ret += "cross,";
            }
            if (pos.square) {
                ret += "square,";
            }
        }

        /* Draw last move */
        if (draw_last_move && this.engine && this.engine.cur_move) {
            if (
                this.engine.cur_move.x === i &&
                this.engine.cur_move.y === j &&
                this.engine.board[j][i] &&
                (this.engine.phase === "play" || this.engine.phase === "finished")
            ) {
                ret += "last_move,";
            }
        }

        return ret;
    }
    public redraw(force_clear?: boolean): void {
        if (!this.ready_to_draw) {
            return;
        }
        if (this.destroyed) {
            console.error("Attempting to redraw destroyed goban");
            return;
        }
        if (!this.drawing_enabled) {
            return;
        }
        if (this.no_display) {
            return;
        }
        // console.log(this) // helpful when debugging

        const metrics = (this.metrics = this.computeMetrics());
        if (
            force_clear ||
            !(
                this.__set_board_width === metrics.width &&
                this.__set_board_height === metrics.height &&
                this.theme_stone_radius === this.computeThemeStoneRadius()
            )
        ) {
            force_clear = true;
            try {
                //this.parent.css({"width": metrics.width + "px", "height": metrics.height + "px"});
                this.parent.style.width = metrics.width + "px";
                this.parent.style.height = metrics.height + "px";
                resizeDeviceScaledCanvas(this.board, metrics.width, metrics.height);

                this.layer_offset_left = 0;
                this.layer_offset_top = 0;

                resizeDeviceScaledCanvas(this.grid_layer, metrics.width, metrics.height);
                this.grid_layer.style.left = this.layer_offset_left + "px";
                this.grid_layer.style.top = this.layer_offset_top + "px";
                const under_ctx = this.grid_layer.getContext("2d");
                if (under_ctx) {
                    this.grid_ctx = under_ctx;
                } else {
                    throw new Error(`Failed to obtain drawing context for understone layer`);
                }

                if (this.pen_layer) {
                    if (this.pen_marks.length) {
                        resizeDeviceScaledCanvas(this.pen_layer, metrics.width, metrics.height);
                        //this.pen_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
                        this.pen_layer.style.left = this.layer_offset_left + "px";
                        this.pen_layer.style.top = this.layer_offset_top + "px";
                        const ctx = this.pen_layer.getContext("2d");
                        if (ctx) {
                            this.pen_ctx = ctx;
                        } else {
                            throw new Error(`Failed to obtain drawing context for pen layer`);
                        }
                    } else {
                        this.detachPenCanvas();
                    }
                }

                if (this.shadow_layer) {
                    resizeDeviceScaledCanvas(this.shadow_layer, metrics.width, metrics.height);
                    //this.shadow_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
                    this.shadow_layer.style.left = this.layer_offset_left + "px";
                    this.shadow_layer.style.top = this.layer_offset_top + "px";
                    const ctx = this.shadow_layer.getContext("2d");
                    if (ctx) {
                        this.shadow_ctx = ctx;
                    } else {
                        throw new Error(`Failed to obtain drawing context for shadow layer`);
                    }
                }

                this.__set_board_width = metrics.width;
                this.__set_board_height = metrics.height;
                const ctx = this.board.getContext("2d");
                if (ctx) {
                    this.ctx = ctx;
                } else {
                    throw new Error(`Failed to obtain drawing context for board`);
                }
                fitTextCaches = new WeakMap();

                this.setThemes(this.getSelectedThemes(), true);
            } catch (e) {
                setTimeout(() => {
                    throw e;
                }, 1);
                return;
            }
        }
        const ctx = this.ctx;

        if (force_clear || !this.__borders_initialized) {
            this.__borders_initialized = true;
            /*
            if (this.shadow_ctx) {
                this.shadow_ctx.clearRect(0, 0, metrics.width, metrics.height);
            }
            */
            /* Draw markings on the board */
            this.drawGridLayer(this.grid_ctx);
        }

        /* Draw squares */
        if (
            !this.__draw_state ||
            force_clear ||
            this.__draw_state.length !== this.height ||
            this.__draw_state[0].length !== this.width
        ) {
            this.__draw_state = GoMath.makeStringMatrix(this.width, this.height);
        }

        /* Set font for text overlay */
        {
            const text_size = Math.round(this.square_size * 0.45);
            const font = this.theme_board.getLabelFont();

            ctx.font = "bold " + text_size + "px " + font;
        }

        for (let j = this.bounds.top; j <= this.bounds.bottom; ++j) {
            for (let i = this.bounds.left; i <= this.bounds.right; ++i) {
                let drawit = false;

                // this state change check is here because full redraw() is
                // called from basically everywhere when a limited update would do
                const jm = JSON.stringify(this.engine.cur_move.getMarks(i, j));
                const jb = JSON.stringify(this.engine.board[j][i]);

                if (this.previous_marks[j][i] !== jm) {
                    drawit = true;
                }
                if (this.previous_board[j][i] !== jb) {
                    drawit = true;
                }

                if (
                    force_clear ||
                    drawit || // this may have no practical effect
                    (this.engine.cur_move.x === i && this.engine.cur_move.y === j)
                ) {
                    // always draw current move due to glitch in marking last move
                    this.queueDrawSquare(i, j);
                    this.previous_marks[j][i] = jm;
                    this.previous_board[j][i] = jb;
                }
            }
        }
        // have to draw the last move to clear the mark
        if (this.last_move && this.engine && !this.last_move.is(this.engine.cur_move)) {
            const m = this.last_move;
            delete this.last_move;
            this.queueDrawSquare(m.x, m.y);
        }

        this.drawQueuedSquares();
        this.drawPenMarks(this.pen_marks);
        this.move_tree_redraw();
    }
    public message(msg: string, timeout: number = 5000): void {
        this.clearMessage();

        this.message_div = document.createElement("div");
        this.message_div.className = "GobanMessage";
        this.message_td = document.createElement("td");
        const table = document.createElement("table");
        const tr = document.createElement("tr");
        tr.appendChild(this.message_td);
        table.appendChild(tr);
        this.message_div.appendChild(table);
        this.message_text = document.createElement("div");
        this.message_text.innerHTML = msg;
        this.message_td.appendChild(this.message_text);
        this.parent.appendChild(this.message_div);

        const message_time = Date.now();
        this.message_div.addEventListener("click", () => {
            try {
                if (Date.now() - message_time < 100) {
                    return;
                }

                if (timeout > 0) {
                    this.clearMessage();
                }
            } catch (e) {
                console.error(e);
            }
        });

        if (!timeout) {
            timeout = 5000;
        }

        if (timeout > 0) {
            this.message_timeout = window.setTimeout(() => {
                this.clearMessage();
            }, timeout);
        }
    }
    public clearMessage(): void {
        if (this.message_div) {
            this.message_div.parentNode?.removeChild(this.message_div);
            delete this.message_div;
        }
        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }
    }

    protected setThemes(themes: GobanSelectedThemes, dont_redraw: boolean): void {
        if (this.no_display) {
            return;
        }

        this.themes = themes;
        this.theme_board = new GoThemes["board"][themes.board]();
        this.theme_white = new GoThemes["white"][themes.white](this.theme_board);
        this.theme_black = new GoThemes["black"][themes.black](this.theme_board);

        if (!this.metrics) {
            this.metrics = this.computeMetrics();
        }
        this.theme_stone_radius = this.computeThemeStoneRadius();
        if (isNaN(this.theme_stone_radius)) {
            console.error(
                "setThemes was not able to find the board size, metrics were: ",
                JSON.stringify(this.metrics),
            );
            throw new Error("invalid stone radius computed");
        }

        if (
            this.theme_white.stoneCastsShadow(this.theme_stone_radius) ||
            this.theme_black.stoneCastsShadow(this.theme_stone_radius)
        ) {
            if (this.shadow_layer) {
                resizeDeviceScaledCanvas(
                    this.shadow_layer,
                    this.metrics.width,
                    this.metrics.height,
                );
                //this.shadow_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
                this.shadow_layer.style.left = this.layer_offset_left + "px";
                this.shadow_layer.style.top = this.layer_offset_top + "px";
                const ctx = this.shadow_layer.getContext("2d");
                if (ctx) {
                    this.shadow_ctx = ctx;
                } else {
                    throw new Error(`Failed to get drawing context for shadow layer`);
                }
            } else {
                this.attachShadowLayer();
            }
        } else {
            this.detachShadowLayer();
        }

        if (!(themes.white in __theme_cache.white)) {
            __theme_cache.white[themes.white] = {};
        }
        if (!(themes.black in __theme_cache.black)) {
            __theme_cache.black[themes.black] = {};
        }
        if (!(this.theme_stone_radius in __theme_cache.white[themes.white])) {
            __theme_cache.white[themes.white][this.theme_stone_radius] =
                this.theme_white.preRenderWhite(this.theme_stone_radius, 23434);
        }
        if (!(this.theme_stone_radius in __theme_cache.black[themes.black])) {
            __theme_cache.black[themes.black][this.theme_stone_radius] =
                this.theme_black.preRenderBlack(this.theme_stone_radius, 2081);
        }

        if (!(MoveTree.stone_radius in __theme_cache.white[themes.white])) {
            __theme_cache.white[themes.white][MoveTree.stone_radius] =
                this.theme_white.preRenderWhite(MoveTree.stone_radius, 23434);
        }
        if (!(MoveTree.stone_radius in __theme_cache.black[themes.black])) {
            __theme_cache.black[themes.black][MoveTree.stone_radius] =
                this.theme_black.preRenderBlack(MoveTree.stone_radius, 2081);
        }

        this.theme_white_stones = __theme_cache.white[themes.white][this.theme_stone_radius];
        this.theme_black_stones = __theme_cache.black[themes.black][this.theme_stone_radius];
        this.theme_line_color = this.theme_board.getLineColor();

        // FIXME: lines/stars should be faded in __drawSquare on demand

        this.theme_star_color = this.theme_board.getStarColor();
        this.theme_blank_text_color = this.theme_board.getBlankTextColor();
        this.theme_black_text_color = this.theme_black.getBlackTextColor();
        this.theme_white_text_color = this.theme_white.getWhiteTextColor();
        //this.parent.css(this.theme_board.getBackgroundCSS());
        const bgcss = this.theme_board.getBackgroundCSS();
        if (this.parent) {
            for (const key in bgcss) {
                (this.parent.style as any)[key] = (bgcss as any)[key];
            }
        }

        if (!dont_redraw) {
            this.redraw(true);
            this.move_tree_redraw();
        }
    }
    private onLabelingStart(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev);
        this.last_label_position = this.xy2ij(pos.x, pos.y);

        {
            const x = this.last_label_position.i;
            const y = this.last_label_position.j;
            if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
                return;
            }
        }

        this.labeling_mode = this.putOrClearLabel(
            this.last_label_position.i,
            this.last_label_position.j,
        )
            ? "put"
            : "clear";

        /* clear hover */
        if (this.__last_pt.valid) {
            const last_hover = this.last_hover_square;
            delete this.last_hover_square;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }
        this.__last_pt = this.xy2ij(-1, -1);
        this.drawSquare(this.last_label_position.i, this.last_label_position.j);
    }
    private onLabelingMove(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev);
        const cur = this.xy2ij(pos.x, pos.y);

        {
            const x = cur.i;
            const y = cur.j;
            if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
                return;
            }
        }

        if (cur.i !== this.last_label_position.i || cur.j !== this.last_label_position.j) {
            this.last_label_position = cur;
            this.putOrClearLabel(cur.i, cur.j, this.labeling_mode);
            this.setLabelCharacterFromMarks();
        }
    }

    protected setTitle(title: string): void {
        this.title = title;
        if (this.title_div) {
            this.title_div.innerHTML = title;
        }
        this.emit("title", title);
    }
    protected watchSelectedThemes(cb: (themes: GobanSelectedThemes) => void): {
        remove: () => any;
    } {
        if (GobanCore.hooks.watchSelectedThemes) {
            return GobanCore.hooks.watchSelectedThemes(cb);
        }
        return { remove: () => {} };
    }

    //
    // Move tree
    //
    public setMoveTreeContainer(container: HTMLElement): void {
        this.move_tree_container = container;
        this.move_tree_redraw();
    }

    public move_tree_redraw(no_warp?: boolean): void {
        if (!this.move_tree_container) {
            return;
        }

        let do_init = false;
        if (!this.move_tree_inner_container) {
            do_init = true;
            this.move_tree_inner_container = document.createElement("div");
            this.move_tree_canvas = document.createElement("canvas");
            this.move_tree_inner_container.appendChild(this.move_tree_canvas);
            this.move_tree_container.appendChild(this.move_tree_inner_container);
            this.move_tree_bindCanvasEvents(this.move_tree_canvas);
            this.move_tree_container.style.position = "relative";
            this.move_tree_canvas.style.position = "absolute";

            try {
                const observer = new ResizeObserver(() => {
                    this.move_tree_redraw(true);
                });
                observer.observe(this.move_tree_container);
                this.on("destroy", () => {
                    observer.disconnect();
                });
            } catch (e) {
                // ResizeObserver is still fairly new and might not exist
            }
        }

        if (!this.move_tree_canvas) {
            console.warn(`move_tree_redraw called without move_tree_canvas set`);
            return;
        }

        if (do_init || this.move_tree_inner_container.parentNode !== this.move_tree_container) {
            const move_tree_on_scroll = (event: Event) => {
                try {
                    this.move_tree_redraw(true);
                } catch (e) {
                    console.error(e);
                }
            };

            this.move_tree_container.appendChild(this.move_tree_inner_container);
            this.move_tree_container.style.position = "relative";
            this.move_tree_container.removeEventListener("scroll", move_tree_on_scroll);
            this.move_tree_container.addEventListener("scroll", move_tree_on_scroll);
            const mt = this.move_tree_container;
            this.on("destroy", () => {
                mt.removeEventListener("scroll", move_tree_on_scroll);
            });
        }

        /*
        if (this.move_tree_canvas.width !== this.move_tree_container.outerWidth ||
            this.move_tree_canvas.height !== this.move_tree_container.outerHeight
        ) {
            console.log(this.move_tree_canvas.width, this.move_tree_container.outerWidth,
                this.move_tree_canvas.height, this.move_tree_container.outerHeight);
            this.move_tree_canvas.width = this.move_tree_container.outerWidth;
            this.move_tree_canvas.height = this.move_tree_container.outerHeight;
            this.move_tree_canvas.style.width = this.move_tree_container.outerWidth + "px";
            this.move_tree_canvas.style.height = this.move_tree_container.outerHeight + "px";
        }
        */

        this.engine.move_tree.recomputeIsobranches();
        const active_path_end = this.engine.cur_move;

        this.engine.move_tree_layout_dirty = false;

        active_path_end.setActivePath(++MoveTree.active_path_number);

        /*
        if (!this.move_tree_container.data("move-tree-redraw-on-scroll")) {
            let debounce = false;
            this.redraw_on_scroll = () => {
                MoveTree.redraw_root.redraw(MoveTree.redraw_config, true);
            };
            this.move_tree_container.data("move-tree-redraw-on-scroll", this.redraw_on_scroll);
            this.move_tree_container.scroll(this.redraw_on_scroll);
        }
        */

        const canvas = this.move_tree_canvas;
        const engine = this.engine;

        this.engine.move_tree_layout_vector = [];
        const layout_hash = {};
        this.engine.move_tree.layout(0, 0, layout_hash, 0);
        this.engine.move_tree_layout_hash = layout_hash;
        let max_height = 0;
        for (let i = 0; i < this.engine.move_tree_layout_vector.length; ++i) {
            max_height = Math.max(this.engine.move_tree_layout_vector[i] + 1, max_height);
        }

        const div_clientWidth = this.move_tree_container.clientWidth;
        const div_clientHeight = this.move_tree_container.clientHeight;
        const width = Math.max(
            div_clientWidth,
            this.engine.move_tree_layout_vector.length * MoveTree.stone_square_size,
        );
        const height = Math.max(div_clientHeight, max_height * MoveTree.stone_square_size);

        let div_scroll_top = this.move_tree_container.scrollTop;
        let div_scroll_left = this.move_tree_container.scrollLeft;

        if (canvas.width !== div_clientWidth || canvas.height !== div_clientHeight) {
            resizeDeviceScaledCanvas(
                canvas,
                this.move_tree_container.clientWidth,
                this.move_tree_container.clientHeight,
            );
        }

        this.move_tree_inner_container.style.width = width + "px";
        this.move_tree_inner_container.style.height = height + "px";

        if (!no_warp) {
            /* make sure our active stone is visible, but don't scroll around unnecessarily */
            if (
                div_scroll_left > active_path_end.layout_cx ||
                div_scroll_left + div_clientWidth - 20 < active_path_end.layout_cx ||
                div_scroll_top > active_path_end.layout_cy ||
                div_scroll_top + div_clientHeight - 20 < active_path_end.layout_cy
            ) {
                this.move_tree_container.scrollLeft =
                    active_path_end.layout_cx - div_clientWidth / 2;
                this.move_tree_container.scrollTop =
                    active_path_end.layout_cy - div_clientHeight / 2;
                div_scroll_top = this.move_tree_container.scrollTop;
                div_scroll_left = this.move_tree_container.scrollLeft;
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

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error(`Failed to get drawing context for move tree canvas`);
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        this.move_tree_hilightNode(ctx, active_path_end, "#6BAADA", viewport);

        if (engine.cur_review_move && engine.cur_review_move.id !== active_path_end.id) {
            this.move_tree_hilightNode(ctx, engine.cur_review_move, "#6BDA6B", viewport);
        }

        ctx.save();
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = this.theme_line_color;
        this.move_tree_recursiveDrawPath(ctx, this.engine.move_tree, viewport);
        ctx.restore();

        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        const text_size = 10;
        ctx.font = `bold ${text_size}px Verdana,Arial,sans-serif`;
        ctx.textBaseline = "middle";
        this.move_tree_drawRecursive(
            ctx,
            this.engine.move_tree,
            MoveTree.active_path_number,
            viewport,
        );
        ctx.restore();
    }
    public move_tree_bindCanvasEvents(canvas: HTMLCanvasElement): void {
        const handler = (event: TouchEvent | MouseEvent) => {
            try {
                if (!this.move_tree_container) {
                    throw new Error(`move_tree_container was not set`);
                }

                const ox = this.move_tree_container.scrollLeft;
                const oy = this.move_tree_container.scrollTop;
                const pos = getRelativeEventPosition(event);
                pos.x += ox;
                pos.y += oy;
                const i = Math.floor(pos.x / MoveTree.stone_square_size);
                const j = Math.floor(pos.y / MoveTree.stone_square_size);
                const node = this.engine.move_tree.getNodeAtLayoutPosition(i, j);

                if (node) {
                    if (this.engine.cur_move.id !== node.id) {
                        this.engine.jumpTo(node);
                        this.setLabelCharacterFromMarks();
                        this.updateTitleAndStonePlacement();
                        this.emit("update");
                        this.syncReviewMove();
                        this.redraw();
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        canvas.addEventListener("touchstart", handler);
        canvas.addEventListener("mousedown", handler);

        this.on("destroy", () => {
            canvas.removeEventListener("touchstart", handler);
            canvas.removeEventListener("mousedown", handler);
        });
    }

    move_tree_drawStone(
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

        const theme_white_stones = __theme_cache.white[this.themes.white][MoveTree.stone_radius];
        const theme_black_stones = __theme_cache.black[this.themes.black][MoveTree.stone_radius];

        if (color === 1) {
            const stone = theme_black_stones[stone_idx % theme_black_stones.length];
            this.theme_black.placeBlackStone(ctx, null, stone, cx, cy, MoveTree.stone_radius);
        } else if (color === 2) {
            const stone = theme_white_stones[stone_idx % theme_white_stones.length];
            this.theme_white.placeWhiteStone(ctx, null, stone, cx, cy, MoveTree.stone_radius);
        } else {
            return;
        }

        const text_color = color === 1 ? this.theme_black_text_color : this.theme_white_text_color;

        let label = "";
        switch (
            GobanCore.hooks.getMoveTreeNumbering
                ? GobanCore.hooks.getMoveTreeNumbering()
                : "move-number"
        ) {
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
    move_tree_drawRecursive(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        active_path_number: number,
        viewport: ViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.move_tree_drawRecursive(ctx, node.trunk_next, active_path_number, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.move_tree_drawRecursive(ctx, node.branches[i], active_path_number, viewport);
        }

        if (
            !viewport ||
            (node.layout_cx >= viewport.minx &&
                node.layout_cx <= viewport.maxx &&
                node.layout_cy >= viewport.miny &&
                node.layout_cy <= viewport.maxy)
        ) {
            this.move_tree_drawStone(ctx, node, active_path_number, viewport);
        }
    }
    move_tree_hilightNode(
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

    move_tree_drawPath(
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
    move_tree_drawIsoBranchTo(
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
    move_tree_recursiveDrawPath(
        ctx: CanvasRenderingContext2D,
        node: MoveTree,
        viewport: ViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.move_tree_recursiveDrawPath(ctx, node.trunk_next, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.move_tree_recursiveDrawPath(ctx, node.branches[i], viewport);
        }

        if (node.isobranches) {
            for (let i = 0; i < node.isobranches.length; ++i) {
                this.move_tree_drawIsoBranchTo(ctx, node, node.isobranches[i], viewport);
            }
        }

        /* only consider x, since lines can extend awhile on the y */
        //if (this.layout_cx >= viewport.minx && this.layout_cx <= viewport.maxx) {
        this.move_tree_drawPath(ctx, node, viewport);
        //}
    }
}

//let fitTextCache: { [key: string]: [number, string, TextMetrics] } = {};
type FitTextCacheType = { [key: string]: [number, string, TextMetrics] };
let fitTextCaches: WeakMap<CanvasRenderingContext2D, FitTextCacheType> = new WeakMap();

// fontPattern MUST have a FONT_SIZE string in it that will be replaced
// ctx.font will be set to the appropriate size when this returns.
// @returns font_size, font_string, metrics
function fitText(
    ctx: CanvasRenderingContext2D,
    text: string,
    fontPattern: string,
    startingFontSize: number,
    width: number,
): [number, string, TextMetrics] {
    const MIN_FONT_SIZE = 4;

    if (fontPattern.indexOf("FONT_SIZE") < 0) {
        throw new Error(
            `fitText expects FONT_SIZE to be present in the fontPattern, was ${fontPattern}`,
        );
    }

    let fitTextCache = {} as FitTextCacheType;
    const tc = fitTextCaches.get(ctx) as FitTextCacheType;
    if (tc) {
        fitTextCache = tc;
    }

    const key = `${width} ${fontPattern} ${startingFontSize} ${text}`;
    if (key in fitTextCache) {
        const cached = fitTextCache[key];
        ctx.font = cached[1];
        return cached;
    }

    let font_size = startingFontSize;

    do {
        const font = fontPattern.replace("FONT_SIZE", font_size.toString());
        ctx.font = font;
        const metrics = ctx.measureText(text);
        if (font_size <= MIN_FONT_SIZE || metrics.width < width) {
            fitTextCache[key] = [font_size, font, metrics];
            fitTextCaches.set(ctx, fitTextCache);
            return fitTextCache[key];
        }

        const new_font_size = Math.floor((font_size * width) / metrics.width);
        if (new_font_size >= font_size) {
            font_size = font_size - 1;
        } else {
            font_size = new_font_size;
        }
    } while (true);
}
