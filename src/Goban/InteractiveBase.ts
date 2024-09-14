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

import {
    GobanEngine,
    GobanEnginePhase,
    ReviewMessage,
    PuzzlePlacementSetting,
    Score,
    ConditionalMoveTree,
    GobanMoveError,
} from "../engine";
import { NumberMatrix, encodeMove, makeMatrix, makeEmptyMatrix } from "../engine/util";
import { MoveTree, MarkInterface } from "../engine/MoveTree";
import { ScoreEstimator } from "../engine/ScoreEstimator";
import { computeAverageMoveTime, niceInterval, matricesAreEqual } from "../engine/util";
import { _ } from "../engine/translate";
import { JGOFIntersection, JGOFPlayerClock, JGOFNumericPlayerColor } from "../engine/formats/JGOF";
import { AdHocClock, AdHocPauseControl } from "../engine/formats/AdHocFormat";
import { StallingScoreEstimate } from "../engine/protocol";
import { callbacks } from "./callbacks";
import {
    GobanBase,
    AnalysisTool,
    AnalysisSubTool,
    GobanModes,
    GobanChatLog,
    GobanBounds,
    GobanConfig,
    JGOFClockWithTransmitting,
} from "../GobanBase";

declare let swal: any;

export const SCORE_ESTIMATION_TRIALS = 1000;
export const SCORE_ESTIMATION_TOLERANCE = 0.3;
export const MARK_TYPES: Array<keyof MarkInterface> = [
    "letter",
    "circle",
    "square",
    "triangle",
    "sub_triangle",
    "cross",
    "black",
    "white",
    "score",
    "stone_removed",
];

export interface ColoredCircle {
    move: JGOFIntersection;
    color: string;
    border_width?: number;
    border_color?: string;
}

export interface MoveCommand {
    //game_id?: number | string;
    game_id: number;
    move: string;
    blur?: number;
    clock?: JGOFPlayerClock;
}

/**
 * This class serves as a functionality layer encapsulating core interactions
 * we do with a Goban, we have it as a separate base class simply to help with
 * code organization and to keep our Goban class size down.
 */
export abstract class GobanInteractive extends GobanBase {
    public abstract sendTimedOut(): void;
    public abstract sent_timed_out_message: boolean; /// Expected to be true if sendTimedOut has been called
    protected abstract sendMove(mv: MoveCommand, cb?: () => void): boolean;

    public conditional_starting_color: "black" | "white" | "invalid" = "invalid";
    public conditional_tree: ConditionalMoveTree = new ConditionalMoveTree(null);
    public double_click_submit: boolean;
    public variation_stone_opacity: number;
    public draw_bottom_labels: boolean;
    public draw_left_labels: boolean;
    public draw_right_labels: boolean;
    public draw_top_labels: boolean;
    public height: number;
    public last_clock?: AdHocClock;
    public last_emitted_clock?: JGOFClockWithTransmitting;
    public clock_should_be_paused_for_move_submission: boolean = false;
    public previous_mode: string;
    public one_click_submit: boolean;
    public pen_marks: Array<any>;
    public readonly game_id: number;
    public readonly review_id: number;
    public showing_scores: boolean = false;
    public stalling_score_estimate?: StallingScoreEstimate;
    public width: number;

    public pause_control?: AdHocPauseControl;
    public paused_since?: number;
    public chat_log: GobanChatLog = [];

    protected last_paused_state: boolean | null = null;
    protected last_paused_by_player_state: boolean | null = null;
    protected analysis_removal_state?: boolean;
    protected analysis_removal_last_position: { i: number; j: number } = { i: NaN, j: NaN };
    protected marked_analysis_score?: boolean[][];

    /* Properties that emit change events */
    private _mode: GobanModes = "play";
    public get mode(): GobanModes {
        return this._mode;
    }
    public set mode(mode: GobanModes) {
        if (this._mode === mode) {
            return;
        }
        this._mode = mode;
        this.emit("mode", this.mode);
    }

    private _title: string = "play";
    public get title(): string {
        return this._title;
    }
    public set title(title: string) {
        if (this._title === title) {
            return;
        }
        this._title = title;
        this.emit("title", this.title);
    }

    private _submit_move?: () => void;
    public get submit_move(): (() => void) | undefined {
        return this._submit_move;
    }
    public set submit_move(submit_move: (() => void) | undefined) {
        if (this._submit_move === submit_move) {
            return;
        }
        this._submit_move = submit_move;
        this.emit("submit_move", this.submit_move);
    }

    private _analyze_tool: AnalysisTool = "stone";
    public get analyze_tool(): AnalysisTool {
        return this._analyze_tool;
    }
    public set analyze_tool(analyze_tool: AnalysisTool) {
        if (this._analyze_tool === analyze_tool) {
            return;
        }
        this._analyze_tool = analyze_tool;
        this.emit("analyze_tool", this.analyze_tool);
    }

    private _analyze_subtool: AnalysisSubTool = "alternate";
    public get analyze_subtool(): AnalysisSubTool {
        return this._analyze_subtool;
    }
    public set analyze_subtool(analyze_subtool: AnalysisSubTool) {
        if (this._analyze_subtool === analyze_subtool) {
            return;
        }
        this._analyze_subtool = analyze_subtool;
        this.emit("analyze_subtool", this.analyze_subtool);
    }

    private _score_estimator: ScoreEstimator | null = null;
    public get score_estimator(): ScoreEstimator | null {
        return this._score_estimator;
    }
    public set score_estimator(score_estimate: ScoreEstimator | null) {
        if (this._score_estimator === score_estimate) {
            return;
        }
        this._score_estimator = score_estimate;
        this.emit("score_estimate", this.score_estimator);
        this._score_estimator?.when_ready
            .then(() => {
                this.emit("score_estimate", this.score_estimator);
            })
            .catch(() => {
                return;
            });
    }

    private _review_owner_id?: number;
    public get review_owner_id(): number | undefined {
        return this._review_owner_id;
    }
    public set review_owner_id(review_owner_id: number | undefined) {
        if (this._review_owner_id === review_owner_id) {
            return;
        }
        this._review_owner_id = review_owner_id;
        this.emit("review_owner_id", this.review_owner_id);
    }

    private _review_controller_id?: number;
    public get review_controller_id(): number | undefined {
        return this._review_controller_id;
    }
    public set review_controller_id(review_controller_id: number | undefined) {
        if (this._review_controller_id === review_controller_id) {
            return;
        }
        this._review_controller_id = review_controller_id;
        this.emit("review_controller_id", this.review_controller_id);
    }

    public config: GobanConfig;
    public last_move_radius: number;
    public circle_radius: number;
    public square_size: number = 10;
    public stone_font_scale: number;

    protected __board_redraw_pen_layer_timer: any = null;
    protected __clock_timer?: ReturnType<typeof setTimeout>;
    protected __draw_state: string[][];
    protected __last_pt: { i: number; j: number; valid: boolean } = { i: -1, j: -1, valid: false };
    protected __update_move_tree: any = null; /* timer */
    protected analysis_move_counter: number;
    protected stone_removal_auto_scoring_done?: boolean = false;
    protected bounded_height: number;
    protected bounded_width: number;
    protected bounds: GobanBounds;
    protected conditional_path: string = "";

    protected current_cmove?: ConditionalMoveTree;
    protected currently_my_cmove: boolean = false;
    protected dirty_redraw: any = null; // timer
    protected disconnectedFromGame: boolean = true;
    protected display_width?: number;
    protected done_loading_review: boolean = false;
    protected dont_draw_last_move: boolean;

    protected edit_color?: "black" | "white";
    protected errorHandler: (e: Error) => void;
    protected heatmap?: NumberMatrix;
    protected colored_circles?: Array<Array<ColoredCircle | undefined>>;
    protected game_type: string;
    protected getPuzzlePlacementSetting?: () => PuzzlePlacementSetting;
    protected highlight_movetree_moves: boolean;
    protected interactive: boolean;
    protected isInPushedAnalysis: () => boolean;
    protected leavePushedAnalysis: () => void;
    protected isPlayerController: () => boolean;
    protected isPlayerOwner: () => boolean;
    protected label_character: string;
    protected label_mark: string = "[UNSET]";
    protected last_hover_square?: JGOFIntersection;
    protected last_move?: MoveTree;
    protected last_phase?: GobanEnginePhase;
    protected last_review_message: ReviewMessage;
    protected last_sound_played_for_a_stone_placement?: string;
    protected last_stone_sound: number;
    protected move_selected?: JGOFIntersection;
    protected no_display: boolean;
    protected onError?: (error: Error) => void;
    protected on_game_screen: boolean;
    protected original_square_size: number | ((goban: GobanBase) => number) | "auto";
    protected player_id: number;
    protected puzzle_autoplace_delay: number;
    protected restrict_moves_to_movetree: boolean;
    protected review_had_gamedata: boolean;
    protected scoring_mode: boolean | "stalling-scoring-mode";
    protected shift_key_is_down: boolean;
    //protected show_move_numbers: boolean;
    protected show_variation_move_numbers: boolean;
    protected stone_placement_enabled: boolean;
    protected sendLatencyTimer?: ReturnType<typeof niceInterval>;

    protected abstract setTitle(title: string): void;
    protected abstract enableDrawing(): void;
    protected abstract disableDrawing(): void;

    protected preloaded_data?: GobanConfig;

    constructor(config: GobanConfig, preloaded_data?: GobanConfig) {
        super();

        this.preloaded_data = preloaded_data;

        this.on("clock", (clock) => {
            if (clock) {
                this.last_emitted_clock = clock;
            }
        });

        /* Apply defaults */
        const C: any = {};
        const default_config = this.defaultConfig();
        for (const k in default_config) {
            C[k] = (default_config as any)[k];
        }
        for (const k in config) {
            C[k] = (config as any)[k];
        }
        config = C;

        /* Apply config */
        //window['active_gobans'][this.goban_id] = this;
        this.on_game_screen = this.getLocation().indexOf("/game/") >= 0;
        this.no_display = false;

        this.width = config.width || 19;
        this.height = config.height || 19;
        this.bounds = config.bounds || {
            top: 0,
            left: 0,
            bottom: this.height - 1,
            right: this.width - 1,
        };
        this.bounded_width = this.bounds ? this.bounds.right - this.bounds.left + 1 : this.width;
        this.bounded_height = this.bounds ? this.bounds.bottom - this.bounds.top + 1 : this.height;
        //this.black_name = config["black_name"];
        //this.white_name = config["white_name"];
        //this.move_number = config["move_number"];
        //this.setGameClock(null);
        this.last_stone_sound = -1;
        this.scoring_mode = false;

        this.game_type = config.game_type || "";
        this.one_click_submit = "one_click_submit" in config ? !!config.one_click_submit : false;
        this.double_click_submit =
            "double_click_submit" in config ? !!config.double_click_submit : true;
        this.variation_stone_opacity =
            typeof config.variation_stone_opacity !== "undefined"
                ? config.variation_stone_opacity
                : 0.6;
        this.original_square_size = config.square_size || "auto";
        //this.square_size = config["square_size"] || "auto";
        this.interactive = !!config.interactive;
        this.pen_marks = [];

        this.config = repair_config(config);
        this.__draw_state = makeMatrix(this.width, this.height, "");
        this.game_id =
            (typeof config.game_id === "string" ? parseInt(config.game_id) : config.game_id) || 0;
        this.player_id = config.player_id || 0;
        this.review_id = config.review_id || 0;
        this.last_review_message = {};
        this.review_had_gamedata = false;
        this.puzzle_autoplace_delay = config.puzzle_autoplace_delay || 300;
        this.isPlayerOwner = config.isPlayerOwner || (() => false); /* for reviews  */
        this.isPlayerController = config.isPlayerController || (() => false); /* for reviews  */
        this.isInPushedAnalysis = config.isInPushedAnalysis
            ? config.isInPushedAnalysis
            : () => false;
        this.leavePushedAnalysis = config.leavePushedAnalysis
            ? config.leavePushedAnalysis
            : () => {
                  return;
              };
        //this.onPendingResignation = config.onPendingResignation;
        //this.onPendingResignationCleared = config.onPendingResignationCleared;
        if ("onError" in config) {
            this.onError = config.onError;
        }
        this.dont_draw_last_move = !!config.dont_draw_last_move;
        this.last_move_radius = config.last_move_radius || 0.25;
        this.circle_radius = config.circle_radius || 0.25;
        this.getPuzzlePlacementSetting = config.getPuzzlePlacementSetting;
        this.mode = config.mode || "play";
        this.previous_mode = this.mode;
        this.label_character = "A";
        //this.edit_color = null;
        this.stone_placement_enabled = false;
        this.highlight_movetree_moves = false;
        this.restrict_moves_to_movetree = false;
        this.analysis_move_counter = 0;
        //this.wait_for_game_to_start = config.wait_for_game_to_start;
        this.errorHandler = (e) => {
            if (e instanceof GobanMoveError) {
                if (e.message_id === "stone_already_placed_here") {
                    return;
                }
            }
            /*
            if (e.message === _("A stone has already been placed here") || e.message === "A stone has already been placed here") {
                return;
            }
            */
            if (e instanceof GobanMoveError && e.message_id === "illegal_self_capture") {
                this.showMessage("self_capture_not_allowed", { error: e }, 5000);
                return;
            } else {
                this.showMessage("error", { error: e }, 5000);
            }
            if (this.onError) {
                this.onError(e);
            }
        };

        this.draw_top_labels = "draw_top_labels" in config ? !!config.draw_top_labels : true;
        this.draw_left_labels = "draw_left_labels" in config ? !!config.draw_left_labels : true;
        this.draw_right_labels = "draw_right_labels" in config ? !!config.draw_right_labels : true;
        this.draw_bottom_labels =
            "draw_bottom_labels" in config ? !!config.draw_bottom_labels : true;
        //this.show_move_numbers = this.getShowMoveNumbers();
        this.show_variation_move_numbers = this.getShowVariationMoveNumbers();
        this.stone_font_scale = this.getStoneFontScale();

        if (this.bounds.left > 0) {
            this.draw_left_labels = false;
        }
        if (this.bounds.top > 0) {
            this.draw_top_labels = false;
        }
        if (this.bounds.right < this.width - 1) {
            this.draw_right_labels = false;
        }
        if (this.bounds.bottom < this.height - 1) {
            this.draw_bottom_labels = false;
        }

        if (typeof config.square_size === "function") {
            this.square_size = config.square_size(this) as number;
            if (isNaN(this.square_size)) {
                console.error("Invalid square size set: (NaN)");
                this.square_size = 12;
            }
        } else if (typeof config.square_size === "number") {
            this.square_size = config.square_size;
        }
        /*
        if (config.display_width && this.original_square_size === "auto") {
            this.setSquareSizeBasedOnDisplayWidth(config.display_width, true) / suppress_redraw / true);
        }
        */

        this.__update_move_tree = null;
        this.shift_key_is_down = false;
    }

    /** Goban calls some abstract methods as part of the construction
     *  process. Because our subclasses might (and do) need to do some of their
     *  own config before these are called, we set this function to be called
     *  by our subclass after it's done it's own internal config stuff.
     */
    protected post_config_constructor(): GobanEngine {
        let ret: GobanEngine;

        delete this.current_cmove; /* set in setConditionalTree */
        this.currently_my_cmove = false;
        this.setConditionalTree(undefined);

        delete this.last_hover_square;
        this.__last_pt = this.xy2ij(-1, -1);

        if (this.preloaded_data) {
            ret = this.load(this.preloaded_data);
        } else {
            ret = this.load(this.config);
        }

        return ret;
    }

    protected getCoordinateDisplaySystem(): "A1" | "1-1" {
        if (callbacks.getCoordinateDisplaySystem) {
            return callbacks.getCoordinateDisplaySystem();
        }
        return "A1";
    }
    protected getShowUndoRequestIndicator(): boolean {
        if (callbacks.getShowUndoRequestIndicator) {
            return callbacks.getShowUndoRequestIndicator();
        }
        return true;
    }
    /*
    protected getShowMoveNumbers(): boolean {
        if (callbacks.getShowMoveNumbers) {
            return callbacks.getShowMoveNumbers();
        }
        return false;
    }
    */
    protected getShowVariationMoveNumbers(): boolean {
        if (callbacks.getShowVariationMoveNumbers) {
            return callbacks.getShowVariationMoveNumbers();
        }
        return false;
    }
    // scale relative to the "OGS default"
    protected getStoneFontScale(): number {
        if (callbacks.getStoneFontScale) {
            return callbacks.getStoneFontScale();
        }
        return 1.0;
    }
    public static getMoveTreeNumbering(): string {
        if (callbacks.getMoveTreeNumbering) {
            return callbacks.getMoveTreeNumbering();
        }
        return "move-number";
    }
    public static getCDNReleaseBase(): string {
        if (callbacks.getCDNReleaseBase) {
            return callbacks.getCDNReleaseBase();
        }
        return "";
    }
    public static getSoundEnabled(): boolean {
        if (callbacks.getSoundEnabled) {
            return callbacks.getSoundEnabled();
        }
        return true;
    }
    public static getSoundVolume(): number {
        if (callbacks.getSoundVolume) {
            return callbacks.getSoundVolume();
        }
        return 0.5;
    }
    protected defaultConfig(): any {
        if (callbacks.defaultConfig) {
            return callbacks.defaultConfig();
        }
        return {};
    }
    public isAnalysisDisabled(perGameSettingAppliesToNonPlayers: boolean = false): boolean {
        if (callbacks.isAnalysisDisabled) {
            return callbacks.isAnalysisDisabled(this, perGameSettingAppliesToNonPlayers);
        }
        return false;
    }

    protected getLocation(): string {
        if (callbacks.getLocation) {
            return callbacks.getLocation();
        }
        return window.location.pathname;
    }
    public override destroy(): void {
        super.destroy();

        delete (this as any).isPlayerController;
        delete (this as any).isPlayerOwner;
        delete (this as any).isInPushedAnalysis;
        delete (this as any).leavePushedAnalysis;
        delete (this as any).onError;
        delete (this as any).onScoreEstimationUpdated;
        delete (this as any).getPuzzlePlacementSetting;
    }
    protected scheduleRedrawPenLayer(): void {
        if (!this.__board_redraw_pen_layer_timer) {
            this.__board_redraw_pen_layer_timer = setTimeout(() => {
                if (this.engine.cur_move.pen_marks.length) {
                    this.drawPenMarks(this.engine.cur_move.pen_marks);
                } else if (this.pen_marks.length) {
                    this.clearAnalysisDrawing();
                }
                this.__board_redraw_pen_layer_timer = null;
            }, 100);
        }
    }

    protected getWidthForSquareSize(square_size: number): number {
        return (
            (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels) * square_size
        );
    }
    protected xy2ij(
        x: number,
        y: number,
        anti_slip: boolean = true,
    ): { i: number; j: number; valid: boolean } {
        if (x > 0 && y > 0) {
            if (this.bounds.left > 0) {
                x += this.bounds.left * this.square_size;
            } else {
                x -= +this.draw_left_labels * this.square_size;
            }

            if (this.bounds.top > 0) {
                y += this.bounds.top * this.square_size;
            } else {
                y -= +this.draw_top_labels * this.square_size;
            }
        }

        const ii = x / this.square_size;
        const jj = y / this.square_size;
        let i = Math.floor(ii);
        let j = Math.floor(jj);
        const border_distance = Math.min(ii - i, jj - j, 1 - (ii - i), 1 - (jj - j));
        if (border_distance < 0.1 && anti_slip) {
            // have a "dead zone" in between squares to avoid misclicks
            i = -1;
            j = -1;
        }
        return { i: i, j: j, valid: i >= 0 && j >= 0 && i < this.width && j < this.height };
    }
    public setAnalyzeTool(tool: AnalysisTool, subtool: AnalysisSubTool | undefined | null) {
        this.analyze_tool = tool;
        this.analyze_subtool = subtool ?? "alternate";

        if (tool === "stone" && subtool === "black") {
            this.edit_color = "black";
        } else if (tool === "stone" && subtool === "white") {
            this.edit_color = "white";
        } else {
            delete this.edit_color;
        }

        this.setLabelCharacterFromMarks(this.analyze_subtool as "letters" | "numbers");

        if (tool === "draw") {
            this.enablePen();
        }
    }

    protected setSubmit(fn?: () => void): void {
        this.submit_move = fn;
        this.emit("submit_move", fn);
    }

    public markDirty(): void {
        if (!this.dirty_redraw) {
            this.dirty_redraw = setTimeout(() => {
                this.dirty_redraw = null;
                this.redraw();
            }, 1);
        }
    }

    public set(x: number, y: number, player: JGOFNumericPlayerColor): void {
        this.markDirty();
    }

    protected updateMoveTree(): void {
        this.move_tree_redraw();
    }
    protected updateOrRedrawMoveTree(): void {
        if (this.engine.move_tree_layout_dirty) {
            this.move_tree_redraw();
        } else {
            this.updateMoveTree();
        }
    }

    public setBounds(bounds: GobanBounds): void {
        this.bounds = bounds || { top: 0, left: 0, bottom: this.height - 1, right: this.width - 1 };

        if (this.bounds) {
            this.bounded_width = this.bounds.right - this.bounds.left + 1;
            this.bounded_height = this.bounds.bottom - this.bounds.top + 1;
        } else {
            this.bounded_width = this.width;
            this.bounded_height = this.height;
        }

        this.draw_left_labels = !!this.config.draw_left_labels;
        this.draw_right_labels = !!this.config.draw_right_labels;
        this.draw_top_labels = !!this.config.draw_top_labels;
        this.draw_bottom_labels = !!this.config.draw_bottom_labels;

        if (this.bounds.left > 0) {
            this.draw_left_labels = false;
        }
        if (this.bounds.top > 0) {
            this.draw_top_labels = false;
        }
        if (this.bounds.right < this.width - 1) {
            this.draw_right_labels = false;
        }
        if (this.bounds.bottom < this.height - 1) {
            this.draw_bottom_labels = false;
        }
    }

    public load(config: GobanConfig): GobanEngine {
        config = repair_config(config);
        for (const k in config) {
            (this.config as any)[k] = (config as any)[k];
        }
        this.clearMessage();

        const new_width = config.width || 19;
        const new_height = config.height || 19;
        // this signalizes that we can keep the old engine
        // we progressively && more and more conditions
        let keep_old_engine = new_width === this.width && new_height === this.height;
        this.width = new_width;
        this.height = new_height;

        delete this.move_selected;

        this.bounds = config.bounds || {
            top: 0,
            left: 0,
            bottom: this.height - 1,
            right: this.width - 1,
        };
        if (this.bounds) {
            this.bounded_width = this.bounds.right - this.bounds.left + 1;
            this.bounded_height = this.bounds.bottom - this.bounds.top + 1;
        } else {
            this.bounded_width = this.width;
            this.bounded_height = this.height;
        }

        if (config.display_width !== undefined) {
            this.display_width = config.display_width;
        }
        /*
        if (this.display_width && this.original_square_size === "auto") {
            const suppress_redraw = true;
            this.setSquareSizeBasedOnDisplayWidth(this.display_width, suppress_redraw);
        }
        */

        if (
            !this.__draw_state ||
            this.__draw_state.length !== this.height ||
            this.__draw_state[0].length !== this.width
        ) {
            this.__draw_state = makeMatrix(this.width, this.height, "");
        }

        this.chat_log = [];
        const main_log: GobanChatLog = (config.chat_log || []).map((x) => {
            x.channel = "main";
            return x;
        });
        const spectator_log: GobanChatLog = (config.spectator_log || []).map((x) => {
            x.channel = "spectator";
            return x;
        });
        const malkovich_log: GobanChatLog = (config.malkovich_log || []).map((x) => {
            x.channel = "malkovich";
            return x;
        });
        this.chat_log = this.chat_log.concat(main_log, spectator_log, malkovich_log);
        this.chat_log.sort((a, b) => a.date - b.date);

        for (const line of this.chat_log) {
            this.emit("chat", line);
        }

        // set up player_pool so we can find player details by id later
        if (!config.player_pool) {
            config.player_pool = {};
        }

        if (config.players) {
            config.player_pool[config.players.black.id] = config.players.black;
            config.player_pool[config.players.white.id] = config.players.white;
        }

        if (config.rengo_teams) {
            for (const player of config.rengo_teams.black.concat(config.rengo_teams.white)) {
                config.player_pool[player.id] = player;
            }
        }

        /* This must be done last as it will invoke the appropriate .set actions to set the board in it's correct state */
        const old_engine = this.engine;

        // we need to have an engine to be able to keep it
        keep_old_engine = keep_old_engine && old_engine !== null && old_engine !== undefined;
        // we only keep the old engine in analyze mode & finished state
        // JM: this keep_old_engine functionality is being added to fix resetting analyze state on network
        // reconnect
        keep_old_engine =
            keep_old_engine && this.mode === "analyze" && old_engine.phase === "finished";

        // NOTE: the construction needs to be side-effect free, because we might not use the new state
        // so we create the engine twice (in case where keep_old_engine = false)
        // here, it is created without the callback to `this` so that it cannot mess things up
        const new_engine = new GobanEngine(config);

        /*
        if (old_engine) {
            console.log("old size", old_engine.move_tree.size());
            console.log("new size", new_engine.move_tree.size());
            console.log(
                "old contains new",
                old_engine.move_tree.containsOtherTreeAsSubset(new_engine.move_tree),
            );
            console.log(
                "new contains old",
                new_engine.move_tree.containsOtherTreeAsSubset(old_engine.move_tree),
            );
        }
        */

        // more sanity checks
        keep_old_engine = keep_old_engine && old_engine.phase === new_engine.phase;
        // just to be on the safe side,
        // we only keep the old engine, if replacing it with new would not bring no new moves
        // (meaning: old has at least all the moves of new one, possibly more == such as the analysis)
        keep_old_engine =
            keep_old_engine && old_engine.move_tree.containsOtherTreeAsSubset(new_engine.move_tree);

        if (!keep_old_engine) {
            // we create the engine anew, this time with the callback argument,
            // in case the constructor some side effects on `this`
            // (JM: which it currently does)
            this.engine = new GobanEngine(config, this);
            this.emit("engine.updated", this.engine);
            this.engine.parentEventEmitter = this;
        }

        this.paused_since = config.paused_since;
        this.pause_control = config.pause_control;

        /*
        if (this.move_number) {
            this.move_number.text(this.engine.getMoveNumber());
        }
        */

        if (this.config.marks && this.engine) {
            this.setMarks(this.config.marks);
        }
        this.setConditionalTree();

        if (this.getPuzzlePlacementSetting) {
            if (
                this.engine.puzzle_player_move_mode === "fixed" &&
                this.getPuzzlePlacementSetting().mode === "play"
            ) {
                this.highlight_movetree_moves = true;
                this.restrict_moves_to_movetree = true;
            }
            if (
                this.getPuzzlePlacementSetting &&
                this.getPuzzlePlacementSetting().mode !== "play"
            ) {
                this.highlight_movetree_moves = true;
            }
        }

        if (!(old_engine && matricesAreEqual(old_engine.board, this.engine.board))) {
            this.redraw(true);
        }

        this.updatePlayerToMoveTitle();
        if (this.mode === "play") {
            if (this.engine.playerToMove() === this.player_id) {
                this.enableStonePlacement();
            } else {
                this.disableStonePlacement();
            }
        } else {
            if (this.stone_placement_enabled) {
                this.disableStonePlacement();
                this.enableStonePlacement();
            }
        }
        if (!keep_old_engine) {
            this.setLastOfficialMove();
        }

        this.emit("update");
        this.emit("load", config);

        return this.engine;
    }
    public setForRemoval(
        x: number,
        y: number,
        removed: boolean,
        emit_stone_removal_updated: boolean = true,
    ) {
        if (removed) {
            this.getMarks(x, y).stone_removed = true;
            this.getMarks(x, y).remove = true;
        } else {
            this.getMarks(x, y).stone_removed = false;
            this.getMarks(x, y).remove = false;
        }
        this.drawSquare(x, y);
        this.emit("set-for-removal", { x, y, removed });
        if (emit_stone_removal_updated) {
            this.emit("stone-removal.updated");
        }
    }
    public showScores(score: Score, only_show_territory: boolean = false): void {
        this.hideScores();
        this.showing_scores = true;

        for (let i = 0; i < 2; ++i) {
            const color: "black" | "white" = i ? "black" : "white";
            const moves = this.engine.decodeMoves(score[color].scoring_positions);
            for (let j = 0; j < moves.length; ++j) {
                const mv = moves[j];
                if (only_show_territory && this.engine.board[mv.y][mv.x] > 0) {
                    continue;
                }
                if (mv.y < 0 || mv.x < 0) {
                    console.error("Negative scoring position: ", mv);
                    console.error(
                        "Scoring positions [" + color + "]: ",
                        score[color].scoring_positions,
                    );
                } else {
                    this.getMarks(mv.x, mv.y).score = color;
                    this.drawSquare(mv.x, mv.y);
                }
            }
        }
    }
    public hideScores(): void {
        this.showing_scores = false;
        for (let j = 0; j < this.height; ++j) {
            for (let i = 0; i < this.width; ++i) {
                if (this.getMarks(i, j).score) {
                    delete this.getMarks(i, j).score;
                    //this.getMarks(i, j).score = false;
                    this.drawSquare(i, j);
                }
            }
        }
    }
    public showStallingScoreEstimate(sse: StallingScoreEstimate): void {
        this.hideScores();
        this.showing_scores = true;
        this.scoring_mode = "stalling-scoring-mode";
        this.stalling_score_estimate = sse;
        this.redraw();
    }

    public updatePlayerToMoveTitle(): void {
        switch (this.engine.phase) {
            case "play":
                if (
                    this.player_id &&
                    this.player_id === this.engine.playerToMove() &&
                    this.engine.cur_move.id === this.engine.last_official_move.id
                ) {
                    if (
                        this.engine.cur_move.passed() &&
                        this.engine.handicapMovesLeft() <= 0 &&
                        this.engine.cur_move.parent
                    ) {
                        this.setTitle(_("Your move - opponent passed"));
                        if (this.last_move && this.last_move.x >= 0) {
                            this.drawSquare(this.last_move.x, this.last_move.y);
                        }
                    } else {
                        this.setTitle(_("Your move"));
                    }
                    if (
                        this.engine.cur_move.id === this.engine.last_official_move.id &&
                        this.mode === "play"
                    ) {
                        this.emit("state_text", { title: _("Your move") });
                    }
                } else {
                    const color = this.engine.playerColor(this.engine.playerToMove());

                    let title;
                    if (color === "black") {
                        title = _("Black to move");
                    } else {
                        title = _("White to move");
                    }
                    this.setTitle(title);
                    if (
                        this.engine.cur_move.id === this.engine.last_official_move.id &&
                        this.mode === "play"
                    ) {
                        this.emit("state_text", { title: title, show_moves_made_count: true });
                    }
                }
                break;

            case "stone removal":
                this.setTitle(_("Stone Removal"));
                this.emit("state_text", { title: _("Stone Removal Phase") });
                break;

            case "finished":
                this.setTitle(_("Game Finished"));
                this.emit("state_text", { title: _("Game Finished") });
                break;

            default:
                this.setTitle(this.engine.phase);
                break;
        }
    }
    public disableStonePlacement(): void {
        this.stone_placement_enabled = false;
        if (this.__last_pt && this.__last_pt.valid) {
            this.drawSquare(this.__last_pt.i, this.__last_pt.j);
        }
    }
    public enableStonePlacement(): void {
        if (this.stone_placement_enabled) {
            this.disableStonePlacement();
        }

        this.stone_placement_enabled = true;
        if (this.__last_pt && this.__last_pt.valid) {
            this.drawSquare(this.__last_pt.i, this.__last_pt.j);
        }
    }
    public showFirst(dont_update_display?: boolean): void {
        this.engine.jumpTo(this.engine.move_tree);
        if (!dont_update_display) {
            this.updateTitleAndStonePlacement();
            this.emit("update");
        }
    }
    public showPrevious(dont_update_display?: boolean): void {
        if (this.mode === "conditional") {
            if (this.conditional_path.length >= 2) {
                const prev_path = this.conditional_path.substr(0, this.conditional_path.length - 2);
                this.jumpToLastOfficialMove();
                this.followConditionalPath(prev_path);
            }
        } else {
            if (this.move_selected) {
                this.jumpToLastOfficialMove();
                return;
            }

            this.engine.showPrevious();
        }

        if (!dont_update_display) {
            this.updateTitleAndStonePlacement();
            this.emit("update");
        }
    }
    public showNext(dont_update_display?: boolean): void {
        if (this.mode === "conditional") {
            if (this.current_cmove) {
                if (this.currently_my_cmove) {
                    if (this.current_cmove.move !== null) {
                        this.followConditionalPath(this.current_cmove.move);
                    }
                } else {
                    for (const ch in this.current_cmove.children) {
                        this.followConditionalPath(ch);
                        break;
                    }
                }
            }
        } else {
            if (this.move_selected) {
                return;
            }
            this.engine.showNext();
        }

        if (!dont_update_display) {
            this.updateTitleAndStonePlacement();
            this.emit("update");
        }
    }
    public prevSibling(): void {
        const sibling = this.engine.cur_move.prevSibling();
        if (sibling) {
            this.engine.jumpTo(sibling);
            this.emit("update");
        }
    }
    public nextSibling(): void {
        const sibling = this.engine.cur_move.nextSibling();
        if (sibling) {
            this.engine.jumpTo(sibling);
            this.emit("update");
        }
    }

    public jumpToLastOfficialMove(): void {
        delete this.move_selected;
        this.engine.jumpToLastOfficialMove();
        this.updateTitleAndStonePlacement();

        this.conditional_path = "";
        this.currently_my_cmove = false;
        if (this.mode === "conditional") {
            this.current_cmove = this.conditional_tree;
        }

        this.emit("update");
    }
    protected setLastOfficialMove(): void {
        this.engine.setLastOfficialMove();
        this.updateTitleAndStonePlacement();
    }
    protected isLastOfficialMove(): boolean {
        return this.engine.isLastOfficialMove();
    }

    public updateTitleAndStonePlacement(): void {
        this.updatePlayerToMoveTitle();

        if (this.engine.phase === "stone removal" || this.scoring_mode) {
            this.enableStonePlacement();
        } else if (this.engine.phase === "play") {
            switch (this.mode) {
                case "play":
                    if (
                        this.isLastOfficialMove() &&
                        this.engine.playerToMove() === this.player_id
                    ) {
                        this.enableStonePlacement();
                    } else {
                        this.disableStonePlacement();
                    }
                    break;

                case "analyze":
                case "conditional":
                case "puzzle":
                    this.disableStonePlacement();
                    this.enableStonePlacement();
                    break;
            }
        } else if (this.engine.phase === "finished") {
            this.disableStonePlacement();
            if (this.mode === "analyze") {
                this.enableStonePlacement();
            }
        }
    }

    public setConditionalTree(conditional_tree?: ConditionalMoveTree): void {
        if (typeof conditional_tree === "undefined") {
            this.conditional_tree = new ConditionalMoveTree(null);
        } else {
            this.conditional_tree = conditional_tree;
        }
        this.current_cmove = this.conditional_tree;

        this.emit("conditional-moves.updated");
        this.emit("update");
    }
    public followConditionalPath(move_path: string) {
        const moves = this.engine.decodeMoves(move_path);
        for (let i = 0; i < moves.length; ++i) {
            this.engine.place(moves[i].x, moves[i].y);
            this.followConditionalSegment(moves[i].x, moves[i].y);
        }
        this.emit("conditional-moves.updated");
    }
    protected followConditionalSegment(x: number, y: number): void {
        const mv = encodeMove(x, y);
        this.conditional_path += mv;

        if (!this.current_cmove) {
            throw new Error(`followConditionalSegment called when current_cmove was not set`);
        }

        if (this.currently_my_cmove) {
            if (mv !== this.current_cmove.move) {
                this.current_cmove.children = {};
            }
            this.current_cmove.move = mv;
        } else {
            let cmove = null;
            if (mv in this.current_cmove.children) {
                cmove = this.current_cmove.children[mv];
            } else {
                cmove = new ConditionalMoveTree(null, this.current_cmove);
                this.current_cmove.children[mv] = cmove;
            }
            this.current_cmove = cmove;
        }

        this.currently_my_cmove = !this.currently_my_cmove;
        this.emit("conditional-moves.updated");
    }
    private deleteConditionalSegment(x: number, y: number) {
        this.conditional_path += encodeMove(x, y);

        if (!this.current_cmove) {
            throw new Error(`deleteConditionalSegment called when current_cmove was not set`);
        }

        if (this.currently_my_cmove) {
            this.current_cmove.children = {};
            this.current_cmove.move = null;
            const cur = this.current_cmove;
            const parent = cur.parent;
            this.current_cmove = parent;
            if (parent) {
                for (const mv in parent.children) {
                    if (parent.children[mv] === cur) {
                        delete parent.children[mv];
                    }
                }
            }
        } else {
            console.error(
                "deleteConditionalSegment called on other player's move, which doesn't make sense",
            );
            return;
            /*
            -- actually this code may work below, we just don't have a ui to drive it for testing so we throw an error

            let cmove = null;
            if (mv in this.current_cmove.children) {
                delete this.current_cmove.children[mv];
            }
            */
        }

        this.currently_my_cmove = !this.currently_my_cmove;
        this.emit("conditional-moves.updated");
    }
    public deleteConditionalPath(move_path: string): void {
        const moves = this.engine.decodeMoves(move_path);
        if (moves.length) {
            for (let i = 0; i < moves.length - 1; ++i) {
                if (i !== moves.length - 2) {
                    this.engine.place(moves[i].x, moves[i].y);
                }
                this.followConditionalSegment(moves[i].x, moves[i].y);
            }
            this.deleteConditionalSegment(moves[moves.length - 1].x, moves[moves.length - 1].y);
            this.conditional_path = this.conditional_path.substr(
                0,
                this.conditional_path.length - 4,
            );
        }
        this.emit("conditional-moves.updated");
    }
    public getCurrentConditionalPath(): string {
        return this.conditional_path;
    }

    public setToPreviousMode(dont_jump_to_official_move?: boolean): boolean {
        return this.setMode(this.previous_mode as GobanModes, dont_jump_to_official_move);
    }
    public setModeDeferred(mode: GobanModes): void {
        setTimeout(() => {
            this.setMode(mode);
        }, 1);
    }
    public setMode(mode: GobanModes, dont_jump_to_official_move?: boolean): boolean {
        if (
            mode === "conditional" &&
            this.player_id === this.engine.playerToMove() &&
            this.mode !== "score estimation"
        ) {
            /* this shouldn't ever get called, but incase we screw up.. */
            try {
                swal.fire("Can't enter conditional move planning when it's your turn");
            } catch (e) {
                console.error(e);
            }
            return false;
        }

        this.setSubmit();

        if (
            ["play", "analyze", "conditional", "edit", "score estimation", "puzzle"].indexOf(
                mode,
            ) === -1
        ) {
            try {
                swal.fire("Invalid mode for Goban: " + mode);
            } catch (e) {
                console.error(e);
            }
            return false;
        }

        if (mode === "analyze" && this.scoring_mode === "stalling-scoring-mode") {
            this.scoring_mode = false;
        }

        if (
            this.engine.config.disable_analysis &&
            this.engine.phase !== "finished" &&
            (mode === "analyze" || mode === "conditional")
        ) {
            try {
                swal.fire("Unable to enter " + mode + " mode");
            } catch (e) {
                console.error(e);
            }
            return false;
        }

        if (mode === "conditional") {
            this.conditional_starting_color = this.engine.playerColor();
        }

        let redraw = true;

        this.previous_mode = this.mode;
        this.mode = mode;
        if (!dont_jump_to_official_move) {
            this.jumpToLastOfficialMove();
        }

        if (this.mode !== "analyze" || this.analyze_tool !== "draw") {
            this.disablePen();
        } else {
            this.enablePen();
        }

        if (mode === "play" && this.engine.phase !== "finished") {
            this.engine.cur_move.clearMarks();
            redraw = true;
        }

        if (redraw) {
            this.clearAnalysisDrawing();
            this.redraw();
        }
        this.updateTitleAndStonePlacement();

        return true;
    }
    public setEditColor(color: "black" | "white"): void {
        this.edit_color = color;
        this.updateTitleAndStonePlacement();
    }
    protected playMovementSound(): void {
        if (
            this.last_sound_played_for_a_stone_placement ===
            this.engine.cur_move.x + "," + this.engine.cur_move.y
        ) {
            return;
        }
        this.last_sound_played_for_a_stone_placement =
            this.engine.cur_move.x + "," + this.engine.cur_move.y;

        let idx;
        do {
            idx = Math.round(Math.random() * 10000) % 5; /* 5 === number of stone sounds */
        } while (idx === this.last_stone_sound);
        this.last_stone_sound = idx;

        if (this.last_sound_played_for_a_stone_placement === "-1,-1") {
            this.emit("audio-pass");
        } else {
            this.emit("audio-stone", {
                x: this.engine.cur_move.x,
                y: this.engine.cur_move.y,
                width: this.engine.width,
                height: this.engine.height,
                color: this.engine.colorNotToMove(),
            });
        }
    }
    /** This is a callback that gets called by GobanEngine.getState to save and
     * board state as it pushes and pops state. Our renderers can override this
     * to save state they need. */
    /*
    public getState(): any {
        const ret = null;
        return ret;
    }
    */

    public setMarks(marks: { [mark: string]: string }, dont_draw?: boolean): void {
        for (const key in marks) {
            const locations = this.engine.decodeMoves(marks[key]);
            for (let i = 0; i < locations.length; ++i) {
                const pt = locations[i];
                this.setMark(pt.x, pt.y, key, dont_draw);
            }
        }
    }
    public setHeatmap(heatmap?: NumberMatrix, dont_draw?: boolean) {
        this.heatmap = heatmap;
        if (!dont_draw) {
            this.redraw(true);
        }
    }
    public setColoredCircles(circles?: Array<ColoredCircle>, dont_draw?: boolean): void {
        if (!circles || circles.length === 0) {
            delete this.colored_circles;
            return;
        }

        this.colored_circles = makeEmptyMatrix<ColoredCircle>(this.width, this.height);
        for (const circle of circles) {
            const mv = circle.move;
            this.colored_circles[mv.y][mv.x] = circle;
        }
        if (!dont_draw) {
            this.redraw(true);
        }
    }

    public setColoredMarks(colored_marks: {
        [key: string]: { move: string; color: string };
    }): void {
        for (const key in colored_marks) {
            const locations = this.engine.decodeMoves(colored_marks[key].move);
            for (let i = 0; i < locations.length; ++i) {
                const pt = locations[i];
                this.setMarkColor(pt.x, pt.y, colored_marks[key].color);
                this.setMark(pt.x, pt.y, key, false);
            }
        }
    }

    protected setMarkColor(x: number, y: number, color: string) {
        this.engine.cur_move.getMarks(x, y).color = color;
    }

    protected setLetterMark(x: number, y: number, mark: string, drawSquare?: boolean): void {
        this.engine.cur_move.getMarks(x, y).letter = mark;
        if (drawSquare) {
            this.drawSquare(x, y);
        }
    }
    public setSubscriptMark(x: number, y: number, mark: string, drawSquare: boolean = true): void {
        this.engine.cur_move.getMarks(x, y).subscript = mark;
        if (drawSquare) {
            this.drawSquare(x, y);
        }
    }
    public setCustomMark(x: number, y: number, mark: string, drawSquare?: boolean): void {
        this.engine.cur_move.getMarks(x, y)[mark] = true;
        if (drawSquare) {
            this.drawSquare(x, y);
        }
    }
    public deleteCustomMark(x: number, y: number, mark: string, drawSquare?: boolean): void {
        delete this.engine.cur_move.getMarks(x, y)[mark];
        if (drawSquare) {
            this.drawSquare(x, y);
        }
    }

    public editPlaceByPrettyCoordinates(
        coordinates: string,
        color: JGOFNumericPlayerColor,
        isTrunkMove?: boolean,
    ): void {
        for (const mv of this.engine.decodeMoves(coordinates)) {
            this.engine.editPlace(mv.x, mv.y, color, isTrunkMove);
        }
    }
    public placeByPrettyCoordinates(coordinates: string): void {
        for (const mv of this.engine.decodeMoves(coordinates)) {
            const removed_stones: Array<JGOFIntersection> = [];
            const removed_count = this.engine.place(
                mv.x,
                mv.y,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                removed_stones,
            );

            if (removed_count > 0) {
                this.emit("audio-capture-stones", {
                    count: removed_count,
                    already_captured: 0,
                });
                this.debouncedEmitCapturedStones(removed_stones);
            }
        }
    }
    public setMarkByPrettyCoordinates(
        coordinates: string,
        mark: number | string,
        dont_draw?: boolean,
    ): void {
        for (const mv of this.engine.decodeMoves(coordinates)) {
            this.setMark(mv.x, mv.y, mark, dont_draw);
        }
    }
    public setMark(x: number, y: number, mark: number | string, dont_draw?: boolean): void {
        try {
            if (x >= 0 && y >= 0) {
                if (typeof mark === "number") {
                    mark = "" + mark;
                }

                if (mark.startsWith("score-")) {
                    const color = mark.split("-")[1];
                    this.getMarks(x, y).score = color;
                    if (!dont_draw) {
                        this.drawSquare(x, y);
                    }
                } else if (mark.length <= 3 || parseFloat(mark)) {
                    this.setLetterMark(x, y, mark, !dont_draw);
                } else {
                    this.setCustomMark(x, y, mark, !dont_draw);
                }
            }
        } catch (e) {
            console.error(e.stack);
        }
    }
    protected setTransientMark(
        x: number,
        y: number,
        mark: number | string,
        dont_draw?: boolean,
    ): void {
        try {
            if (x >= 0 && y >= 0) {
                if (typeof mark === "number") {
                    mark = "" + mark;
                }

                if (mark.length <= 3) {
                    this.engine.cur_move.getMarks(x, y).transient_letter = mark;
                } else {
                    this.engine.cur_move.getMarks(x, y)["transient_" + mark] = true;
                }

                if (!dont_draw) {
                    this.drawSquare(x, y);
                }
            }
        } catch (e) {
            console.error(e.stack);
        }
    }
    public getMarks(x: number, y: number): MarkInterface {
        if (this.engine && this.engine.cur_move) {
            return this.engine.cur_move.getMarks(x, y);
        }
        return {};
    }
    protected toggleMark(
        x: number,
        y: number,
        mark: number | string,
        force_label?: boolean,
        force_put?: boolean,
    ): boolean {
        let ret = true;
        if (typeof mark === "number") {
            mark = "" + mark;
        }
        const marks = this.getMarks(x, y);

        const clearMarks = () => {
            for (let i = 0; i < MARK_TYPES.length; ++i) {
                delete marks[MARK_TYPES[i]];
            }
        };

        if (force_label || /^[a-zA-Z0-9]{1,2}$/.test(mark)) {
            if (!force_put && "letter" in marks) {
                clearMarks();
                ret = false;
            } else {
                clearMarks();
                marks.letter = mark;
            }
        } else {
            if (!force_put && mark in marks) {
                clearMarks();
                ret = false;
            } else {
                clearMarks();
                this.getMarks(x, y)[mark] = true;
            }
        }
        this.drawSquare(x, y);
        return ret;
    }
    protected incrementLabelCharacter(): void {
        const seq1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        if (parseInt(this.label_character)) {
            this.label_character = "" + (parseInt(this.label_character) + 1);
        } else if (seq1.indexOf(this.label_character) !== -1) {
            this.label_character = seq1[(seq1.indexOf(this.label_character) + 1) % seq1.length];
        }
    }
    protected setLabelCharacterFromMarks(set_override?: "numbers" | "letters"): void {
        if (set_override === "letters" || /^[a-zA-Z]$/.test(this.label_character)) {
            const seq1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
            let idx = -1;

            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    const ch = this.getMarks(x, y).letter;
                    if (ch) {
                        idx = Math.max(idx, seq1.indexOf(ch));
                    }
                }
            }

            this.label_character = seq1[idx + (1 % seq1.length)];
        }
        if (set_override === "numbers" || /^[0-9]+$/.test(this.label_character)) {
            let val = 0;

            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    const mark_as_number: number = parseInt(this.getMarks(x, y).letter || "");
                    if (mark_as_number) {
                        val = Math.max(val, mark_as_number);
                    }
                }
            }

            this.label_character = "" + (val + 1);
        }
    }
    public setLabelCharacter(ch: string): void {
        this.label_character = ch;
        if (this.last_hover_square) {
            this.drawSquare(this.last_hover_square.x, this.last_hover_square.y);
        }
    }
    public clearMark(x: number, y: number, mark: string | number): void {
        try {
            if (typeof mark === "number") {
                mark = "" + mark;
            }

            if (/^[a-zA-Z0-9]{1,2}$/.test(mark)) {
                this.getMarks(x, y).letter = "";
            } else {
                this.getMarks(x, y)[mark] = false;
            }
            this.drawSquare(x, y);
        } catch (e) {
            console.error(e);
        }
    }
    protected clearTransientMark(x: number, y: number, mark: string | number): void {
        try {
            if (typeof mark === "number") {
                mark = "" + mark;
            }

            if (/^[a-zA-Z0-9]{1,2}$/.test(mark)) {
                this.getMarks(x, y).transient_letter = "";
            } else {
                this.getMarks(x, y)["transient_" + mark] = false;
            }
            this.drawSquare(x, y);
        } catch (e) {
            console.error(e);
        }
    }
    public updateScoreEstimation(): void {
        if (this.score_estimator) {
            const est = this.score_estimator.estimated_hard_score - this.engine.komi;
            if (callbacks.updateScoreEstimation) {
                callbacks.updateScoreEstimation(est > 0 ? "black" : "white", Math.abs(est));
            }
            if (this.config.onScoreEstimationUpdated) {
                this.config.onScoreEstimationUpdated(est > 0 ? "black" : "white", Math.abs(est));
            }
            this.emit("score_estimate", this.score_estimator);
        }
    }

    public isCurrentUserAPlayer(): boolean {
        return this.player_id in this.engine.player_pool;
    }

    public setScoringMode(tf: boolean, prefer_remote: boolean = false): MoveTree {
        this.scoring_mode = tf;
        const ret = this.engine.cur_move;

        if (this.scoring_mode) {
            this.showMessage("processing", undefined, -1);
            this.setMode("score estimation", true);
            this.clearMessage();
            const should_autoscore = false;
            this.score_estimator = this.engine.estimateScore(
                SCORE_ESTIMATION_TRIALS,
                SCORE_ESTIMATION_TOLERANCE,
                prefer_remote,
                should_autoscore,
            );
            this.enableStonePlacement();
            this.redraw(true);
            this.emit("update");
        } else {
            if (this.previous_mode === "analyze" || this.previous_mode === "conditional") {
                this.setToPreviousMode(true);
            } else {
                this.setMode("play");
            }
            this.redraw(true);
        }

        return ret;
    }

    private last_emitted_captured_stones: Array<JGOFIntersection> = [];

    /* Emits the captured-stones event, only if didn't just  emitted it with
     * the same removed_stones. That situation happens when the client signals
     * the removal, and then we get a second followup confirmation from the
     * server, we need both sources of the event for when the user has two
     * clients pointed at the same game, but we don't want to emit the event
     * twice on the device that submitted the move in the first place. */
    public debouncedEmitCapturedStones(removed_stones: Array<JGOFIntersection>): void {
        if (removed_stones.length > 0) {
            const captured_stones = removed_stones
                .map((o) => ({ x: o.x, y: o.y }))
                .sort((a, b) => {
                    if (a.x < b.x) {
                        return -1;
                    } else if (a.x > b.x) {
                        return 1;
                    } else if (a.y < b.y) {
                        return -1;
                    } else if (a.y > b.y) {
                        return 1;
                    } else {
                        return 0;
                    }
                });

            let different = captured_stones.length !== this.last_emitted_captured_stones.length;
            if (!different) {
                for (let i = 0; i < captured_stones.length; ++i) {
                    if (
                        captured_stones[i].x !== this.last_emitted_captured_stones[i].x ||
                        captured_stones[i].y !== this.last_emitted_captured_stones[i].y
                    ) {
                        different = true;
                        break;
                    }
                }
            }

            if (different) {
                this.last_emitted_captured_stones = removed_stones;
                this.emit("captured-stones", { removed_stones });
            }
        }
    }
}

function repair_config(config: GobanConfig): GobanConfig {
    if (config.time_control) {
        if (!config.time_control.system && (config.time_control as any).time_control) {
            (config.time_control as any).system = (config.time_control as any).time_control;
            console.log(
                "Repairing goban config: time_control.time_control -> time_control.system = ",
                (config.time_control as any).system,
            );
        }
        if (!config.time_control.speed) {
            const tpm = computeAverageMoveTime(config.time_control, config.width, config.height);
            (config.time_control as any).speed =
                tpm === 0 || tpm > 3600 ? "correspondence" : tpm < 10 ? "blitz" : "live";
            console.log(
                "Repairing goban config: time_control.speed = ",
                (config.time_control as any).speed,
            );
        }
    }

    return config;
}
