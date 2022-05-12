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

import {
    AUTOSCORE_TRIALS,
    AUTOSCORE_TOLERANCE,
    GoEngine,
    GoEngineConfig,
    GoEnginePhase,
    GoEngineRules,
    encodeMove,
    ReviewMessage,
    PlayerColor,
    PuzzleConfig,
    PuzzlePlacementSetting,
    Score,
} from "./GoEngine";
import { GobanMoveError } from "./GobanError";
import { GoMath, Move, NumberMatrix, Intersection } from "./GoMath";
import { GoConditionalMove, ConditionalMoveResponse } from "./GoConditionalMove";
import { MoveTree, MarkInterface, MoveTreePenMarks } from "./MoveTree";
import { init_score_estimator, ScoreEstimator } from "./ScoreEstimator";
import { deepEqual, dup, computeAverageMoveTime } from "./GoUtil";
import { TypedEventEmitter } from "./TypedEventEmitter";
import { _, interpolate } from "./translate";
import {
    JGOFClock,
    JGOFIntersection,
    JGOFTimeControl,
    JGOFPlayerClock,
    JGOFTimeControlSystem,
    JGOFNumericPlayerColor,
    JGOFPauseState,
    JGOFPlayerSummary,
} from "./JGOF";
import { AdHocClock, AdHocPlayerClock, AdHocPauseControl } from "./AdHocFormat";

declare let swal: any;

export const GOBAN_FONT = "Verdana,Arial,sans-serif";

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
];

let last_goban_id = 0;

interface JGOFPlayerClockWithTimedOut extends JGOFPlayerClock {
    timed_out: boolean;
}

export type GobanModes =
    | "play"
    | "puzzle"
    | "score estimation"
    | "analyze"
    | "conditional"
    | "setup"
    | "edit"
    | "pattern search";

export type AnalysisTool = "stone" | "draw" | "label";
export type AnalysisSubTool =
    | "black"
    | "white"
    | "alternate"
    | "letters"
    | "numbers"
    | string /* label character(s) */;

export interface ColoredCircle {
    move: JGOFIntersection;
    color: string;
    border_width?: number;
    border_color?: string;
}

export interface GobanSelectedThemes {
    board: string;
    white: string;
    black: string;
}

export interface GobanBounds {
    top: number;
    left: number;
    right: number;
    bottom: number;
}

export interface GobanChatLogLine {
    chat_id: string;
    // TODO: there are other fields in here, we need to flesh them out, and/or
    // figure out if we even still need this
}

export type GobanChatLog = Array<{
    channel: "main" | "spectator" | "malkovich";
    date: number;
    lines: Array<GobanChatLogLine>;
}>;

export interface GobanConfig extends GoEngineConfig, PuzzleConfig {
    display_width?: number;

    interactive?: boolean;
    mode?: GobanModes;
    square_size?: number | ((goban: GobanCore) => number) | "auto";

    getPuzzlePlacementSetting?: () => PuzzlePlacementSetting;

    chat_log?: GobanChatLog;
    spectator_log?: GobanChatLog;
    malkovich_log?: GobanChatLog;

    // pause control
    pause_control?: AdHocPauseControl;
    paused_since?: number;

    // settings
    draw_top_labels?: boolean;
    draw_left_labels?: boolean;
    draw_bottom_labels?: boolean;
    draw_right_labels?: boolean;
    bounds?: GobanBounds;
    dont_draw_last_move?: boolean;
    one_click_submit?: boolean;
    double_click_submit?: boolean;
    variation_stone_transparency?: number;
    visual_undo_request_indicator?: boolean;

    //
    auth?: string;
    time_control?: JGOFTimeControl;
    marks?: { [mark: string]: string };

    //
    isPlayerOwner?: () => boolean;
    isPlayerController?: () => boolean;
    isInPushedAnalysis?: () => boolean;
    leavePushedAnalysis?: () => void;
    onError?: (err: Error) => void;
    onScoreEstimationUpdated?: (winning_color: "black" | "white", points: number) => void;

    //
    game_type?: "temporary";

    // puzzle stuff
    /*
    puzzle_autoplace_delay?: number;
    puzzle_opponent_move_mode?: PuzzleOpponentMoveMode;
    puzzle_player_move_mode?: PuzzlePlayerMoveMode;
    puzzle_rank = puzzle && puzzle.puzzle_rank ? puzzle.puzzle_rank : 0;
    puzzle_collection = (puzzle && puzzle.collection ? puzzle.collection.id : 0);
    puzzle_type = (puzzle && puzzle.type ? puzzle.type : "");
    */

    // deprecated
    username?: string;
    server_socket?: any;
    connect_to_chat?: number | boolean;
}

export interface AudioClockEvent {
    /** Number of seconds left in the current period */
    countdown_seconds: number;

    /** Full player clock information */
    clock: JGOFPlayerClock;

    /** The player (id) whose turn it is */
    player_id: string;

    /** The player whose turn it is */
    color: PlayerColor;

    /** Time control system being used by the clock */
    time_control_system: JGOFTimeControlSystem;

    /** True if we are in overtime. This is only ever set for systems that have
     *  a concept of overtime.
     */
    in_overtime: boolean;
}

interface MoveCommand {
    auth?: string;
    game_id?: number | string;
    player_id?: number;
    move: string;
    blur?: number;
    clock?: JGOFPlayerClock;
}

export interface JGOFClockWithTransmitting extends JGOFClock {
    black_move_transmitting: number; // estimated ms left for transmission, or 0 if complete
    white_move_transmitting: number; // estimated ms left for transmission, or 0 if complete
}

export interface StateUpdateEvents {
    mode: GobanModes;
    title: string;
    phase: GoEnginePhase;
    cur_move: MoveTree;
    last_official_move: MoveTree;
    submit_move: (() => void) | undefined;
    analyze_tool: AnalysisTool;
    analyze_subtool: AnalysisSubTool;
    score_estimate: ScoreEstimator | null;
    strict_seki_mode: boolean;
    rules: GoEngineRules;
    winner: PlayerColor | undefined;
    undo_requested: number | undefined; // move number of the last undo request
    paused: boolean;
    outcome: string;
    review_owner_id: number | undefined;
    review_controller_id: number | undefined;
}

export interface Events extends StateUpdateEvents {
    destroy: never;
    update: never;
    "chat-reset": never;
    reset: any;
    error: any;
    gamedata: any;
    chat: any;
    load: GobanConfig;
    "submitting-move": boolean;
    "chat-remove": { chat_ids: Array<string> };
    "move-made": never;
    "player-update": JGOFPlayerSummary;
    "played-by-click": {
        player_id: number;
        x: number;
        y: number;
    };
    "review.sync-to-current-move": never;
    "review.updated": never;
    "review.load-start": never;
    "review.load-end": never;
    "puzzle-wrong-answer": never;
    "puzzle-correct-answer": never;
    state_text: {
        title: string;
        show_moves_made_count?: boolean;
    };
    "advance-to-next-board": never;
    "auto-resign": {
        game_id: number;
        player_id: number;
        expiration: number;
    };
    "clear-auto-resign": {
        game_id: number;
        player_id: number;
    };
    "set-for-removal": { x: number; y: number; removed: boolean };
    "stone-removal.accepted": never;
    "stone-removal.updated": never;
    "conditional-moves.updated": never;
    "puzzle-place": {
        x: number;
        y: number;
        width: number;
        height: number;
        color: "black" | "white";
    };
    clock: JGOFClockWithTransmitting | null;
    "audio-game-started": {
        player_id: number; // Player to move
    };
    "audio-game-ended": "black" | "white" | "tie";
    "audio-pass": never;
    "audio-stone": {
        x: number;
        y: number;
        width: number;
        height: number;
        color: "black" | "white";
    };
    "audio-other-player-disconnected": {
        player_id: number;
    };
    "audio-other-player-reconnected": {
        player_id: number;
    };
    "audio-clock": AudioClockEvent;
    "audio-disconnected": never; // your connection has been lost to the server
    "audio-reconnected": never; // your connection has been reestablished
    "audio-capture-stones": {
        count: number /* number of stones we just captured */;
        already_captured: number /* number of stones that have already been captured by this player */;
    };
    "audio-game-paused": never;
    "audio-game-resumed": never;
    "audio-enter-stone-removal": never;
    "audio-resume-game-from-stone-removal": never;
    "audio-undo-requested": never;
    "audio-undo-granted": never;
}

export interface GobanHooks {
    defaultConfig?: () => any;
    getCoordinateDisplaySystem?: () => "A1" | "1-1";
    isAnalysisDisabled?: (goban: GobanCore, perGameSettingAppliesToNonPlayers: boolean) => boolean;

    getClockDrift?: () => number;
    getNetworkLatency?: () => number;
    getLocation?: () => string;
    getShowMoveNumbers?: () => boolean;
    getShowVariationMoveNumbers?: () => boolean;
    getMoveTreeNumbering?: () => "move-coordinates" | "none" | "move-number";
    getCDNReleaseBase?: () => string;
    getSoundEnabled?: () => boolean;
    getSoundVolume?: () => number;

    watchSelectedThemes?: (cb: (themes: GobanSelectedThemes) => void) => { remove: () => any };
    getSelectedThemes?: () => GobanSelectedThemes;

    discBlackStoneColor?: () => string;
    discBlackTextColor?: () => string;
    discWhiteStoneColor?: () => string;
    discWhiteTextColor?: () => string;
    plainBoardColor?: () => string;
    plainBoardLineColor?: () => string;
    plainBoardUrl?: () => string;

    addCoordinatesToChatInput?: (coordinates: string) => void;
    updateScoreEstimation?: (
        est_winning_color: "black" | "white",
        number_of_points: number,
    ) => void;
}

export interface GobanMetrics {
    width: number;
    height: number;
    mid: number;
    offset: number;
}

export abstract class GobanCore extends TypedEventEmitter<Events> {
    public conditional_starting_color: "black" | "white" | "invalid" = "invalid";
    //public black_pause_text: string;
    public conditional_tree: GoConditionalMove = new GoConditionalMove(null);
    public double_click_submit: boolean;
    public variation_stone_transparency: number;
    public draw_bottom_labels: boolean;
    public draw_left_labels: boolean;
    public draw_right_labels: boolean;
    public draw_top_labels: boolean;
    public visual_undo_request_indicator: boolean;
    public abstract engine: GoEngine;
    public height: number;
    public last_clock?: AdHocClock;
    public last_emitted_clock?: JGOFClockWithTransmitting;
    public clock_should_be_paused_for_move_submission: boolean = false;
    public previous_mode: string;
    public one_click_submit: boolean;
    public pen_marks: Array<any>;
    public readonly game_id: number | string;
    public readonly review_id: number;
    public showing_scores: boolean = false;
    //public white_pause_text: string;
    public width: number;

    public pause_control?: AdHocPauseControl;
    public paused_since?: number;
    public sent_timed_out_message: boolean = false;
    public chat_log: GobanChatLog = [];

    private last_paused_state: boolean | null = null;
    private last_paused_by_player_state: boolean | null = null;

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

    private _score_estimate: ScoreEstimator | null = null;
    public get score_estimate(): ScoreEstimator | null {
        return this._score_estimate;
    }
    public set score_estimate(score_estimate: ScoreEstimator | null) {
        if (this._score_estimate === score_estimate) {
            return;
        }
        this._score_estimate = score_estimate;
        this.emit("score_estimate", this.score_estimate);
        this._score_estimate?.when_ready
            .then(() => {
                this.emit("score_estimate", this.score_estimate);
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

    protected __board_redraw_pen_layer_timer: any = null;
    protected __clock_timer?: ReturnType<typeof setTimeout>;
    protected __draw_state: Array<Array<string>>;
    protected __last_pt: { i: number; j: number; valid: boolean } = { i: -1, j: -1, valid: false };
    protected __update_move_tree: any = null; /* timer */
    protected analysis_move_counter: number;
    protected auto_scoring_done?: boolean = false;
    //protected black_clock;
    //protected black_name;
    protected bounded_height: number;
    protected bounded_width: number;
    protected bounds: GobanBounds;
    protected conditional_path: string = "";
    public config: GobanConfig;
    protected current_cmove?: GoConditionalMove;
    protected currently_my_cmove: boolean = false;
    protected destroyed: boolean;
    protected dirty_redraw: any = null; // timer
    protected disconnectedFromGame: boolean = true;
    protected display_width?: number;
    protected done_loading_review: boolean = false;
    protected dont_draw_last_move: boolean;
    protected edit_color?: "black" | "white";
    protected errorHandler: (e: Error) => void;
    protected heatmap?: NumberMatrix;
    protected colored_circles?: Array<Array<ColoredCircle>>;
    protected game_type: string;
    protected getPuzzlePlacementSetting?: () => PuzzlePlacementSetting;
    protected goban_id: number;
    protected highlight_movetree_moves: boolean;
    protected interactive: boolean;
    protected isInPushedAnalysis: () => boolean;
    protected leavePushedAnalysis: () => void;
    protected isPlayerController: () => boolean;
    protected isPlayerOwner: () => boolean;
    protected label_character: string;
    protected label_mark: string = "[UNSET]";
    protected last_hover_square?: Intersection;
    protected last_move?: MoveTree;
    protected last_phase?: GoEnginePhase;
    protected last_review_message: ReviewMessage;
    protected last_sound_played_for_a_stone_placement?: string;
    protected last_stone_sound: number;
    //protected move_number:number;
    protected move_selected?: Intersection;
    protected no_display: boolean;
    protected onError?: (error: Error) => void;
    //protected onPendingResignation;
    //protected onPendingResignationCleared;
    protected on_game_screen: boolean;
    protected original_square_size: number | ((goban: GobanCore) => number) | "auto";
    protected player_id: number;
    protected puzzle_autoplace_delay: number;
    protected restrict_moves_to_movetree: boolean;
    protected review_had_gamedata: boolean;
    protected scoring_mode: boolean;
    //protected selectedThemeWatcher;
    protected shift_key_is_down: boolean;
    protected show_move_numbers: boolean;
    protected show_variation_move_numbers: boolean;
    protected square_size: number = 10;
    protected stone_placement_enabled: boolean;
    protected submitBlinkTimer?: ReturnType<typeof setTimeout>;
    protected sendLatencyTimer?: ReturnType<typeof setInterval>;
    //protected syncToCurrentReviewMove;
    //protected waiting_for_game_to_begin;
    //protected white_clock;
    //protected white_name;

    // todo remove this when we split out connection stuff
    protected socket: any;
    protected socket_event_bindings: Array<[string, () => void]> = [];
    protected game_connection_data: any;
    protected connectToReviewSent?: boolean;
    protected review_connection_data?: {
        auth: string;
        review_id: number;
        player_id: number;
    };
    //protected on_disconnects:Array<()=>void>;

    /** GobanCore calls some abstract methods as part of the construction
     *  process. Because our subsclasses might (and do) need to do some of their
     *  own config before these are called, we set this function to be called
     *  by our subclass after it's done it's own internal config stuff.
     */
    protected post_config_constructor: () => GoEngine;

    public abstract enablePen(): void;
    public abstract disablePen(): void;
    public abstract clearAnalysisDrawing(): void;
    public abstract drawPenMarks(penmarks: MoveTreePenMarks): void;
    public abstract message(msg: string, timeout?: number): void;
    public abstract clearMessage(): void;
    protected abstract setThemes(themes: GobanSelectedThemes, dont_redraw: boolean): void;
    public abstract drawSquare(i: number, j: number): void;
    public abstract redraw(force_clear?: boolean): void;
    public abstract move_tree_redraw(no_warp?: boolean): void;
    public abstract setMoveTreeContainer(container: HTMLElement): void;
    protected abstract setTitle(title: string): void;
    protected abstract enableDrawing(): void;
    protected abstract disableDrawing(): void;

    public static hooks: GobanHooks = {
        getClockDrift: () => 0,
    };

    constructor(config: GobanConfig, preloaded_data?: GobanConfig) {
        super();

        this.on("clock", (clock) => {
            if (clock) {
                this.last_emitted_clock = clock;
            }
        });

        this.goban_id = ++last_goban_id;

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
        this.destroyed = false;
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
        delete this.__clock_timer;
        this.setGameClock(null);
        this.last_stone_sound = -1;
        this.scoring_mode = false;

        /* TODO: Remove this after 5.0 and after doing a check to see if any of these still exist somehow */
        if ("game_type" in config && config.game_type === "temporary") {
            config.game_id = "tmp:" + config.game_id;
        }

        this.game_type = config.game_type || "";
        this.one_click_submit = "one_click_submit" in config ? !!config.one_click_submit : false;
        this.double_click_submit =
            "double_click_submit" in config ? !!config.double_click_submit : true;
        this.variation_stone_transparency =
            typeof config.variation_stone_transparency !== "undefined"
                ? config.variation_stone_transparency
                : 0.6;
        this.visual_undo_request_indicator =
            "visual_undo_request_indicator" in config
                ? !!config.visual_undo_request_indicator
                : false;
        this.original_square_size = config.square_size || "auto";
        //this.square_size = config["square_size"] || "auto";
        this.interactive = !!config.interactive;
        this.pen_marks = [];

        //this.engine = null;
        //this.last_move = null;
        this.config = repair_config(config);
        this.__draw_state = GoMath.makeStringMatrix(this.width, this.height);
        this.game_id = config.game_id || 0;
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
            this.message(e.message, 5000);
            if (this.onError) {
                this.onError(e);
            }
        };

        this.draw_top_labels = "draw_top_labels" in config ? !!config.draw_top_labels : true;
        this.draw_left_labels = "draw_left_labels" in config ? !!config.draw_left_labels : true;
        this.draw_right_labels = "draw_right_labels" in config ? !!config.draw_right_labels : true;
        this.draw_bottom_labels =
            "draw_bottom_labels" in config ? !!config.draw_bottom_labels : true;
        this.show_move_numbers = this.getShowMoveNumbers();
        this.show_variation_move_numbers = this.getShowVariationMoveNumbers();

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
        if (config.display_width && this.original_square_size === "auto") {
            this.display_width = config.display_width;
            let n_squares = Math.max(
                this.bounded_width + +this.draw_left_labels + +this.draw_right_labels,
                this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels,
            );

            if (isNaN(this.display_width)) {
                console.error("Invalid display width. (NaN)");
                this.display_width = 320;
            }

            if (isNaN(n_squares)) {
                console.error("Invalid n_squares: ", n_squares);
                console.error("bounded_width: ", this.bounded_width);
                console.error("this.draw_left_labels: ", this.draw_left_labels);
                console.error("this.draw_right_labels: ", this.draw_right_labels);
                console.error("bounded_height: ", this.bounded_height);
                console.error("this.draw_top_labels: ", this.draw_top_labels);
                console.error("this.draw_bottom_labels: ", this.draw_bottom_labels);
                n_squares = 19;
            }

            this.square_size = Math.floor(this.display_width / n_squares);
        }

        this.__update_move_tree = null;
        this.shift_key_is_down = false;

        this.post_config_constructor = (): GoEngine => {
            let ret: GoEngine;

            delete this.current_cmove; /* set in setConditionalTree */
            this.currently_my_cmove = false;
            this.setConditionalTree(undefined);

            delete this.last_hover_square;
            this.__last_pt = this.xy2ij(-1, -1);

            this.game_connection_data = {
                game_id: config.game_id,
                player_id: config.player_id,
                chat: config.connect_to_chat || 0,
                //"game_type": ("game_type" in config ? config.game_type : "temporary")
            };

            if ("auth" in config) {
                this.game_connection_data.auth = config.auth;
            }
            /*
            if ("archive_id" in config) {
                this.game_connection_data.archive_id = config.archive_id;
            }
            */

            this.review_connection_data = {
                auth: config.auth || "missing-auth",
                review_id: config.review_id || 0,
                player_id: config.player_id || 0,
            };

            if (preloaded_data) {
                ret = this.load(preloaded_data);
            } else {
                ret = this.load(config);
            }
            if ("server_socket" in config && config["server_socket"]) {
                if (!preloaded_data) {
                    this.message(_("Loading..."), -1);
                }
                this.connect(config["server_socket"]);
            }

            return ret;
        };
    }

    protected _socket_on(event: string, cb: any) {
        this.socket.on(event, cb);
        this.socket_event_bindings.push([event, cb]);
    }

    public static setHooks(hooks: GobanHooks): void {
        for (const name in hooks) {
            (GobanCore.hooks as any)[name] = (hooks as any)[name];
        }
    }

    protected getClockDrift(): number {
        if (GobanCore.hooks.getClockDrift) {
            return GobanCore.hooks.getClockDrift();
        }
        console.warn("getClockDrift not provided for Goban instance");
        return 0;
    }
    protected getNetworkLatency(): number {
        if (GobanCore.hooks.getNetworkLatency) {
            return GobanCore.hooks.getNetworkLatency();
        }
        console.warn("getNetworkLatency not provided for Goban instance");
        return 0;
    }
    protected getCoordinateDisplaySystem(): "A1" | "1-1" {
        if (GobanCore.hooks.getCoordinateDisplaySystem) {
            return GobanCore.hooks.getCoordinateDisplaySystem();
        }
        return "A1";
    }
    protected getShowMoveNumbers(): boolean {
        if (GobanCore.hooks.getShowMoveNumbers) {
            return GobanCore.hooks.getShowMoveNumbers();
        }
        return false;
    }
    protected getShowVariationMoveNumbers(): boolean {
        if (GobanCore.hooks.getShowVariationMoveNumbers) {
            return GobanCore.hooks.getShowVariationMoveNumbers();
        }
        return false;
    }
    public static getMoveTreeNumbering(): string {
        if (GobanCore.hooks.getMoveTreeNumbering) {
            return GobanCore.hooks.getMoveTreeNumbering();
        }
        return "move-number";
    }
    public static getCDNReleaseBase(): string {
        if (GobanCore.hooks.getCDNReleaseBase) {
            return GobanCore.hooks.getCDNReleaseBase();
        }
        return "";
    }
    public static getSoundEnabled(): boolean {
        if (GobanCore.hooks.getSoundEnabled) {
            return GobanCore.hooks.getSoundEnabled();
        }
        return true;
    }
    public static getSoundVolume(): number {
        if (GobanCore.hooks.getSoundVolume) {
            return GobanCore.hooks.getSoundVolume();
        }
        return 0.5;
    }
    protected defaultConfig(): any {
        if (GobanCore.hooks.defaultConfig) {
            return GobanCore.hooks.defaultConfig();
        }
        return {};
    }
    public isAnalysisDisabled(perGameSettingAppliesToNonPlayers: boolean = false): boolean {
        if (GobanCore.hooks.isAnalysisDisabled) {
            return GobanCore.hooks.isAnalysisDisabled(this, perGameSettingAppliesToNonPlayers);
        }
        return false;
    }

    protected getLocation(): string {
        if (GobanCore.hooks.getLocation) {
            return GobanCore.hooks.getLocation();
        }
        return window.location.pathname;
    }
    protected getSelectedThemes(): GobanSelectedThemes {
        if (GobanCore.hooks.getSelectedThemes) {
            return GobanCore.hooks.getSelectedThemes();
        }
        //return {white:'Plain', black:'Plain', board:'Plain'};
        //return {white:'Plain', black:'Plain', board:'Kaya'};
        return { white: "Shell", black: "Slate", board: "Kaya" };
    }
    protected connect(server_socket: any): void {
        const socket = (this.socket = server_socket);

        this.disconnectedFromGame = false;
        //this.on_disconnects = [];

        const send_connect_message = () => {
            if (this.disconnectedFromGame) {
                return;
            }

            if (this.review_id) {
                this.connectToReviewSent = true;
                this.done_loading_review = false;
                this.setTitle(_("Review"));
                if (!this.disconnectedFromGame) {
                    socket.send("review/connect", this.review_connection_data);
                }
                this.emit("chat-reset");
            } else if (this.game_id) {
                if (!this.disconnectedFromGame) {
                    socket.send("game/connect", this.game_connection_data);
                }
            }

            if (!this.sendLatencyTimer) {
                const sendLatency = () => {
                    if (!this.interactive) {
                        return;
                    }
                    if (!this.isCurrentUserAPlayer()) {
                        return;
                    }
                    if (!GobanCore.hooks.getNetworkLatency) {
                        return;
                    }
                    const latency = GobanCore.hooks.getNetworkLatency();
                    if (!latency) {
                        return;
                    }

                    //console.log("Sending latency", this.getNetworkLatency());
                    this.socket.send("game/latency", {
                        auth: this.config.auth,
                        game_id: this.config.game_id,
                        player_id: this.config.player_id,
                        latency: this.getNetworkLatency(),
                    });
                };
                this.sendLatencyTimer = setInterval(sendLatency, 5000);
                sendLatency();
            }
        };

        if (socket.connected) {
            send_connect_message();
        }

        this._socket_on("connect", send_connect_message);
        this._socket_on("disconnect", (): void => {
            if (this.disconnectedFromGame) {
                return;
            }
        });

        let reconnect = false;

        this._socket_on("connect", () => {
            if (this.disconnectedFromGame) {
                return;
            }
            if (reconnect) {
                this.emit("audio-reconnected");
            }
            reconnect = true;
        });
        this._socket_on("disconnect", (): void => {
            if (this.disconnectedFromGame) {
                return;
            }
            this.emit("audio-disconnected");
        });

        let prefix = null;

        if (this.game_id) {
            prefix = "game/" + this.game_id + "/";
        }
        if (this.review_id) {
            prefix = "review/" + this.review_id + "/";
        }

        this._socket_on(prefix + "reset", (msg: any): void => {
            if (this.disconnectedFromGame) {
                return;
            }
            this.emit("reset", msg);

            if (msg.gamestart_beep) {
                this.emit("audio-game-started", { player_id: msg.player_to_move });
            }
            if (msg.message) {
                if (
                    !(window as any)["has_focus"] &&
                    !(window as any)["user"].anonymous &&
                    /^\/game\//.test(this.getLocation())
                ) {
                    swal(_(msg.message));
                } else {
                    console.info(msg.message);
                }
            }
            console.info("Game connection reset");
        });
        this._socket_on(prefix + "error", (msg: any): void => {
            if (this.disconnectedFromGame) {
                return;
            }
            this.emit("error", msg);
            let duration = 500;

            if (msg === "This is a protected game" || msg === "This is a protected review") {
                duration = -1;
            }

            this.message(_(msg), duration);
            console.error("ERROR: ", msg);
        });

        /*****************/
        /*** Game mode ***/
        /*****************/
        if (this.game_id) {
            this._socket_on(prefix + "gamedata", (obj: GobanConfig): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.clearMessage();
                //this.onClearChatLogs();

                this.emit("chat-reset");
                focus_tracker.reset();

                if (this.last_phase && this.last_phase !== "finished" && obj.phase === "finished") {
                    const winner = obj.winner;
                    let winner_color: "black" | "white" | undefined;
                    if (typeof winner === "number") {
                        winner_color = winner === obj.black_player_id ? "black" : "white";
                    } else if (winner === "black" || winner === "white") {
                        winner_color = winner;
                    }

                    if (winner_color) {
                        this.emit("audio-game-ended", winner_color);
                    }
                }
                if (obj.phase) {
                    this.last_phase = obj.phase;
                } else {
                    console.warn(`Game gameata missing phase`);
                }
                this.load(obj);
                this.emit("gamedata", obj);
            });
            this._socket_on(prefix + "chat", (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                obj.line.channel = obj.channel;
                this.chat_log.push(obj.line);
                this.emit("chat", obj.line);
            });
            this._socket_on(prefix + "reset-chats", (): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                this.emit("chat-reset");
            });
            this._socket_on(prefix + "chat/remove", (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                this.emit("chat-remove", obj);
            });
            this._socket_on(prefix + "message", (msg: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                this.message(msg);
            });
            delete this.last_phase;

            this._socket_on(prefix + "latency", (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                if (this.engine) {
                    if (!this.engine.latencies) {
                        this.engine.latencies = {};
                    }
                    this.engine.latencies[obj.player_id] = obj.latency;
                }
            });
            this._socket_on(prefix + "clock", (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.clock_should_be_paused_for_move_submission = false;
                this.setGameClock(obj);

                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "phase", (new_phase: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.setMode("play");
                if (new_phase !== "finished") {
                    this.engine.clearRemoved();
                }

                if (this.engine.phase !== new_phase) {
                    if (new_phase === "stone removal") {
                        this.emit("audio-enter-stone-removal");
                    }
                    if (new_phase === "play" && this.engine.phase === "stone removal") {
                        this.emit("audio-resume-game-from-stone-removal");
                    }
                }

                this.engine.phase = new_phase;

                if (this.engine.phase === "stone removal") {
                    this.autoScore();
                } else {
                    delete this.auto_scoring_done;
                }

                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "undo_requested", (move_number: string): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.engine.undo_requested = parseInt(move_number);
                this.emit("update");
                this.emit("audio-undo-requested");
                if (this.visual_undo_request_indicator) {
                    this.redraw(true); // need to update the mark on the last move
                }
            });
            this._socket_on(prefix + "undo_accepted", (): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                if (!this.engine.undo_requested) {
                    console.warn("Undo accepted, but no undo requested, we might be out of sync");
                    swal(
                        "Game synchronization error related to undo, please reload your game page",
                    );
                    return;
                }

                this.engine.undo_requested = undefined;

                this.setMode("play");
                this.engine.showPrevious();
                this.engine.setLastOfficialMove();

                this.setConditionalTree();

                this.engine.undo_requested = undefined;
                this.updateTitleAndStonePlacement();
                this.emit("update");
                this.emit("audio-undo-granted");
            });
            this._socket_on(prefix + "move", (move_obj: any): void => {
                try {
                    if (this.disconnectedFromGame) {
                        return;
                    }
                    focus_tracker.reset();

                    if (move_obj.game_id !== this.game_id) {
                        console.error(
                            "Invalid move for this game received [" + this.game_id + "]",
                            move_obj,
                        );
                        return;
                    }
                    const move = move_obj.move;

                    if (this.isInPushedAnalysis()) {
                        this.leavePushedAnalysis();
                    }

                    /* clear any undo state that may be hanging around */
                    this.engine.undo_requested = undefined;

                    const mv = this.engine.decodeMoves(move);

                    if (mv.length > 1) {
                        console.warn(
                            "More than one move provided in encoded move in a `move` event.  That's odd.",
                        );
                    }

                    const the_move = mv[0];

                    if (this.mode === "conditional" || this.mode === "play") {
                        this.setMode("play");
                    }

                    let jumptomove = null;
                    if (
                        this.engine.cur_move.id !== this.engine.last_official_move.id &&
                        ((this.engine.cur_move.parent == null &&
                            this.engine.cur_move.trunk_next != null) ||
                            this.engine.cur_move.parent?.id !== this.engine.last_official_move.id)
                    ) {
                        jumptomove = this.engine.cur_move;
                    }
                    this.engine.jumpToLastOfficialMove();

                    if (this.engine.playerToMove() !== this.player_id) {
                        const t = this.conditional_tree.getChild(
                            GoMath.encodeMove(the_move.x, the_move.y),
                        );
                        t.move = null;
                        this.setConditionalTree(t);
                    }

                    if (this.engine.getMoveNumber() !== move_obj.move_number - 1) {
                        this.message(_("Synchronization error, reloading"));
                        setTimeout(() => {
                            window.location.href = window.location.href;
                        }, 2500);
                        console.error(
                            "Synchronization error, we thought move should be " +
                                this.engine.getMoveNumber() +
                                " server thought it should be " +
                                (move_obj.move_number - 1),
                        );

                        return;
                    }

                    const score_before_move =
                        this.engine.computeScore(true)[this.engine.colorToMove()].prisoners;

                    let removed_count = 0;
                    if (the_move.edited) {
                        this.engine.editPlace(the_move.x, the_move.y, the_move.color || 0);
                    } else {
                        removed_count = this.engine.place(
                            the_move.x,
                            the_move.y,
                            false,
                            false,
                            false,
                            true,
                            true,
                        );
                    }

                    if (the_move.player_update && this.engine.player_pool) {
                        //console.log("`move` got player update:", the_move.player_update);
                        this.engine.cur_move.player_update = the_move.player_update;
                        this.engine.updatePlayers(the_move.player_update);
                    }

                    if (the_move.played_by) {
                        this.engine.cur_move.played_by = the_move.played_by;
                    }

                    this.setLastOfficialMove();
                    delete this.move_selected;

                    if (jumptomove) {
                        this.engine.jumpTo(jumptomove);
                    }

                    this.emit("update");
                    this.playMovementSound();
                    if (removed_count) {
                        console.log("audio-capture-stones", {
                            count: removed_count,
                            already_captured: score_before_move,
                        });
                        this.emit("audio-capture-stones", {
                            count: removed_count,
                            already_captured: score_before_move,
                        });
                    }

                    this.emit("move-made");

                    /*
                    if (this.move_number) {
                        this.move_number.text(this.engine.getMoveNumber());
                    }
                    */
                } catch (e) {
                    console.error(e);
                }
            });

            this._socket_on(prefix + "player_update", (player_update: JGOFPlayerSummary): void => {
                try {
                    let jumptomove = null;
                    if (
                        this.engine.cur_move.id !== this.engine.last_official_move.id &&
                        ((this.engine.cur_move.parent == null &&
                            this.engine.cur_move.trunk_next != null) ||
                            this.engine.cur_move.parent?.id !== this.engine.last_official_move.id)
                    ) {
                        jumptomove = this.engine.cur_move;
                    }
                    this.engine.jumpToLastOfficialMove();

                    this.engine.cur_move.player_update = player_update;
                    this.engine.updatePlayers(player_update);

                    if (this.mode === "conditional" || this.mode === "play") {
                        this.setMode("play");
                    } else {
                        console.warn("unexpected player_update received!");
                    }

                    if (jumptomove) {
                        this.engine.jumpTo(jumptomove);
                    }
                } catch (e) {
                    console.error(e);
                }
                this.emit("player-update", player_update);
            });

            this._socket_on(
                prefix + "conditional_moves",
                (cmoves: {
                    player_id: number;
                    move_number: number;
                    moves: ConditionalMoveResponse | null;
                }): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    if (cmoves.moves == null) {
                        this.setConditionalTree();
                    } else {
                        this.setConditionalTree(GoConditionalMove.decode(cmoves.moves));
                    }
                },
            );
            this._socket_on(prefix + "removed_stones", (cfg: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                if ("strict_seki_mode" in cfg) {
                    this.engine.strict_seki_mode = cfg.strict_seki_mode;
                } else {
                    const removed = cfg.removed;
                    const stones = cfg.stones;
                    let moves: Array<Move>;
                    if (!stones) {
                        moves = [];
                    } else {
                        moves = this.engine.decodeMoves(stones);
                    }

                    for (let i = 0; i < moves.length; ++i) {
                        this.engine.setRemoved(moves[i].x, moves[i].y, removed);
                    }
                }
                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "removed_stones_accepted", (cfg: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                const player_id = cfg.player_id;
                const stones = cfg.stones;

                if (player_id === 0) {
                    this.engine.players["white"].accepted_stones = stones;
                    this.engine.players["black"].accepted_stones = stones;
                } else {
                    this.engine.players[
                        this.engine.playerColor(player_id) as "black" | "white"
                    ].accepted_stones = stones;
                    this.engine.players[
                        this.engine.playerColor(player_id) as "black" | "white"
                    ].accepted_strict_seki_mode =
                        "strict_seki_mode" in cfg ? cfg.strict_seki_mode : false;
                }
                this.updateTitleAndStonePlacement();
                this.emit("stone-removal.accepted");
                this.emit("update");
            });

            const auto_resign_state: { [id: number]: boolean } = {};

            this._socket_on(prefix + "auto_resign", (obj: any) => {
                this.emit("auto-resign", {
                    game_id: obj.game_id,
                    player_id: obj.player_id,
                    expiration: obj.expiration,
                });
                auto_resign_state[obj.player_id] = true;
                this.emit("audio-other-player-disconnected", {
                    player_id: obj.player_id,
                });
            });
            this._socket_on(prefix + "clear_auto_resign", (obj: any) => {
                this.emit("clear-auto-resign", {
                    game_id: obj.game_id,
                    player_id: obj.player_id,
                });
                if (auto_resign_state[obj.player_id]) {
                    this.emit("audio-other-player-reconnected", {
                        player_id: obj.player_id,
                    });
                    delete auto_resign_state[obj.player_id];
                }
            });
        }

        /*******************/
        /*** Review mode ***/
        /*******************/
        let bulk_processing = false;
        const process_r = (obj: ReviewMessage) => {
            if (this.disconnectedFromGame) {
                return;
            }

            if (obj.chat) {
                obj.chat.channel = "discussion";
                if (!obj.chat.chat_id) {
                    obj.chat.chat_id = obj.chat.player_id + "." + obj.chat.date;
                }
                this.chat_log.push(obj.chat as any);
                this.emit("chat", obj.chat);
            }

            if (obj["remove-chat"]) {
                this.emit("chat-remove", { chat_ids: [obj["remove-chat"]] });
            }

            if (obj.gamedata) {
                if (obj.gamedata.phase === "stone removal") {
                    obj.gamedata.phase = "finished";
                }

                this.load(obj.gamedata);
                this.review_had_gamedata = true;
            }

            if (obj.player_update && this.engine.player_pool) {
                console.log("process_r got player update:", obj.player_update);
                this.engine.updatePlayers(obj.player_update);
            }

            if (obj.owner) {
                this.review_owner_id = typeof obj.owner === "object" ? obj.owner.id : obj.owner;
            }
            if (obj.controller) {
                this.review_controller_id =
                    typeof obj.controller === "object" ? obj.controller.id : obj.controller;
            }

            if (
                !this.isPlayerController() ||
                !this.done_loading_review ||
                "om" in obj /* official moves are always alone in these object broadcasts */ ||
                "undo" in obj /* official moves are always alone in these object broadcasts */
            ) {
                const curmove = this.engine.cur_move;
                const follow =
                    this.engine.cur_review_move == null ||
                    this.engine.cur_review_move.id === curmove.id;
                let do_redraw = false;
                if ("f" in obj && typeof obj.m === "string") {
                    /* specifying node */
                    const t = this.done_loading_review;
                    this.done_loading_review =
                        false; /* this prevents drawing from being drawn when we do a follow path. */
                    this.engine.followPath(obj.f || 0, obj.m);
                    this.drawSquare(this.engine.cur_move.x, this.engine.cur_move.y);
                    this.done_loading_review = t;
                    this.engine.setAsCurrentReviewMove();
                    this.scheduleRedrawPenLayer();
                }

                if ("om" in obj) {
                    /* Official move [comes from live review of game] */
                    const t = this.engine.cur_review_move || this.engine.cur_move;
                    const mv = this.engine.decodeMoves([obj.om] as any)[0];
                    const follow_om = t.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.place(mv.x, mv.y, false, false, true, true, true);
                    this.engine.setLastOfficialMove();
                    if (
                        (t.x !== mv.x ||
                            t.y !== mv.y) /* case when a branch has been promoted to trunk */ &&
                        !follow_om
                    ) {
                        /* case when they were on a last official move, autofollow to next */
                        this.engine.jumpTo(t);
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.move_tree_redraw();
                    }
                }

                if ("undo" in obj) {
                    /* Official undo move [comes from live review of game] */
                    const t = this.engine.cur_review_move;
                    const cur_move_undone =
                        this.engine.cur_review_move?.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.showPrevious();
                    this.engine.setLastOfficialMove();
                    if (!cur_move_undone) {
                        if (t) {
                            this.engine.jumpTo(t);
                        } else {
                            console.warn(
                                `No valid move to jump back to in review game relay of undo`,
                            );
                        }
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.move_tree_redraw();
                    }
                }

                if (this.engine.cur_review_move) {
                    if (typeof obj["t"] === "string") {
                        /* set text */
                        this.engine.cur_review_move.text = obj["t"];
                    }
                    if ("t+" in obj) {
                        /* append to text */
                        this.engine.cur_review_move.text += obj["t+"];
                    }
                    if (typeof obj.k !== "undefined") {
                        /* set marks */
                        const t = this.engine.cur_move;
                        this.engine.cur_review_move.clearMarks();
                        this.engine.cur_move = this.engine.cur_review_move;
                        this.setMarks(obj["k"], this.engine.cur_move.id !== t.id);
                        this.engine.cur_move = t;
                    }
                    if ("clearpen" in obj) {
                        this.engine.cur_review_move.pen_marks = [];
                        this.scheduleRedrawPenLayer();
                        do_redraw = false;
                    }
                    if ("delete" in obj) {
                        const t = this.engine.cur_review_move.parent;
                        this.engine.cur_review_move.remove();
                        this.engine.jumpTo(t);
                        this.engine.setAsCurrentReviewMove();
                        this.scheduleRedrawPenLayer();
                        if (this.done_loading_review) {
                            this.move_tree_redraw();
                        }
                    }
                    if (typeof obj.pen !== "undefined") {
                        /* start pen */
                        this.engine.cur_review_move.pen_marks.push({
                            color: obj["pen"],
                            points: [],
                        });
                    }
                    if (typeof obj.pp !== "undefined") {
                        /* update pen marks */
                        try {
                            const pts =
                                this.engine.cur_review_move.pen_marks[
                                    this.engine.cur_review_move.pen_marks.length - 1
                                ].points;
                            this.engine.cur_review_move.pen_marks[
                                this.engine.cur_review_move.pen_marks.length - 1
                            ].points = pts.concat(obj["pp"]);
                            this.scheduleRedrawPenLayer();
                            do_redraw = false;
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }

                if (this.done_loading_review) {
                    if (!follow) {
                        this.engine.jumpTo(curmove);
                        this.move_tree_redraw();
                    } else {
                        if (do_redraw) {
                            this.redraw(true);
                        }
                        if (!this.__update_move_tree) {
                            this.__update_move_tree = setTimeout(() => {
                                this.__update_move_tree = null;
                                this.updateOrRedrawMoveTree();
                                this.emit("update");
                            }, 100);
                        }
                    }
                }
            }

            if ("controller" in obj) {
                if (!("owner" in obj)) {
                    /* only false at index 0 of the replay log */
                    if (this.isPlayerController()) {
                        this.emit("review.sync-to-current-move");
                    }
                    this.updateTitleAndStonePlacement();
                    const line = {
                        system: true,
                        chat_id: uuid(),
                        body: interpolate(_("Control passed to %s"), [
                            typeof obj.controller === "number"
                                ? `%%%PLAYER-${obj.controller}%%%`
                                : obj.controller?.username || "[missing controller name]",
                        ]),
                        channel: "system",
                    };
                    //this.chat_log.push(line);
                    this.emit("chat", line);
                    this.emit("update");
                }
            }
            if (!bulk_processing) {
                this.emit("review.updated");
            }
        };

        if (this.review_id) {
            this._socket_on(prefix + "full_state", (entries: Array<ReviewMessage>) => {
                console.log("processing fullstate");
                try {
                    if (!entries || entries.length === 0) {
                        console.error("Blank full state received, ignoring");
                        return;
                    }
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    this.disableDrawing();
                    /* TODO: Clear our state here better */

                    this.emit("review.load-start");
                    bulk_processing = true;
                    for (let i = 0; i < entries.length; ++i) {
                        process_r(entries[i]);
                    }
                    bulk_processing = false;

                    this.enableDrawing();
                    /*
                    if (this.isPlayerController()) {
                        this.done_loading_review = true;
                        this.drawPenMarks(this.engine.cur_move.pen_marks);
                        this.redraw(true);
                        return;
                    }
                    */

                    this.done_loading_review = true;
                    this.drawPenMarks(this.engine.cur_move.pen_marks);
                    this.emit("review.load-end");
                    this.emit("review.updated");
                    this.move_tree_redraw();
                    this.redraw(true);
                } catch (e) {
                    console.error(e);
                }
            });
            this._socket_on(prefix + "r", process_r);
        }

        return socket;
    }
    public destroy(): void {
        this.emit("destroy");
        //delete window['active_gobans'][this.goban_id];
        this.destroyed = true;
        if (this.socket) {
            this.disconnect();
        }
        if (this.sendLatencyTimer) {
            clearInterval(this.sendLatencyTimer);
            delete this.sendLatencyTimer;
        }

        /* Clear various timeouts that may be running */
        this.clock_should_be_paused_for_move_submission = false;
        this.setGameClock(null);
        if (this.submitBlinkTimer) {
            clearTimeout(this.submitBlinkTimer);
            delete this.submitBlinkTimer;
        }
    }
    protected disconnect(): void {
        this.emit("destroy");
        if (!this.disconnectedFromGame) {
            this.disconnectedFromGame = true;
            if (this.socket) {
                if (this.review_id) {
                    this.socket.send("review/disconnect", { review_id: this.review_id });
                }
                if (this.game_id) {
                    this.socket.send("game/disconnect", { game_id: this.game_id });
                }
            }
        }
        for (const pair of this.socket_event_bindings) {
            this.socket.off(pair[0], pair[1]);
        }
        this.socket_event_bindings = [];
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

    public sendChat(msg_body: string, type: string) {
        if (typeof msg_body === "string" && msg_body.length === 0) {
            return;
        }

        const msg: any = {
            body: msg_body,
        };

        let where = null;
        if (this.game_id) {
            where = "game/chat";
            msg["type"] = type;
            msg["game_id"] = this.config.game_id;
            msg["move_number"] = this.engine.getCurrentMoveNumber();
        } else {
            const diff = this.engine.getMoveDiff();
            where = "review/chat";
            msg["review_id"] = this.config.review_id;
            msg["from"] = diff.from;
            msg["moves"] = diff.moves;
        }

        this.socket.send(where, msg);
    }

    protected getWidthForSquareSize(square_size: number): number {
        return (
            (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels) * square_size
        );
    }
    protected xy2ij(x: number, y: number): { i: number; j: number; valid: boolean } {
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
        if (border_distance < 0.1) {
            // have a "dead zone" in between squares to avoid misclicks
            i = -1;
            j = -1;
        }
        return { i: i, j: j, valid: i >= 0 && j >= 0 && i < this.width && j < this.height };
    }
    public setAnalyzeTool(tool: AnalysisTool, subtool: AnalysisSubTool) {
        this.analyze_tool = tool;
        this.analyze_subtool = subtool;
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

    protected putOrClearLabel(x: number, y: number, mode?: "put" | "clear"): boolean {
        let ret = false;
        if (mode == null || typeof mode === "undefined") {
            if (this.analyze_subtool === "letters" || this.analyze_subtool === "numbers") {
                this.label_mark = this.label_character;
                ret = this.toggleMark(x, y, this.label_character, true);
                if (ret === true) {
                    this.incrementLabelCharacter();
                } else {
                    this.setLabelCharacterFromMarks();
                }
            } else {
                this.label_mark = this.analyze_subtool;
                ret = this.toggleMark(x, y, this.analyze_subtool);
            }
        } else {
            if (mode === "put") {
                ret = this.toggleMark(x, y, this.label_mark, this.label_mark.length <= 3, true);
            } else {
                const marks = this.getMarks(x, y);

                for (let i = 0; i < MARK_TYPES.length; ++i) {
                    delete marks[MARK_TYPES[i]];
                }
                this.drawSquare(x, y);
            }
        }

        this.syncReviewMove();
        return ret;
    }
    public setSquareSize(new_ss: number): void {
        const redraw = this.square_size !== new_ss;
        this.square_size = new_ss;
        if (redraw) {
            this.redraw(true);
        }
    }
    public setSquareSizeBasedOnDisplayWidth(display_width: number): void {
        let n_squares = Math.max(
            this.bounded_width + +this.draw_left_labels + +this.draw_right_labels,
            this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels,
        );
        this.display_width = display_width;

        if (isNaN(this.display_width)) {
            console.error("Invalid display width. (NaN)");
            this.display_width = 320;
        }

        if (isNaN(n_squares)) {
            console.error("Invalid n_squares: ", n_squares);
            console.error("bounded_width: ", this.bounded_width);
            console.error("this.draw_left_labels: ", this.draw_left_labels);
            console.error("this.draw_right_labels: ", this.draw_right_labels);
            console.error("bounded_height: ", this.bounded_height);
            console.error("this.draw_top_labels: ", this.draw_top_labels);
            console.error("this.draw_bottom_labels: ", this.draw_bottom_labels);
            n_squares = 19;
        }

        this.setSquareSize(Math.floor(this.display_width / n_squares));
    }

    public setStrictSekiMode(tf: boolean): void {
        if (this.engine.phase !== "stone removal") {
            throw "Not in stone removal phase";
        }
        if (this.engine.strict_seki_mode === tf) {
            return;
        }
        this.engine.strict_seki_mode = tf;

        this.socket.send("game/removed_stones/set", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
            strict_seki_mode: tf,
        });
    }
    public computeMetrics(): GobanMetrics {
        if (!this.square_size || this.square_size <= 0) {
            this.square_size = 12;
        }

        const ret = {
            width:
                this.square_size *
                (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels),
            height:
                this.square_size *
                (this.bounded_height + +this.draw_top_labels + +this.draw_bottom_labels),
            mid: this.square_size / 2,
            offset: 0,
        };

        if (this.square_size % 2 === 0) {
            ret.mid -= 0.5;
            ret.offset = 0.5;
        }

        return ret;
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

    protected computeThemeStoneRadius(): number {
        // Scale proportionally in general
        let r = this.square_size * 0.488;

        // Prevent pixel sharing in low-res
        if (this.square_size % 2 === 0) {
            r = Math.min(r, (this.square_size - 1) / 2);
        }

        return Math.max(1, r);
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

    public load(config: GobanConfig): GoEngine {
        config = repair_config(config);
        for (const k in config) {
            (this.config as any)[k] = (config as any)[k];
        }
        this.clearMessage();
        this.width = config.width || 19;
        this.height = config.height || 19;
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

        if (config.display_width && this.original_square_size === "auto") {
            this.display_width = config["display_width"];
            if (isNaN(this.display_width)) {
                console.error("Invalid display width. (NaN)");
                this.display_width = 320;
            }
            let n_squares = Math.max(
                this.bounded_width + +this.draw_left_labels + +this.draw_right_labels,
                this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels,
            );
            if (isNaN(n_squares)) {
                console.error("Invalid n_squares: ", n_squares);
                console.error("bounded_width: ", this.bounded_width);
                console.error("this.draw_left_labels: ", this.draw_left_labels);
                console.error("this.draw_right_labels: ", this.draw_right_labels);
                console.error("bounded_height: ", this.bounded_height);
                console.error("this.draw_top_labels: ", this.draw_top_labels);
                console.error("this.draw_bottom_labels: ", this.draw_bottom_labels);
                n_squares = 19;
            }

            this.square_size = Math.floor(this.display_width / n_squares);
        }

        if (
            !this.__draw_state ||
            this.__draw_state.length !== this.height ||
            this.__draw_state[0].length !== this.width
        ) {
            this.__draw_state = GoMath.makeStringMatrix(this.width, this.height);
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
        this.engine = new GoEngine(config, this);
        this.engine.parentEventEmitter = this;
        this.engine.getState_callback = () => {
            return this.getState();
        };
        this.engine.setState_callback = (state) => {
            return this.setState(state);
        };

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

        if (
            !(
                old_engine &&
                old_engine.boardMatriciesAreTheSame(old_engine.board, this.engine.board)
            )
        ) {
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
        this.setLastOfficialMove();
        this.emit("update");

        if (
            this.engine.phase === "stone removal" &&
            !("auto_scoring_done" in this) &&
            !("auto_scoring_done" in (this as any).engine)
        ) {
            (this as any).autoScore();
        }

        this.emit("load", config);
        return this.engine;
    }
    public set(x: number, y: number, player: JGOFNumericPlayerColor): void {
        this.markDirty();
    }
    public setForRemoval(x: number, y: number, removed: number) {
        if (removed) {
            this.getMarks(x, y).stone_removed = true;
            this.getMarks(x, y).remove = true;
        } else {
            this.getMarks(x, y).stone_removed = false;
            this.getMarks(x, y).remove = false;
        }
        this.drawSquare(x, y);
        this.emit("set-for-removal", { x, y, removed: !!removed });
        this.emit("stone-removal.updated");
    }
    public showScores(score: Score): void {
        this.hideScores();
        this.showing_scores = true;

        for (let i = 0; i < 2; ++i) {
            const color: "black" | "white" = i ? "black" : "white";
            const moves = this.engine.decodeMoves(score[color].scoring_positions);
            for (let j = 0; j < moves.length; ++j) {
                const mv = moves[j];
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
                    this.getMarks(i, j).score = false;
                    this.drawSquare(i, j);
                }
            }
        }
    }

    public updatePlayerToMoveTitle(): void {
        switch (this.engine.phase) {
            case "play":
                if (
                    this.player_id &&
                    this.player_id === this.engine.playerToMove() &&
                    this.mode !== "edit" &&
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
                    let color = this.engine.playerColor(this.engine.playerToMove());
                    if (this.mode === "edit" && this.edit_color) {
                        color = this.edit_color;
                    }

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

        /*
        if (this.engine.phase === "play" || (this.engine.phase === "finished" && this.mode === "analyze")) {
            let color = this.engine.playerColor(this.engine.playerToMove());
            if (this.mode === "edit" && this.edit_color) {
                color = this.edit_color;
            }
        }
        */

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
    public deleteBranch(): void {
        if (!this.engine.cur_move.trunk) {
            if (this.isPlayerController()) {
                this.syncReviewMove({ delete: 1 });
            }
            this.engine.deleteCurMove();
            this.emit("update");
            this.move_tree_redraw();
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
                case "edit":
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

    public setConditionalTree(conditional_tree?: GoConditionalMove): void {
        if (typeof conditional_tree === "undefined") {
            this.conditional_tree = new GoConditionalMove(null);
        } else {
            this.conditional_tree = conditional_tree;
        }
        this.current_cmove = this.conditional_tree;

        this.emit("conditional-moves.updated");
        this.emit("update");
    }
    public followConditionalPath(movepath: string) {
        const moves = this.engine.decodeMoves(movepath);
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
                cmove = new GoConditionalMove(null, this.current_cmove);
                this.current_cmove.children[mv] = cmove;
            }
            this.current_cmove = cmove;
        }

        this.currently_my_cmove = !this.currently_my_cmove;
        this.emit("conditional-moves.updated");
    }
    protected deleteConditionalSegment(x: number, y: number) {
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
    public deleteConditionalPath(movepath: string): void {
        const moves = this.engine.decodeMoves(movepath);
        if (moves.length) {
            for (let i = 0; i < moves.length - 1; ++i) {
                if (i !== moves.length - 2) {
                    this.engine.place(moves[i].x, moves[i].y);
                }
                this.followConditionalSegment(moves[i].x, moves[i].y);
            }
            this.deleteConditionalSegment(moves[moves.length - 1].x, moves[moves.length - 1].y);
        }
        this.emit("conditional-moves.updated");
    }
    public getCurrentConditionalPath(): string {
        return this.conditional_path;
    }
    public saveConditionalMoves(): void {
        this.socket.send("game/conditional_moves/set", {
            auth: this.config.auth,
            move_number: this.engine.getCurrentMoveNumber(),
            game_id: this.config.game_id,
            player_id: this.config.player_id,
            cmoves: this.conditional_tree.encode(),
        });
        this.emit("conditional-moves.updated");
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
            swal("Can't enter conditional move planning when it's your turn");
            return false;
        }

        this.setSubmit();

        if (
            [
                "play",
                "analyze",
                "conditional",
                "edit",
                "score estimation",
                "pattern search",
                "puzzle",
            ].indexOf(mode) === -1
        ) {
            swal("Invalid mode for Goban: " + mode);
            return false;
        }

        if (
            this.engine.config.disable_analysis &&
            this.engine.phase !== "finished" &&
            (mode === "analyze" || mode === "conditional")
        ) {
            swal("Unable to enter " + mode + " mode");
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
    public resign(): void {
        this.socket.send("game/resign", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    protected sendPendingResignation(): void {
        this.socket.send("game/delayed_resign", {
            auth: this.config.auth,
            game_id: this.config.game_id,
        });
    }
    protected clearPendingResignation(): void {
        this.socket.send("game/clear_delayed_resign", {
            auth: this.config.auth,
            game_id: this.config.game_id,
        });
    }
    public cancelGame(): void {
        this.socket.send("game/cancel", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    protected annul(): void {
        this.socket.send("game/annul", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    public pass(): void {
        this.engine.place(-1, -1);
        if (this.mode === "play") {
            this.sendMove({
                auth: this.config.auth,
                game_id: this.config.game_id,
                player_id: this.config.player_id,
                move: encodeMove(-1, -1),
            });
        } else {
            this.syncReviewMove();
            this.move_tree_redraw();
        }
    }
    public requestUndo(): void {
        this.socket.send("game/undo/request", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
            move_number: this.engine.getCurrentMoveNumber(),
        });
    }
    public acceptUndo(): void {
        this.socket.send("game/undo/accept", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
            move_number: this.engine.getCurrentMoveNumber(),
        });
    }
    public pauseGame(): void {
        this.socket.send("game/pause", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    public resumeGame(): void {
        this.socket.send("game/resume", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }

    public acceptRemovedStones(): void {
        const stones = this.engine.getStoneRemovalString();
        this.engine.players[
            this.engine.playerColor(this.config.player_id) as "black" | "white"
        ].accepted_stones = stones;
        this.socket.send("game/removed_stones/accept", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
            stones: stones,
            strict_seki_mode: this.engine.strict_seki_mode,
        });
    }
    public rejectRemovedStones(): void {
        delete this.engine.players[
            this.engine.playerColor(this.config.player_id) as "black" | "white"
        ].accepted_stones;
        this.socket.send("game/removed_stones/reject", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    public setEditColor(color: "black" | "white"): void {
        this.edit_color = color;
        this.updateTitleAndStonePlacement();
    }
    protected editSettings(changes: GoEngineConfig): void {
        let need_to_change = false;
        for (const k in changes) {
            if ((this.engine as any)[k] !== (changes as any)[k]) {
                need_to_change = true;
                break;
            }
        }

        if (need_to_change) {
            /* this will send back a gamedata blob which will in turn update our own state */
            this.socket.send("editSettings", {
                auth: this.config.auth,
                game_id: this.config.game_id,
                player_id: this.config.player_id,
                changes: changes,
            });
        }
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
    protected setState(state: any): void {
        if ((this.game_type === "review" || this.game_type === "demo") && this.engine) {
            this.drawPenMarks(this.engine.cur_move.pen_marks);
            if (this.isPlayerController() && this.connectToReviewSent) {
                this.syncReviewMove();
            }
        }

        this.setLabelCharacterFromMarks();
        this.markDirty();
    }
    protected getState(): {} {
        /* This is a callback that gets called by GoEngine.getState to store board state in its state stack */
        const ret = {};
        return ret;
    }
    public giveReviewControl(player_id: number): void {
        this.syncReviewMove({ controller: player_id });
    }
    protected giveVoice(player_id: number): void {
        this.socket.send("review/voice/give", {
            review_id: this.review_id,
            voice_player: {
                id: player_id,
            },
        });
    }
    protected removeVoice(player_id: number): void {
        this.socket.send("review/voice/remove", {
            review_id: this.review_id,
            voice_player: {
                id: player_id,
            },
        });
    }

    public setMarks(marks: { [mark: string]: string }, dont_draw?: boolean): void {
        for (const key in marks) {
            const locations = this.engine.decodeMoves(marks[key]);
            for (let i = 0; i < locations.length; ++i) {
                const pt = locations[i];
                this.setMark(pt.x, pt.y, key, dont_draw);
            }
        }
    }
    public setHeatmap(heatmap: NumberMatrix, dont_draw?: boolean) {
        this.heatmap = heatmap;
        if (!dont_draw) {
            this.redraw(true);
        }
    }
    public setColoredCircles(circles: Array<ColoredCircle>, dont_draw?: boolean): void {
        if (!circles || circles.length === 0) {
            delete this.colored_circles;
            return;
        }

        this.colored_circles = GoMath.makeEmptyObjectMatrix<ColoredCircle>(this.width, this.height);
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

    public editPlaceByPrettyCoord(
        coord: string,
        color: JGOFNumericPlayerColor,
        isTrunkMove?: boolean,
    ): void {
        for (const mv of this.engine.decodeMoves(coord)) {
            this.engine.editPlace(mv.x, mv.y, color, isTrunkMove);
        }
    }
    public placeByPrettyCoord(coord: string): void {
        for (const mv of this.engine.decodeMoves(coord)) {
            this.engine.place(mv.x, mv.y);
        }
    }
    public setMarkByPrettyCoord(coord: string, mark: number | string, dont_draw?: boolean): void {
        for (const mv of this.engine.decodeMoves(coord)) {
            this.setMark(mv.x, mv.y, mark, dont_draw);
        }
    }
    public setMark(x: number, y: number, mark: number | string, dont_draw?: boolean): void {
        try {
            if (x >= 0 && y >= 0) {
                if (typeof mark === "number") {
                    mark = "" + mark;
                }

                if (mark.length <= 3 || parseFloat(mark)) {
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
        if (this.score_estimate) {
            const est = this.score_estimate.estimated_hard_score - this.engine.komi;
            if (GobanCore.hooks.updateScoreEstimation) {
                GobanCore.hooks.updateScoreEstimation(est > 0 ? "black" : "white", Math.abs(est));
            }
            if (this.config.onScoreEstimationUpdated) {
                this.config.onScoreEstimationUpdated(est > 0 ? "black" : "white", Math.abs(est));
            }
            this.emit("score_estimate", this.score_estimate);
        }
    }
    public autoScore(): void {
        try {
            if (
                !(window as any)["user"] ||
                !this.on_game_screen ||
                !this.engine ||
                (((window as any)["user"].id as number) !== this.engine.players.black.id &&
                    ((window as any)["user"].id as number) !== this.engine.players.white.id)
            ) {
                return;
            }
        } catch (e) {
            console.error(e.stack);
            return;
        }

        this.auto_scoring_done = true;

        this.message(_("Processing..."), -1);
        const do_score_estimation = () => {
            const se = new ScoreEstimator(
                this,
                this.engine,
                AUTOSCORE_TRIALS,
                Math.min(0.1, AUTOSCORE_TOLERANCE),
                true,
            );

            se.when_ready
                .then(() => {
                    const current_removed = this.engine.getStoneRemovalString();
                    const new_removed = se.getProbablyDead();

                    this.engine.clearRemoved();
                    const moves = this.engine.decodeMoves(new_removed);
                    for (let i = 0; i < moves.length; ++i) {
                        this.engine.setRemoved(moves[i].x, moves[i].y, true);
                    }

                    this.updateTitleAndStonePlacement();
                    this.emit("update");

                    this.socket.send("game/removed_stones/set", {
                        auth: this.config.auth,
                        game_id: this.config.game_id,
                        player_id: this.config.player_id,
                        removed: false,
                        stones: current_removed,
                    });
                    this.socket.send("game/removed_stones/set", {
                        auth: this.config.auth,
                        game_id: this.config.game_id,
                        player_id: this.config.player_id,
                        removed: true,
                        stones: new_removed,
                    });

                    this.clearMessage();
                })
                .catch((err) => {
                    console.error(err);
                    this.clearMessage();
                    this.message("Auto-scoring error: " + err, -1);
                });
        };

        setTimeout(() => {
            init_score_estimator()
                .then(do_score_estimation)
                .catch((err) => console.error(err));
        }, 10);
    }

    protected sendMove(mv: MoveCommand, cb?: () => void): void {
        if (!mv.blur) {
            mv.blur = focus_tracker.getMaxBlurDurationSinceLastReset();
            focus_tracker.reset();
        }
        this.setConditionalTree();

        // Add `.clock` to the move sent to the server
        if (this.player_id) {
            if (this.__clock_timer) {
                clearTimeout(this.__clock_timer);
                delete this.__clock_timer;
                this.clock_should_be_paused_for_move_submission = true;
            }

            const original_clock = this.last_clock;
            if (!original_clock) {
                throw new Error(`No last_clock when calling sendMove()`);
            }
            let color: "black" | "white";

            if (this.player_id === original_clock.black_player_id) {
                color = "black";
            } else if (this.player_id === original_clock.white_player_id) {
                color = "white";
            } else {
                throw new Error(`Player id ${this.player_id} not found in clock`);
            }

            if (color) {
                const clock_drift = GobanCore.hooks?.getClockDrift
                    ? GobanCore.hooks?.getClockDrift()
                    : 0;

                const current_server_time = Date.now() - clock_drift;

                const pause_control = this.pause_control;

                const paused = pause_control
                    ? isPaused(AdHocPauseControl2JGOFPauseState(pause_control))
                    : false;

                const elapsed: number = original_clock.start_mode
                    ? 0
                    : paused && original_clock.paused_since
                    ? Math.max(original_clock.paused_since, original_clock.last_move) -
                      original_clock.last_move
                    : current_server_time - original_clock.last_move;

                const clock = this.computeNewPlayerClock(
                    original_clock[`${color}_time`] as any,
                    true,
                    elapsed,
                    this.config.time_control as any,
                );

                mv.clock = clock;
            } else {
                throw new Error(`No color for player_id ${this.player_id}`);
            }
        }

        // Send the move. If we aren't getting a response, show a message
        // indicating such and try reloading after a few more seconds.
        let reload_timeout: ReturnType<typeof setTimeout>;
        const timeout = setTimeout(() => {
            this.message(_("Error submitting move"), -1);

            reload_timeout = setTimeout(() => {
                window.location.reload();
            }, 5000);
        }, 5000);
        this.emit("submitting-move", true);
        this.socket.send("game/move", mv, () => {
            if (reload_timeout) {
                clearTimeout(reload_timeout);
            }
            clearTimeout(timeout);
            this.clearMessage();
            this.emit("submitting-move", false);
            if (cb) {
                cb();
            }
        });
    }

    public sendTimedOut(): void {
        // When we think our clock has runout, send a message to the server
        // letting it know. Otherwise we have to wait for the server grace
        // period to expire for it to time us out.
        console.log("Sending timed out");

        this.socket.send("game/timed_out", {
            auth: this.config.auth,
            game_id: this.config.game_id,
            player_id: this.config.player_id,
        });
    }
    public isCurrentUserAPlayer(): boolean {
        return this.player_id in this.engine.player_pool;
    }

    public setGameClock(original_clock: AdHocClock | null): void {
        if (this.__clock_timer) {
            clearTimeout(this.__clock_timer);
            delete this.__clock_timer;
        }

        if (!original_clock) {
            this.emit("clock", null);
            return;
        }

        if (!this.config.time_control || !this.config.time_control.system) {
            this.emit("clock", null);
            return;
        }
        const time_control: JGOFTimeControl = this.config.time_control;

        this.last_clock = original_clock;

        let current_server_time = 0;
        function update_current_server_time() {
            if (GobanCore.hooks.getClockDrift) {
                const server_time_offset = GobanCore.hooks.getClockDrift();
                current_server_time = Date.now() - server_time_offset;
            }
        }
        update_current_server_time();

        const clock: JGOFClockWithTransmitting = {
            current_player:
                original_clock.current_player === original_clock.black_player_id
                    ? "black"
                    : "white",
            current_player_id: original_clock.current_player.toString(),
            time_of_last_move: original_clock.last_move,
            paused_since: original_clock.paused_since,
            black_clock: { main_time: 0 },
            white_clock: { main_time: 0 },
            black_move_transmitting: 0,
            white_move_transmitting: 0,
        };

        if (original_clock.pause) {
            if (original_clock.pause.paused) {
                this.paused_since = original_clock.pause.paused_since;
                this.pause_control = original_clock.pause.pause_control;

                /* correct for when we used to store paused_since in terms of seconds instead of ms */
                if (this.paused_since < 2000000000) {
                    this.paused_since *= 1000;
                }

                clock.paused_since = original_clock.pause.paused_since;
                clock.pause_state = AdHocPauseControl2JGOFPauseState(
                    original_clock.pause.pause_control,
                );
            } else {
                delete this.paused_since;
                delete this.pause_control;
            }
        }

        if (original_clock.start_mode) {
            clock.start_mode = true;
        }

        const last_audio_event: { [player_id: string]: AudioClockEvent } = {
            black: {
                countdown_seconds: 0,
                clock: { main_time: 0 },
                player_id: "",
                color: "black",
                time_control_system: "none",
                in_overtime: false,
            },
            white: {
                countdown_seconds: 0,
                clock: { main_time: 0 },
                player_id: "",
                color: "white",
                time_control_system: "none",
                in_overtime: false,
            },
        };

        const do_update = () => {
            if (!time_control || !time_control.system) {
                return;
            }

            update_current_server_time();

            const next_update_time = 100;

            if (clock.start_mode) {
                clock.start_time_left = original_clock.expiration - current_server_time;
            }

            if (this.paused_since) {
                clock.paused_since = this.paused_since;
                if (!this.pause_control) {
                    throw new Error(`Invalid pause_control state when performing clock do_update`);
                }
                clock.pause_state = AdHocPauseControl2JGOFPauseState(this.pause_control);
                if (clock.pause_state.stone_removal) {
                    clock.stone_removal_time_left = original_clock.expiration - current_server_time;
                }
            }

            if (!clock.pause_state || Object.keys(clock.pause_state).length === 0) {
                delete clock.paused_since;
                delete clock.pause_state;
            }

            if (this.last_paused_state === null) {
                this.last_paused_state = !!clock.pause_state;
            } else {
                const cur_paused = !!clock.pause_state;
                if (cur_paused !== this.last_paused_state) {
                    this.last_paused_state = cur_paused;
                    if (cur_paused) {
                        this.emit("audio-game-paused");
                    } else {
                        this.emit("audio-game-resumed");
                    }
                }
            }

            if (this.last_paused_by_player_state === null) {
                this.last_paused_by_player_state = !!this.pause_control?.paused;
            } else {
                const cur_paused = !!this.pause_control?.paused;
                if (cur_paused !== this.last_paused_by_player_state) {
                    this.last_paused_by_player_state = cur_paused;
                    if (cur_paused) {
                        this.emit("paused", cur_paused);
                    } else {
                        this.emit("paused", cur_paused);
                    }
                }
            }

            const elapsed: number = clock.paused_since
                ? Math.max(clock.paused_since, original_clock.last_move) - original_clock.last_move
                : current_server_time - original_clock.last_move;

            const black_relative_latency = this.getPlayerRelativeLatency(
                original_clock.black_player_id,
            );
            const white_relative_latency = this.getPlayerRelativeLatency(
                original_clock.white_player_id,
            );

            const black_elapsed = Math.max(0, elapsed - Math.abs(black_relative_latency));
            const white_elapsed = Math.max(0, elapsed - Math.abs(white_relative_latency));

            clock.black_clock = this.computeNewPlayerClock(
                original_clock.black_time as AdHocPlayerClock,
                clock.current_player === "black" && !clock.start_mode,
                black_elapsed,
                time_control,
            );

            clock.white_clock = this.computeNewPlayerClock(
                original_clock.white_time as AdHocPlayerClock,
                clock.current_player === "white" && !clock.start_mode,
                white_elapsed,
                time_control,
            );

            const wall_clock_elapsed = current_server_time - original_clock.last_move;
            clock.black_move_transmitting =
                clock.current_player === "black"
                    ? Math.max(0, black_relative_latency - wall_clock_elapsed)
                    : 0;
            clock.white_move_transmitting =
                clock.current_player === "white"
                    ? Math.max(0, white_relative_latency - wall_clock_elapsed)
                    : 0;

            if (!this.sent_timed_out_message) {
                if (
                    clock.current_player === "white" &&
                    this.player_id === this.engine.config.white_player_id
                ) {
                    if ((clock.white_clock as JGOFPlayerClockWithTimedOut).timed_out) {
                        this.sent_timed_out_message = true;
                    }
                }
                if (
                    clock.current_player === "black" &&
                    this.player_id === this.engine.config.black_player_id
                ) {
                    if ((clock.black_clock as JGOFPlayerClockWithTimedOut).timed_out) {
                        this.sent_timed_out_message = true;
                    }
                }
                if (this.sent_timed_out_message) {
                    this.sendTimedOut();
                }
            }

            if (this.clock_should_be_paused_for_move_submission && this.last_emitted_clock) {
                this.emit("clock", this.last_emitted_clock);
            } else {
                this.emit("clock", clock);
            }

            // check if we need to update our audio
            if (this.mode === "play" && this.engine.phase === "play") {
                // Move's and clock events are separate, so this just checks to make sure that when we
                // update, we are updating when the engine and clock agree on whose turn it is.
                if (this.engine.colorToMove() === clock.current_player) {
                    const player_clock: JGOFPlayerClock =
                        clock.current_player === "black" ? clock.black_clock : clock.white_clock;
                    const audio_clock: AudioClockEvent = {
                        countdown_seconds: 0,
                        clock: player_clock,
                        player_id: this.engine.playerToMove().toString(),
                        color: this.engine.colorToMove(),
                        time_control_system: time_control.system,
                        in_overtime: false,
                    };

                    switch (time_control.system) {
                        case "simple":
                            if (audio_clock.countdown_seconds === time_control.per_move) {
                                // When byo-yomi resets, we don't want to play the sound for the
                                // top of the second mark because it's going to get clipped short
                                // very soon as time passes and we're going to start playing the
                                // next second sound.
                                audio_clock.countdown_seconds = -1;
                            }
                            break;

                        case "absolute":
                        case "fischer":
                            audio_clock.countdown_seconds = Math.ceil(
                                player_clock.main_time / 1000,
                            );
                            break;

                        case "byoyomi":
                            if (player_clock.main_time > 0) {
                                audio_clock.countdown_seconds = Math.ceil(
                                    player_clock.main_time / 1000,
                                );
                            } else {
                                audio_clock.in_overtime = true;
                                audio_clock.countdown_seconds = Math.ceil(
                                    (player_clock.period_time_left || 0) / 1000,
                                );
                                if ((player_clock.periods_left || 0) <= 0) {
                                    audio_clock.countdown_seconds = -1;
                                }

                                /*
                                if (
                                    audio_clock.countdown_seconds === time_control.period_time &&
                                    audio_clock.in_overtime == last_audio_event[clock.current_player].in_overtime
                                ) {
                                    // When byo-yomi resets, we don't want to play the sound for the
                                    // top of the second mark because it's going to get clipped short
                                    // very soon as time passes and we're going to start playing the
                                    // next second sound.
                                    audio_clock.countdown_seconds = -1;
                                }
                                */
                            }
                            break;

                        case "canadian":
                            if (player_clock.main_time > 0) {
                                audio_clock.countdown_seconds = Math.ceil(
                                    player_clock.main_time / 1000,
                                );
                            } else {
                                audio_clock.in_overtime = true;
                                audio_clock.countdown_seconds = Math.ceil(
                                    (player_clock.block_time_left || 0) / 1000,
                                );

                                if (audio_clock.countdown_seconds === time_control.period_time) {
                                    // When we start a new period, we don't want to play the sound for the
                                    // top of the second mark because it's going to get clipped short
                                    // very soon as time passes and we're going to start playing the
                                    // next second sound.
                                    audio_clock.countdown_seconds = -1;
                                }
                            }
                            break;

                        case "none":
                            break;

                        default:
                            throw new Error(
                                `Unsupported time control system: ${(time_control as any).system}`,
                            );
                    }

                    const cur = audio_clock;
                    const last = last_audio_event[clock.current_player];
                    if (
                        cur.countdown_seconds !== last.countdown_seconds ||
                        cur.player_id !== last.player_id ||
                        cur.in_overtime !== last.in_overtime
                    ) {
                        last_audio_event[clock.current_player] = audio_clock;
                        if (audio_clock.countdown_seconds > 0) {
                            this.emit("audio-clock", audio_clock);
                        }
                    }
                } else {
                    // Engine and clock code didn't agreen on whose turn it was, don't emit audio-clock event yet
                }
            }

            if (this.engine.phase !== "finished") {
                this.__clock_timer = setTimeout(do_update, next_update_time);
            }
        };

        do_update();
    }

    protected computeNewPlayerClock(
        original_player_clock: Readonly<AdHocPlayerClock>,
        is_current_player: boolean,
        time_elapsed: number,
        time_control: Readonly<JGOFTimeControl>,
    ): JGOFPlayerClockWithTimedOut {
        const ret: JGOFPlayerClockWithTimedOut = {
            main_time: 0,
            timed_out: false,
        };

        const original_clock = this.last_clock;
        if (!original_clock) {
            throw new Error(`No last_clock when computing new player clock`);
        }

        const tcs: string = "" + time_control.system;
        switch (time_control.system) {
            case "simple":
                ret.main_time = is_current_player
                    ? Math.max(0, time_control.per_move - time_elapsed / 1000) * 1000
                    : time_control.per_move * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "none":
                ret.main_time = 0;
                break;

            case "absolute":
                /*
                ret.main_time = is_current_player
                    ? Math.max(
                          0,
                          original_clock_expiration + raw_clock_pause_offset - current_server_time,
                      )
                    : Math.max(0, original_player_clock.thinking_time * 1000);
                    */
                ret.main_time = is_current_player
                    ? Math.max(0, original_player_clock.thinking_time * 1000 - time_elapsed)
                    : original_player_clock.thinking_time * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "fischer":
                ret.main_time = is_current_player
                    ? Math.max(0, original_player_clock.thinking_time * 1000 - time_elapsed)
                    : original_player_clock.thinking_time * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "byoyomi":
                if (is_current_player) {
                    let overtime_usage = 0;
                    if (original_player_clock.thinking_time > 0) {
                        ret.main_time = original_player_clock.thinking_time * 1000 - time_elapsed;
                        if (ret.main_time <= 0) {
                            overtime_usage = -ret.main_time;
                            ret.main_time = 0;
                        }
                    } else {
                        ret.main_time = 0;
                        overtime_usage = time_elapsed;
                    }
                    ret.periods_left = original_player_clock.periods || 0;
                    ret.period_time_left = time_control.period_time * 1000;
                    if (overtime_usage > 0) {
                        const periods_used = Math.floor(
                            overtime_usage / (time_control.period_time * 1000),
                        );
                        ret.periods_left -= periods_used;
                        ret.period_time_left =
                            time_control.period_time * 1000 -
                            (overtime_usage - periods_used * time_control.period_time * 1000);

                        if (ret.periods_left < 0) {
                            ret.periods_left = 0;
                        }

                        if (ret.period_time_left < 0) {
                            ret.period_time_left = 0;
                        }
                    }
                } else {
                    ret.main_time = original_player_clock.thinking_time * 1000;
                    ret.periods_left = original_player_clock.periods;
                    ret.period_time_left = time_control.period_time * 1000;
                }

                if (ret.main_time <= 0 && (ret.periods_left || 0) === 0) {
                    ret.timed_out = true;
                }
                break;

            case "canadian":
                if (is_current_player) {
                    let overtime_usage = 0;
                    if (original_player_clock.thinking_time > 0) {
                        ret.main_time = original_player_clock.thinking_time * 1000 - time_elapsed;
                        if (ret.main_time <= 0) {
                            overtime_usage = -ret.main_time;
                            ret.main_time = 0;
                        }
                    } else {
                        ret.main_time = 0;
                        overtime_usage = time_elapsed;
                    }
                    ret.moves_left = original_player_clock.moves_left;
                    ret.block_time_left = (original_player_clock.block_time || 0) * 1000;

                    if (overtime_usage > 0) {
                        ret.block_time_left -= overtime_usage;

                        if (ret.block_time_left < 0) {
                            ret.block_time_left = 0;
                        }
                    }
                } else {
                    ret.main_time = original_player_clock.thinking_time * 1000;
                    ret.moves_left = original_player_clock.moves_left;
                    ret.block_time_left = (original_player_clock.block_time || 0) * 1000;
                }

                if (ret.main_time <= 0 && ret.block_time_left <= 0) {
                    ret.timed_out = true;
                }
                break;

            default:
                throw new Error(`Unsupported time control system: ${tcs}`);
        }

        return ret;
    }

    public syncReviewMove(msg_override?: ReviewMessage, node_text?: string): void {
        if (
            this.review_id &&
            (this.isPlayerController() ||
                (this.isPlayerOwner() && msg_override && msg_override.controller)) &&
            this.done_loading_review
        ) {
            if (this.isInPushedAnalysis()) {
                return;
            }

            const diff = this.engine.getMoveDiff();
            this.engine.setAsCurrentReviewMove();

            let msg: ReviewMessage;

            if (!msg_override) {
                const marks: { [mark: string]: string } = {};
                for (let y = 0; y < this.height; ++y) {
                    for (let x = 0; x < this.width; ++x) {
                        const pos = this.getMarks(x, y);
                        for (let i = 0; i < MARK_TYPES.length; ++i) {
                            if (MARK_TYPES[i] in pos && pos[MARK_TYPES[i]]) {
                                const markkey: keyof MarkInterface =
                                    MARK_TYPES[i] === "letter"
                                        ? pos.letter || "[ERR]"
                                        : MARK_TYPES[i];
                                if (!(markkey in marks)) {
                                    marks[markkey] = "";
                                }
                                marks[markkey] += encodeMove(x, y);
                            }
                        }
                    }
                }

                if (!node_text && node_text !== "") {
                    node_text = this.engine.cur_move.text || "";
                }

                msg = {
                    f: diff.from,
                    t: node_text,
                    m: diff.moves,
                    k: marks,
                };
                const tmp = dup(msg);

                if (this.last_review_message.f === msg.f && this.last_review_message.m === msg.m) {
                    delete msg["f"];
                    delete msg["m"];

                    const txt_idx = node_text.indexOf(this.engine.cur_move.text || "");
                    if (txt_idx === 0) {
                        delete msg["t"];
                        if (node_text !== this.engine.cur_move.text) {
                            msg["t+"] = node_text.substr(this.engine.cur_move.text.length);
                        }
                    }

                    if (deepEqual(marks, this.last_review_message.k)) {
                        delete msg["k"];
                    }
                } else {
                    this.scheduleRedrawPenLayer();
                }
                this.engine.cur_move.text = node_text;
                this.last_review_message = tmp;

                if (Object.keys(msg).length === 0) {
                    return;
                }
            } else {
                msg = msg_override;
                if (msg.clearpen) {
                    this.engine.cur_move.pen_marks = [];
                }
            }

            msg.auth = this.config.auth;
            msg.review_id = this.review_id;
            msg.player_id = this.player_id;
            msg.username = this.config.username;

            this.socket.send("review/append", msg);
        }
    }
    public setScoringMode(tf: boolean, prefer_remote: boolean = false): MoveTree {
        this.scoring_mode = tf;
        const ret = this.engine.cur_move;

        if (this.scoring_mode) {
            this.message(_("Processing..."), -1);
            this.setMode("score estimation", true);
            this.clearMessage();
            this.score_estimate = this.engine.estimateScore(
                SCORE_ESTIMATION_TRIALS,
                SCORE_ESTIMATION_TOLERANCE,
                prefer_remote,
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

    /* Computes the relative latency between the target player and the current viewer.
     * For example, if player P has a latency of 500ms and we have a latency of 200ms,
     * the relative latency will be 300ms. This is used to artifically delay the clock
     * countdown for that player to minimize the amount of apparent time jumping that can
     * happen as clocks are synchronized */
    public getPlayerRelativeLatency(player_id: number): number {
        if (player_id === this.player_id) {
            return 0;
        }

        // If the other latency is not available for whatever reason, use our own latency as a better-than-0 guess */
        const other_latency = this.engine?.latencies?.[player_id] || this.getNetworkLatency();

        return other_latency - this.getNetworkLatency();
    }
    public getLastReviewMessage(): ReviewMessage {
        return this.last_review_message;
    }
    public setLastReviewMessage(m: ReviewMessage): void {
        this.last_review_message = m;
    }
}
function uuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function AdHocPauseControl2JGOFPauseState(pause_control: AdHocPauseControl): JGOFPauseState {
    const ret: JGOFPauseState = {};

    for (const k in pause_control) {
        const matches = k.match(/vacation-([0-9]+)/);
        if (matches) {
            const player_id = matches[1];
            if (!ret.vacation) {
                ret.vacation = {};
            }
            ret.vacation[player_id] = true;
        } else {
            switch (k) {
                case "stone-removal":
                    ret.stone_removal = true;
                    break;

                case "weekend":
                    ret.weekend = true;
                    break;

                case "server":
                case "system":
                    ret.server = true;
                    break;

                case "paused":
                    ret.player = {
                        player_id: pause_control.paused?.pausing_player_id.toString() || "0",
                        pauses_left: pause_control.paused?.pauses_left || 0,
                    };
                    break;

                case "moderator_paused":
                    ret.moderator = pause_control.moderator_paused?.moderator_id.toString() || "0";
                    break;

                default:
                    throw new Error(`Unhandled pause control key: ${k}`);
            }
        }
    }

    return ret;
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
            const tpm = computeAverageMoveTime(config.time_control);
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

class FocusTracker {
    hasFocus: boolean = true;
    lastFocus: number = Date.now();
    outOfFocusDurations: Array<number> = [];

    constructor() {
        try {
            window.addEventListener("blur", this.onBlur);
            window.addEventListener("focus", this.onFocus);
        } catch (e) {
            console.error(e);
        }
    }

    reset(): void {
        this.lastFocus = Date.now();
        this.outOfFocusDurations = [];
    }

    getMaxBlurDurationSinceLastReset(): number {
        if (!this.hasFocus) {
            this.outOfFocusDurations.push(Date.now() - this.lastFocus);
        }

        if (this.outOfFocusDurations.length === 0) {
            return 0;
        }

        const ret = Math.max.apply(Math.max, this.outOfFocusDurations);

        if (!this.hasFocus) {
            this.outOfFocusDurations.pop();
        }

        return ret;
    }

    onFocus = () => {
        this.hasFocus = true;
        this.outOfFocusDurations.push(Date.now() - this.lastFocus);
        this.lastFocus = Date.now();
    };

    onBlur = () => {
        this.hasFocus = false;
        this.lastFocus = Date.now();
    };
}

function isPaused(pause_state: JGOFPauseState): boolean {
    for (const _key in pause_state) {
        return true;
    }
    return false;
}

export const focus_tracker = new FocusTracker();
