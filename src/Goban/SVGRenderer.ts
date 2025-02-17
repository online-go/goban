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

//import { GobanCore, GobanSelectedThemes, GobanMetrics, GOBAN_FONT } from "./GobanCore";
import { GobanConfig } from "../GobanBase";
import { GobanEngine } from "../engine";
import { MoveTree } from "../engine/MoveTree";
import { GobanTheme, THEMES } from "./themes";
import { MoveTreePenMarks } from "../engine/MoveTree";
import { getRelativeEventPosition } from "./canvas_utils";
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
import { Goban, GobanMetrics, GobanSelectedThemes } from "./Goban";
import { ColoredCircle } from "./InteractiveBase";

//import { GobanCanvasConfig, GobanCanvasInterface } from "./GobanCanvas";

const __theme_cache: {
    [color: string]: { [name: string]: { [size: string]: any } };
} = {
    black: {},
    white: {},
};
//const __theme_defs_cache: { [radius: number]: SVGDefsElement } = {};

declare let ResizeObserver: any;

const USE_CELL_RENDERER = true;
// Shadow dom provided a bit of a performance boost, but older browsers don't support it yet.
function canConstructStyleSheet() {
    try {
        new CSSStyleSheet();
        return true;
    } catch (e) {}

    return false;
}
const USE_SHADOW_DOM =
    document.body.attachShadow !== undefined &&
    CSSStyleSheet !== undefined &&
    canConstructStyleSheet();

export interface SVGRendererGobanConfig extends GobanConfig {
    board_div?: HTMLElement;
    title_div?: HTMLElement;
    move_tree_container?: HTMLElement;
    last_move_opacity?: number;
}

interface MoveTreeViewPortInterface {
    offset_x: number;
    offset_y: number;
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
}

const HOT_PINK = "#ff69b4";

//interface GobanCanvasInterface {
interface GobanSVGInterface {
    engine: GobanEngine;
    move_tree_container?: HTMLElement;

    clearAnalysisDrawing(): void;
    drawPenMarks(pen_marks: MoveTreePenMarks): void;
    enablePen(): void;
    disablePen(): void;
    setByoYomiLabel(label: string): void;
    setLastMoveOpacity(opacity: number): void;

    move_tree_bindEvents(svg: SVGElement): void;
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

export class SVGRenderer extends Goban implements GobanSVGInterface {
    public engine: GobanEngine;
    //private board_div: HTMLElement;
    private svg: SVGElement;
    private svg_defs: SVGDefsElement;
    //private loaded_pre_rendered_stones: { [radius: number]: boolean } = {};
    private __set_board_height: number = -1;
    private __set_board_width: number = -1;
    private ready_to_draw: boolean = false;
    private message_div?: HTMLDivElement;
    private message_td?: HTMLElement;
    private message_text?: HTMLDivElement;
    private message_timeout?: number;
    private handleShiftKey: (ev: KeyboardEvent) => void;

    private lines_layer?: SVGGraphicsElement;
    private coordinate_labels_layer?: SVGGraphicsElement;
    private grid: Array<Array<SVGGraphicsElement>> = [];
    public grid_layer?: SVGGraphicsElement;
    private cells: Array<Array<GCell>> = [];
    public shadow_grid: Array<Array<SVGElement | undefined>> = [];
    public shadow_layer?: SVGGraphicsElement;
    private pen_layer?: SVGGraphicsElement;

    private last_move_opacity: number = 1;
    public move_tree_container?: HTMLElement;
    private move_tree_inner_container?: HTMLDivElement;
    private move_tree_svg?: SVGElement;
    private move_tree_svg_defs?: SVGDefsElement;

    private autoplaying_puzzle_move: boolean = false;
    private byoyomi_label: string = "";
    private current_pen_mark?: { color: string; points: [number, number] };
    private labeling_mode?: "put" | "clear";
    private last_label_position: { i: number; j: number } = { i: NaN, j: NaN };
    private last_pen_position?: [number, number];
    public metrics: GobanMetrics = { width: NaN, height: NaN, mid: NaN, offset: NaN };

    private drawing_enabled: boolean = true;
    protected title_div?: HTMLElement;
    public event_layer?: HTMLDivElement;

    private themes: GobanSelectedThemes = {
        "board": "Plain",
        "black": "Plain",
        "white": "Plain",
        "removal-graphic": "x",
        "removal-scale": 1.0,
    };
    public theme_black!: GobanTheme;
    private theme_black_stones: Array<any> = [];
    public theme_black_text_color: string = HOT_PINK;
    private theme_blank_text_color: string = HOT_PINK;
    private theme_board!: GobanTheme;
    public theme_faded_line_color: string = HOT_PINK;
    public theme_faded_star_color: string = HOT_PINK;
    //private theme_faded_text_color:string;
    private theme_line_color: string = "";
    private theme_star_color: string = "";
    private theme_stone_radius: number = 10;
    public theme_white!: GobanTheme;
    private theme_white_stones: Array<any> = [];
    public theme_white_text_color: string = HOT_PINK;

    constructor(config: SVGRendererGobanConfig, preloaded_data?: AdHocFormat | JGOF) {
        /* TODO: Need to reconcile the clock fields before we can get rid of this `any` cast */
        super(config, preloaded_data as any);

        if (config.board_div) {
            this.parent = config["board_div"];
        } else {
            this.no_display = true;
            // unattached div dangle prevent null pointer refs
            this.parent = document.createElement("div");
        }

        this.title_div = config["title_div"];
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

        if (USE_SHADOW_DOM) {
            const shadow_root =
                this.parent.shadowRoot ?? this.parent.attachShadow({ mode: "open" });
            if (shadow_root.childNodes.length) {
                shadow_root.childNodes.forEach((child) => child.remove());
            }
            //throw new Error("Shadow root already has children");
            //const shadow_root = this.parent.attachShadow({ mode: "closed" });
            shadow_root.appendChild(this.svg);
            const sheet = new CSSStyleSheet();
            if (sheet?.replaceSync) {
                sheet.replaceSync(`text {
                font-family: Verdana, Arial, sans-serif;
                text-anchor: middle;
                font-weight: bold;
                user-select: none;
            }`);
            }
            shadow_root.adoptedStyleSheets = [sheet];
        } else {
            this.parent.appendChild(this.svg);
        }

        this.on("destroy", () => {
            this.svg.remove();
        });

        this.svg_defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        this.svg.appendChild(this.svg_defs);
        this.last_move_opacity = config["last_move_opacity"] ?? 1;

        if (USE_SHADOW_DOM) {
            this.bindPointerBindings(this.parent as any);
        } else {
            this.event_layer = document.createElement("div");
            this.event_layer.style.position = "absolute";
            this.event_layer.style.top = "0";
            this.event_layer.style.right = "0";
            this.event_layer.style.left = "0";
            this.event_layer.style.bottom = "0";
            this.parent.appendChild(this.event_layer);
            this.bindPointerBindings(this.event_layer);
        }

        this.move_tree_container = config.move_tree_container;

        this.handleShiftKey = (ev) => {
            try {
                if (ev.shiftKey !== this.shift_key_is_down) {
                    this.shift_key_is_down = ev.shiftKey;
                    if (this.last_hover_square) {
                        if (USE_CELL_RENDERER) {
                            this.cellDraw(this.last_hover_square.x, this.last_hover_square.y);
                        } else {
                            this.__drawSquare(this.last_hover_square.x, this.last_hover_square.y);
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };
        window.addEventListener("keydown", this.handleShiftKey);
        window.addEventListener("keyup", this.handleShiftKey);

        this.setTheme(this.getSelectedThemes(), true);
        const watcher = this.watchSelectedThemes((themes: GobanSelectedThemes) => {
            if (!this.engine) {
                return;
            }
            delete __theme_cache.black?.["Custom"];
            delete __theme_cache.white?.["Custom"];
            delete __theme_cache.board?.["Custom"];
            this.setTheme(themes, false);
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
        this.attachPenLayer();
    }
    public disablePen(): void {
        this.detachPenLayer();
    }

    public cell(i: number, j: number): GCell {
        if (!this.cells[j]) {
            this.cells[j] = [];
        }
        if (!this.cells[j][i]) {
            this.cells[j][i] = new GCell(this, i, j);
        }
        return this.cells[j][i];
    }

    public clearCells(): void {
        this.cells = [];
    }

    public override destroy(): void {
        super.destroy();

        this.clearMessage();

        if (this.svg && this.svg.parentNode) {
            this.svg.remove();
        }
        delete (this as any).board;
        delete (this as any).svg;

        this.detachPenLayer();

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
        delete this.move_tree_svg;
        delete this.title_div;
    }
    private detachPenLayer(): void {
        if (this.pen_layer) {
            this.pen_layer.remove();
            delete this.pen_layer;
        }
    }
    private attachPenLayer(): void {
        if (!this.pen_layer) {
            this.pen_layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
            this.pen_layer.setAttribute("id", "pen-svg");
            this.pen_layer.setAttribute("class", "PenLayer");
            this.pen_layer.setAttribute("width", this.metrics.width.toString());
            this.pen_layer.setAttribute("height", this.metrics.height.toString());
            this.svg.appendChild(this.pen_layer);
        }
    }
    private bindPointerBindings(div: HTMLDivElement): void {
        if (!this.interactive) {
            return;
        }

        if (div.getAttribute("data-pointers-bound") === "true") {
            return;
        }

        div.setAttribute("data-pointers-bound", "true");

        this.on("destroy", () => {
            div.removeAttribute("data-pointers-bound");
        });

        let dragging = false;

        let last_click_square = this.xy2ij(0, 0);
        let pointer_down_timestamp = 0;

        const pointerUp = (ev: MouseEvent | TouchEvent, double_clicked: boolean): void => {
            const press_duration_ms = performance.now() - pointer_down_timestamp;
            try {
                if (!dragging) {
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
                    const pos = getRelativeEventPosition(ev, this.parent);
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
                        const pos = getRelativeEventPosition(ev, this.parent);
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
                    const pos = getRelativeEventPosition(ev, this.parent);
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

        const onClick = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                dragging = true;
                pointerUp(ev, false);
            }
            ev.preventDefault();
            return false;
        };
        const onDblClick = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                dragging = true;
                pointerUp(ev, true);
            }
            ev.preventDefault();
            return false;
        };
        const onMouseDown = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                pointerDown(ev);
            }
            ev.preventDefault();

            return false;
        };
        const onMouseUp = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                dragging = false;
                //pointerUp(ev, false);
            }
            //ev.preventDefault();
            return false;
        };
        const onMouseMove = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                pointerMove(ev);
            }
            ev.preventDefault();
            return false;
        };
        const onMouseOut = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                pointerOut(ev);
            } else {
                ev.preventDefault();
            }
            return false;
        };
        const onContextMenu = (ev: MouseEvent) => {
            if (!mouse_disabled) {
                pointerUp(ev, false);
            } else {
                ev.preventDefault();
            }
            return false;
        };
        const onFocus = (ev: FocusEvent) => {
            ev.preventDefault();
            return false;
        };

        div.addEventListener("click", onClick);
        div.addEventListener("dblclick", onDblClick);
        div.addEventListener("mousedown", onMouseDown);
        div.addEventListener("mouseup", onMouseUp);
        div.addEventListener("mousemove", onMouseMove);
        div.addEventListener("mouseout", onMouseOut);
        div.addEventListener("contextmenu", onContextMenu);
        div.addEventListener("focus", onFocus);
        this.on("destroy", () => {
            div.removeEventListener("click", onClick);
            div.removeEventListener("dblclick", onDblClick);
            div.removeEventListener("mousedown", onMouseDown);
            div.removeEventListener("mouseup", onMouseUp);
            div.removeEventListener("mousemove", onMouseMove);
            div.removeEventListener("mouseout", onMouseOut);
            div.removeEventListener("contextmenu", onContextMenu);
            div.removeEventListener("focus", onFocus);
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
                getRelativeEventPosition(ev, this.parent); // enables tracking of last ev position so on touch end can always tell where we released from

                if (ev.target === div) {
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
                    ev.target === div &&
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

                if (ev.target === div) {
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
                getRelativeEventPosition(ev, this.parent); // enables tracking of last ev position so on touch end can always tell where we released from

                if (ev.target === div) {
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
        /*
        if (this.pen_ctx) {
            this.pen_ctx.clearRect(0, 0, this.metrics.width, this.metrics.height);
        }
        */
        if (this.pen_layer) {
            this.pen_layer.innerHTML = "";
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
        /*
        if (!this.pen_ctx) {
            throw new Error(`setPenStyle called with null pen_ctx`);
        }

        this.pen_ctx.strokeStyle = color;
        this.pen_ctx.lineWidth = Math.max(1, Math.round(this.square_size * 0.1));
        this.pen_ctx.lineCap = "round";
        */
    }
    private onPenStart(ev: MouseEvent | TouchEvent): void {
        this.attachPenLayer();

        const pos = getRelativeEventPosition(ev, this.parent);
        this.last_pen_position = this.xy2pen(pos.x, pos.y);
        this.current_pen_mark = { color: this.analyze_subtool, points: this.xy2pen(pos.x, pos.y) };
        this.pen_marks.push(this.current_pen_mark);
        this.setPenStyle(this.analyze_subtool);

        this.syncReviewMove({ pen: this.analyze_subtool, pp: this.xy2pen(pos.x, pos.y) });
    }
    private onPenMove(ev: MouseEvent | TouchEvent): void {
        if (!this.last_pen_position || !this.current_pen_mark) {
            throw new Error(`onPenMove called with invalid last pen position or current pen mark`);
        }

        const pos = getRelativeEventPosition(ev, this.parent);
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

        /*
        this.pen_ctx.beginPath();
        this.pen_ctx.moveTo(s[0], s[1]);
        this.pen_ctx.lineTo(e[0], e[1]);
        this.pen_ctx.stroke();
        */

        const path = `M ${s[0]} ${s[1]} L ${e[0]} ${e[1]}`;
        const path_element = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path_element.setAttribute("d", path);
        path_element.setAttribute("stroke", this.analyze_subtool);
        path_element.setAttribute("stroke-width", "3");
        path_element.setAttribute("fill", "none");
        this.pen_layer?.appendChild(path_element);

        this.syncReviewMove({ pp: [dx, dy] });
    }
    public drawPenMarks(pen_marks: MoveTreePenMarks): void {
        if (this.review_id && !this.done_loading_review) {
            return;
        }
        if (!pen_marks.length) {
            return;
        }
        this.attachPenLayer();
        this.clearAnalysisDrawing();
        this.pen_marks = pen_marks;

        for (let i = 0; i < pen_marks.length; ++i) {
            const stroke = pen_marks[i];
            this.setPenStyle(stroke.color);

            let px = stroke.points[0];
            let py = stroke.points[1];
            const pt = this.pen2xy(px, py);
            let path = `M ${pt[0]} ${pt[1]}`;
            for (let j = 2; j < stroke.points.length; j += 2) {
                px += stroke.points[j];
                py += stroke.points[j + 1];
                const pt = this.pen2xy(px, py);
                path += ` L ${pt[0]} ${pt[1]}`;
            }
            const path_element = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path_element.setAttribute("d", path);
            path_element.setAttribute("stroke", stroke.color);
            path_element.setAttribute("stroke-width", "3");
            path_element.setAttribute("fill", "none");
            this.pen_layer?.appendChild(path_element);
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

        // If there are modes where right click should not behave as if you clicked a placement on the svg
        // then return here instead of proceeding.
        if (right_click && this.mode === "play") {
            return;
        }

        const pos = getRelativeEventPosition(event, this.parent);
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

        const pos = getRelativeEventPosition(event, this.parent);
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

        if (!this.grid_layer) {
            return;
        }

        if (USE_CELL_RENDERER) {
            this.cellDraw(i, j);
        } else {
            if (this.__draw_state[j][i] !== this.drawingHash(i, j)) {
                this.__drawSquare(i, j);
            }
        }
    }
    private cellDraw(i: number, j: number): void {
        if (!this.drawing_enabled || this.no_display) {
            return;
        }
        if (i < 0 || j < 0) {
            return;
        }

        const cell = this.cell(i, j);

        const removed_stone_scale = this.themes["removal-scale"];
        const ss = this.square_size;
        let ox = this.draw_left_labels ? ss : 0;
        let oy = this.draw_top_labels ? ss : 0;
        if (this.bounds.left > 0) {
            ox = -ss * this.bounds.left;
        }
        if (this.bounds.top > 0) {
            oy = -ss * this.bounds.top;
        }

        const l = i * ss + ox;
        const t = j * ss + oy;

        let transform = `translate(${l},${t})`;

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
                (typeof this.isInPushedAnalysis() !== "undefined" &&
                    this.isInPushedAnalysis() &&
                    this.show_variation_move_numbers))
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

        /* Fade our lines if we have text to draw */
        if (have_text_to_draw) {
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

            cell.drawFadedIntersectionLines(draw_star_point, star_radius);
        } else {
            cell.clearFadedLines();
        }

        /* Heatmap */
        if (this.heatmap && this.heatmap[j][i] > 0.001) {
            cell.heatmap(this.heatmap[j][i]);
        } else {
            cell.clearHeatmap();
        }

        /* Draw square highlights if any */
        if (
            pos.hint ||
            (this.highlight_movetree_moves && movetree_contains_this_square) ||
            pos.color
        ) {
            const color = pos.color ? pos.color : pos.hint ? "#8EFF0A" : "#FF8E0A";
            cell.highlight(color);
        } else {
            cell.clearHighlight();
        }

        /* Colored stones */
        const circle = this.colored_circles?.[j][i];
        if (circle) {
            cell.circle(circle);
        } else {
            cell.clearCircle();
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

                    const stone_transparent = translucent || !stone_color;

                    cell.stone(
                        color,
                        stone_transparent,
                        color === JGOFNumericPlayerColor.BLACK
                            ? this.theme_black.getStone(i, j, this.theme_black_stones, this)
                            : this.theme_white.getStone(i, j, this.theme_white_stones, this),
                        this.theme_stone_radius,
                        stoneAlphaValue,
                    );
                } else {
                    cell.clearStone();
                }

                /** Draw the circle around the blue move */
                const circle = this.colored_circles?.[j][i];
                if (pos.blue_move && circle) {
                    cell.blueMove(circle.border_color || "#000000", circle.border_width || 0.1);
                } else {
                    cell.clearBlueMove();
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
                    //(this.mode === "analyze" && pos.stone_removed)
                    pos.stone_removed
                ) {
                    draw_removal_x = this.themes["removal-graphic"] === "x";
                    transform = `translate(${l + this.metrics.mid * (1.0 - removed_stone_scale)}, ${
                        t + this.metrics.mid * (1.0 - removed_stone_scale)
                    }) scale(${removed_stone_scale})`;
                }
            } else {
                cell.clearStone();
                cell.clearBlueMove();
            }
        }

        let red_x = false;
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

            let fill = "";
            const mid = this.metrics.mid;
            let r = Math.max(1, mid * 0.5);

            if (pos.score === "black" && color === "white") {
                fill = this.theme_white_text_color;
            } else if (pos.score === "white" && color === "black") {
                fill = this.theme_black_text_color;
            } else if (
                (pos.score === "white" && color === "white") ||
                (pos.score === "black" && color === "black")
            ) {
                // score point for the same color where the stone is removed
                // should call special attention to it
                fill = "#ff0000";
                red_x = true;
                r = Math.max(1, mid * 0.65);
            } else {
                // otherwise, no score but removed stones can happen when
                // territory isn't properly sealed, so we are going to mark
                // it grey to avoid calling too much attention, but still
                // denote that removing these stones doesn't result in
                // the territory being territory yet.
                fill = "#777777";
            }
            const opacity = this.engine.board[j][i] ? 1.0 : 0.2;
            cell.removalCross(fill, r, opacity);
        } else {
            cell.clearRemovalCross();
        }

        /* Draw Scores */
        if (
            (pos.score &&
                (!draw_removal_x || red_x) &&
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
                    (this.score_estimator.removal[j][i] && this.score_estimator.board[j][i] === 0))
            ) {
                color = this.score_estimator.territory[j][i] === 1 ? "black" : "white";
                if (this.score_estimator.board[j][i] === 0 && this.score_estimator.removal[j][i]) {
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

            let opacity = 1.0;
            let fill = "";
            let stroke = "";
            if (color === "white") {
                fill = this.theme_black_text_color;
                stroke = "#777777";
            }
            if (color === "black") {
                fill = this.theme_white_text_color;
                stroke = "#888888";
            }
            if (color === "dame") {
                opacity = 0.2;
                stroke = "#365FE6";
            }
            if (color === "seal") {
                opacity = 0.8;
                fill = "#ff4444";
                stroke = "#E079CE";
            }
            if (color?.[0] === "#") {
                fill = color;
                stroke = color_blend("#888888", color);
            }
            cell.score(fill, stroke, opacity);
        } else {
            cell.clearScore();
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
                    const move_diff = m.getMoveNumberDifferenceFromTrunk();
                    if (move_diff !== m.move_number) {
                        if (m.edited) {
                            if (this.engine.board[j][i]) {
                                //alt_marking = "triangle";
                            }
                        } else {
                            letter = move_diff.toString();
                        }
                    }
                }
            }

            if (letter) {
                letter_was_drawn = true;
                draw_last_move = false;

                let fontSize = this.square_size * 0.5 * this.stone_font_scale;
                if (subscript) {
                    fontSize *= 0.8;
                }
                cell.letter(letter, text_color, fontSize, transparent ? 0.6 : 1.0, !!subscript);
            } else {
                cell.clearLetter();
            }

            if (subscript) {
                letter_was_drawn = true;
                draw_last_move = false;
                cell.subscript(
                    subscript,
                    text_color,
                    this.square_size * 0.4 * this.stone_font_scale,
                    transparent ? 0.6 : 1.0,
                    !!letter,
                    !!pos.sub_triangle,
                );
            } else {
                cell.clearSubscript();
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
                draw_last_move = false;
                cell.circleSymbol(symbol_color, transparent ? 0.6 : 1.0);
            } else {
                cell.clearCircleSymbol();
            }

            if (
                pos.triangle ||
                pos.chat_triangle ||
                pos.sub_triangle ||
                alt_marking === "triangle" ||
                hover_mark === "triangle"
            ) {
                draw_last_move = false;
                cell.triangleSymbol(symbol_color, transparent ? 0.6 : 1.0, !!pos.sub_triangle);
            } else {
                cell.clearTriangleSymbol();
            }

            if (pos.cross || hover_mark === "cross") {
                draw_last_move = false;
                cell.crossSymbol(symbol_color, transparent ? 0.6 : 1.0);
            } else {
                cell.clearCrossSymbol();
            }

            if (pos.square || hover_mark === "square") {
                draw_last_move = false;
                cell.squareSymbol(symbol_color, transparent ? 0.6 : 1.0);
            } else {
                cell.clearSquareSymbol();
            }
        }

        /* Clear last move */
        if (this.last_move && this.engine && !this.last_move.is(this.engine.cur_move)) {
            const m = this.last_move;
            delete this.last_move;
            this.cell(m.x, m.y).clearLastMove();
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
                        draw_last_move = false;
                        cell.lastMove("+", color, this.last_move_opacity);
                    } else {
                        if (
                            this.engine.undo_requested &&
                            this.getShowUndoRequestIndicator() &&
                            this.engine.undo_requested === this.engine.cur_move.move_number
                        ) {
                            draw_last_move = false;
                            cell.lastMove("?", color, 1.0);
                        } else {
                            cell.lastMove("o", color, this.last_move_opacity);
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
            const color = est < 0 ? "white" : "black";
            const color_num = color === "black" ? 1 : 2;

            if (color_num !== stone_color) {
                cell.scoreEstimate(color, est);
            } else {
                cell.clearScoreEstimate();
            }
        } else {
            cell.clearScoreEstimate();
        }

        cell.transform = transform;
        //this.__draw_state[j][i] = this.drawingHash(i, j);
    }
    private __drawSquare(i: number, j: number): void {
        if (USE_CELL_RENDERER) {
            throw new Error(`USE_CELL_RENDERER is set, this should not be called`);
        }

        if (!this.drawing_enabled || this.no_display || !this.grid || !this.grid[j]) {
            return;
        }
        if (i < 0 || j < 0) {
            return;
        }

        let cell = this.grid[j][i];
        const shadow_cell = this.shadow_grid[j][i];

        if (cell) {
            cell.remove();
        }
        if (shadow_cell) {
            shadow_cell.remove();
        }

        cell = this.grid[j][i] = document.createElementNS("http://www.w3.org/2000/svg", "g");
        this.grid_layer!.appendChild(cell);

        const removed_stone_scale = this.themes["removal-scale"];
        const ss = this.square_size;
        let ox = this.draw_left_labels ? ss : 0;
        let oy = this.draw_top_labels ? ss : 0;
        if (this.bounds.left > 0) {
            ox = -ss * this.bounds.left;
        }
        if (this.bounds.top > 0) {
            oy = -ss * this.bounds.top;
        }

        const l = i * ss + ox;
        //const r = (i + 1) * ss + ox;
        const t = j * ss + oy;
        //const b = (j + 1) * ss + oy;

        //const cx = l + this.metrics.mid;
        //const cy = t + this.metrics.mid;
        const cx = this.metrics.mid;
        const cy = this.metrics.mid;

        let transform = `translate(${l},${t})`;

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
                (typeof this.isInPushedAnalysis() !== "undefined" &&
                    this.isInPushedAnalysis() &&
                    this.show_variation_move_numbers))
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

        /* Fade our lines if we have text to draw */
        if (have_text_to_draw) {
            /* draw lighter colored lines */
            let sx = 0;
            let ex = ss;
            const mx = ss / 2 - this.metrics.offset;
            let sy = 0;
            let ey = ss;
            const my = ss / 2 - this.metrics.offset;

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

            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("stroke", this.theme_faded_line_color);
            path.setAttribute("stroke-width", this.square_size < 5 ? "0.2" : "1");
            path.setAttribute("fill", "none");
            path.setAttribute(
                "d",
                `
                M ${Math.floor(sx)} ${my} L ${Math.floor(ex)} ${my}
                M ${mx} ${Math.floor(sy)} L ${mx} ${Math.floor(ey)} 
            `,
            );
            cell.appendChild(path);

            /* Draw star points */
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
                const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circ.setAttribute("cx", cx.toString());
                circ.setAttribute("cy", cy.toString());
                circ.setAttribute("r", star_radius.toString());
                circ.setAttribute("fill", this.theme_faded_star_color);
                cell.appendChild(circ);
            }
        }

        /* Heatmap */
        if (this.heatmap) {
            if (this.heatmap[j][i] > 0.001) {
                const color = "#00FF00";
                const r = Math.floor(this.square_size * 0.5) - 0.5;
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", (cx - r).toFixed(1));
                rect.setAttribute("y", (cy - r).toFixed(1));
                rect.setAttribute("width", (r * 2).toFixed(1));
                rect.setAttribute("height", (r * 2).toFixed(1));
                rect.setAttribute("fill-opacity", Math.min(this.heatmap[j][i], 0.5).toFixed(2));
                rect.setAttribute("fill", color);
                cell.appendChild(rect);
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
                const r = Math.floor(this.square_size * 0.5) - 0.5;
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", (cx - r).toFixed(1));
                rect.setAttribute("y", (cy - r).toFixed(1));
                rect.setAttribute("width", (r * 2).toFixed(1));
                rect.setAttribute("height", (r * 2).toFixed(1));
                rect.setAttribute("fill-opacity", "0.6");
                rect.setAttribute("fill", color);
                cell.appendChild(rect);
            }
        }

        /* Colored stones */
        const circle = this.colored_circles?.[j][i];
        if (circle) {
            const radius = Math.floor(this.square_size * 0.5) - 0.5;
            let lineWidth = radius * (circle.border_width || 0.1);
            if (lineWidth < 0.3) {
                lineWidth = 0;
            }

            const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circ.setAttribute("class", "colored-circle");
            circ.setAttribute("fill", circle.color);
            if (circle.border_color) {
                circ.setAttribute("stroke", circle.border_color);
            }
            if (lineWidth > 0) {
                circ.setAttribute("stroke-width", lineWidth.toFixed(1));
            } else {
                circ.setAttribute("stroke-width", "1px");
            }
            circ.setAttribute("cx", cx.toString());
            circ.setAttribute("cy", cy.toString());
            circ.setAttribute("r", Math.max(0.1, radius - lineWidth / 2).toString());
            cell.appendChild(circ);
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

                    const stone_transparent = translucent || !stone_color;

                    if (color === 1) {
                        const stone = this.theme_black.getStone(
                            i,
                            j,
                            this.theme_black_stones,
                            this,
                        );
                        const [elt, shadow] = this.theme_black.placeBlackStoneSVG(
                            cell,
                            stone_transparent ? undefined : this.shadow_layer,
                            stone,
                            cx,
                            cy,
                            this.theme_stone_radius,
                        );
                        this.shadow_grid[j][i] = shadow;
                        if (stone_transparent) {
                            elt.setAttribute("opacity", stoneAlphaValue.toString());
                        }
                    } else {
                        const stone = this.theme_white.getStone(
                            i,
                            j,
                            this.theme_white_stones,
                            this,
                        );
                        const [elt, shadow] = this.theme_white.placeWhiteStoneSVG(
                            cell,
                            stone_transparent ? undefined : this.shadow_layer,
                            stone,
                            cx,
                            cy,
                            this.theme_stone_radius,
                        );
                        this.shadow_grid[j][i] = shadow;
                        if (stone_transparent) {
                            elt.setAttribute("opacity", stoneAlphaValue.toString());
                        }
                    }
                }

                /** Draw the circle around the blue move */
                const circle = this.colored_circles?.[j][i];
                if (pos.blue_move && circle) {
                    const radius = Math.floor(this.square_size * 0.5) - 0.5;
                    let lineWidth = radius * (circle.border_width || 0.1);
                    if (lineWidth < 0.3) {
                        lineWidth = 0;
                    }

                    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    circ.setAttribute("class", "colored-circle");
                    if (circle.border_color) {
                        circ.setAttribute("stroke", circle.border_color || "#000000");
                    }
                    if (lineWidth > 0) {
                        circ.setAttribute("stroke-width", `${lineWidth.toFixed(1)}px`);
                    } else {
                        circ.setAttribute("stroke-width", "1px");
                    }
                    circ.setAttribute("fill", "none");
                    circ.setAttribute("cx", cx.toString());
                    circ.setAttribute("cy", cy.toString());
                    circ.setAttribute("r", Math.max(0.1, radius - lineWidth / 2).toString());
                    cell.appendChild(circ);
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
                    //(this.mode === "analyze" && pos.stone_removed)
                    pos.stone_removed
                ) {
                    draw_removal_x = this.themes["removal-graphic"] === "x";
                    transform = `translate(${l + this.metrics.mid * (1.0 - removed_stone_scale)}, ${
                        t + this.metrics.mid * (1.0 - removed_stone_scale)
                    }) scale(${removed_stone_scale})`;
                }
            }
        }

        let red_x = false;
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
            let r = Math.max(1, this.metrics.mid * 0.5);
            const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
            cross.setAttribute("class", "removal-cross");
            const color =
                this.engine.board[j][i] === JGOFNumericPlayerColor.BLACK ? "black" : "white";

            if (pos.score === "black" && color === "white") {
                cross.setAttribute("fill", this.theme_white_text_color);
            } else if (pos.score === "white" && color === "black") {
                cross.setAttribute("fill", this.theme_black_text_color);
            } else if (
                (pos.score === "white" && color === "white") ||
                (pos.score === "black" && color === "black")
            ) {
                // score point for the same color where the stone is removed
                // should call special attention to it
                cross.setAttribute("fill", "#ff0000");
                red_x = true;
                r = Math.max(1, this.metrics.mid * 0.65);
            } else {
                // otherwise, no score but removed stones can happen when
                // territory isn't properly sealed, so we are going to mark
                // it grey to avoid calling too much attention, but still
                // denote that removing these stones doesn't result in
                // the territory being territory yet.
                cross.setAttribute("fill", "#777777");
            }

            /* four dagger tip points with a square in the center. Start at top left going clockwise*/
            const dx = r * 0.25; // tip width
            const ir = r * 0.3; // inner radius for our box
            const ir_dx = ir * 0.4; // offset to where our daggers meet the box

            // prettier-ignore
            const points = [
                /* top half */
                -r          , -r          ,
                -r + dx     , -r          ,
                -ir + ir_dx , -ir - ir_dx ,
                ir - ir_dx  , -ir - ir_dx ,
                r - dx      , -r          ,
                r           , -r          ,

                /* right half */
                r          , -r + dx     ,
                ir + ir_dx , -ir + ir_dx ,
                ir + ir_dx , ir - ir_dx  ,
                r          , r - dx      ,
                r          , r           ,

                /* bottom half */
                r - dx      , r          ,
                ir - ir_dx  , ir + ir_dx ,
                -ir + ir_dx , ir + ir_dx ,
                -r + dx     , r          ,
                -r          , r          ,

                /* left half */
                -r          , r - dx      ,
                -ir - ir_dx , ir - ir_dx  ,
                -ir - ir_dx , -ir + ir_dx ,
                -r          , -r + dx     ,
                //-r          , -r          ,
            ];

            const path =
                points
                    .map((v, i) => {
                        return (i % 2 === 0 ? (i === 0 ? "M" : "L") : " ") + v;
                    })
                    .join(" ") + " Z";

            cross.setAttribute("stroke", "#888888");
            cross.setAttribute("stroke-width", `${this.square_size * 0.0275}px`);
            //cross.setAttribute("fill", "none");
            cross.setAttribute(
                "d",
                path,
                /*
                `
                    M ${cx - r} ${cy - r}
                    L ${cx + r} ${cy + r}
                    M ${cx + r} ${cy - r}
                    L ${cx - r} ${cy + r}
                `,
                */
            );
            const opacity = this.engine.board[j][i] ? 1.0 : 0.2;
            cross.setAttribute("stroke-opacity", opacity?.toString());
            cross.setAttribute("transform", `translate(${cx}, ${cy})`);

            cell.appendChild(cross);
        }

        /* Draw Scores */
        {
            if (
                (pos.score &&
                    (!draw_removal_x || red_x) &&
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

                const r = this.square_size * 0.15;
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", (cx - r).toFixed(1));
                rect.setAttribute("y", (cy - r).toFixed(1));
                rect.setAttribute("width", (r * 2).toFixed(1));
                rect.setAttribute("height", (r * 2).toFixed(1));
                if (color === "white") {
                    rect.setAttribute("fill", this.theme_black_text_color);
                    rect.setAttribute("stroke", "#777777");
                }
                if (color === "black") {
                    rect.setAttribute("fill", this.theme_white_text_color);
                    rect.setAttribute("stroke", "#888888");
                }
                if (color === "dame") {
                    rect.setAttribute("fill-opacity", "0.2");
                    rect.setAttribute("stroke", "#365FE6");
                }
                if (color === "seal") {
                    rect.setAttribute("fill-opacity", "0.8");
                    rect.setAttribute("fill", "#ff4444");
                    rect.setAttribute("stroke", "#E079CE");
                }
                if (color?.[0] === "#") {
                    rect.setAttribute("fill", color);
                    rect.setAttribute("stroke", color_blend("#888888", color));
                }
                rect.setAttribute(
                    "stroke-width",
                    (Math.ceil(this.square_size * 0.065) - 0.5).toFixed(1),
                );
                cell.appendChild(rect);
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
                    const move_diff = m.getMoveNumberDifferenceFromTrunk();
                    if (move_diff !== m.move_number) {
                        if (m.edited) {
                            if (this.engine.board[j][i]) {
                                //alt_marking = "triangle";
                            }
                        } else {
                            letter = move_diff.toString();
                        }
                    }
                }
            }

            console.log("letter", letter, "subscript", subscript);

            if (letter) {
                letter_was_drawn = true;
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("class", "letter");
                text.setAttribute("fill", text_color);

                let fontSize = this.square_size * 0.5 * this.stone_font_scale;
                if (subscript) {
                    fontSize *= 0.8;
                }
                text.setAttribute("font-size", `${fontSize}px`);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("x", cx.toString());

                let yy = cy + fontSize * 0.35;
                if (subscript) {
                    yy -= this.square_size * 0.15;
                }
                text.setAttribute("y", yy.toString());
                text.textContent = letter;
                if (transparent) {
                    text.setAttribute("fill-opacity", "0.6");
                }
                cell.appendChild(text);
                draw_last_move = false;
            }

            if (subscript) {
                letter_was_drawn = true;
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("class", "subscript");
                text.setAttribute("fill", text_color);
                const fontSize = this.square_size * 0.4 * this.stone_font_scale;
                text.setAttribute("font-size", `${fontSize}px`);
                text.setAttribute("text-anchor", "middle");
                text.setAttribute("x", cx.toString());
                let yy = cy;
                yy -= this.square_size / 6;
                if (letter) {
                    yy += this.square_size * 0.6;
                } else {
                    yy += this.square_size * 0.31;
                }
                if (pos.sub_triangle) {
                    yy -= this.square_size * 0.08;
                }
                yy += fontSize * 0.35;
                text.setAttribute("y", yy.toString());
                text.textContent = subscript;
                if (transparent) {
                    text.setAttribute("fill-opacity", "0.6");
                }
                cell.appendChild(text);
                draw_last_move = false;
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
                const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circ.setAttribute("class", "circle");
                circ.setAttribute("fill", "none");
                circ.setAttribute("stroke", symbol_color);
                circ.setAttribute(
                    "stroke-width",
                    `${this.square_size * 0.075 * this.stone_font_scale}px`,
                );
                circ.setAttribute("cx", cx.toString());
                circ.setAttribute("cy", cy.toString());
                circ.setAttribute(
                    "r",
                    Math.max(
                        0.1,
                        this.square_size * this.circle_radius * this.stone_font_scale,
                    ).toFixed(2),
                );
                if (transparent) {
                    circ.setAttribute("stroke-opacity", "0.6");
                }
                cell.appendChild(circ);
                draw_last_move = false;
            }
            if (
                pos.triangle ||
                pos.chat_triangle ||
                pos.sub_triangle ||
                alt_marking === "triangle" ||
                hover_mark === "triangle"
            ) {
                let scale = 1.0 * this.stone_font_scale;
                let oy = 0.0;
                let line_width = this.square_size * 0.075 * scale;
                if (pos.sub_triangle) {
                    scale = 0.5 * scale;
                    oy = this.square_size * 0.3;
                    transparent = false;
                    line_width *= 0.5;
                }

                const triangle = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                triangle.setAttribute("class", "triangle");
                triangle.setAttribute("fill", "none");
                triangle.setAttribute("stroke", symbol_color);
                triangle.setAttribute("stroke-width", `${line_width}px`);
                const r = this.square_size * 0.3 * scale;
                let theta = -(Math.PI * 2) / 4;
                const points = [];
                points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
                theta += (Math.PI * 2) / 3;
                points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
                theta += (Math.PI * 2) / 3;
                points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
                theta += (Math.PI * 2) / 3;
                points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
                triangle.setAttribute(
                    "points",
                    points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "),
                );
                if (transparent) {
                    triangle.setAttribute("stroke-opacity", "0.6");
                }
                cell.appendChild(triangle);
                draw_last_move = false;
            }
            if (pos.cross || hover_mark === "cross") {
                const r = Math.max(1, this.metrics.mid * 0.35 * this.stone_font_scale);
                const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
                cross.setAttribute("class", "cross");
                cross.setAttribute("stroke", symbol_color);
                cross.setAttribute(
                    "stroke-width",
                    `${this.square_size * 0.075 * this.stone_font_scale}px`,
                );
                cross.setAttribute("fill", "none");
                cross.setAttribute(
                    "d",
                    `
                    M ${cx - r} ${cy - r}
                    L ${cx + r} ${cy + r}
                    M ${cx + r} ${cy - r}
                    L ${cx - r} ${cy + r}
                `,
                );
                if (transparent) {
                    cross.setAttribute("stroke-opacity", "0.6");
                }

                cell.appendChild(cross);

                draw_last_move = false;
            }

            if (pos.square || hover_mark === "square") {
                draw_last_move = false;
                const square = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                square.setAttribute("class", "square");
                square.setAttribute("fill", "none");
                square.setAttribute("stroke", symbol_color);
                square.setAttribute(
                    "stroke-width",
                    `${this.square_size * 0.075 * this.stone_font_scale}px`,
                );
                const r = Math.max(1, this.metrics.mid * 0.4 * this.stone_font_scale);
                square.setAttribute("x", (cx - r).toFixed(2));
                square.setAttribute("y", (cy - r).toFixed(2));
                square.setAttribute("width", (r * 2).toFixed(2));
                square.setAttribute("height", (r * 2).toFixed(2));
                if (transparent) {
                    square.setAttribute("stroke-opacity", "0.6");
                }
                cell.appendChild(square);
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
                        draw_last_move = false;

                        const r =
                            Math.max(1, this.metrics.mid * 0.35) * 0.8 * this.stone_font_scale;
                        const cross = document.createElementNS(
                            "http://www.w3.org/2000/svg",
                            "path",
                        );
                        cross.setAttribute("class", "last-move");
                        cross.setAttribute("stroke", color);
                        cross.setAttribute(
                            "stroke-width",
                            `${this.square_size * 0.075 * this.stone_font_scale}px`,
                        );
                        cross.setAttribute("fill", "none");
                        cross.setAttribute("opacity", this.last_move_opacity.toString());
                        cross.setAttribute(
                            "d",
                            `
                            M ${cx - r} ${cy}
                            L ${cx + r} ${cy}
                            M ${cx} ${cy - r}
                            L ${cx} ${cy + r}
                        `,
                        );
                        cell.appendChild(cross);
                    } else {
                        if (
                            this.engine.undo_requested &&
                            this.getShowUndoRequestIndicator() &&
                            this.engine.undo_requested === this.engine.cur_move.move_number
                        ) {
                            const letter = "?";
                            draw_last_move = false;

                            const text = document.createElementNS(
                                "http://www.w3.org/2000/svg",
                                "text",
                            );
                            text.setAttribute("class", "letter");
                            text.setAttribute("fill", color);
                            text.setAttribute(
                                "font-size",
                                `${this.square_size * 0.5 * this.stone_font_scale}px`,
                            );
                            text.setAttribute("text-anchor", "middle");
                            text.setAttribute("x", cx.toString());
                            let yy = cy;
                            yy += this.square_size / 6;
                            text.setAttribute("y", yy.toString());
                            text.textContent = letter;
                            cell.appendChild(text);
                        } else {
                            const circ = document.createElementNS(
                                "http://www.w3.org/2000/svg",
                                "circle",
                            );
                            let r = this.square_size * this.last_move_radius;
                            if (this.submit_move) {
                                r = this.square_size * 0.3;
                            }

                            r = Math.max(0.1, r * this.stone_font_scale);
                            circ.setAttribute("class", "last-move");
                            circ.setAttribute("fill", "none");
                            circ.setAttribute("stroke", color);
                            circ.setAttribute(
                                "stroke-width",
                                `${this.square_size * 0.075 * this.stone_font_scale}px`,
                            );
                            circ.setAttribute("cx", cx.toString());
                            circ.setAttribute("cy", cy.toString());
                            circ.setAttribute("opacity", this.last_move_opacity.toString());
                            circ.setAttribute("r", r.toString());
                            cell.appendChild(circ);
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
            const color = est < 0 ? "white" : "black";
            const color_num = color === "black" ? 1 : 2;

            if (color_num !== stone_color) {
                const r = this.square_size * 0.2 * Math.abs(est);
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", (cx - r).toFixed(1));
                rect.setAttribute("y", (cy - r).toFixed(1));
                rect.setAttribute("width", (r * 2).toFixed(1));
                rect.setAttribute("height", (r * 2).toFixed(1));
                if (color === "white") {
                    rect.setAttribute("fill", this.theme_black_text_color);
                    rect.setAttribute("stroke", "#777777");
                }
                if (color === "black") {
                    rect.setAttribute("fill", this.theme_white_text_color);
                    rect.setAttribute("stroke", "#888888");
                }
                rect.setAttribute(
                    "stroke-width",
                    (Math.ceil(this.square_size * 0.035) - 0.5).toFixed(1),
                );
                cell.appendChild(rect);
            }
        }

        this.__draw_state[j][i] = this.drawingHash(i, j);

        cell.setAttribute("transform", transform);

        if (this.shadow_grid[j][i]) {
            this.shadow_grid[j][i].setAttribute("transform", transform);
        }
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
                    pos.blue_move &&
                    this.colored_circles &&
                    this.colored_circles[j] &&
                    this.colored_circles[j][i]
                ) {
                    ret += "blue";
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

        let red_x = false;
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
                red_x = true;
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
                    (!draw_removal_x || red_x) &&
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

    private drawLines(force_clear?: boolean): void {
        if (force_clear) {
            if (this.lines_layer) {
                this.lines_layer.remove();
                delete this.lines_layer;
            }
        }

        if (!this.lines_layer) {
            const ss = this.square_size;
            let ox = this.draw_left_labels ? ss : 0;
            let oy = this.draw_top_labels ? ss : 0;

            if (this.bounds.left > 0) {
                ox = -ss * this.bounds.left;
            }
            if (this.bounds.top > 0) {
                oy = -ss * this.bounds.top;
            }

            // lines go through center of our stone grid
            ox += Math.round(ss / 2);
            oy += Math.round(ss / 2);

            // Tiny square sizes, as in the ones used to display puzzle icons
            const TINY_SQUARE_SIZE = 10;

            // Compute a line width that is rounded to the nearest 0.5 so we
            // get crisp lines
            const line_width =
                ss > TINY_SQUARE_SIZE
                    ? Math.round(2 * Math.round(Math.max(1, ss * 0.02))) * 0.5
                    : // for very small boards, like puzzle icons, have faint lines
                      ss * 0.08;
            ox -= line_width * 0.5;
            oy -= line_width * 0.5;

            // Round to half pixel offsets odd widths for crisp lines
            ox = Math.round(ox * 2.0) * 0.5;
            oy = Math.round(oy * 2.0) * 0.5;

            this.lines_layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
            const lines_path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            let path_str = "";
            for (let x = 0; x < this.width; ++x) {
                path_str += `M ${ox + x * ss} ${oy} L ${ox + x * ss} ${
                    oy + (this.height - 1) * ss
                } `;
            }
            for (let y = 0; y < this.height; ++y) {
                path_str += `M ${ox} ${oy + y * ss} L ${ox + (this.width - 1) * ss} ${
                    oy + y * ss
                } `;
            }
            lines_path.setAttribute("d", path_str);
            lines_path.setAttribute("stroke", this.theme_line_color);
            if (ss > TINY_SQUARE_SIZE) {
                lines_path.setAttribute("stroke-width", `${line_width.toFixed(0)}px`);
            } else {
                lines_path.setAttribute("stroke-width", `${line_width.toFixed(1)}px`);
            }
            lines_path.setAttribute("stroke-linecap", "square");
            this.lines_layer.appendChild(lines_path);

            // Hoshi / star points
            let hoshi = null;

            if (this.width === 19 && this.height === 19) {
                hoshi = [
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
                hoshi = [
                    [3, 3],
                    [3, 9],
                    [6, 6],
                    [9, 3],
                    [9, 9],
                ];
            }

            if (this.width === 9 && this.height === 9) {
                hoshi = [
                    [2, 2],
                    [2, 6],
                    [4, 4],
                    [6, 2],
                    [6, 6],
                ];
            }

            if (hoshi) {
                const r = this.square_size < 5 ? 0.5 : Math.max(2, this.square_size * 0.075);

                for (let i = 0; i < hoshi.length; ++i) {
                    const [hx, hy] = hoshi[i];
                    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    circle.setAttribute("cx", (ox + hx * ss).toString());
                    circle.setAttribute("cy", (oy + hy * ss).toString());
                    circle.setAttribute("r", `${r.toFixed(1)}px`);
                    circle.setAttribute("fill", this.theme_star_color);
                    this.lines_layer.appendChild(circle);
                }
            }
            this.svg.appendChild(this.lines_layer);
        }
    }

    private drawCoordinateLabels(force_clear?: boolean): void {
        if (force_clear) {
            if (this.coordinate_labels_layer) {
                this.coordinate_labels_layer.remove();
                delete this.coordinate_labels_layer;
            }
        }

        if (!this.coordinate_labels_layer) {
            this.coordinate_labels_layer = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "g",
            );
            this.coordinate_labels_layer.setAttribute("class", "coordinate-labels");

            let text_size = Math.round(this.square_size * 0.5);
            let bold_or_not = "bold";
            if (this.getCoordinateDisplaySystem() === "1-1") {
                text_size *= 0.7;
                bold_or_not = "";

                if (this.height > 20) {
                    text_size *= 0.7;
                }
            }

            const place = (ch: string, x: number, y: number): void => {
                /* places centered (horizontally & vertically) text at x,y */
                const ox = 0;
                const oy = this.square_size / 6;

                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", (x + ox).toFixed(0));
                text.setAttribute("y", (y + oy).toFixed(0));
                text.setAttribute("font-size", `${Math.round(text_size)}px`);
                text.setAttribute("font-size", `${Math.round(text_size)}px`);
                text.setAttribute("font-weight", bold_or_not);
                text.setAttribute("fill", this.theme_board.getLabelTextColor());
                text.textContent = ch;
                this.coordinate_labels_layer!.appendChild(text);
            };
            const v_place = (ch: string, x: number, y: number): void => {
                /* places centered (horizontally & vertically) text at x,y, with text going down vertically. */
                for (let i = 0; i < ch.length; ++i) {
                    //const xx = x - text_size / 2;
                    const H = text_size;
                    const xx = x;
                    let yy = y + text_size / 2.5;

                    if (ch.length === 2) {
                        yy = yy - H * 0.5 + i * H;
                    }
                    if (ch.length === 3) {
                        yy = yy - H * 1 + i * H + 0.5;
                    }

                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("x", xx.toFixed(0));
                    text.setAttribute("y", yy.toFixed(1));
                    text.setAttribute("font-size", `${Math.round(text_size)}px`);
                    text.setAttribute("font-weight", bold_or_not);
                    text.setAttribute("fill", this.theme_board.getLabelTextColor());
                    text.textContent = ch[i];
                    this.coordinate_labels_layer!.appendChild(text);
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

            this.svg.appendChild(this.coordinate_labels_layer);
        }
    }

    protected computeThemeStoneRadius(): number {
        const r = this.square_size * 0.5;
        return Math.max(1, r);
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
                this.parent.style.width = metrics.width + "px";
                this.parent.style.height = metrics.height + "px";
                this.svg.setAttribute("width", metrics.width.toString());
                this.svg.setAttribute("height", metrics.height.toString());

                this.__set_board_width = metrics.width;
                this.__set_board_height = metrics.height;

                this.setTheme(this.getSelectedThemes(), true);
            } catch (e) {
                setTimeout(() => {
                    throw e;
                }, 1);
                return;
            }
        }

        this.drawLines(force_clear);
        this.drawCoordinateLabels(force_clear);

        if (force_clear || !this.grid_layer || !this.shadow_layer) {
            this.shadow_layer?.remove();
            this.shadow_layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
            this.shadow_layer.setAttribute("class", "shadow-layer");
            this.svg.appendChild(this.shadow_layer);

            this.grid_layer?.remove();
            this.grid_layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
            this.grid_layer.setAttribute("class", "grid");
            this.svg.appendChild(this.grid_layer);

            this.clearCells();

            for (let j = 0; j < this.height; ++j) {
                this.grid[j] = [];
                this.shadow_grid[j] = [];
                /*
                for (let i = 0; i < this.width; ++i) {
                    const cell = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    cell.setAttribute("x", (i * this.square_size).toString());
                    cell.setAttribute("y", (j * this.square_size).toString());
                    cell.setAttribute("width", this.square_size.toString());
                    cell.setAttribute("height", this.square_size.toString());
                    this.grid_layer.appendChild(cell);

                    this.grid[j][i] = cell;
                }
                */
            }
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

        for (let j = this.bounds.top; j <= this.bounds.bottom; ++j) {
            for (let i = this.bounds.left; i <= this.bounds.right; ++i) {
                this.drawSquare(i, j);
            }
        }

        if (this.pen_marks) {
            if (force_clear) {
                this.detachPenLayer();
            }
            this.drawPenMarks(this.pen_marks);
        }
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
            this.message_div.remove();
            delete this.message_div;
        }
        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            delete this.message_timeout;
        }

        this.emit("clear-message");
    }

    protected generateSvgDefs(radius: number): SVGDefsElement {
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const themes = this.themes;

        if (!(themes.white in __theme_cache.white)) {
            __theme_cache.white[themes.white] = {};
        }
        if (!(themes.black in __theme_cache.black)) {
            __theme_cache.black[themes.black] = {};
        }

        this.theme_black.preRenderShadowSVG(defs, "black");
        this.theme_white.preRenderShadowSVG(defs, "white");

        __theme_cache.white[themes.white][radius] = this.theme_white.preRenderWhiteSVG(
            defs,
            radius,
            23434,
            () => {},
        );
        __theme_cache.black[themes.black][radius] = this.theme_black.preRenderBlackSVG(
            defs,
            radius,
            2081,
            () => {},
        );

        return defs;
    }

    protected setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void {
        if (this.no_display) {
            console.log("No display");
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

        /*
        const deferredRenderCallback = () => {
            this.redraw(true);
            this.move_tree_redraw();
        };
        */

        try {
            this.svg_defs?.remove();
            this.svg_defs = this.generateSvgDefs(this.theme_stone_radius);
            this.svg.appendChild(this.svg_defs);

            if (this.move_tree_svg) {
                this.move_tree_svg_defs?.remove();
                this.move_tree_svg_defs = this.generateSvgDefs(MoveTree.stone_radius);
                this.move_tree_svg.appendChild(this.move_tree_svg_defs);
            }
        } catch (e) {
            console.error(`Error pre-rendering stones.`, {
                themes,
                move_tree_stone_radius: MoveTree.stone_radius,
            });
            throw e;
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
        const pos = getRelativeEventPosition(ev, this.parent);
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
        const pos = getRelativeEventPosition(ev, this.parent);
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
            this.move_tree_svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

            if (USE_SHADOW_DOM) {
                const shadow_root =
                    this.move_tree_inner_container.shadowRoot ??
                    this.move_tree_inner_container.attachShadow({ mode: "open" });
                shadow_root.appendChild(this.move_tree_svg);
                const sheet = new CSSStyleSheet();
                if (sheet?.replaceSync) {
                    sheet.replaceSync(`text {
                    font-family: Verdana, Arial, sans-serif;
                    text-anchor: middle;
                    font-weight: bold;
                    user-select: none;
                }`);
                }
                shadow_root.adoptedStyleSheets = [sheet];
            } else {
                this.move_tree_inner_container.appendChild(this.move_tree_svg);
            }

            this.move_tree_svg_defs = this.generateSvgDefs(MoveTree.stone_radius);
            this.move_tree_container.appendChild(this.move_tree_inner_container);
            this.move_tree_bindEvents(this.move_tree_svg);
            this.move_tree_container.style.position = "relative";
            this.move_tree_svg.style.position = "absolute";
            this.move_tree_svg.appendChild(this.move_tree_svg_defs);

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

        if (!this.move_tree_svg) {
            console.warn(`move_tree_redraw called without move_tree_svg set`);
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

        if (
            this.move_tree_svg.clientWidth !== this.move_tree_container.clientWidth ||
            this.move_tree_svg.clientHeight !== this.move_tree_container.clientHeight
        ) {
            this.move_tree_svg.setAttribute(
                "width",
                this.move_tree_container.clientWidth.toString(),
            );
            this.move_tree_svg.setAttribute(
                "height",
                this.move_tree_container.clientHeight.toString(),
            );
        }

        this.engine.move_tree.recomputeIsobranches();
        const active_path_end = this.engine.cur_move;

        this.engine.move_tree_layout_dirty = false;

        active_path_end.setActivePath(++MoveTree.active_path_number);

        //const canvas = this.move_tree_canvas;
        const svg = this.move_tree_svg;
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

        svg.style.top = div_scroll_top + "px";
        svg.style.left = div_scroll_left + "px";

        const viewport = {
            offset_x: div_scroll_left,
            offset_y: div_scroll_top,
            minx: div_scroll_left - MoveTree.stone_square_size,
            miny: div_scroll_top - MoveTree.stone_square_size,
            maxx: div_scroll_left + div_clientWidth + MoveTree.stone_square_size,
            maxy: div_scroll_top + div_clientHeight + MoveTree.stone_square_size,
        };

        svg.innerHTML = "";
        if (this.move_tree_svg_defs) {
            svg.appendChild(this.move_tree_svg_defs);
        }

        this.move_tree_hilightNode(svg, active_path_end, "#6BAADA", viewport);

        if (engine.cur_review_move && engine.cur_review_move.id !== active_path_end.id) {
            this.move_tree_hilightNode(svg, engine.cur_review_move, "#6BDA6B", viewport);
        }

        this.move_tree_recursiveDrawPath(svg, this.engine.move_tree, viewport);

        this.move_tree_drawRecursive(
            svg,
            this.engine.move_tree,
            MoveTree.active_path_number,
            viewport,
        );
    }
    public move_tree_bindEvents(svg: SVGElement): void {
        const handler = (event: TouchEvent | MouseEvent) => {
            try {
                if (!this.move_tree_container) {
                    throw new Error(`move_tree_container was not set`);
                }

                const ox = this.move_tree_container.scrollLeft;
                const oy = this.move_tree_container.scrollTop;
                const pos = getRelativeEventPosition(event, this.move_tree_container);
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
                        const rpos = getRelativeEventPosition(event, this.move_tree_container);
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

        svg.addEventListener("touchstart", handler);
        svg.addEventListener("mousedown", handler);

        this.on("destroy", () => {
            svg.removeEventListener("touchstart", handler);
            svg.removeEventListener("mousedown", handler);
        });
    }

    move_tree_drawStone(
        svg: SVGElement,
        node: MoveTree,
        active_path_number: number,
        viewport: MoveTreeViewPortInterface,
    ): void {
        const stone_idx = node.move_number * 31;
        const cx = node.layout_cx - viewport.offset_x;
        const cy = node.layout_cy - viewport.offset_y;
        const color = node.player;
        const on_path = node.active_path_number === active_path_number;
        const r = MoveTree.stone_radius;

        const cell = document.createElementNS("http://www.w3.org/2000/svg", "g");
        svg.appendChild(cell);
        if (!on_path) {
            cell.setAttribute("class", "move-tree-stone");
            cell.setAttribute("fill-opacity", "0.6");
            cell.setAttribute("stroke-opacity", "0.6");
            cell.setAttribute("opacity", "0.6");
        }

        const theme_white_stones = __theme_cache.white[this.themes.white][r];
        const theme_black_stones = __theme_cache.black[this.themes.black][r];

        if (!theme_white_stones || !theme_black_stones) {
            throw new Error(
                "Failed to load stone images for given radius" + this.theme_stone_radius,
            );
        }

        if (color === 1) {
            const stone = theme_black_stones[stone_idx % theme_black_stones.length];
            this.theme_black.placeBlackStoneSVG(cell, undefined, stone, cx, cy, r);
        } else if (color === 2) {
            const stone = theme_white_stones[stone_idx % theme_white_stones.length];
            this.theme_white.placeWhiteStoneSVG(cell, undefined, stone, cx, cy, r);
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

        const font_size = 10;
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", cx.toFixed(0));
        text.setAttribute("y", (cy + font_size / 8).toFixed(1));
        text.setAttribute("width", MoveTree.stone_square_size.toFixed(1));
        text.setAttribute("height", MoveTree.stone_square_size.toFixed(1));
        text.setAttribute("font-size", `${font_size}px`);
        text.setAttribute("font-weight", "bold");
        text.setAttribute("alignment-baseline", "middle");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("fill", text_color);
        text.textContent = node.label;

        cell.appendChild(text);

        const ring_color = node.text
            ? "#3333ff"
            : node.correct_answer
              ? "#33ff33"
              : node.wrong_answer
                ? "#ff3333"
                : null;

        if (ring_color) {
            const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            ring.setAttribute("cx", cx.toFixed(0));
            ring.setAttribute("cy", cy.toFixed(1));
            ring.setAttribute("r", r.toFixed(0));
            ring.setAttribute("fill", "none");
            ring.setAttribute("stroke", ring_color);
            ring.setAttribute("stroke-width", "2");
            cell.appendChild(ring);
        }
    }
    move_tree_drawRecursive(
        svg: SVGElement,
        node: MoveTree,
        active_path_number: number,
        viewport: MoveTreeViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.move_tree_drawRecursive(svg, node.trunk_next, active_path_number, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.move_tree_drawRecursive(svg, node.branches[i], active_path_number, viewport);
        }

        if (
            !viewport ||
            (node.layout_cx >= viewport.minx &&
                node.layout_cx <= viewport.maxx &&
                node.layout_cy >= viewport.miny &&
                node.layout_cy <= viewport.maxy)
        ) {
            this.move_tree_drawStone(svg, node, active_path_number, viewport);
        }
    }
    move_tree_hilightNode(
        svg: SVGElement,
        node: MoveTree,
        color: string,
        viewport: MoveTreeViewPortInterface,
    ): void {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const sx =
            Math.round(node.layout_cx - MoveTree.stone_square_size * 0.5) - viewport.offset_x;
        const sy =
            Math.round(node.layout_cy - MoveTree.stone_square_size * 0.5) - viewport.offset_y;
        rect.setAttribute("x", sx.toFixed(0));
        rect.setAttribute("y", sy.toFixed(0));
        rect.setAttribute("width", MoveTree.stone_square_size.toFixed(0));
        rect.setAttribute("height", MoveTree.stone_square_size.toFixed(0));
        rect.setAttribute("fill", color);
        svg.appendChild(rect);
    }

    move_tree_drawPath(svg: SVGElement, node: MoveTree, viewport: MoveTreeViewPortInterface): void {
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

            const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const ox = viewport.offset_x;
            const oy = viewport.offset_y;
            curve.setAttribute(
                "d",
                `M ${node.parent.layout_cx - ox} ${node.parent.layout_cy - oy} Q ${
                    node.layout_cx - MoveTree.stone_square_size * 0.5 - ox
                } ${node.layout_cy - oy} ${node.layout_cx - ox} ${node.layout_cy - oy}`,
            );
            curve.setAttribute("fill", "none");
            curve.setAttribute(
                "stroke",
                node.trunk ? "#000000" : MoveTree.line_colors[node.line_color],
            );
            curve.setAttribute("stroke-width", "1");
            svg.appendChild(curve);
        }
    }
    move_tree_drawIsoBranchTo(
        svg: SVGElement,
        from_node: MoveTree,
        to_node: MoveTree,
        viewport: MoveTreeViewPortInterface,
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

        if (
            B.trunk_next === null &&
            B.branches.length === 0 &&
            (A.trunk_next !== null || A.branches.length !== 0)
        ) {
            const t = A;
            A = B;
            B = t;
        }

        const strong =
            A.trunk_next == null &&
            A.branches.length === 0 &&
            (B.trunk_next !== null || B.branches.length !== 0);

        const ox = viewport.offset_x;
        const oy = viewport.offset_y;

        const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const my = strong ? B.layout_cy : (A.layout_cy + B.layout_cy) / 2;
        const mx = (A.layout_cx + B.layout_cx) / 2 + MoveTree.stone_square_size * 0.5;
        curve.setAttribute(
            "d",
            `M ${B.layout_cx - ox} ${B.layout_cy - oy} Q ${mx - ox} ${my - oy} ${
                A.layout_cx - ox
            } ${A.layout_cy - oy}`,
        );
        curve.setAttribute("fill", "none");
        curve.setAttribute("stroke", MoveTree.isobranch_colors[strong ? "strong" : "weak"]);
        curve.setAttribute("stroke-width", "2");
        svg.appendChild(curve);
    }
    move_tree_recursiveDrawPath(
        svg: SVGElement,
        node: MoveTree,
        viewport: MoveTreeViewPortInterface,
    ): void {
        if (node.trunk_next) {
            this.move_tree_recursiveDrawPath(svg, node.trunk_next, viewport);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            this.move_tree_recursiveDrawPath(svg, node.branches[i], viewport);
        }

        if (node.isobranches) {
            for (let i = 0; i < node.isobranches.length; ++i) {
                this.move_tree_drawIsoBranchTo(svg, node, node.isobranches[i], viewport);
            }
        }

        this.move_tree_drawPath(svg, node, viewport);
    }
}

class GCell {
    renderer: SVGRenderer;
    i: number;
    j: number;
    _g?: SVGGraphicsElement;
    _transform: string = "";

    constructor(renderer: SVGRenderer, i: number, j: number) {
        this.renderer = renderer;
        this.i = i;
        this.j = j;
    }

    public get g(): SVGGraphicsElement {
        if (!this._g) {
            this._g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            if (this._transform) {
                this.g.setAttribute("transform", this._transform);
            }
            this.renderer.grid_layer!.appendChild(this._g);
        }
        return this._g;
    }

    public set transform(transform: string) {
        if (this._transform === transform) {
            return;
        }

        this._transform = transform;

        if (!this._g) {
            // be lazy if we haven't already created the g element
            return;
        }

        this.g.setAttribute("transform", transform);

        if (this.last_stone_shadow) {
            this.last_stone_shadow.setAttribute("transform", transform);
        }
    }

    public get transform(): string {
        return this._transform;
    }

    /*
     * Faded intersection lines
     */
    private last_faded_lines?: SVGPathElement;
    private last_faded_star_point?: SVGCircleElement;

    public drawFadedIntersectionLines(draw_star_point: boolean, star_radius: number): void {
        if (this.last_faded_lines) {
            return;
        }

        const mid = this.renderer.metrics.mid;
        const ss = this.renderer.square_size;
        const offset = this.renderer.metrics.offset;
        const width = this.renderer.width;
        const height = this.renderer.height;

        let sx = 0;
        let ex = ss;
        const mx = ss / 2 - offset;
        let sy = 0;
        let ey = ss;
        const my = ss / 2 - offset;

        if (this.i === 0) {
            sx += mid;
        }
        if (this.i === width - 1) {
            ex -= mid;
        }
        if (this.j === 0) {
            sy += mid;
        }
        if (this.j === height - 1) {
            ey -= mid;
        }

        if (this.i === width - 1 && this.j === height - 1) {
            if (mx === ex && my === ey) {
                ex += 1;
                ey += 1;
            }
        }

        const cx = mid;
        const cy = mid;

        const g = this.g;

        if (draw_star_point) {
            const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            this.last_faded_star_point = circ;
            circ.setAttribute("cx", cx.toString());
            circ.setAttribute("cy", cy.toString());
            circ.setAttribute("r", star_radius.toString());
            circ.setAttribute("fill", this.renderer.theme_faded_star_color);
            g.prepend(circ);
        }

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        this.last_faded_lines = path;
        path.setAttribute("stroke", this.renderer.theme_faded_line_color);
        path.setAttribute("stroke-width", this.renderer.square_size < 5 ? "0.2" : "1");
        path.setAttribute("fill", "none");
        path.setAttribute(
            "d",
            `
                M ${Math.floor(sx)} ${my} L ${Math.floor(ex)} ${my}
                M ${mx} ${Math.floor(sy)} L ${mx} ${Math.floor(ey)} 
            `,
        );
        g.prepend(path);
    }

    public clearFadedLines(): void {
        if (this.last_faded_lines) {
            this.last_faded_lines.remove();
            delete this.last_faded_lines;
        }
        if (this.last_faded_star_point) {
            this.last_faded_star_point.remove();
            delete this.last_faded_star_point;
        }
    }

    /*
     * Heatmap
     */
    private last_heatmap_value?: number;
    private last_heatmap_rect?: SVGRectElement;

    public heatmap(value: number): void {
        if (this.last_heatmap_value === value) {
            return;
        }

        if (!this.last_heatmap_rect) {
            const mid = this.renderer.metrics.mid;
            const ss = this.renderer.square_size;
            const cx = mid;
            const cy = mid;
            const color = "#00FF00";
            const r = Math.floor(ss * 0.5) - 0.5;
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            this.last_heatmap_rect = rect;
            rect.setAttribute("x", (cx - r).toFixed(1));
            rect.setAttribute("y", (cy - r).toFixed(1));
            rect.setAttribute("width", (r * 2).toFixed(1));
            rect.setAttribute("height", (r * 2).toFixed(1));
            this.last_heatmap_rect.setAttribute("fill", color);
            this.g.appendChild(this.last_heatmap_rect);
        }

        this.last_heatmap_value = value;
        this.last_heatmap_rect.setAttribute("fill-opacity", Math.min(value, 0.5).toFixed(2));
    }
    public clearHeatmap(): void {
        if (this.last_heatmap_rect) {
            this.last_heatmap_rect.remove();
            delete this.last_heatmap_rect;
            this.last_heatmap_value = undefined;
        }
    }

    /*
     * Highlights
     */

    private last_highlight_color?: string;
    private last_highlight_rect?: SVGRectElement;
    public highlight(color: string): void {
        if (this.last_highlight_color === color) {
            return;
        }

        if (!this.last_highlight_rect) {
            const mid = this.renderer.metrics.mid;
            const ss = this.renderer.square_size;
            const cx = mid;
            const cy = mid;
            const r = Math.floor(ss * 0.5) - 0.5;
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            this.last_highlight_rect = rect;
            rect.setAttribute("x", (cx - r).toFixed(1));
            rect.setAttribute("y", (cy - r).toFixed(1));
            rect.setAttribute("width", (r * 2).toFixed(1));
            rect.setAttribute("height", (r * 2).toFixed(1));
            rect.setAttribute("fill-opacity", "0.6");
            this.g.appendChild(rect);
        }

        this.last_highlight_rect.setAttribute("fill", color);
        this.last_highlight_color = color;
    }
    public clearHighlight(): void {
        if (this.last_highlight_rect) {
            this.last_highlight_rect.remove();
            delete this.last_highlight_rect;
            this.last_highlight_color = undefined;
        }
    }

    /*
     * Colored circles
     */
    private last_circle?: SVGCircleElement;
    private last_circle_fill?: string;
    private last_circle_radius?: number;
    private last_circle_stroke?: string;
    private last_circle_stroke_width?: number;
    public circle(circle: ColoredCircle): void {
        const ss = this.renderer.square_size;
        const radius = Math.floor(ss * 0.5) - 0.5;

        if (!this.last_circle) {
            const mid = this.renderer.metrics.mid;
            const cx = mid;
            const cy = mid;

            const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            this.last_circle = circ;
            circ.setAttribute("class", "colored-circle");
            circ.setAttribute("cx", cx.toString());
            circ.setAttribute("cy", cy.toString());
            this.g.appendChild(circ);
        }

        if (this.last_circle_fill !== circle.color) {
            this.last_circle.setAttribute("fill", circle.color);
            this.last_circle_fill = circle.color;
        }
        if (this.last_circle_stroke !== circle.border_color) {
            if (circle.border_color) {
                this.last_circle.setAttribute("stroke", circle.border_color);
            } else {
                this.last_circle.removeAttribute("stroke");
            }
            this.last_circle_stroke = circle.border_color;
        }

        let lineWidth = radius * (circle.border_width || 0.1);
        if (lineWidth < 0.3) {
            lineWidth = 0;
        }

        if (this.last_circle_stroke_width !== circle.border_width) {
            if (lineWidth > 0) {
                this.last_circle.setAttribute("stroke-width", lineWidth.toFixed(1));
            } else {
                this.last_circle.setAttribute("stroke-width", "1px");
            }
            this.last_circle_stroke_width = circle.border_width;
        }
        if (this.last_circle_radius !== radius) {
            this.last_circle.setAttribute("r", Math.max(0.1, radius - lineWidth / 2).toString());
            this.last_circle_radius = radius;
        }
    }
    public clearCircle(): void {
        if (this.last_circle) {
            this.last_circle.remove();
            delete this.last_circle;
            delete this.last_circle_fill;
            delete this.last_circle_radius;
            delete this.last_circle_stroke;
            delete this.last_circle_stroke_width;
        }
    }

    /*
     * Stone
     */
    private last_stone?: SVGElement;
    private last_stone_color?: JGOFNumericPlayerColor;
    private last_stone_transparent?: boolean;
    private last_stone_stone?: string;
    private last_stone_radius?: number;
    private last_stone_alpha_value?: number;
    private last_stone_shadow?: SVGElement;

    public stone(
        color: JGOFNumericPlayerColor,
        transparent: boolean,
        stone: string,
        radius: number,
        stone_alpha_value: number,
    ): void {
        if (
            this.last_stone &&
            this.last_stone_color === color &&
            this.last_stone_transparent === transparent &&
            this.last_stone_stone === stone &&
            this.last_stone_radius === radius &&
            this.last_stone_alpha_value === stone_alpha_value
        ) {
            return;
        }

        this.clearStone();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        // TODO: Need to handle shadows
        const [elt, shadow] =
            color === JGOFNumericPlayerColor.BLACK
                ? this.renderer.theme_black.placeBlackStoneSVG(
                      this.g,
                      transparent ? undefined : this.renderer.shadow_layer,
                      stone,
                      cx,
                      cy,
                      radius,
                  )
                : this.renderer.theme_black.placeWhiteStoneSVG(
                      this.g,
                      transparent ? undefined : this.renderer.shadow_layer,
                      stone,
                      cx,
                      cy,
                      radius,
                  );
        if (this.last_stone_shadow) {
            this.last_stone_shadow.remove();
        }
        this.last_stone_shadow = shadow;
        if (this.last_stone_shadow) {
            this.last_stone_shadow.setAttribute("transform", this.transform);
        }

        if (transparent) {
            elt.setAttribute("opacity", stone_alpha_value.toString());
        }

        this.last_stone = elt;
        this.last_stone_color = color;
        this.last_stone_transparent = transparent;
        this.last_stone_stone = stone;
        this.last_stone_radius = radius;
        this.last_stone_alpha_value = stone_alpha_value;
    }
    public clearStone(): void {
        if (this.last_stone) {
            this.last_stone.remove();
            delete this.last_stone;
        }
        if (this.last_stone_shadow) {
            this.last_stone_shadow.remove();
            delete this.last_stone_shadow;
        }
    }

    /*
     * Blue move
     */
    private last_blue_move?: SVGCircleElement;
    private last_blue_move_color?: string;
    private last_blue_move_border_width?: number;

    public blueMove(color: string, border_width: number) {
        if (
            this.last_blue_move &&
            this.last_blue_move_color === color &&
            this.last_blue_move_border_width === border_width
        ) {
            return;
        }

        this.clearBlueMove();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;

        const radius = Math.floor(ss * 0.5) - 0.5;
        let lineWidth = radius * (border_width || 0.1);
        if (lineWidth < 0.3) {
            lineWidth = 0;
        }

        const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circ.setAttribute("class", "colored-circle");
        circ.setAttribute("stroke", color);
        if (lineWidth > 0) {
            circ.setAttribute("stroke-width", `${lineWidth.toFixed(1)}px`);
        } else {
            circ.setAttribute("stroke-width", "1px");
        }
        circ.setAttribute("fill", "none");
        circ.setAttribute("cx", cx.toString());
        circ.setAttribute("cy", cy.toString());
        circ.setAttribute("r", Math.max(0.1, radius - lineWidth / 2).toString());
        this.g.appendChild(circ);
        this.last_blue_move = circ;
        this.last_blue_move_color = color;
        this.last_blue_move_border_width = border_width;
    }
    public clearBlueMove() {
        if (this.last_blue_move) {
            this.last_blue_move.remove();
            delete this.last_blue_move;
        }
    }

    /*
     * Cross
     */
    private last_removal_cross?: SVGPathElement;
    private last_removal_cross_fill?: string;
    private last_removal_cross_radius?: number;
    private last_removal_cross_opacity?: number;

    public removalCross(fill: string, radius: number, opacity: number) {
        if (
            this.last_removal_cross &&
            this.last_removal_cross_fill === fill &&
            this.last_removal_cross_radius === radius &&
            this.last_removal_cross_opacity === opacity
        ) {
            return;
        }

        this.clearRemovalCross();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;
        const r = radius;

        const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
        cross.setAttribute("class", "removal-cross");
        cross.setAttribute("fill", fill);

        /* four dagger tip points with a square in the center. Start at top left going clockwise*/
        const dx = r * 0.25; // tip width
        const ir = r * 0.3; // inner radius for our box
        const ir_dx = ir * 0.4; // offset to where our daggers meet the box

        // prettier-ignore
        const points = [
                /* top half */
                -r          , -r          ,
                -r + dx     , -r          ,
                -ir + ir_dx , -ir - ir_dx ,
                ir - ir_dx  , -ir - ir_dx ,
                r - dx      , -r          ,
                r           , -r          ,

                /* right half */
                r          , -r + dx     ,
                ir + ir_dx , -ir + ir_dx ,
                ir + ir_dx , ir - ir_dx  ,
                r          , r - dx      ,
                r          , r           ,

                /* bottom half */
                r - dx      , r          ,
                ir - ir_dx  , ir + ir_dx ,
                -ir + ir_dx , ir + ir_dx ,
                -r + dx     , r          ,
                -r          , r          ,

                /* left half */
                -r          , r - dx      ,
                -ir - ir_dx , ir - ir_dx  ,
                -ir - ir_dx , -ir + ir_dx ,
                -r          , -r + dx     ,
                //-r          , -r          ,
            ];

        const path =
            points
                .map((v, i) => {
                    return (i % 2 === 0 ? (i === 0 ? "M" : "L") : " ") + v;
                })
                .join(" ") + " Z";

        cross.setAttribute("stroke", "#888888");
        cross.setAttribute("stroke-width", `${ss * 0.0275}px`);
        cross.setAttribute("d", path);
        cross.setAttribute("stroke-opacity", opacity.toString());
        cross.setAttribute("transform", `translate(${cx}, ${cy})`);

        this.g.appendChild(cross);

        this.last_removal_cross = cross;
        this.last_removal_cross_fill = fill;
        this.last_removal_cross_radius = radius;
        this.last_removal_cross_opacity = opacity;
    }

    public clearRemovalCross() {
        if (this.last_removal_cross) {
            this.last_removal_cross.remove();
            delete this.last_removal_cross;
            delete this.last_removal_cross_fill;
            delete this.last_removal_cross_radius;
            delete this.last_removal_cross_opacity;
        }
    }

    /*
     * Score
     */
    private last_score?: SVGRectElement;
    private last_score_fill?: string;
    private last_score_stroke?: string;
    private last_score_opacity?: number;

    public score(fill: string, stroke: string, opacity: number): void {
        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;

        if (
            this.last_score &&
            this.last_score_fill === fill &&
            this.last_score_stroke === stroke &&
            this.last_score_opacity === opacity
        ) {
            return;
        }

        this.clearScore();

        const r = ss * 0.15;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", (cx - r).toFixed(1));
        rect.setAttribute("y", (cy - r).toFixed(1));
        rect.setAttribute("width", (r * 2).toFixed(1));
        rect.setAttribute("height", (r * 2).toFixed(1));
        rect.setAttribute("stroke-width", (Math.ceil(ss * 0.065) - 0.5).toFixed(1));

        rect.setAttribute("fill", fill);
        rect.setAttribute("stroke", stroke);
        if (opacity < 1) {
            rect.setAttribute("fill-opacity", opacity.toString());
        }

        this.g.appendChild(rect);

        this.last_score = rect;
        this.last_score_fill = fill;
        this.last_score_stroke = stroke;
        this.last_score_opacity = opacity;
    }

    public clearScore(): void {
        if (this.last_score) {
            this.last_score.remove();
            delete this.last_score;
            delete this.last_score_fill;
            delete this.last_score_stroke;
            delete this.last_score_opacity;
        }
    }

    /*
     * Letter markings
     */
    private last_letter?: SVGTextElement;
    private last_letter_letter?: string;
    private last_letter_color?: string;
    private last_letter_font_size?: number;
    private last_letter_opacity?: number;
    private last_letter_room_for_subscript?: boolean;

    public letter(
        letter: string,
        color: string,
        font_size: number,
        opacity: number,
        room_for_subscript: boolean,
    ): void {
        if (
            this.last_letter &&
            this.last_letter_letter === letter &&
            this.last_letter_color === color &&
            this.last_letter_font_size === font_size &&
            this.last_letter_opacity === opacity &&
            this.last_letter_room_for_subscript === room_for_subscript
        ) {
            // if we already have an element here but we are not currently the
            // last element, move ourselves to the end of the list
            if (this.last_letter.nextSibling) {
                this.g.appendChild(this.last_letter);
            }

            return;
        }

        this.clearLetter();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "letter");
        text.setAttribute("fill", color);
        text.setAttribute("font-size", `${font_size}px`);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("x", cx.toString());

        // Adjust the y-coordinate to account for vertical centering based on the font size
        let yy = cy + font_size * 0.35;
        if (room_for_subscript) {
            yy -= ss * 0.15;
        }

        text.setAttribute("y", yy.toString());
        text.textContent = letter;
        if (opacity < 1) {
            text.setAttribute("fill-opacity", opacity.toString());
        }
        this.g.appendChild(text);

        this.last_letter = text;
        this.last_letter_letter = letter;
        this.last_letter_color = color;
        this.last_letter_font_size = font_size;
        this.last_letter_opacity = opacity;
        this.last_letter_room_for_subscript = room_for_subscript;
    }

    public clearLetter(): void {
        if (this.last_letter) {
            this.last_letter.remove();
            delete this.last_letter;
            delete this.last_letter_letter;
            delete this.last_letter_color;
            delete this.last_letter_font_size;
            delete this.last_letter_opacity;
            delete this.last_letter_room_for_subscript;
        }
    }

    /*
     * Subscript markings
     */
    private last_subscript?: SVGTextElement;
    private last_subscript_subscript?: string;
    private last_subscript_color?: string;
    private last_subscript_font_size?: number;
    private last_subscript_opacity?: number;
    private last_subscript_room_for_letter?: boolean;
    private last_subscript_room_for_sub_triangle?: boolean;

    public subscript(
        subscript: string,
        color: string,
        font_size: number,
        opacity: number,
        room_for_letter: boolean,
        room_for_sub_triangle: boolean,
    ): void {
        if (
            this.last_subscript &&
            this.last_subscript_subscript === subscript &&
            this.last_subscript_color === color &&
            this.last_subscript_font_size === font_size &&
            this.last_subscript_opacity === opacity &&
            this.last_subscript_room_for_letter === room_for_letter &&
            this.last_subscript_room_for_sub_triangle === room_for_sub_triangle
        ) {
            return;
        }

        this.clearSubscript();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("class", "subscript");
        text.setAttribute("fill", color);

        text.setAttribute("font-size", `${font_size}px`);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("x", cx.toString());

        // Adjust baseline based on the provided font size
        let yy = cy + font_size * 0.3;

        if (room_for_letter) {
            yy += ss * 0.3;
        }

        if (room_for_sub_triangle) {
            yy -= ss * 0.08;
        }

        text.setAttribute("y", yy.toString());
        text.textContent = subscript;

        if (opacity < 1) {
            text.setAttribute("fill-opacity", opacity.toString());
        }
        this.g.appendChild(text);

        this.last_subscript = text;
        this.last_subscript_subscript = subscript;
        this.last_subscript_color = color;
        this.last_subscript_font_size = font_size;
        this.last_subscript_opacity = opacity;
        this.last_subscript_room_for_letter = room_for_letter;
        this.last_subscript_room_for_sub_triangle = room_for_sub_triangle;
    }

    public clearSubscript(): void {
        if (this.last_subscript) {
            this.last_subscript.remove();
            delete this.last_subscript;
            delete this.last_subscript_subscript;
            delete this.last_subscript_color;
            delete this.last_subscript_font_size;
            delete this.last_subscript_opacity;
            delete this.last_subscript_room_for_letter;
            delete this.last_subscript_room_for_sub_triangle;
        }
    }

    /*
     * Symbols
     */
    private last_circle_symbol?: SVGCircleElement;
    private last_circle_symbol_color?: string;
    private last_circle_symbol_opacity?: number;

    public circleSymbol(color: string, opacity: number): void {
        if (
            this.last_circle_symbol &&
            this.last_circle_symbol_color === color &&
            this.last_circle_symbol_opacity === opacity
        ) {
            return;
        }

        this.clearCircleSymbol();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size * this.renderer.stone_font_scale;

        const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circ.setAttribute("class", "circle");
        circ.setAttribute("fill", "none");
        circ.setAttribute("stroke", color);
        circ.setAttribute("stroke-width", `${ss * 0.075}px`);
        circ.setAttribute("cx", cx.toString());
        circ.setAttribute("cy", cy.toString());
        circ.setAttribute(
            "r",
            Math.max(
                0.1,
                ss * this.renderer.circle_radius * this.renderer.stone_font_scale,
            ).toFixed(2),
        );
        if (opacity < 1.0) {
            circ.setAttribute("stroke-opacity", opacity.toString());
        }
        this.g.appendChild(circ);

        this.last_circle_symbol = circ;
        this.last_circle_symbol_color = color;
        this.last_circle_symbol_opacity = opacity;
    }

    public clearCircleSymbol(): void {
        if (this.last_circle_symbol) {
            this.last_circle_symbol.remove();
            delete this.last_circle_symbol;
            delete this.last_circle_symbol_color;
            delete this.last_circle_symbol_opacity;
        }
    }

    private last_triangle_symbol?: SVGPathElement;
    private last_triangle_symbol_color?: string;
    private last_triangle_symbol_opacity?: number;
    private last_triangle_symbol_as_subscript?: boolean;

    public triangleSymbol(color: string, opacity: number, as_subscript: boolean): void {
        if (
            this.last_triangle_symbol &&
            this.last_triangle_symbol_color === color &&
            this.last_triangle_symbol_opacity === opacity &&
            this.last_triangle_symbol_as_subscript === as_subscript
        ) {
            return;
        }

        this.clearTriangleSymbol();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size;

        let scale = 1.0 * this.renderer.stone_font_scale;
        let oy = 0.0;
        let line_width = ss * 0.075 * scale;
        if (as_subscript) {
            scale = 0.5 * scale;
            oy = ss * 0.3;
            opacity = 1.0;
            line_width *= 0.5;
        }

        const triangle = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        triangle.setAttribute("class", "triangle");
        triangle.setAttribute("fill", "none");
        triangle.setAttribute("stroke", color);
        triangle.setAttribute("stroke-width", `${line_width}px`);
        const r = ss * 0.3 * scale;
        let theta = -(Math.PI * 2) / 4;
        const points = [];
        points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
        theta += (Math.PI * 2) / 3;
        points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
        theta += (Math.PI * 2) / 3;
        points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
        theta += (Math.PI * 2) / 3;
        points.push([cx + r * Math.cos(theta), cy + oy + r * Math.sin(theta)]);
        triangle.setAttribute(
            "points",
            points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" "),
        );
        if (opacity < 1.0) {
            triangle.setAttribute("stroke-opacity", opacity.toString());
        }
        this.g.appendChild(triangle);

        this.last_triangle_symbol = triangle;
        this.last_triangle_symbol_color = color;
        this.last_triangle_symbol_opacity = opacity;
        this.last_triangle_symbol_as_subscript = as_subscript;
    }

    public clearTriangleSymbol(): void {
        if (this.last_triangle_symbol) {
            this.last_triangle_symbol.remove();
            delete this.last_triangle_symbol;
            delete this.last_triangle_symbol_color;
            delete this.last_triangle_symbol_opacity;
            delete this.last_triangle_symbol_as_subscript;
        }
    }

    /*
     * Cross
     */

    private last_cross_symbol?: SVGPathElement;
    private last_cross_symbol_color?: string;
    private last_cross_symbol_opacity?: number;

    public crossSymbol(color: string, opacity: number): void {
        if (
            this.last_cross_symbol &&
            this.last_cross_symbol_color === color &&
            this.last_cross_symbol_opacity === opacity
        ) {
            return;
        }

        this.clearCrossSymbol();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size * this.renderer.stone_font_scale;
        const r = Math.max(1, mid * 0.35 * this.renderer.stone_font_scale);

        const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
        cross.setAttribute("class", "cross");
        cross.setAttribute("fill", "none");
        cross.setAttribute("stroke", color);
        cross.setAttribute("stroke-width", `${ss * 0.075}px`);
        if (opacity < 1.0) {
            cross.setAttribute("stroke-opacity", opacity.toString());
        }
        cross.setAttribute(
            "d",
            `
                M ${cx - r} ${cy - r}
                L ${cx + r} ${cy + r}
                M ${cx + r} ${cy - r}
                L ${cx - r} ${cy + r}
            `,
        );
        this.g.appendChild(cross);

        this.last_cross_symbol = cross;
        this.last_cross_symbol_color = color;
        this.last_cross_symbol_opacity = opacity;
    }

    public clearCrossSymbol(): void {
        if (this.last_cross_symbol) {
            this.last_cross_symbol.remove();
            delete this.last_cross_symbol;
            delete this.last_cross_symbol_color;
            delete this.last_cross_symbol_opacity;
        }
    }

    /*
     * Square
     */
    private last_square_symbol?: SVGRectElement;
    private last_square_symbol_color?: string;
    private last_square_symbol_opacity?: number;

    public squareSymbol(color: string, opacity: number): void {
        if (
            this.last_square_symbol &&
            this.last_square_symbol_color === color &&
            this.last_square_symbol_opacity === opacity
        ) {
            return;
        }

        this.clearSquareSymbol();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size * this.renderer.stone_font_scale;
        const r = Math.max(1, mid * 0.4 * this.renderer.stone_font_scale);

        const square = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        square.setAttribute("class", "square");
        square.setAttribute("fill", "none");
        square.setAttribute("stroke", color);
        square.setAttribute("stroke-width", `${ss * 0.075}px`);
        if (opacity < 1.0) {
            square.setAttribute("stroke-opacity", opacity.toString());
        }
        square.setAttribute("x", (cx - r).toFixed(2));
        square.setAttribute("y", (cy - r).toFixed(2));
        square.setAttribute("width", (r * 2).toFixed(2));
        square.setAttribute("height", (r * 2).toFixed(2));
        this.g.appendChild(square);

        this.last_square_symbol = square;
        this.last_square_symbol_color = color;
        this.last_square_symbol_opacity = opacity;
    }

    public clearSquareSymbol(): void {
        if (this.last_square_symbol) {
            this.last_square_symbol.remove();
            delete this.last_square_symbol;
            delete this.last_square_symbol_color;
            delete this.last_square_symbol_opacity;
        }
    }

    /*
     * Last move
     */
    private last_last_move?: SVGElement;
    private last_last_move_symbol?: "+" | "?" | "o";
    private last_last_move_color?: string;
    private last_last_move_opacity?: number;

    public lastMove(symbol: "+" | "?" | "o", color: string, opacity: number): void {
        if (
            this.last_last_move &&
            this.last_last_move_symbol === symbol &&
            this.last_last_move_color === color &&
            this.last_last_move_opacity === opacity
        ) {
            return;
        }

        this.clearLastMove();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size * this.renderer.stone_font_scale;

        switch (symbol) {
            case "+":
                {
                    const r = Math.max(1, mid * 0.35) * 0.8 * this.renderer.stone_font_scale;
                    const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    cross.setAttribute("class", "last-move");
                    cross.setAttribute("stroke", color);
                    cross.setAttribute("stroke-width", `${ss * 0.075}px`);
                    cross.setAttribute("fill", "none");
                    cross.setAttribute(
                        "d",
                        `
                        M ${cx - r} ${cy}
                        L ${cx + r} ${cy}
                        M ${cx} ${cy - r}
                        L ${cx} ${cy + r}
                    `,
                    );
                    this.g.appendChild(cross);
                    this.last_last_move = cross;
                }
                break;

            case "?":
                {
                    const letter = "?";
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("class", "letter");
                    text.setAttribute("fill", color);
                    text.setAttribute("font-size", `${ss * 0.5}px`);
                    text.setAttribute("text-anchor", "middle");
                    text.setAttribute("x", cx.toString());
                    let yy = cy;
                    yy += ss / 6;
                    text.setAttribute("y", yy.toString());
                    text.textContent = letter;
                    this.g.appendChild(text);
                    this.last_last_move = text;
                }
                break;

            case "o":
                {
                    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    let r = ss * this.renderer.last_move_radius * this.renderer.stone_font_scale;
                    if (ss) {
                        r = ss * 0.3;
                    }

                    r = Math.max(0.1, r);
                    circ.setAttribute("class", "last-move");
                    circ.setAttribute("fill", "none");
                    circ.setAttribute("stroke", color);
                    circ.setAttribute("stroke-width", `${ss * 0.075}px`);
                    circ.setAttribute("cx", cx.toString());
                    circ.setAttribute("cy", cy.toString());
                    circ.setAttribute("r", r.toString());
                    this.g.appendChild(circ);
                    this.last_last_move = circ;
                }
                break;
        }

        if (opacity < 1.0) {
            this.last_last_move?.setAttribute("opacity", opacity.toString());
        }

        this.last_last_move_symbol = symbol;
        this.last_last_move_color = color;
        this.last_last_move_opacity = opacity;
    }

    public clearLastMove(): void {
        if (this.last_last_move) {
            this.last_last_move.remove();
            delete this.last_last_move;
        }
    }

    /*
     * Score estimate
     */
    private last_score_estimate?: SVGRectElement;
    private last_score_estimate_color?: string;
    private last_score_estimate_estimate?: number;

    public scoreEstimate(color: string, estimate: number): void {
        if (
            this.last_score_estimate &&
            this.last_score_estimate_color === color &&
            this.last_score_estimate_estimate === estimate
        ) {
            return;
        }

        this.clearScoreEstimate();

        const mid = this.renderer.metrics.mid;
        const cx = mid;
        const cy = mid;
        const ss = this.renderer.square_size * this.renderer.stone_font_scale;

        const r = ss * 0.2 * Math.abs(estimate);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", (cx - r).toFixed(1));
        rect.setAttribute("y", (cy - r).toFixed(1));
        rect.setAttribute("width", (r * 2).toFixed(1));
        rect.setAttribute("height", (r * 2).toFixed(1));
        if (color === "white") {
            rect.setAttribute("fill", this.renderer.theme_black_text_color);
            rect.setAttribute("stroke", "#777777");
        }
        if (color === "black") {
            rect.setAttribute("fill", this.renderer.theme_white_text_color);
            rect.setAttribute("stroke", "#888888");
        }
        rect.setAttribute("stroke-width", (Math.ceil(ss * 0.035) - 0.5).toFixed(1));
        this.g.appendChild(rect);

        this.last_score_estimate = rect;
        this.last_score_estimate_color = color;
        this.last_score_estimate_estimate = estimate;
    }

    public clearScoreEstimate(): void {
        if (this.last_score_estimate) {
            this.last_score_estimate.remove();
            delete this.last_score_estimate;
            delete this.last_score_estimate_color;
        }
    }
}
