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

import { JGOF, JGOFIntersection, JGOFNumericPlayerColor } from "../engine/formats/JGOF";

import { AdHocFormat } from "../engine/formats/AdHocFormat";

import { GobanConfig } from "../GobanBase";
import { GobanEngine } from "../engine";
import { MoveTree } from "../engine/MoveTree";
import { GobanTheme, THEMES } from "./themes";
import { MoveTreePenMarks } from "../engine/MoveTree";
import {
    createDeviceScaledCanvas,
    resizeDeviceScaledCanvas,
    allocateCanvasOrError,
    getRelativeEventPosition,
} from "./canvas_utils";
import { _ } from "../engine/translate";
import { formatMessage, MessageID } from "../engine/messages";
import {
    color_blend,
    encodeMove,
    encodeMoves,
    encodePrettyXCoordinate,
    getRandomInt,
    makeMatrix,
} from "../engine/util";
import { callbacks } from "./callbacks";
import { Goban, GobanMetrics, GobanSelectedThemes, GOBAN_FONT } from "./Goban";

const __theme_cache: {
    [bw: string]: { [name: string]: { [size: string]: any } };
} = {
    black: {},
    white: {},
};

declare let ResizeObserver: any;

export interface CanvasRendererGobanConfig extends GobanConfig {
    board_div?: HTMLElement;
    title_div?: HTMLElement;
    move_tree_container?: HTMLElement;
    last_move_opacity?: number;
}

interface ViewPortInterface {
    offset_x: number;
    offset_y: number;
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
}

const HOT_PINK = "#ff69b4";

export interface GobanCanvasInterface {
    engine: GobanEngine;
    move_tree_container?: HTMLElement;

    clearAnalysisDrawing(): void;
    drawPenMarks(pen_marks: MoveTreePenMarks): void;
    enablePen(): void;
    disablePen(): void;
    setByoYomiLabel(label: string): void;
    setLastMoveOpacity(opacity: number): void;

    move_tree_bindCanvasEvents(canvas: HTMLCanvasElement): void;
    move_tree_redraw(no_warp?: boolean): void;
    setMoveTreeContainer(container: HTMLElement): void;

    showMessage(
        message_id_or_error: MessageID,
        parameters?: { [key: string]: any },
        timeout?: number,
    ): void;
    clearMessage(): void;

    drawSquare(i: number, j: number): void;

    destroy(): void;
}

export class GobanCanvas extends Goban implements GobanCanvasInterface {
    public engine: GobanEngine;
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
    private handleShiftKey: (ev: KeyboardEvent) => void;

    private last_move_opacity: number = 1;
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

    private drawing_enabled: boolean = true;
    private pen_ctx?: CanvasRenderingContext2D;
    private pen_layer?: HTMLCanvasElement;
    protected title_div?: HTMLElement;

    private themes: GobanSelectedThemes = {
        "board": "Plain",
        "black": "Plain",
        "white": "Plain",
        "removal-graphic": "x",
        "removal-scale": 1.0,
    };
    private theme_black!: GobanTheme;
    private theme_black_stones: Array<any> = [];
    private theme_black_text_color: string = HOT_PINK;
    private theme_blank_text_color: string = HOT_PINK;
    private theme_board!: GobanTheme;
    private theme_faded_line_color: string = HOT_PINK;
    private theme_faded_star_color: string = HOT_PINK;
    //private theme_faded_text_color:string;
    private theme_line_color: string = "";
    private theme_star_color: string = "";
    private theme_stone_radius: number = 10;
    private theme_white!: GobanTheme;
    private theme_white_stones: Array<any> = [];
    private theme_white_text_color: string = HOT_PINK;

    constructor(config: CanvasRendererGobanConfig, preloaded_data?: AdHocFormat | JGOF) {
        /* TODO: Need to reconcile the clock fields before we can get rid of this `any` cast */
        super(config, preloaded_data as any);

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
        this.board = createDeviceScaledCanvas(10, 10);
        this.board.setAttribute("id", "board-canvas");
        this.board.className = "StoneLayer";
        this.last_move_opacity = config["last_move_opacity"] ?? 1;
        const ctx = this.board.getContext("2d", { willReadFrequently: true });
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

        // these are set in this.setThemes(..)
        // this.theme_board
        // this.theme_white
        // this.theme_black
        this.setTheme(this.getSelectedThemes(), true);
        let first_pass = true;
        const watcher = this.watchSelectedThemes((themes: GobanSelectedThemes) => {
            if (!this.engine) {
                return;
            }
            if (
                themes.black === "Custom" ||
                themes.white === "Custom" ||
                themes.board === "Custom"
            ) {
                //first_pass = true;
            }
            delete __theme_cache.black?.["Custom"];
            delete __theme_cache.white?.["Custom"];
            delete __theme_cache.board?.["Custom"];
            this.setTheme(themes, first_pass ? true : false);
            first_pass = false;
        });
        this.on("destroy", () => watcher.remove());

        this.engine = this.post_config_constructor();
        this.emit("engine.updated", this.engine);

        this.ready_to_draw = true;
        this.redraw(true);
    }
    public setLastMoveOpacity(opacity: number): void {
        this.last_move_opacity = opacity;
    }

    public enablePen(): void {
        this.attachPenCanvas();
    }
    public disablePen(): void {
        this.detachPenCanvas();
    }

    public override destroy(): void {
        super.destroy();

        if (this.board && this.board.parentNode) {
            this.board.parentNode.removeChild(this.board);
        }
        delete (this as any).board;
        delete (this as any).ctx;

        this.detachPenCanvas();
        this.detachShadowLayer();

        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }

        window.removeEventListener("keydown", this.handleShiftKey);
        window.removeEventListener("keyup", this.handleShiftKey);

        this.theme_black_stones = [];
        this.theme_white_stones = [];
        delete (this as any).theme_board;
        delete (this as any).theme_black;
        delete (this as any).theme_white;
        delete this.message_div;
        delete this.message_td;
        delete this.message_text;
        delete this.move_tree_container;
        delete this.move_tree_inner_container;
        delete this.move_tree_canvas;
        delete this.title_div;
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

            const ctx = this.shadow_layer.getContext("2d", { willReadFrequently: true });
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
            const ctx = this.pen_layer.getContext("2d", { willReadFrequently: true });
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
        let pointer_down_timestamp = 0;

        const pointerUp = (ev: MouseEvent | TouchEvent, double_clicked: boolean): void => {
            const press_duration_ms = performance.now() - pointer_down_timestamp;
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
                        if (this.score_estimator) {
                            this.score_estimator.handleClick(
                                pt.i,
                                pt.j,
                                ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey,
                                press_duration_ms,
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
                        if (callbacks.addCoordinatesToChatInput) {
                            callbacks.addCoordinatesToChatInput(
                                this.engine.prettyCoordinates(pt.i, pt.j),
                            );
                        }
                    } catch (e) {
                        console.error(e);
                    }
                    return;
                }

                if (this.mode === "analyze" && this.analyze_tool === "draw") {
                    /* might want to interpret this as a start/stop of a line segment */
                } else if (this.mode === "analyze" && this.analyze_tool === "score") {
                    // nothing to do here
                } else if (this.mode === "analyze" && this.analyze_tool === "removal") {
                    this.onAnalysisToggleStoneRemoval(ev);
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

                    this.onTap(ev, double_clicked, right_click, press_duration_ms);
                    this.onMouseOut(ev);
                }
            } catch (e) {
                console.error(e);
            }
        };

        const pointerDown = (ev: MouseEvent | TouchEvent): void => {
            pointer_down_timestamp = performance.now();
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
                } else if (this.mode === "analyze" && this.analyze_tool === "score") {
                    this.onAnalysisScoringStart(ev);
                } else if (this.mode === "analyze" && this.analyze_tool === "removal") {
                    // nothing to do here, we act on pointerUp
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
                } else if (dragging && this.mode === "analyze" && this.analyze_tool === "score") {
                    this.onAnalysisScoringMove(ev);
                } else if (dragging && this.mode === "analyze" && this.analyze_tool === "removal") {
                    // nothing for moving
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

        let mouse_disabled: any = 0;

        canvas.addEventListener("click", (ev) => {
            if (!mouse_disabled) {
                dragging = true;
                pointerUp(ev, false);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("dblclick", (ev) => {
            if (!mouse_disabled) {
                dragging = true;
                pointerUp(ev, true);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mousedown", (ev) => {
            if (!mouse_disabled) {
                pointerDown(ev);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mousemove", (ev) => {
            if (!mouse_disabled) {
                pointerMove(ev);
            }
            ev.preventDefault();
            return false;
        });
        canvas.addEventListener("mouseout", (ev) => {
            if (!mouse_disabled) {
                pointerOut(ev);
            } else {
                ev.preventDefault();
            }
            return false;
        });
        canvas.addEventListener("contextmenu", (ev) => {
            if (!mouse_disabled) {
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
                if (mouse_disabled) {
                    clearTimeout(mouse_disabled);
                }
                mouse_disabled = setTimeout(() => {
                    mouse_disabled = 0;
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
                // Stop a touch screen device always auto scrolling to the chat input box if it is active when you make a move
                const currentElement = document.activeElement;
                if (
                    ev.target === canvas &&
                    currentElement &&
                    currentElement instanceof HTMLElement &&
                    currentElement.tagName.toLowerCase() === "input"
                ) {
                    currentElement.blur();
                }

                if (mouse_disabled) {
                    clearTimeout(mouse_disabled);
                }
                mouse_disabled = setTimeout(() => {
                    mouse_disabled = 0;
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
                if (mouse_disabled) {
                    clearTimeout(mouse_disabled);
                }
                mouse_disabled = setTimeout(() => {
                    mouse_disabled = 0;
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

        const cleanup = () => {
            document.removeEventListener("touchstart", onTouchStart);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchmove", onTouchMove);
            this.off("destroy", cleanup);
        };

        this.on("destroy", cleanup);
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
    public drawPenMarks(pen_marks: MoveTreePenMarks): void {
        if (this.review_id && !this.done_loading_review) {
            return;
        }
        if (!pen_marks.length) {
            return;
        }
        this.attachPenCanvas();
        if (!this.pen_ctx) {
            throw new Error(`onPenMove called with null pen_ctx`);
        }
        this.clearAnalysisDrawing();
        this.pen_marks = pen_marks;
        for (let i = 0; i < pen_marks.length; ++i) {
            const stroke = pen_marks[i];
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
    private onTap(
        event: MouseEvent | TouchEvent,
        double_tap: boolean,
        right_click: boolean,
        press_duration_ms: number,
    ): void {
        if (
            !(
                this.stone_placement_enabled &&
                (this.player_id ||
                    !this.engine.players.black.id ||
                    this.mode === "analyze" ||
                    this.mode === "puzzle")
            )
        ) {
            return;
        }

        // If there are modes where right click should not behave as if you clicked a placement on the canvas
        // then return here instead of proceeding.
        if (right_click && this.mode === "play") {
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
            const m = this.engine.getMoveByLocation(x, y, true);
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

        const tap_time = Date.now();
        let removed_count = 0;
        const removed_stones: Array<JGOFIntersection> = [];

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
            const sent = this.sendMove({
                game_id: this.game_id,
                move: encodeMove(x, y),
            });
            if (sent) {
                this.playMovementSound();
                this.setTitle(_("Submitting..."));

                if (removed_count) {
                    this.debouncedEmitCapturedStones(removed_stones);
                }

                this.disableStonePlacement();
                delete this.move_selected;
            } else {
                console.log("Move not sent, not playing movement sound");
            }
        };
        /* we disable clicking if we've been initialized with the view user,
         * unless the board is a demo board (thus black_player_id is 0).  */
        try {
            let force_redraw = false;

            if (
                this.engine.phase === "stone removal" &&
                this.engine.isActivePlayer(this.player_id) &&
                this.engine.cur_move === this.engine.last_official_move
            ) {
                const { removed, group } = this.engine.toggleSingleGroupRemoval(
                    x,
                    y,
                    event.shiftKey || press_duration_ms > 500,
                );

                if (group.length) {
                    this.socket.send("game/removed_stones/set", {
                        game_id: this.game_id,
                        removed: removed,
                        stones: encodeMoves(group),
                    });
                }
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

                                removed_count = this.engine.place(
                                    mv_x,
                                    mv_y,
                                    true,
                                    false,
                                    true,
                                    false,
                                    false,
                                    removed_stones,
                                );
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
                                         * are playing for the ai for some moves so don't auto-move blindly */ ((next.player ===
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
                if (removed_count > 0) {
                    this.emit("audio-capture-stones", {
                        count: removed_count,
                        already_captured: 0,
                    });
                    this.debouncedEmitCapturedStones(removed_stones);
                }
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
                        !(
                            this.mode === "analyze" &&
                            this.analyze_tool === "stone" &&
                            this.analyze_subtool !== "alternate"
                        )
                    ) {
                        removed_count = this.engine.place(
                            x,
                            y,
                            true,
                            true,
                            undefined,
                            undefined,
                            undefined,
                            removed_stones,
                        );

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
                }

                if (force_redraw) {
                    this.redraw();
                }
            }
        } catch (e) {
            delete this.move_selected;
            // stone already placed is just to be ignored, it's not really an error.
            if (e.message_id !== "stone_already_placed_here") {
                this.errorHandler(e);
                this.emit("error", "stone_already_placed_here");
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
    public drawSquare(i: number, j: number): void {
        if (i < 0 || j < 0 || !this.drawing_enabled || this.no_display) {
            return;
        }
        if (this.__draw_state[j][i] !== this.drawingHash(i, j)) {
            this.__drawSquare(i, j);
        }
    }
    private __drawSquare(i: number, j: number): void {
        if (!this.drawing_enabled || this.no_display) {
            return;
        }
        const ctx = this.ctx;
        if (!ctx) {
            return;
        }
        if (i < 0 || j < 0) {
            return;
        }
        const s = this.square_size;
        let ox = this.draw_left_labels ? s : 0;
        let oy = this.draw_top_labels ? s : 0;
        if (this.bounds.left > 0) {
            ox = -s * this.bounds.left;
        }
        if (this.bounds.top > 0) {
            oy = -s * this.bounds.top;
        }

        let cx: number;
        let cy: number;
        let draw_last_move = !this.dont_draw_last_move;

        let stone_color = 0;
        if (this.engine) {
            stone_color = this.engine.board[j][i];
        }

        /* Figure out marks for this spot */
        let pos = this.getMarks(i, j);
        if (!pos) {
            console.error("No position for ", j, i);
            pos = {};
        }
        let alt_marking: string | undefined;
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
                        if (!cur.edited && this.show_variation_move_numbers) {
                            alt_marking = cur.getMoveNumberDifferenceFromTrunk().toString();
                        }
                    }
                }
            }
        }

        let movetree_contains_this_square = false;
        if (this.engine && this.engine.cur_move.lookupMove(i, j, this.engine.player, false)) {
            movetree_contains_this_square = true;
        }

        let have_text_to_draw = false;
        let text_color = this.theme_blank_text_color;
        for (const key in pos) {
            if (key.length <= 3) {
                have_text_to_draw = true;
            }
        }
        if (
            pos.circle ||
            pos.triangle ||
            pos.chat_triangle ||
            pos.sub_triangle ||
            pos.cross ||
            pos.square
        ) {
            have_text_to_draw = true;
        }
        if (pos.letter && pos.letter.length > 0) {
            have_text_to_draw = true;
        }
        if (pos.subscript && pos.subscript.length > 0) {
            have_text_to_draw = true;
        }

        /* clear and draw lines */
        {
            const l = i * s + ox;
            const r = (i + 1) * s + ox;
            const t = j * s + oy;
            const b = (j + 1) * s + oy;

            ctx.clearRect(l, t, r - l, b - t);
            if (this.shadow_ctx) {
                let shadow_offset = this.square_size * 0.1;
                this.shadow_ctx.clearRect(
                    l + shadow_offset,
                    t + shadow_offset,
                    this.square_size,
                    this.square_size,
                );
                shadow_offset = this.square_size * 0.2;
                this.shadow_ctx.clearRect(
                    l + shadow_offset,
                    t + shadow_offset,
                    this.square_size,
                    this.square_size,
                );
                shadow_offset = this.square_size * 0.3;
                this.shadow_ctx.clearRect(
                    l + shadow_offset,
                    t + shadow_offset,
                    this.square_size,
                    this.square_size,
                );
            }

            cx = l + this.metrics.mid;
            cy = t + this.metrics.mid;

            /* draw line */
            let sx = l;
            let ex = r;
            const mx = (r + l) / 2 - this.metrics.offset;
            let sy = t;
            let ey = b;
            const my = (t + b) / 2 - this.metrics.offset;

            if (i === 0) {
                sx += this.metrics.mid;
            }
            if (i === this.width - 1) {
                ex -= this.metrics.mid;
            }
            if (j === 0) {
                sy += this.metrics.mid;
            }
            if (j === this.height - 1) {
                ey -= this.metrics.mid;
            }

            if (i === this.width - 1 && j === this.height - 1) {
                if (mx === ex && my === ey) {
                    ex += 1;
                    ey += 1;
                }
            }

            if (this.square_size < 5) {
                ctx.lineWidth = 0.2;
            } else {
                ctx.lineWidth = 1;
            }
            if (have_text_to_draw) {
                ctx.strokeStyle = this.theme_faded_line_color;
            } else {
                ctx.strokeStyle = this.theme_line_color;
            }
            ctx.lineCap = "butt";
            ctx.beginPath();
            ctx.moveTo(Math.floor(sx), my);
            ctx.lineTo(Math.floor(ex), my);
            ctx.moveTo(mx, Math.floor(sy));
            ctx.lineTo(mx, Math.floor(ey));
            ctx.stroke();
        }

        /* Draw star points */
        {
            let star_radius;
            if (this.square_size < 5) {
                star_radius = 0.5;
            } else {
                star_radius = Math.max(2, (this.metrics.mid - 1.5) * 0.16);
            }
            let draw_star_point = false;
            if (
                this.width === 19 &&
                this.height === 19 &&
                ((i === 3 && (j === 3 || j === 9 || j === 15)) ||
                    (i === 9 && (j === 3 || j === 9 || j === 15)) ||
                    (i === 15 && (j === 3 || j === 9 || j === 15)))
            ) {
                draw_star_point = true;
            }

            if (
                this.width === 13 &&
                this.height === 13 &&
                ((i === 3 && (j === 3 || j === 9)) ||
                    (i === 6 && j === 6) ||
                    (i === 9 && (j === 3 || j === 9)))
            ) {
                draw_star_point = true;
            }

            if (
                this.width === 9 &&
                this.height === 9 &&
                ((i === 2 && (j === 2 || j === 6)) ||
                    (i === 4 && j === 4) ||
                    (i === 6 && (j === 2 || j === 6)))
            ) {
                draw_star_point = true;
            }

            if (draw_star_point) {
                ctx.beginPath();
                ctx.fillStyle = this.theme_star_color;
                if (have_text_to_draw) {
                    ctx.fillStyle = this.theme_faded_star_color;
                }
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
        }

        /* Heatmap */

        if (this.heatmap) {
            if (this.heatmap[j][i] > 0.001) {
                const color = "#00FF00";
                ctx.lineCap = "square";
                ctx.save();
                ctx.beginPath();
                ctx.globalAlpha = Math.min(this.heatmap[j][i], 0.5);
                const r = Math.floor(this.square_size * 0.5) - 0.5;
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.lineTo(cx - r, cy + r);
                ctx.lineTo(cx - r, cy - r);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.restore();
            }
        }

        /* Draw square highlights if any */
        {
            if (
                pos.hint ||
                (this.highlight_movetree_moves && movetree_contains_this_square) ||
                pos.color
            ) {
                const color = pos.color ? pos.color : pos.hint ? "#8EFF0A" : "#FF8E0A";

                ctx.lineCap = "square";
                ctx.save();
                ctx.beginPath();
                ctx.globalAlpha = 0.6;
                const r = Math.floor(this.square_size * 0.5) - 0.5;
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.lineTo(cx - r, cy + r);
                ctx.lineTo(cx - r, cy - r);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.restore();
            }
        }

        /* Colored stones */

        const circle = this.colored_circles?.[j][i];
        if (circle) {
            const color = circle.color;

            ctx.save();
            ctx.globalAlpha = 1.0;
            const radius = Math.floor(this.square_size * 0.5) - 0.5;
            let lineWidth = radius * (circle.border_width || 0.1);

            if (lineWidth < 0.3) {
                lineWidth = 0;
            }
            ctx.fillStyle = color;
            ctx.strokeStyle = circle.border_color || "#000000";
            if (lineWidth > 0) {
                ctx.lineWidth = lineWidth;
            }
            ctx.beginPath();
            ctx.arc(
                cx,
                cy,
                Math.max(0.1, radius - lineWidth / 2),
                0.001,
                2 * Math.PI,
                false,
            ); /* 0.001 to workaround fucked up chrome bug */
            if (lineWidth > 0) {
                ctx.stroke();
            }
            ctx.fill();
            ctx.restore();
        }

        /* Draw stones & hovers */
        let draw_removal_x = false;
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
                            this.getPuzzlePlacementSetting().mode === "play"))) ||
                (this.scoring_mode &&
                    this.score_estimator &&
                    this.score_estimator.board[j][i] &&
                    this.score_estimator.removal[j][i]) ||
                (this.engine &&
                    this.engine.phase === "stone removal" &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]) ||
                pos.black ||
                pos.white
            ) {
                //let color = stone_color ? stone_color : (this.move_selected ? this.engine.otherPlayer() : this.engine.player);
                let translucent = false;
                let stoneAlphaValue = 0.6;
                let color;
                if (
                    this.scoring_mode &&
                    this.score_estimator &&
                    this.score_estimator.board[j][i] &&
                    this.score_estimator.removal[j][i]
                ) {
                    color = this.score_estimator.board[j][i];
                    translucent = true;
                } else if (
                    this.engine &&
                    ((this.engine.phase === "stone removal" &&
                        this.engine.last_official_move === this.engine.cur_move) ||
                        (this.engine.phase === "finished" && this.mode !== "analyze")) &&
                    this.engine.board &&
                    this.engine.removal &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]
                ) {
                    color = this.engine.board[j][i];
                    translucent = true;
                } else if (stone_color) {
                    color = stone_color;
                } else if (
                    this.mode === "analyze" &&
                    this.analyze_tool === "stone" &&
                    this.analyze_subtool !== "alternate"
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
                } else if (pos.black || pos.white) {
                    color = pos.black ? 1 : 2;
                    translucent = true;
                    stoneAlphaValue = this.variation_stone_opacity;
                } else {
                    color = this.engine.player;
                }

                if (pos.stone_removed) {
                    translucent = true;
                }

                if (!(this.autoplaying_puzzle_move && !stone_color)) {
                    text_color =
                        color === 1 ? this.theme_black_text_color : this.theme_white_text_color;

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

                    ctx.save();
                    let shadow_ctx: CanvasRenderingContext2D | null | undefined = this.shadow_ctx;
                    if (!stone_color || translucent) {
                        ctx.globalAlpha = stoneAlphaValue;
                        shadow_ctx = null;
                    }
                    if (shadow_ctx === undefined) {
                        shadow_ctx = null;
                    }
                    if (color === 1) {
                        const stone = this.theme_black.getStone(
                            i,
                            j,
                            this.theme_black_stones,
                            this,
                        );
                        this.theme_black.placeBlackStone(
                            ctx,
                            shadow_ctx,
                            stone,
                            cx,
                            cy,
                            this.theme_stone_radius,
                        );
                    } else {
                        const stone = this.theme_white.getStone(
                            i,
                            j,
                            this.theme_white_stones,
                            this,
                        );
                        this.theme_white.placeWhiteStone(
                            ctx,
                            shadow_ctx,
                            stone,
                            cx,
                            cy,
                            this.theme_stone_radius,
                        );
                    }
                    ctx.restore();
                }

                const circle = this.colored_circles?.[j]?.[i];
                if (pos.blue_move && circle) {
                    ctx.save();
                    ctx.globalAlpha = 1.0;
                    const radius = Math.floor(this.square_size * 0.5) - 0.5;
                    let lineWidth = radius * (circle.border_width || 0.1);

                    if (lineWidth < 0.3) {
                        lineWidth = 0;
                    }
                    ctx.strokeStyle = circle.border_color || "#000000";
                    if (lineWidth > 0) {
                        ctx.lineWidth = lineWidth;
                    }
                    ctx.beginPath();
                    ctx.arc(
                        cx,
                        cy,
                        Math.max(0.1, radius - lineWidth / 2),
                        0.001,
                        2 * Math.PI,
                        false,
                    ); /* 0.001 to workaround fucked up chrome bug */
                    if (lineWidth > 0) {
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                /* Red X if the stone is marked for removal */
                if (
                    (this.engine &&
                        this.engine.phase === "stone removal" &&
                        this.engine.last_official_move === this.engine.cur_move &&
                        this.engine.board[j][i] &&
                        this.engine.removal[j][i]) ||
                    (this.scoring_mode &&
                        this.score_estimator &&
                        this.score_estimator.board[j][i] &&
                        this.score_estimator.removal[j][i]) ||
                    pos.stone_removed
                ) {
                    //draw_removal_x = true;
                    draw_removal_x = this.themes["removal-graphic"] === "x";
                }
            }
        }
        if (
            draw_removal_x ||
            (this.mode === "analyze" &&
                this.analyze_tool === "removal" &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j) ||
            (this.engine.phase === "stone removal" &&
                this.engine.isActivePlayer(this.player_id) &&
                this.engine.cur_move === this.engine.last_official_move &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j)
        ) {
            const color =
                this.engine.board[j][i] === JGOFNumericPlayerColor.BLACK ? "black" : "white";

            const opacity = this.engine.board[j][i] ? 1.0 : 0.2;
            ctx.lineCap = "square";
            ctx.save();
            ctx.beginPath();
            ctx.lineWidth = this.square_size * 0.125;
            ctx.globalAlpha = opacity;
            const r = Math.max(1, this.metrics.mid * 0.65);
            ctx.moveTo(cx - r, cy - r);
            ctx.lineTo(cx + r, cy + r);
            ctx.moveTo(cx + r, cy - r);
            ctx.lineTo(cx - r, cy + r);

            if (pos.score === "black" && color === "white") {
                ctx.strokeStyle = this.theme_white_text_color;
            } else if (pos.score === "white" && color === "black") {
                ctx.strokeStyle = this.theme_black_text_color;
            } else if (
                (pos.score === "white" && color === "white") ||
                (pos.score === "black" && color === "black")
            ) {
                // score point for the same color where the stone is removed
                // should call special attention to it
                ctx.strokeStyle = "#ff0000";
            } else {
                // otherwise, no score but removed stones can happen when
                // territory isn't properly sealed, so we are going to mark
                // it grey to avoid calling too much attention, but still
                // denote that removing these stones doesn't result in
                // the territory being territory yet.
                ctx.strokeStyle = "#888888";
            }

            ctx.stroke();
            ctx.restore();
            draw_last_move = false;
        }

        /* Draw Scores */
        {
            if (
                (pos.score &&
                    (this.engine.phase !== "finished" ||
                        this.mode === "play" ||
                        this.mode === "analyze")) ||
                (this.scoring_mode &&
                    this.score_estimator &&
                    (this.score_estimator.territory[j][i] ||
                        (this.score_estimator.removal[j][i] &&
                            this.score_estimator.board[j][i] === 0))) ||
                ((this.engine.phase === "stone removal" ||
                    (this.engine.phase === "finished" && this.mode === "play")) &&
                    this.engine.board[j][i] === 0 &&
                    (this.engine.removal[j][i] || pos.needs_sealing)) ||
                (this.mode === "analyze" &&
                    this.analyze_tool === "score" &&
                    this.last_hover_square &&
                    this.last_hover_square.x === i &&
                    this.last_hover_square.y === j)
            ) {
                ctx.beginPath();

                let color = pos.score;
                if (
                    this.scoring_mode &&
                    this.score_estimator &&
                    (this.score_estimator.territory[j][i] ||
                        (this.score_estimator.removal[j][i] &&
                            this.score_estimator.board[j][i] === 0))
                ) {
                    color = this.score_estimator.territory[j][i] === 1 ? "black" : "white";
                    if (
                        this.score_estimator.board[j][i] === 0 &&
                        this.score_estimator.removal[j][i]
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

                if (pos.needs_sealing) {
                    color = "seal";
                }

                if (
                    this.mode === "analyze" &&
                    this.analyze_tool === "score" &&
                    this.last_hover_square &&
                    this.last_hover_square.x === i &&
                    this.last_hover_square.y === j
                ) {
                    color = this.analyze_subtool;
                }

                if (color === "white") {
                    ctx.fillStyle = this.theme_black_text_color;
                    ctx.strokeStyle = "#777777";
                } else if (color === "black") {
                    ctx.fillStyle = this.theme_white_text_color;
                    ctx.strokeStyle = "#888888";
                } else if (color === "dame") {
                    ctx.fillStyle = "#ff0000";
                    ctx.strokeStyle = "#365FE6";
                } else if (color === "seal") {
                    ctx.fillStyle = "#ff0000";
                    ctx.strokeStyle = "#E079CE";
                }
                if (color?.[0] === "#") {
                    ctx.fillStyle = color;
                    ctx.strokeStyle = color_blend("#888888", color);
                }
                ctx.lineWidth = Math.ceil(this.square_size * 0.065) - 0.5;

                const r = this.square_size * 0.15;
                ctx.rect(cx - r, cy - r, r * 2, r * 2);
                if (color !== "dame") {
                    ctx.fill();
                }
                ctx.stroke();
            }
        }

        /* Draw letters and numbers */
        let letter_was_drawn = false;
        {
            let letter: string | undefined;
            let subscript: string | undefined;
            let transparent = false;
            if (pos.letter) {
                letter = pos.letter;
            }
            if (pos.subscript) {
                subscript = pos.subscript;
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
            if (!letter && alt_marking !== "triangle") {
                letter = alt_marking;
            }

            if (
                this.show_variation_move_numbers &&
                !letter &&
                !(
                    pos.circle ||
                    pos.triangle ||
                    pos.chat_triangle ||
                    pos.sub_triangle ||
                    pos.cross ||
                    pos.square
                )
            ) {
                const m = this.engine.getMoveByLocation(i, j, false);
                if (m && !m.trunk) {
                    if (m.edited) {
                        //letter = "triangle";
                        if (this.engine.board[j][i]) {
                            //alt_marking = "triangle";
                        }
                    } else {
                        letter = m.getMoveNumberDifferenceFromTrunk().toString();
                    }
                }
            }

            if (letter) {
                letter_was_drawn = true;
                ctx.save();
                ctx.fillStyle = text_color;
                const [, , metrics] = fitText(
                    ctx,
                    letter,
                    `bold FONT_SIZEpx ${GOBAN_FONT}`,
                    this.square_size * 0.4,
                    this.square_size * 0.8 * (subscript ? 0.9 : 1.0),
                );

                const xx = cx - metrics.width / 2;
                let yy =
                    cy +
                    (/WebKit|Trident/.test(navigator.userAgent)
                        ? this.square_size * -0.03
                        : 1); /* middle centering is different on firefox */

                if (subscript) {
                    yy -= this.square_size * 0.15;
                }

                ctx.textBaseline = "middle";
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                ctx.fillText(letter, xx, yy);
                draw_last_move = false;
                ctx.restore();
            }

            if (subscript) {
                letter_was_drawn = true;
                ctx.save();
                ctx.fillStyle = text_color;
                if (letter && subscript === "0") {
                    subscript = "0.0"; // clarifies the markings on the blue move typically
                }

                const [, , metrics] = fitText(
                    ctx,
                    subscript,
                    `bold FONT_SIZEpx ${GOBAN_FONT}`,
                    this.square_size * 0.4,
                    this.square_size * 0.8 * (letter ? 0.9 : 1.0),
                );

                const xx = cx - metrics.width / 2;
                let yy =
                    cy +
                    (/WebKit|Trident/.test(navigator.userAgent)
                        ? this.square_size * -0.03
                        : 1); /* middle centering is different on firefox */

                if (letter) {
                    yy += this.square_size * 0.3;
                }

                ctx.textBaseline = "middle";
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                ctx.fillText(subscript, xx, yy);
                draw_last_move = false;
                ctx.restore();
            }
        }

        /* draw special symbols */
        {
            let transparent = letter_was_drawn;
            let hover_mark: string | undefined;
            const symbol_color =
                stone_color === 1
                    ? this.theme_black_text_color
                    : stone_color === 2
                      ? this.theme_white_text_color
                      : text_color;

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
                    hover_mark = this.analyze_subtool;
                }
            }

            if (pos.circle || hover_mark === "circle") {
                ctx.lineCap = "round";
                ctx.save();
                ctx.beginPath();
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                ctx.strokeStyle = symbol_color;
                ctx.lineWidth = this.square_size * 0.075;
                const r = Math.max(0.1, this.square_size * this.circle_radius);
                ctx.arc(cx, cy, r, 0, 2 * Math.PI, false);
                ctx.stroke();
                ctx.restore();
                draw_last_move = false;
            }
            if (
                pos.triangle ||
                pos.chat_triangle ||
                pos.sub_triangle ||
                alt_marking === "triangle" ||
                hover_mark === "triangle"
            ) {
                let scale = 1.0;
                let oy = 0.0;
                if (pos.sub_triangle) {
                    scale = 0.5;
                    oy = this.square_size * 0.3;
                    transparent = false;
                }
                ctx.lineCap = "round";
                ctx.save();
                ctx.beginPath();
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                ctx.strokeStyle = symbol_color;
                if (pos.chat_triangle) {
                    ctx.strokeStyle = "#00aaFF";
                }
                ctx.lineWidth = this.square_size * 0.075 * scale;
                let theta = -(Math.PI * 2) / 4;
                const r = this.square_size * 0.3 * scale;
                ctx.moveTo(cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta));
                theta += (Math.PI * 2) / 3;
                ctx.lineTo(cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta));
                theta += (Math.PI * 2) / 3;
                ctx.lineTo(cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta));
                theta += (Math.PI * 2) / 3;
                ctx.lineTo(cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta));
                ctx.stroke();
                ctx.restore();
                draw_last_move = false;
            }
            if (pos.cross || hover_mark === "cross") {
                ctx.lineCap = "square";
                ctx.save();
                ctx.beginPath();
                ctx.lineWidth = this.square_size * 0.075;
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                const r = Math.max(1, this.metrics.mid * 0.35);
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.moveTo(cx + r, cy - r);
                ctx.lineTo(cx - r, cy + r);
                ctx.strokeStyle = symbol_color;
                ctx.stroke();
                ctx.restore();
                draw_last_move = false;
            }

            if (pos.square || hover_mark === "square") {
                ctx.lineCap = "square";
                ctx.save();
                ctx.beginPath();
                ctx.lineWidth = this.square_size * 0.075;
                if (transparent) {
                    ctx.globalAlpha = 0.6;
                }
                const r = Math.max(1, this.metrics.mid * 0.4);
                ctx.moveTo(cx - r, cy - r);
                ctx.lineTo(cx + r, cy - r);
                ctx.lineTo(cx + r, cy + r);
                ctx.lineTo(cx - r, cy + r);
                ctx.lineTo(cx - r, cy - r);
                ctx.strokeStyle = symbol_color;
                ctx.stroke();
                ctx.restore();
                draw_last_move = false;
            }
        }

        /* Clear last move */
        if (this.last_move && this.engine && !this.last_move.is(this.engine.cur_move)) {
            const m = this.last_move;
            delete this.last_move;
            this.drawSquare(m.x, m.y);
        }

        /* Draw last move */
        if (draw_last_move && this.engine && this.engine.cur_move) {
            if (
                this.engine.cur_move.x === i &&
                this.engine.cur_move.y === j &&
                this.engine.board[j][i] &&
                (this.engine.phase === "play" || this.engine.phase === "finished")
            ) {
                this.last_move = this.engine.cur_move;

                if (i >= 0 && j >= 0) {
                    const color =
                        stone_color === 1
                            ? this.theme_black_text_color
                            : this.theme_white_text_color;

                    if (this.submit_move) {
                        ctx.lineCap = "square";
                        ctx.save();
                        ctx.beginPath();
                        ctx.lineWidth = this.square_size * 0.075;
                        ctx.globalAlpha = this.last_move_opacity;
                        const r = Math.max(1, this.metrics.mid * 0.35) * 0.8;
                        ctx.moveTo(cx - r, cy);
                        ctx.lineTo(cx + r, cy);
                        ctx.moveTo(cx, cy - r);
                        ctx.lineTo(cx, cy + r);
                        ctx.strokeStyle = color;
                        ctx.stroke();
                        ctx.restore();
                        draw_last_move = false;
                    } else {
                        if (
                            this.engine.undo_requested &&
                            this.getShowUndoRequestIndicator() &&
                            this.engine.undo_requested === this.engine.cur_move.move_number
                        ) {
                            const letter = "?";
                            ctx.save();
                            ctx.fillStyle = color;
                            const metrics = ctx.measureText(letter);
                            const xx = cx - metrics.width / 2;
                            const yy =
                                cy +
                                (/WebKit|Trident/.test(navigator.userAgent)
                                    ? this.square_size * -0.03
                                    : 1); /* middle centering is different on firefox */
                            ctx.textBaseline = "middle";
                            ctx.fillText(letter, xx, yy);
                            draw_last_move = false;
                            ctx.restore();
                        } else {
                            ctx.save();
                            ctx.beginPath();
                            ctx.strokeStyle = color;
                            ctx.lineWidth = this.square_size * 0.075;
                            ctx.globalAlpha = this.last_move_opacity;
                            let r = this.square_size * this.last_move_radius;
                            if (this.submit_move) {
                                r = this.square_size * 0.3;
                            }

                            r = Math.max(0.1, r);
                            ctx.arc(cx, cy, r, 0, 2 * Math.PI, false);
                            ctx.stroke();
                            ctx.restore();
                        }
                    }
                }
            }
        }

        /* Score Estimation */
        if (
            (this.scoring_mode === true && this.score_estimator) ||
            (this.scoring_mode === "stalling-scoring-mode" &&
                this.stalling_score_estimate &&
                this.mode !== "analyze")
        ) {
            const se =
                this.scoring_mode === "stalling-scoring-mode"
                    ? this.stalling_score_estimate
                    : this.score_estimator;
            const est = se!.ownership[j][i];

            ctx.beginPath();

            const color = est < 0 ? "white" : "black";
            const color_num = color === "black" ? 1 : 2;

            if (color_num !== stone_color) {
                if (color === "white") {
                    ctx.fillStyle = this.theme_black_text_color;
                    ctx.strokeStyle = "#777777";
                } else if (color === "black") {
                    ctx.fillStyle = this.theme_white_text_color;
                    ctx.strokeStyle = "#888888";
                }
                ctx.lineWidth = Math.ceil(this.square_size * 0.035) - 0.5;
                const r = this.square_size * 0.2 * Math.abs(est);
                ctx.rect(cx - r, cy - r, r * 2, r * 2);
                ctx.fill();
                ctx.stroke();
            }
        }

        this.__draw_state[j][i] = this.drawingHash(i, j);
    }
    private drawingHash(i: number, j: number): string {
        if (this.no_display) {
            return "";
        }
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
        const circle = this.colored_circles?.[j][i];
        if (circle) {
            ret += "circle " + circle.color;
        }

        /* Figure out marks for this spot */
        let pos = this.getMarks(i, j);
        if (!pos) {
            console.error("No position for ", j, i);
            pos = {};
        }
        let alt_marking: string | undefined;
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
                        if (!cur.edited && this.show_variation_move_numbers) {
                            alt_marking = cur.getMoveNumberDifferenceFromTrunk().toString();
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
        let draw_removal_x = false;
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
                    this.score_estimator &&
                    this.score_estimator.board[j][i] &&
                    this.score_estimator.removal[j][i]) ||
                (this.engine &&
                    this.engine.phase === "stone removal" &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]) ||
                pos.black ||
                pos.white
            ) {
                let translucent = false;
                let color;
                if (
                    this.scoring_mode &&
                    this.score_estimator &&
                    this.score_estimator.board[j][i] &&
                    this.score_estimator.removal[j][i]
                ) {
                    color = this.score_estimator.board[j][i];
                    translucent = true;
                } else if (
                    this.engine &&
                    this.engine.phase === "stone removal" &&
                    this.engine.board &&
                    this.engine.removal &&
                    this.engine.board[j][i] &&
                    this.engine.removal[j][i]
                ) {
                    color = this.engine.board[j][i];
                    translucent = true;
                } else if (stone_color) {
                    color = stone_color;
                } else if (
                    this.mode === "analyze" &&
                    this.analyze_tool === "stone" &&
                    this.analyze_subtool !== "alternate"
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
                    translucent = true;
                } else {
                    color = this.engine.player;
                }

                //if (this.mode === "analyze" && pos.stone_removed) {
                if (pos.stone_removed) {
                    translucent = true;
                }

                if (color === 1) {
                    ret += this.theme_black.getStoneHash(i, j, this.theme_black_stones, this);
                }
                if (color === 2) {
                    ret += this.theme_white.getStoneHash(i, j, this.theme_white_stones, this);
                }

                if (
                    (this.engine &&
                        this.engine.phase === "stone removal" &&
                        this.engine.last_official_move === this.engine.cur_move &&
                        this.engine.board[j][i] &&
                        this.engine.removal[j][i]) ||
                    (this.scoring_mode &&
                        this.score_estimator &&
                        this.score_estimator.board[j][i] &&
                        this.score_estimator.removal[j][i]) ||
                    //(this.mode === "analyze" && pos.stone_removed)
                    pos.stone_removed
                ) {
                    draw_removal_x = true;
                }

                ret += (translucent ? "T" : "") + color + ",";
            }
        }

        if (
            draw_removal_x ||
            (this.mode === "analyze" &&
                this.analyze_tool === "removal" &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j) ||
            (this.engine.phase === "stone removal" &&
                this.engine.isActivePlayer(this.player_id) &&
                this.engine.cur_move === this.engine.last_official_move &&
                this.last_hover_square &&
                this.last_hover_square.x === i &&
                this.last_hover_square.y === j)
        ) {
            const color =
                this.engine.board[j][i] === JGOFNumericPlayerColor.BLACK ? "black" : "white";
            if (pos.score === "black" && color === "white") {
                ret += "whiteX";
            } else if (pos.score === "white" && color === "black") {
                ret += "blackX";
            } else {
                ret += "redX";
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

            if (this.scoring_mode && this.score_estimator && this.score_estimator.removal[j][i]) {
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
                (pos.score &&
                    (this.engine.phase !== "finished" ||
                        this.mode === "play" ||
                        this.mode === "analyze")) ||
                (this.scoring_mode &&
                    this.score_estimator &&
                    (this.score_estimator.territory[j][i] ||
                        (this.score_estimator.removal[j][i] &&
                            this.score_estimator.board[j][i] === 0))) ||
                ((this.engine.phase === "stone removal" ||
                    (this.engine.phase === "finished" && this.mode === "play")) &&
                    this.engine.board[j][i] === 0 &&
                    (this.engine.removal[j][i] || pos.needs_sealing)) ||
                (this.mode === "analyze" &&
                    this.analyze_tool === "score" &&
                    this.last_hover_square &&
                    this.last_hover_square.x === i &&
                    this.last_hover_square.y === j)
            ) {
                let color = pos.score;
                if (
                    this.scoring_mode &&
                    this.score_estimator &&
                    (this.score_estimator.territory[j][i] ||
                        (this.score_estimator.removal[j][i] &&
                            this.score_estimator.board[j][i] === 0))
                ) {
                    color = this.score_estimator.territory[j][i] === 1 ? "black" : "white";
                    if (
                        this.score_estimator.board[j][i] === 0 &&
                        this.score_estimator.removal[j][i]
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

                if (pos.needs_sealing) {
                    color = "seal";
                }

                if (
                    this.mode === "analyze" &&
                    this.analyze_tool === "score" &&
                    this.last_hover_square &&
                    this.last_hover_square.x === i &&
                    this.last_hover_square.y === j
                ) {
                    color = this.analyze_subtool;
                }

                if (
                    this.scoring_mode &&
                    this.score_estimator &&
                    this.score_estimator.territory[j][i]
                ) {
                    color = this.score_estimator.territory[j][i] === 1 ? "black" : "white";
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
            if (!letter && alt_marking !== "triangle") {
                letter = alt_marking;
            }

            if (
                this.show_variation_move_numbers &&
                !letter &&
                !(pos.circle || pos.triangle || pos.chat_triangle || pos.cross || pos.square)
            ) {
                const m = this.engine.getMoveByLocation(i, j, false);
                if (m && !m.trunk) {
                    if (m.edited) {
                        //letter = "triangle";
                        if (this.engine.board[j][i]) {
                            //alt_marking = "triangle";
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
            if (pos.triangle || pos.chat_triangle || alt_marking === "triangle") {
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
                if (
                    this.engine.undo_requested &&
                    this.getShowUndoRequestIndicator() &&
                    this.engine.undo_requested === this.engine.cur_move.move_number
                ) {
                    ret += "?" + ",";
                }
            }
        }

        /* Score Estimation */
        if (
            (this.scoring_mode === true && this.score_estimator) ||
            (this.scoring_mode === "stalling-scoring-mode" &&
                this.stalling_score_estimate &&
                this.mode !== "analyze")
        ) {
            const se =
                this.scoring_mode === "stalling-scoring-mode"
                    ? this.stalling_score_estimate
                    : this.score_estimator;
            const est = se!.ownership[j][i];

            ret += est.toFixed(5) + ",";
        }

        return ret;
    }
    public redraw(force_clear?: boolean): void {
        if (!this.ready_to_draw) {
            return;
        }
        if (this.destroyed) {
            console.debug("Attempting to redraw destroyed goban");
            return;
        }
        if (!this.drawing_enabled) {
            return;
        }
        if (this.no_display) {
            return;
        }

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

                if (this.pen_layer) {
                    if (this.pen_marks.length) {
                        resizeDeviceScaledCanvas(this.pen_layer, metrics.width, metrics.height);
                        const ctx = this.pen_layer.getContext("2d", { willReadFrequently: true });
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
                    const ctx = this.shadow_layer.getContext("2d", { willReadFrequently: true });
                    if (ctx) {
                        this.shadow_ctx = ctx;
                    } else {
                        throw new Error(`Failed to obtain drawing context for shadow layer`);
                    }
                }

                this.__set_board_width = metrics.width;
                this.__set_board_height = metrics.height;
                const ctx = this.board.getContext("2d", { willReadFrequently: true });
                if (ctx) {
                    this.ctx = ctx;
                } else {
                    throw new Error(`Failed to obtain drawing context for board`);
                }

                this.setTheme(this.getSelectedThemes(), true);
            } catch (e) {
                setTimeout(() => {
                    throw e;
                }, 1);
                return;
            }
        }
        const ctx = this.ctx;

        const place = (ch: string, x: number, y: number): void => {
            /* places centered (horizontally & vertically) text at x,y */
            const metrics = ctx.measureText(ch);
            const xx = x - metrics.width / 2;
            const yy = y;
            ctx.fillText(ch, xx, yy);
        };
        const v_place = (ch: string, x: number, y: number): void => {
            /* places centered (horizontally & vertically) text at x,y, with text going down vertically. */
            for (let i = 0; i < ch.length; ++i) {
                const metrics = ctx.measureText(ch[i]);
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
        };

        const drawHorizontal = (i: number, j: number): void => {
            switch (this.getCoordinateDisplaySystem()) {
                case "A1":
                    for (let c = 0; c < this.width; ++i, ++c) {
                        const x =
                            (i -
                                this.bounds.left -
                                (this.bounds.left > 0 ? +this.draw_left_labels : 0)) *
                                this.square_size +
                            this.square_size / 2;
                        const y = j * this.square_size + this.square_size / 2;
                        place(encodePrettyXCoordinate(c), x, y);
                    }
                    break;
                case "1-1":
                    for (let c = 0; c < this.width; ++i, ++c) {
                        const x =
                            (i -
                                this.bounds.left -
                                (this.bounds.left > 0 ? +this.draw_left_labels : 0)) *
                                this.square_size +
                            this.square_size / 2;
                        const y = j * this.square_size + this.square_size / 2;
                        place("" + (c + 1), x, y);
                    }
                    break;
            }
        };

        const drawVertical = (i: number, j: number): void => {
            switch (this.getCoordinateDisplaySystem()) {
                case "A1":
                    for (let c = 0; c < this.height; ++j, ++c) {
                        const x = i * this.square_size + this.square_size / 2;
                        const y =
                            (j -
                                this.bounds.top -
                                (this.bounds.top > 0 ? +this.draw_top_labels : 0)) *
                                this.square_size +
                            this.square_size / 2;
                        place("" + (this.height - c), x, y);
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
                    for (let c = 0; c < this.height; ++j, ++c) {
                        const x = i * this.square_size + this.square_size / 2;
                        const y =
                            (j -
                                this.bounds.top -
                                (this.bounds.top > 0 ? +this.draw_top_labels : 0)) *
                                this.square_size +
                            this.square_size / 2;
                        v_place(chinese_japanese_numbers[c], x, y);
                    }
                    break;
            }
        };

        if (force_clear || !this.__borders_initialized) {
            this.__borders_initialized = true;
            if (this.shadow_ctx) {
                this.shadow_ctx.clearRect(0, 0, metrics.width, metrics.height);
            }
            ctx.clearRect(0, 0, metrics.width, metrics.height);

            /* Draw labels */
            let text_size = Math.round(this.square_size * 0.5);
            let bold = "bold";
            if (this.getCoordinateDisplaySystem() === "1-1") {
                text_size *= 0.7;
                bold = "";

                if (this.height > 20) {
                    text_size *= 0.7;
                }
            }

            ctx.font = `${bold} ${text_size}px ${GOBAN_FONT}`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = this.theme_board.getLabelTextColor();
            ctx.save();

            if (this.draw_top_labels && this.bounds.top === 0) {
                drawHorizontal(this.draw_left_labels ? 1 : 0, 0);
            }
            if (this.draw_bottom_labels && this.bounds.bottom === this.height - 1) {
                drawHorizontal(
                    this.draw_left_labels ? 1 : 0,
                    +this.draw_top_labels + this.bounded_height,
                );
            }
            if (this.draw_left_labels && this.bounds.left === 0) {
                drawVertical(0, this.draw_top_labels ? 1 : 0);
            }
            if (this.draw_right_labels && this.bounds.right === this.width - 1) {
                drawVertical(+this.draw_left_labels + this.bounded_width, +this.draw_top_labels);
            }

            ctx.restore();
        }

        /* Draw squares */
        if (
            !this.__draw_state ||
            force_clear ||
            this.__draw_state.length !== this.height ||
            this.__draw_state[0].length !== this.width
        ) {
            this.__draw_state = makeMatrix(this.width, this.height, "");
        }

        /* Set font for text overlay */
        {
            const text_size = Math.round(this.square_size * 0.45);
            ctx.font = "bold " + text_size + "px " + GOBAN_FONT;
        }

        for (let j = this.bounds.top; j <= this.bounds.bottom; ++j) {
            for (let i = this.bounds.left; i <= this.bounds.right; ++i) {
                this.drawSquare(i, j);
            }
        }

        this.drawPenMarks(this.pen_marks);
        this.move_tree_redraw();
    }
    public showMessage(
        message_id_or_error: MessageID,
        parameters?: { [key: string]: any },
        timeout: number = 5000,
    ): void {
        this.clearMessage();

        const message_id = parameters?.error?.message_id || message_id_or_error;

        const msg = formatMessage(message_id, parameters);
        this.emit("show-message", {
            formatted: msg,
            message_id: message_id,
            parameters: parameters,
        });

        if (!this.config.dont_show_messages) {
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
        }

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

        this.emit("clear-message");
    }
    protected setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void {
        if (this.no_display) {
            return;
        }

        this.themes = themes;
        const BoardTheme = THEMES["board"]?.[themes.board] || THEMES["board"]["Plain"];
        const WhiteTheme = THEMES["white"]?.[themes.white] || THEMES["white"]["Plain"];
        const BlackTheme = THEMES["black"]?.[themes.black] || THEMES["black"]["Plain"];
        this.theme_board = new BoardTheme();
        this.theme_white = new WhiteTheme(this.theme_board);
        this.theme_black = new BlackTheme(this.theme_board);

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
                const ctx = this.shadow_layer.getContext("2d", { willReadFrequently: true });
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
            __theme_cache.white[themes.white] = {
                creation_order: [],
            };
        }
        if (!(themes.black in __theme_cache.black)) {
            __theme_cache.black[themes.black] = {
                creation_order: [],
            };
        }

        const deferredRenderCallback = () => {
            this.redraw(true);
            this.move_tree_redraw();
        };

        try {
            if (!(this.theme_stone_radius in __theme_cache.white[themes.white])) {
                __theme_cache.white[themes.white][this.theme_stone_radius] =
                    this.theme_white.preRenderWhite(
                        this.theme_stone_radius,
                        23434,
                        deferredRenderCallback,
                    );
                __theme_cache.white[themes.white].creation_order.push(this.theme_stone_radius);
            }
            if (!(this.theme_stone_radius in __theme_cache.black[themes.black])) {
                __theme_cache.black[themes.black][this.theme_stone_radius] =
                    this.theme_black.preRenderBlack(
                        this.theme_stone_radius,
                        2081,
                        deferredRenderCallback,
                    );
                __theme_cache.black[themes.black].creation_order.push(this.theme_stone_radius);
            }

            if (!(MoveTree.stone_radius in __theme_cache.white[themes.white])) {
                __theme_cache.white[themes.white][MoveTree.stone_radius] =
                    this.theme_white.preRenderWhite(
                        MoveTree.stone_radius,
                        23434,
                        deferredRenderCallback,
                    );
                __theme_cache.white[themes.white].creation_order.push(MoveTree.stone_radius);
            }
            if (!(MoveTree.stone_radius in __theme_cache.black[themes.black])) {
                __theme_cache.black[themes.black][MoveTree.stone_radius] =
                    this.theme_black.preRenderBlack(
                        MoveTree.stone_radius,
                        2081,
                        deferredRenderCallback,
                    );
                __theme_cache.black[themes.black].creation_order.push(MoveTree.stone_radius);
            }
        } catch (e) {
            console.error(`Error pre-rendering stones.`, {
                themes,
                move_tree_stone_radius: MoveTree.stone_radius,
            });
            throw e;
        }

        // We should only need a few sizes, like 6 in most cases, but when we resize a window slowly or
        // have a bunch of weird sized boards, we'll need more. These are very small and there aren't
        // any devices that should have a problem with them, except for an artificial limit on iOS devices
        // which we'll handle below.
        let max_cache_size = 500;
        try {
            /* ipads only allow a very small amount of memory to be allocated to canvases,
             * so we will be more aggressive about cleaning up the cache on those devices */
            if (
                /iP(ad|hone|od).+(Version\/[\d.]|OS \d.*like mac os x)+.*Safari/i.test(
                    navigator.userAgent,
                )
            ) {
                console.log("iOS device detected, reducing cache size");
                max_cache_size = 12; // mini goban, main boards, 9x9, 13x13, 19x19 should account for 6. We double that for good measure for odd sizes and resizing.
            }
        } catch (e) {
            console.error(e);
        }

        if (__theme_cache.black[themes.black].creation_order.length > max_cache_size) {
            const old_radius = __theme_cache.black[themes.black].creation_order.shift();
            if (old_radius) {
                console.log("deleting old radius [black]", old_radius);
                delete __theme_cache.black[themes.black][old_radius];
            }
        }
        if (__theme_cache.white[themes.white].creation_order.length > max_cache_size) {
            const old_radius = __theme_cache.white[themes.white].creation_order.shift();
            if (old_radius) {
                console.log("deleting old radius [white]", old_radius);
                delete __theme_cache.white[themes.white][old_radius];
            }
        }

        this.theme_white_stones = __theme_cache.white[themes.white][this.theme_stone_radius];
        this.theme_black_stones = __theme_cache.black[themes.black][this.theme_stone_radius];
        if (!this.theme_white_stones || !this.theme_black_stones) {
            throw new Error(
                "Failed to load stone images for given radius" + this.theme_stone_radius,
            );
        }
        this.theme_line_color = this.theme_board.getLineColor();
        this.theme_faded_line_color = this.theme_board.getFadedLineColor();
        this.theme_star_color = this.theme_board.getStarColor();
        this.theme_faded_star_color = this.theme_board.getFadedStarColor();
        this.theme_blank_text_color = this.theme_board.getBlankTextColor();
        this.theme_black_text_color = this.theme_black.getBlackTextColor();
        this.theme_white_text_color = this.theme_white.getWhiteTextColor();
        //this.parent.css(this.theme_board.getBackgroundCSS());
        const bg_css = this.theme_board.getBackgroundCSS();
        if (this.parent) {
            for (const key in bg_css) {
                (this.parent.style as any)[key] = (bg_css as any)[key];
            }
        }

        if (!dont_redraw) {
            this.redraw(true);
            this.move_tree_redraw();
        }
    }
    private onLabelingStart(ev: MouseEvent | TouchEvent) {
        const pos = getRelativeEventPosition(ev);
        this.last_label_position = this.xy2ij(pos.x, pos.y, false);

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
    }
    protected watchSelectedThemes(cb: (themes: GobanSelectedThemes) => void): {
        remove: () => any;
    } {
        if (callbacks.watchSelectedThemes) {
            return callbacks.watchSelectedThemes(cb);
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
            this.move_tree_canvas = allocateCanvasOrError();
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

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
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
                    if (this.engine.cur_move.played_by) {
                        // note that getRelativeEventPosition handles various
                        // nasty looking things to do with Touch etc, so using it here
                        // gets around that kind of thing, even though in theory it
                        // might be nicer to sent the client absolute coords, maybe.
                        const rpos = getRelativeEventPosition(event);
                        this.emit("played-by-click", {
                            player_id: this.engine.cur_move.played_by,
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

        this.on("destroy", () => {
            canvas.removeEventListener("touchstart", handler);
            canvas.removeEventListener("mousedown", handler);
        });
    }

    protected computeThemeStoneRadius(): number {
        // Scale proportionally in general
        let r = this.square_size * 0.488;

        // Prevent pixel sharing in low-res
        if (this.square_size % 2 === 0) {
            r = Math.min(r, (this.square_size - 1) / 2);
        }

        return Math.max(1, r);
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

        if (!theme_white_stones || !theme_black_stones) {
            throw new Error(
                "Failed to load stone images for given radius" + this.theme_stone_radius,
            );
        }

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

const fitTextCache: { [key: string]: [number, string, TextMetrics] } = {};

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
