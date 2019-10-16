/*
 * Copyright 2012-2019 Online-Go.com
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


import * as PIXI from 'pixi.js';
import { JGOF } from './JGOF';
import { AdHocFormat } from './AdHocFormat';

import {
    GobanCore,
    GobanConfig,
    GobanSelectedThemes,
    GOBAN_FONT,
    SCORE_ESTIMATION_TRIALS,
    SCORE_ESTIMATION_TOLERANCE,
    AUTOSCORE_TRIALS,
    AUTOSCORE_TOLERANCE,
    MARK_TYPES,
} from './GobanCore';
import {GoEngine, encodeMove, encodeMoves} from "./GoEngine";
import {GoMath} from "./GoMath";
import {GoThemes} from "./GoThemes";
import { MoveTreePenMarks } from "./MoveTree";
import { elementOffset} from "./GoUtil";
import { getRelativeEventPosition, getRandomInt } from "./GoUtil";
import {_, pgettext, interpolate} from "./translate";

let __theme_cache = {"black": {}, "white": {}};

let type = "WebGL"
if(!PIXI.utils.isWebGLSupported()){
  type = "canvas"
}

PIXI.utils.sayHello(type)

export interface GobanPixiConfig extends GobanConfig {
    board_div: HTMLElement;
}

export class GobanPixi extends GobanCore  {
    private parent: HTMLElement;
    private board: PIXI.Application;
    private board_texture: PIXI.Texture = PIXI.Texture.EMPTY;
    private board_sprite: PIXI.Sprite;
    private graphics:PIXI.Graphics;
    private lines_and_text:PIXI.Container;

    // possibly deprecated

    private __set_board_height;
    private __set_board_width;

    private shadow_layer:HTMLCanvasElement;
    private shadow_ctx:CanvasRenderingContext2D;
    private ready_to_draw:boolean = false;
    private message_div:HTMLDivElement;
    private message_td:HTMLElement;
    private message_text:HTMLDivElement;
    private message_timeout:number;

    constructor(config:GobanPixiConfig, preloaded_data?:AdHocFormat|JGOF) {
        super(config, preloaded_data);

        this.parent = config["board_div"];
        if (!this.parent) {
            this.no_display = true;
            this.parent = document.createElement("div"); /* let a div dangle in no-mans land to prevent null pointer refs */
        }

        let devicePixelRatio = 1;
        try {
            devicePixelRatio = window.devicePixelRatio;
        } catch (e) {
            // ignore
        }

        this.board = new PIXI.Application({
            width: 1,
            height: 1,
            antialias: true,
            transparent: false,
            backgroundColor: 0xDCB35C,
            powerPreference: 'low-power',
            resolution: devicePixelRatio,
            resizeTo: this.parent,
        })
        this.parent.append(this.board.view);
        //this.bindPointerBindings(this.board);

        this.board_sprite = new PIXI.Sprite(this.board_texture);
        this.board.stage.addChild(this.board_sprite);
        this.lines_and_text = new PIXI.Container();
        this.board.stage.addChild(this.lines_and_text);


        if (config['interactive']) {
            this.makeInteractive();
        }

        this.post_config_constructor();

        this.ready_to_draw = true;
        this.redraw(true);
    }
    public enablePen():void {
        //this.attachPenCanvas();
    }
    public disablePen():void {
        //this.detachPenCanvas();
    }

    public makeInteractive():void {
        window.addEventListener("keydown", this.handleShiftKey);
        window.addEventListener("keyup", this.handleShiftKey);

        //let cursor = new PIXI.Sprite(PIXI.Texture.from('/img/granite.jpg'));
        //this.board.stage.addChild(cursor);

        this.board.stage.interactive = true;
        this.board.stage.on('mousemove', (ev:PIXI.interaction.InteractionEvent) => {
            //cursor.setTransform(ev.data.global.x, ev.data.global.y);
        });



    }

    private handleShiftKey = (ev:KeyboardEvent):void => {
        /* TODO
        if (ev.shiftKey !== this.shift_key_is_down) {
            this.shift_key_is_down = ev.shiftKey;
            if (this.last_hover_square) {
                this.__drawSquare(this.last_hover_square.x, this.last_hover_square.y);
            }
        }
        */
    };

    public destroy():void {
        super.destroy();

        this.board.destroy();
        //this.detachPenCanvas();
        //this.detachShadowLayer();

        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            this.message_timeout = null;
        }

        window.removeEventListener("keydown", this.handleShiftKey);
        window.removeEventListener("keyup", this.handleShiftKey);
    }
    /*
    private detachShadowLayer():void {
        if (this.shadow_layer) {
            this.shadow_layer.remove();
            this.shadow_layer = null;
            this.shadow_ctx = null;
        }
    }
    private attachShadowLayer():void {
        if (!this.shadow_layer && this.parent) {
            this.shadow_layer = createDeviceScaledCanvas(this.metrics.width, this.metrics.height);
            this.shadow_layer.setAttribute("id", "shadow-canvas");
            this.shadow_layer.className = "ShadowLayer";

            this.parent.insertBefore(this.shadow_layer, this.board);
            //this.shadow_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
            this.shadow_layer.style.left = this.layer_offset_left;
            this.shadow_layer.style.top = this.layer_offset_top;


            this.shadow_ctx = this.shadow_layer.getContext("2d");
            this.bindPointerBindings(this.shadow_layer);
        }
    }
    private detachPenCanvas():void {
        if (this.pen_layer) {
            this.pen_layer.remove();
            this.pen_layer = null;
            this.pen_ctx = null;
        }
    }
    private attachPenCanvas():void {
        if (!this.pen_layer) {
            this.pen_layer = createDeviceScaledCanvas(this.metrics.width, this.metrics.height);
            this.pen_layer.setAttribute("id", "pen-canvas");
            this.pen_layer.className = "PenLayer";
            this.parent.append(this.pen_layer);
            //this.pen_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
            this.pen_layer.style.left = this.layer_offset_left;
            this.pen_layer.style.top = this.layer_offset_top;
            this.pen_ctx = this.pen_layer.getContext("2d");
            this.bindPointerBindings(this.pen_layer);
        }
    }
    */

    /*
    private bindPointerBindings(canvas:HTMLCanvasElement):void {
        if (!this.interactive) {
            return;
        }

        if (canvas.getAttribute("data-pointers-bound") === "true") {
            return;
        }

        canvas.setAttribute("data-pointers-bound", "true");


        let dragging = false;

        let last_click_square = this.xy2ij(0, 0);

        let pointerUp = (ev, double_clicked) => {
            if (!dragging) {
                // if we didn't start the click in the canvas, don't respond to it
                return;
            }

            dragging = false;

            if (this.scoring_mode) {
                let pos = getRelativeEventPosition(ev);
                let pt = this.xy2ij(pos.x, pos.y);
                if (pt.i >= 0 && pt.i < this.width && pt.j >= 0 && pt.j < this.height) {
                    if (this.score_estimate) {
                        this.score_estimate.handleClick(pt.i, pt.j, ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey);
                    }
                    this.emit("update");
                }
                return;
            }

            if (ev.ctrlKey || ev.metaKey || ev.altKey) {
                try {
                    let pos = getRelativeEventPosition(ev);
                    let pt = this.xy2ij(pos.x, pos.y);
                    if (GobanCore.hooks.addCoordinatesToChatInput) {
                        GobanCore.hooks.addCoordinatesToChatInput(this.engine.prettyCoords(pt.i, pt.j));
                    }
                } catch (e) {
                    console.error(e);
                }
                return;
            }

            if (this.mode === "analyze" && this.analyze_tool === "draw") {
                // might want to interpret this as a start/stop of a line segment
            } else {
                let pos = getRelativeEventPosition(ev);
                let pt = this.xy2ij(pos.x, pos.y);
                if (!double_clicked) {
                    last_click_square = pt;
                } else {
                    if (last_click_square.i !== pt.i || last_click_square.j !== pt.j) {
                        this.onMouseOut(ev);
                        return;
                    }
                }

                this.onTap(ev, double_clicked);
                this.onMouseOut(ev);
            }
        };

        let pointerDown = (ev) => {
            dragging = true;
            if (this.mode === "analyze" && this.analyze_tool === "draw") {
                this.onPenStart(ev);
            }
            else if (this.mode === "analyze" && this.analyze_tool === "label") {
                if (ev.shiftKey) {
                    if (this.analyze_subtool === "letters") {
                        let label_char = prompt(_("Enter the label you want to add to the board"), "");
                        if (label_char) {
                            this.label_character = label_char.substring(0, 3);
                            dragging = false;
                            return;
                        }
                    }
                }

                this.onLabelingStart(ev);
            }
        };

        let pointerMove = (ev) => {
            if (this.mode === "analyze" && this.analyze_tool === "draw") {
                if (!dragging) { return; }
                this.onPenMove(ev);
            } else if (dragging && this.mode === "analyze" && this.analyze_tool === "label") {
                this.onLabelingMove(ev);
            } else {
                 this.onMouseMove(ev);
            }
        };

        let pointerOut = (ev) => {
            dragging = false;
            this.onMouseOut(ev);
        };

        let mousedisabled:any = 0;

        canvas.addEventListener("click", (ev) => { if (!mousedisabled) { dragging = true; pointerUp(ev, false); } ev.preventDefault(); return false; });
        canvas.addEventListener("dblclick", (ev) => { if (!mousedisabled) { dragging = true; pointerUp(ev, true); } ev.preventDefault(); return false; });
        canvas.addEventListener("mousedown", (ev) => { if (!mousedisabled) { pointerDown(ev); } ev.preventDefault(); return false; });
        canvas.addEventListener("mousemove", (ev) => { if (!mousedisabled) { pointerMove(ev); } ev.preventDefault(); return false; });
        canvas.addEventListener("mouseout", (ev) => { if (!mousedisabled) { pointerOut(ev); } else { ev.preventDefault(); } return false; });
        canvas.addEventListener("focus", (ev) => { ev.preventDefault(); return false; });


        let lastX = 0;
        let lastY = 0;
        let startX = 0;
        let startY = 0;

        const onTouchStart = (ev:TouchEvent) => {
            if (mousedisabled) {
                clearTimeout(mousedisabled);
            }
            mousedisabled = setTimeout(() => { mousedisabled = 0; }, 5000);

            if (ev.target === canvas) {
                lastX = ev.touches[0].pageX;
                lastY = ev.touches[0].pageY;
                startX = ev.touches[0].pageX;
                startY = ev.touches[0].pageY;
                pointerDown(ev);
            } else if (dragging) {
                pointerOut(ev);
            }
        };
        const onTouchEnd = (ev:TouchEvent) => {
            if (mousedisabled) {
                clearTimeout(mousedisabled);
            }
            mousedisabled = setTimeout(() => { mousedisabled = 0; }, 5000);

            if (ev.target === canvas) {
                if (Math.sqrt((startX - lastX) * (startX - lastX) + (startY - lastY) * (startY - lastY)) > 10) {
                    pointerOut(ev);
                } else {
                    pointerUp(ev, false);
                }
            } else if (dragging) {
                pointerOut(ev);
            }
        };
        const onTouchMove = (ev:TouchEvent) => {
            if (mousedisabled) {
                clearTimeout(mousedisabled);
            }
            mousedisabled = setTimeout(() => { mousedisabled = 0; }, 5000);

            if (ev.target === canvas) {
                lastX = ev.touches[0].pageX;
                lastY = ev.touches[0].pageY;
                if (this.mode === "analyze" && this.analyze_tool === "draw") {
                    pointerMove(ev);
                    ev.preventDefault();
                    return false;
                }
            } else if (dragging) {
                pointerOut(ev);
            }
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
    */
    public clearAnalysisDrawing():void {
        this.pen_marks = [];
        /* TODO
        if (this.pen_ctx) {
            this.pen_ctx.clearRect(0, 0, this.metrics.width, this.metrics.height);
        }
        */
    }
    private xy2pen(x:number, y:number):[number, number] {
        let lx = this.draw_left_labels ? 0.0 : 1.0;
        let ly = this.draw_top_labels ? 0.0 : 1.0;
        return [Math.round(((x / this.square_size) + lx) * 64), Math.round(((y / this.square_size) + ly) * 64)];
    }
    private pen2xy(x:number, y:number):[number, number] {
        let lx = this.draw_left_labels ? 0.0 : 1.0;
        let ly = this.draw_top_labels ? 0.0 : 1.0;

        return [((x / 64) - lx) * this.square_size, ((y / 64) - ly) * this.square_size];
    }
    private setPenStyle(color:string):void {
        /*
        this.pen_ctx.strokeStyle = color;
        this.pen_ctx.lineWidth = Math.max(1, Math.round(this.square_size * 0.1));
        this.pen_ctx.lineCap = "round";
        */
    }
    private onPenStart(ev:MouseEvent):void {
        /*
        this.attachPenCanvas();

        let pos = getRelativeEventPosition(ev);
        this.last_pen_position = this.xy2pen(pos.x, pos.y);
        this.current_pen_mark = {"color": this.analyze_subtool, "points": this.xy2pen(pos.x, pos.y)};
        this.pen_marks.push(this.current_pen_mark);
        this.setPenStyle(this.analyze_subtool);

        this.syncReviewMove({"pen": this.analyze_subtool, "pp": this.xy2pen(pos.x, pos.y)});
        */
    }
    private onPenMove(ev:MouseEvent):void {
        /*
        let pos = getRelativeEventPosition(ev);
        let start = this.last_pen_position;
        let s = this.pen2xy(start[0], start[1]);
        let end = this.xy2pen(pos.x, pos.y);
        let e = this.pen2xy(end[0], end[1]);

        let dx = end[0] - start[0];
        let dy = end[1] - start[1];
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

        this.syncReviewMove({"pp": [dx, dy]});
        */
    }
    public drawPenMarks(penmarks:MoveTreePenMarks):void {
        /*
        if (this.review_id && !this.done_loading_review) { return; }
        if (!(penmarks.length || this.pen_layer)) {
            return;
        }
        this.attachPenCanvas();
        this.clearAnalysisDrawing();
        this.pen_marks = penmarks;
        for (let i = 0; i < penmarks.length; ++i) {
            let stroke = penmarks[i];
            this.setPenStyle(stroke.color);

            let px = stroke.points[0];
            let py = stroke.points[1];
            this.pen_ctx.beginPath();
            let pt = this.pen2xy(px, py);
            this.pen_ctx.moveTo(pt[0], pt[1]);
            for (let j = 2; j < stroke.points.length; j += 2 ) {
                px += stroke.points[j];
                py += stroke.points[j + 1];
                let pt = this.pen2xy(px, py);
                this.pen_ctx.lineTo(pt[0], pt[1]);
            }
            this.pen_ctx.stroke();
        }
        */
    }
    private onTap(event:MouseEvent, double_tap:boolean):void {
        /*
        if (!(this.stone_placement_enabled && (this.player_id || this.engine.black_player_id === 0 || this.mode === "analyze" || this.mode === "pattern search" || this.mode === "puzzle"))) { return; }

        let pos = getRelativeEventPosition(event);
        let xx = pos.x;
        let yy = pos.y;


        let pt = this.xy2ij(xx, yy);
        let x = pt.i;
        let y = pt.j;

        if (x < 0 || y < 0 || x >= this.engine.width || y >= this.engine.height) {
            return;
        }

        if (!this.double_click_submit) {
            double_tap = false;
        }

        if (this.mode === "analyze" && event.shiftKey
            // don't warp to move tree position when shift clicking in stone edit mode
            && !(this.analyze_tool === "stone" && (this.analyze_subtool === "black" || this.analyze_subtool === "white"))
            // nor when in labeling mode
            && this.analyze_tool !== "label"
           ) {
            let m = this.engine.getMoveByLocation(x, y);
            if (m) {
                this.engine.jumpTo(m);
                this.emit("update");
            }
            return;
        }

        if (this.mode === "analyze" && this.analyze_tool === "label") {
            return;
        }

        this.setSubmit(null);
        if (this.submitBlinkTimer) {
            clearTimeout(this.submitBlinkTimer);
        }
        this.submitBlinkTimer = null;


        let tap_time = Date.now();
        let submit = () => {
            let submit_time = Date.now();
            if (!this.one_click_submit && (!this.double_click_submit || !double_tap)) {
                // then submit button was pressed, so check to make sure this didn't happen too quick
                let delta = submit_time - tap_time;
                if (delta <= 50) {
                    console.info("Submit button pressed only ", delta, "ms after stone was placed, presuming bad click");
                    return;
                }
            }
            this.last_sent_move = encodeMove(x, y);
            this.sendMove({
                "auth": this.config.auth,
                "game_id": this.config.game_id,
                "player_id": this.config.player_id,
                "move": encodeMove(x, y)
            });
            this.setTitle(_("Submitting..."));
            this.disableStonePlacement();
            this.move_selected = false;
        };
        // we disable clicking if we've been initialized with the view user,
        // unless the board is a demo board (thus black_player_id is 0).
        try {
            let force_redraw = false;

            if ((this.engine.phase === "stone removal" || this.scoring_mode) && this.isParticipatingPlayer()) {
                let arrs;
                if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
                    let removed = !this.engine.removal[y][x];
                    arrs = [[removed, [{"x": x, "y": y}]]];
                }
                else {
                    arrs = this.engine.toggleMetaGroupRemoval(x, y);
                }

                for (let i = 0; i < arrs.length; ++i) {
                    let arr = arrs[i];

                    let removed = arr[0];
                    let group = arr[1];
                    if (group.length && !this.scoring_mode) {
                        this.socket.send("game/removed_stones/set", {
                            "auth"        : this.config.auth,
                            "game_id"     : this.config.game_id,
                            "player_id"   : this.config.player_id,
                            "removed"     : removed,
                            "stones"      : encodeMoves(group)
                        });
                    }
                    if (this.scoring_mode) {
                        this.score_estimate = this.engine.estimateScore(SCORE_ESTIMATION_TRIALS, SCORE_ESTIMATION_TOLERANCE);
                        this.redraw(true);
                    }
                }
            }
            else if (this.mode === "pattern search") {
                let color = (this.engine.board[y][x] + 1) % 3; // cycle through the colors
                if (this.pattern_search_color) {
                    color = this.pattern_search_color;
                    if (this.engine.board[y][x] === this.pattern_search_color) {
                        color = 0;
                    }
                }
                if (event.shiftKey && color === 1) { // if we're going to place a black on an empty square but we're holding down shift, place white
                    color = 2;
                }
                if (event.shiftKey && color === 2) { // if we're going to place a black on an empty square but we're holding down shift, place white
                    color = 1;
                }
                if (!double_tap) { // we get called for each tap, then once for the final double tap so we only want to process this x2
                    this.engine.editPlace(x, y, color);
                }
                this.emit("update");
            }
            else if (this.mode === "puzzle") {
                let puzzle_mode = "place";
                let color = 0;
                if (this.getPuzzlePlacementSetting) {
                    let s = this.getPuzzlePlacementSetting();
                    puzzle_mode = s.mode;
                    color = s.color;
                    if (this.shift_key_is_down) {
                        color = color === 1 ? 2 : 1;
                    }
                }

                if (puzzle_mode === "place") {
                    if (!double_tap) { // we get called for each tap, then once for the final double tap so we only want to process this x2
                        this.engine.place(x, y, true, false, true, false, false);
                        this.emit("puzzle-place", {x, y});
                    }
                }
                if (puzzle_mode === "play") {
                    // we get called for each tap, then once for the final double tap so we only want to process this x2
                    // Also, if we just placed a piece and the computer is waiting to place it's piece (autoplaying), then
                    // don't allow anything to be placed.
                    if (!double_tap && !this.autoplaying_puzzle_move) {
                        let mv_x = x;
                        let mv_y = y;
                        let calls = 0;

                        if (this.engine.puzzle_player_move_mode !== "fixed" || this.engine.cur_move.lookupMove(x, y, this.engine.player, false)) {
                            let puzzle_place = (mv_x, mv_y) => {
                                ++calls;

                                this.engine.place(mv_x, mv_y, true, false, true, false, false);
                                this.emit("puzzle-place", {x : mv_x, y : mv_y});
                                if (this.engine.cur_move.wrong_answer) {
                                    this.emit("puzzle-wrong-answer");
                                }
                                if (this.engine.cur_move.correct_answer) {
                                    this.emit("puzzle-correct-answer");
                                }

                                if (this.engine.cur_move.branches.length === 0) {
                                    let isobranches = this.engine.cur_move.findStrongIsobranches();
                                    if (isobranches.length > 0) {
                                        let w = getRandomInt(0, isobranches.length);
                                        let which = isobranches[w];
                                        console.info("Following isomorphism (" + (w + 1) + " of " + isobranches.length + ")");
                                        this.engine.jumpTo(which);
                                        this.emit("update");
                                    }
                                }

                                if (this.engine.cur_move.branches.length) {
                                    let next = this.engine.cur_move.branches[getRandomInt(0, this.engine.cur_move.branches.length)];

                                    if (calls === 1
                                        && // only move if it's the "ai" turn.. if we undo we can get into states where we
                                           // are playing for the ai for some moves so don't automove blindly
                                        ((next.player === 2 && this.engine.config.initial_player === "black")
                                            || (next.player === 1 && this.engine.config.initial_player === "white"))
                                        && this.engine.puzzle_opponent_move_mode !== "manual"
                                       ) {
                                           this.autoplaying_puzzle_move = true;
                                           setTimeout(() => {
                                               this.autoplaying_puzzle_move = false;
                                               puzzle_place(next.x, next.y);
                                               this.emit("update");
                                           }, this.puzzle_autoplace_delay);
                                       }
                                } else {
                                    // default to wrong answer, but only if there are no nodes prior to us that were marked
                                    // as correct
                                    let c = this.engine.cur_move;
                                    let parent_was_correct = false;
                                    while (c) {
                                        if (c.correct_answer) {
                                            parent_was_correct = true;
                                            break;
                                        }
                                        c = c.parent;
                                    }
                                    if (!parent_was_correct) {
                                        // default to wrong answer - we say ! here because we will have already emitted
                                        // puzzle-wrong-answer if wrong_answer was true above.
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
            }
            else if (this.engine.phase === "play" || (this.engine.phase === "finished" && this.mode === "analyze")) {
                if (this.move_selected) {
                    if (this.mode === "play") {
                        this.engine.cur_move.removeIfNoChildren();
                    }

                    // If same stone is clicked again, simply remove it
                    let same_stone_clicked = false;
                    if ((this.move_selected.x === x && this.move_selected.y === y)) {
                        this.move_selected = false;
                        same_stone_clicked = true;
                    }

                    this.engine.jumpTo(this.engine.last_official_move);

                    // If same stone is clicked again, simply remove it
                    if (same_stone_clicked) {
                        this.updatePlayerToMoveTitle();
                        if (!double_tap) {
                            this.emit("update");
                            return;
                        }
                    }
                }
                this.move_selected = {"x": x, "y": y};

                // Place our stone
                try {
                    if ((this.mode !== "edit" || this.edit_color == null) &&
                        !(this.mode === "analyze" && this.analyze_tool === "stone" && this.analyze_subtool !== "alternate")) {
                        this.engine.place(x, y, true, true);

                        if (this.mode === "analyze") {
                            if (this.engine.handicapMovesLeft() > 0) {
                                this.engine.place(-1, -1);
                            }
                        }
                    } else {
                        let edit_color = this.engine.playerByColor(this.edit_color);
                        if (event.shiftKey && edit_color === 1) { // if we're going to place a black on an empty square but we're holding down shift, place white
                            edit_color = 2;
                        }
                        else if (event.shiftKey && edit_color === 2) { // if we're going to place a black on an empty square but we're holding down shift, place white
                            edit_color = 1;
                        }
                        if (this.engine.board[y][x] === edit_color) {
                            this.engine.editPlace(x, y, 0);
                        }
                        else {
                            this.engine.editPlace(x, y, edit_color);
                        }
                    }

                    if (this.mode === "analyze" && this.analyze_tool === "stone") {
                        let c = this.engine.cur_move;
                        while (c && !c.trunk) {
                            let mark:any = c.getMoveNumberDifferenceFromTrunk();
                            if (c.edited) {
                                mark = "triangle";
                            }

                            if (c.x >= 0 && c.y >= 0 && !(this.engine.board[c.y][c.x])) {
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
                    this.move_selected = false;
                    this.updatePlayerToMoveTitle();
                    throw e;
                }

                this.playMovementSound();

                switch (this.mode) {
                    case "play":
                        //if (this.one_click_submit || double_tap || this.engine.game_type === "temporary") {
                        if (this.one_click_submit || double_tap) {
                            submit();
                        }
                        else {
                            this.setSubmit(submit);
                        }
                        break;
                    case "analyze":
                        this.move_selected = false;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");
                        break;
                    case "conditional":
                        this.followConditionalSegment(x, y);
                        this.move_selected = false;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");
                        break;
                    case "edit":
                        this.move_selected = false;
                        this.updateTitleAndStonePlacement();
                        this.emit("update");

                        this.last_sent_move = encodeMove(x, y);
                        this.sendMove({
                            "auth": this.config.auth,
                            "game_id": this.config.game_id,
                            "player_id": this.config.player_id,
                            "move": "!" + this.engine.board[y][x] + encodeMove(x, y)
                        });
                        break;
                }

                if (force_redraw) {
                    this.redraw();
                }
            }

        } catch (e) {
            this.move_selected = false;
            console.info(e);
            this.errorHandler(e);
            this.emit("error");
            this.emit("update");
        }
        */
    }
    private onMouseMove(event:MouseEvent):void {
        /*
        if (!(this.stone_placement_enabled &&
            (this.player_id || this.engine.black_player_id === 0 || this.mode === "analyze" || this.scoring_mode)
            )) { return; }

        let offset = elementOffset(this.board);
        let x = event.pageX - offset.left;
        let y = event.pageY - offset.top;

        let pt = this.xy2ij(x, y);

        if (this.__last_pt.i === pt.i && this.__last_pt.j === pt.j) {
            return;
        }

        if (this.__last_pt.valid) {
            let last_hover = this.last_hover_square;
            this.last_hover_square = null;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }

        this.__last_pt = pt;

        if (pt.valid) {
            this.last_hover_square = {"x": pt.i, "y": pt.j};
            this.drawSquare(pt.i, pt.j);
        }
        */
    }
    private onMouseOut(event:MouseEvent):void {
        /*
        if (this.__last_pt.valid) {
            let last_hover = this.last_hover_square;
            this.last_hover_square = null;
            if (last_hover) {
                this.drawSquare(last_hover.x, last_hover.y);
            }
        }
        this.__last_pt = this.xy2ij(-1, -1);
        */
    }
    public drawSquare(i:number, j:number):void {
        /*
        if (i < 0 || j < 0) { return; }
        if (this.__draw_state[j][i] !== this.drawingHash(i, j)) {
            this.__drawSquare(i, j);
        }
        */
    }
    private __drawSquare(i:number, j:number):void {
    }
    public redraw(force_clear?: boolean):void {
        if (!this.ready_to_draw) {
            return;
        }
        if (!this.drawing_enabled) {
            return;
        }
        if (this.no_display) { return; }

        let start = new Date();

        let metrics = this.metrics = this.computeMetrics();
        if (force_clear ||
            !(this.__set_board_width === metrics.width
                && this.__set_board_height === metrics.height
                && this.theme_stone_radius === this.computeThemeStoneRadius(metrics)))
        {
            try {
                //this.parent.css({"width": metrics.width + "px", "height": metrics.height + "px"});
                this.parent.style.width = metrics.width + "px";
                this.parent.style.height = metrics.height + "px";
                //resizeDeviceScaledCanvas(this.board, metrics.width, metrics.height);
                this.board.resize();
                //this.board.stage.width = metrics.width;
                //this.board.stage.height = metrics.height;

                //let bo = this.board.offset();
                //let po = this.parent.offset() || {"top": 0, "left": 0};
                /*
                let bo = elementOffset(this.board);
                let po = elementOffset(this.parent) || {"top": 0, "left": 0};
                let top = bo.top - po.top;
                let left = bo.left - po.left;

                this.layer_offset_left = 0;
                this.layer_offset_top = 0;

                if (this.pen_layer) {
                    if (this.pen_marks.length) {
                        resizeDeviceScaledCanvas(this.pen_layer, metrics.width, metrics.height);
                        //this.pen_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
                        this.pen_layer.style.left = this.layer_offset_left;
                        this.pen_layer.style.top = this.layer_offset_top;
                        this.pen_ctx = this.pen_layer.getContext("2d");
                    } else {
                        this.detachPenCanvas();
                    }
                }

                this.ctx = this.board.getContext("2d");
                */

                this.__set_board_width = metrics.width;
                this.__set_board_height = metrics.height;

                this.setThemes(this.getSelectedThemes(), true);
            } catch (e) {
                setTimeout(() => { throw e; }, 1);
                return;
            }
        }




        if (force_clear || !this.__borders_initialized) {
            this.lines_and_text.removeChildren();
            this.__borders_initialized = true;

            // Draw labels
            let fontSize = Math.round(this.square_size * 0.5);
            let fontWeight = 'bold';
            if (this.getCoordinateDisplaySystem() === '1-1') {
                fontSize *= 0.7;
                fontWeight = 'normal';

                if (this.height > 20) {
                    fontSize *= 0.7;
                }
            }

            let style = new PIXI.TextStyle({
                fontFamily: GOBAN_FONT,
                fontSize: fontSize,
                fontWeight: fontWeight,
                //textBaseline: "middle",
                textBaseline: "bottom",
                //fill: this.theme_board.getLabelTextColor(),
                fill: this.theme_board.getLabelTextColor(),
                //align: 'center',
            });

            let cache = {};

            const place = (ch, x, y) => { // places centered (horizontally & veritcally) text at x,y
                //let metrics = PIXI.TextMetrics.measureText(ch, style);
                //let text = new PIXI.Text(ch, style);
                let text = text_sprite(this.board, ch, style);
                //text.x = Math.round(x - metrics.width / 2);
                //text.y = Math.round(y - (metrics.height * 0.4));
                text.x = Math.round(x - text.width / 2);
                text.y = Math.round(y - (text.height * 0.4));
                this.lines_and_text.addChild(text);
            };
            const vplace = (ch, x, y) => { // places centered (horizontally & veritcally) text at x,y, with text going down vertically.
                for (let i = 0; i < ch.length; ++i) {
                    let metrics = PIXI.TextMetrics.measureText(ch[i], style);
                    let xx = x - metrics.width / 2;
                    let yy = y - metrics.height * 0.4;
                    let H = metrics.width; // should be height in an ideal world, measureText doesn't seem to return it though. For our purposes this works well enough though.

                    if (ch.length === 2) {
                        yy = yy - H + (i * H);
                    }
                    if (ch.length === 3) {
                        yy = yy - (H * 1.5) + (i * H);
                    }

                    let text = new PIXI.Text(ch, style);
                    text.x = Math.round(xx);
                    text.y = Math.round(yy);
                    this.lines_and_text.addChild(text);
                }
            };

            const drawHorizontal = (i, j) => {
                switch (this.getCoordinateDisplaySystem()) {
                    case 'A1':
                        for (let c = 0; c < this.width; ++i, ++c) {
                            let x = (i - this.bounds.left - (this.bounds.left > 0 ? +this.draw_left_labels : 0)) * this.square_size + this.square_size / 2;
                            let y = j * this.square_size + this.square_size / 2;
                            place("ABCDEFGHJKLMNOPQRSTUVWXYZ"[c], x, y);
                        }
                        break;
                    case '1-1':
                        for (let c = 0; c < this.width; ++i, ++c) {
                            let x = (i - this.bounds.left - (this.bounds.left > 0 ? +this.draw_left_labels : 0)) * this.square_size + this.square_size / 2;
                            let y = j * this.square_size + this.square_size / 2;
                            place('' + (c + 1), x, y);
                        }
                        break;
                }
            };

            const drawVertical = (i, j) => {
                switch (this.getCoordinateDisplaySystem()) {
                    case 'A1':
                        for (let c = 0; c < this.height; ++j, ++c) {
                            let x = i * this.square_size + this.square_size / 2;
                            let y = (j - this.bounds.top - (this.bounds.top > 0 ? +this.draw_top_labels : 0)) * this.square_size + this.square_size / 2;
                            place("" + (this.height - c), x, y);
                        }
                        break;
                    case '1-1':
                        let chinese_japanese_numbers = [
                            "一", "二", "三", "四", "五",
                            "六", "七", "八", "九", "十",
                            "十一", "十二", "十三", "十四", "十五",
                            "十六", "十七", "十八", "十九", "二十",
                            "二十一", "二十二", "二十三", "二十四", "二十五",
                        ];
                        for (let c = 0; c < this.height; ++j, ++c) {
                            let x = i * this.square_size + this.square_size / 2;
                            let y = (j - this.bounds.top - (this.bounds.top > 0 ? +this.draw_top_labels : 0)) * this.square_size + this.square_size / 2;
                            vplace(chinese_japanese_numbers[c], x, y);
                        }
                        break;
                }
            };

            /*
            if (this.shadow_ctx) {
                this.shadow_ctx.clearRect (0, 0, metrics.width, metrics.height);
            }
            ctx.clearRect (0, 0, metrics.width, metrics.height);
            */


            if (this.draw_top_labels && this.bounds.top === 0) {
                drawHorizontal(this.draw_left_labels, 0);
            }
            if (this.draw_bottom_labels && this.bounds.bottom === this.height - 1) {
                drawHorizontal(this.draw_left_labels, +this.draw_top_labels + this.bounded_height);
            }
            if (this.draw_left_labels && this.bounds.left === 0) {
                drawVertical(0, this.draw_top_labels);
            }
            if (this.draw_right_labels && this.bounds.right === this.width - 1) {
                drawVertical(+this.draw_left_labels + this.bounded_width, +this.draw_top_labels);
            }

            // Lines
            let graphics = new PIXI.Graphics();
            this.lines_and_text.addChild(graphics);
            let d = graphics.lineStyle(1.0, this.theme_board.getLineColor());
            let ox = this.draw_left_labels ? this.square_size : 0;
            let ex = this.draw_right_labels ? -this.square_size : 0;
            let oy = this.draw_top_labels ? this.square_size : 0;
            let ey = this.draw_bottom_labels ? -this.square_size : 0;

            let half_square = this.square_size / 2.0;
            let left_edge_offset = this.bounds.left === 0 ? this.square_size / 2 : 0;
            let right_edge_offset = this.bounds.right === (this.width - 1) ? this.square_size / 2 : this.square_size;
            let top_edge_offset = this.bounds.top === 0 ? this.square_size / 2 : 0;
            let bottom_edge_offset = this.bounds.bottom === (this.height - 1) ? this.square_size / 2 : this.square_size;

            for (let j = 0; j <= this.bounds.bottom - this.bounds.top; ++j) {
                d.moveTo(
                    Math.round(ox + left_edge_offset) + 0.5,
                    Math.round(oy + this.square_size * j + half_square) + 0.5
                );
                d.lineTo(
                    Math.round(ox + this.square_size * (this.bounds.right  - this.bounds.left) + right_edge_offset) + 0.5,
                    Math.round(oy + this.square_size * j + half_square) + 0.5
                );
            }
            //for (let i = this.bounds.left; i <= this.bounds.right; ++i) {
            for (let i = 0; i <=  this.bounds.right - this.bounds.left; ++i) {
                d.moveTo(
                    Math.round(ox + this.square_size * i + half_square) + 0.5,
                    Math.round(oy + top_edge_offset) + 0.5
                );
                d.lineTo(
                    Math.round(ox + this.square_size * i + half_square) + 0.5,
                    Math.round(oy + this.square_size * (this.bounds.bottom  - this.bounds.top) + bottom_edge_offset) + 0.5
                );
            }
        }




        // Draw squares
        /*
        if (!this.__draw_state || force_clear || this.__draw_state.length !== this.height || this.__draw_state[0].length !== this.width) {
            this.__draw_state = GoMath.makeMatrix(this.width, this.height);
        }
        */


        // Set font for text overlay
        /*
        {
            let text_size = Math.round(this.square_size * 0.45);
            ctx.font = "bold " + text_size + "px " + GOBAN_FONT;
        }
        */

        /*
        for (let j = this.bounds.top; j <= this.bounds.bottom; ++j) {
            for (let i = this.bounds.left; i <= this.bounds.right; ++i) {
                this.drawSquare(i, j);
            }
        }
        */

        /*
        let stop = new Date();
        this.drawPenMarks(this.pen_marks);

        if (this.move_tree_div) {
            this.redrawMoveTree();
        }
        */
    }
    protected setThemes(themes:GobanSelectedThemes, dont_redraw:boolean):void {
        if (this.no_display) {
            return;
        }

        this.themes = themes;

        this.theme_board = new (GoThemes["board"][themes.board])();
        this.theme_white = new (GoThemes["white"][themes.white])(this.theme_board);
        this.theme_black = new (GoThemes["black"][themes.black])(this.theme_board);

        if (!this.metrics) {
            this.metrics = this.computeMetrics();
        }
        this.theme_stone_radius = this.computeThemeStoneRadius(this.metrics);


        // Update board theme
        this.board.renderer.backgroundColor = color2number(this.theme_board.getBackgroundCSS()['background-color']);
        if (this.theme_board.getBackgroundCSS()['background-image']) {
            this.board_texture = PIXI.Texture.from(stripCSSUrl(this.theme_board.getBackgroundCSS()['background-image']));
        } else {
            this.board_texture = PIXI.Texture.EMPTY;
        }
        this.board_sprite.texture = this.board_texture;

        // resize board sprite to cover the background
        var containerWidth = this.board.renderer.width;
        var containerHeight = this.board.renderer.height;

        var imageRatio = this.board_sprite.width / this.board_sprite.height;
        var containerRatio = containerWidth / containerHeight;

        if (containerRatio > imageRatio) {
            this.board_sprite.height = this.board_sprite.height / (this.board_sprite.width / containerWidth);
            this.board_sprite.width = containerWidth;
            this.board_sprite.position.x = 0;
            this.board_sprite.position.y = (containerHeight - this.board_sprite.height) / 2;
        } else {
            this.board_sprite.width = this.board_sprite.width / (this.board_sprite.height / containerHeight);
            this.board_sprite.height = containerHeight;
            this.board_sprite.position.y = 0;
            this.board_sprite.position.x = (containerWidth - this.board_sprite.width) / 2;
        }




        /*
        if (isNaN(this.theme_stone_radius)) {
            console.error("setThemes was not able to find the board size, metrics were: ", JSON.stringify(this.metrics));
            throw new Error("invalid stone radius computed");
        }

        if (this.theme_white.stoneCastsShadow(this.theme_stone_radius) || this.theme_black.stoneCastsShadow(this.theme_stone_radius)) {
            if (this.shadow_layer) {
                resizeDeviceScaledCanvas(this.shadow_layer, this.metrics.width, this.metrics.height);
                //this.shadow_layer.css({"left": this.layer_offset_left, "top": this.layer_offset_top});
                this.shadow_layer.style.left = this.layer_offset_left;
                this.shadow_layer.style.top = this.layer_offset_top;
                this.shadow_ctx = this.shadow_layer.getContext("2d");
            } else {
                this.attachShadowLayer();
            }
        } else {
            this.detachShadowLayer();
        }


        if (!(themes.white in __theme_cache.white)) { __theme_cache.white[themes.white] = {}; }
        if (!(themes.black in __theme_cache.black)) { __theme_cache.black[themes.black] = {}; }
        if (!(this.theme_stone_radius in __theme_cache.white[themes.white])) {
            __theme_cache.white[themes.white][this.theme_stone_radius] = this.theme_white.preRenderWhite(this.theme_stone_radius, 23434);
        }
        if (!(this.theme_stone_radius in __theme_cache.black[themes.black])) {
            __theme_cache.black[themes.black][this.theme_stone_radius] = this.theme_black.preRenderBlack(this.theme_stone_radius, 2081);
        }

        this.theme_white_stones = __theme_cache.white[themes.white][this.theme_stone_radius];
        this.theme_black_stones = __theme_cache.black[themes.black][this.theme_stone_radius];
        this.theme_line_color = this.theme_board.getLineColor();
        this.theme_faded_line_color = this.theme_board.getFadedLineColor();
        this.theme_star_color = this.theme_board.getStarColor();
        this.theme_faded_star_color = this.theme_board.getFadedStarColor();
        this.theme_blank_text_color = this.theme_board.getBlankTextColor();
        this.theme_black_text_color = this.theme_black.getBlackTextColor();
        this.theme_white_text_color = this.theme_white.getWhiteTextColor();
        //this.parent.css(this.theme_board.getBackgroundCSS());
        let bgcss = this.theme_board.getBackgroundCSS();
        for (let key in bgcss) {
            this.parent.style[key] = bgcss[key];
        }

        if (this.move_tree_div) {
            if (this.engine) {
                this.engine.move_tree.updateTheme(this);
            }
        }

        if (!dont_redraw) {
            this.redraw(true);
            if (this.move_tree_div) {
                this.redrawMoveTree();
            }
        }
        */
    }
    public message(msg:string, timeout:number = 5000):void {
        console.error(msg);
        /*
        this.clearMessage();

        this.message_div = document.createElement('div');
        this.message_div.className = "GobanMessage";
        this.message_td = document.createElement("td");
        let table = document.createElement("table");
        let tr = document.createElement("tr");
        tr.appendChild(this.message_td);
        table.appendChild(tr);
        this.message_div.appendChild(table);
        this.message_text = document.createElement("div");
        this.message_text.innerHTML = msg;
        this.message_td.append(this.message_text);
        this.parent.append(this.message_div);

        this.message_div.addEventListener("click", () => {
            if (timeout > 0) {
                this.clearMessage();
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
        */
    }
    public clearMessage():void {
        /*
        if (this.message_div) {
            this.message_div.remove();
            this.message_div = null;
        }
        if (this.message_timeout) {
            clearTimeout(this.message_timeout);
            this.message_timeout = null;
        }
        */
    }
}


function color2number(hex_color:string):number {
    return parseInt(hex_color.replace('#','0x'));
}
/** url('http://blah.com/foo.jpg') => http://blah.com/foo.jpg */
function stripCSSUrl(css_url_string:string):string {
    return css_url_string.replace("')",'').replace("url('",'');
}

function text_sprite(application:PIXI.Application, ch, style:PIXI.TextStyle):PIXI.Sprite {
    let key = `text-${ch}-${style.fill}-${style.toFontString()}`;
    if (!(key in PIXI.utils.TextureCache)) {
        let text = new PIXI.Text(ch, style);
        application.renderer.render(text);
        PIXI.Texture.addToCache(text.texture, key);
    }
    return new PIXI.Sprite(PIXI.utils.TextureCache[key]);
}
