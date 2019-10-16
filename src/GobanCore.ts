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

import {GoEngine, encodeMove, encodeMoves} from "./GoEngine";
import {GoMath} from "./GoMath";
import {GoStoneGroup} from "./GoStoneGroup";
import {GoConditionalMove} from "./GoConditionalMove";
import {GoThemes} from "./GoThemes";
import {MoveTree} from "./MoveTree";
import {init_score_estimator, ScoreEstimator} from "./ScoreEstimator";
import {createDeviceScaledCanvas, resizeDeviceScaledCanvas, deviceCanvasScalingRatio,
    deepEqual, getRelativeEventPosition, getRandomInt, shortDurationString, dup
} from "./GoUtil";
import {TypedEventEmitter} from "./TypedEventEmitter";
import {_, pgettext, interpolate} from "./translate";
import { JGOFClock, JGOFTimeControl, JGOFPlayerClock, JGOFTimeControlSystem } from './JGOF';
import { AdHocClock, AdHocPlayerClock  } from './AdHocFormat';

declare let swal;

export const GOBAN_FONT =  "Verdana,Arial,sans-serif";

export const SCORE_ESTIMATION_TRIALS = 1000;
export const SCORE_ESTIMATION_TOLERANCE = 0.30;
export const AUTOSCORE_TRIALS = 1000;
export const AUTOSCORE_TOLERANCE = 0.30;
export const MARK_TYPES = ["letter", "circle", "square", "triangle", "sub_triangle", "cross", "black", "white"];

let last_goban_id = 0;

export interface ColoredCircle {
    move          : string;
    color         : string;
    border_width? : number;
    border_color? : string;
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

export interface GobanConfig {
    interactive?: boolean;
    mode?: 'puzzle';
    square_size?: number;
    original_sgf?: string;

    draw_top_labels?: boolean;
    draw_left_labels?: boolean;
    draw_bottom_labels?: boolean;
    draw_right_labels?: boolean;
    bounds?: GobanBounds;
}



interface Events {
    "destroy": never;
    "update": never;
    "chat-reset": never;
    "reset": any;
    "error": any;
    "gamedata": any;
    "chat": any;
    "chat-remove": {chat_ids: Array<string>};
    "move-made": never;
    "review.sync-to-current-move": never;
    "review.updated": never;
    "review.load-start": never;
    "review.load-end": never;
    "title": string;
    "puzzle-wrong-answer": never;
    "puzzle-correct-answer": never;
    "show-submit": boolean;
    "state_text": {
        title: string;
        show_moves_made_count?: boolean;
    };
    "advance-to-next-board": never;
    "pause-text": {
        white_pause_text: string;
        black_pause_text: string;
    };
    "auto-resign": {
        game_id: number;
        player_id: number;
        expiration: number;
    };
    "clear-auto-resign": {
        game_id: number;
        player_id: number;
    };
    "set-for-removal": {x:number, y:number, removed:boolean};
    "puzzle-place": {x:number, y:number};
    "audio-game-start": never;
    "audio-game-end": never;
    "audio-pass": never;
    "audio-stone": number;
    "audio-clock": {
        seconds_left: number;
        player_to_move: number;
        clock_player: number;
        time_control_system: JGOFTimeControlSystem;
        in_overtime: boolean;
    };
    "clock": JGOFClock;
}

export interface GobanHooks {
    defaultConfig?: () => any;
    getCoordinateDisplaySystem?: () => 'A1'|'1-1';
    isAnalysisDisabled?: (goban:GobanCore, perGameSettingAppliesToNonPlayers:boolean) => boolean;

    getClockDrift?: () => number;
    getNetworkLatency?: () => number;
    getLocation?: () => string;
    getShowMoveNumbers?: () => boolean;
    getShowVariationMoveNumbers?: () => boolean;
    getMoveTreeNumbering?: () => string;
    getCDNReleaseBase?: () => string;
    getSoundEnabled?: () => boolean;
    getSoundVolume?: () => number;

    watchSelectedThemes?: (cb:() => void) => { remove:() => any };
    getSelectedThemes?: () => GobanSelectedThemes;

    discBlackStoneColor?: () => string;
    discBlackTextColor?: () => string;
    discWhiteStoneColor?: () => string;
    discWhiteTextColor?: () => string;
    plainBoardColor?: () => string;
    plainBoardLineColor?: () => string;

    addCoordinatesToChatInput?: (coordinates:string) => void;
    updateScoreEstimation?: (est_winning_color:"black"|"white", number_of_points:number) => void;
}


export abstract class GobanCore extends TypedEventEmitter<Events> {
    public conditional_starting_color:'black'|'white'|'invalid';
    public analyze_subtool:string;
    public analyze_tool:string;
    public black_pause_text: string = null;
    public conditional_tree:GoConditionalMove;
    public double_click_submit: boolean;
    public draw_bottom_labels:boolean;
    public draw_left_labels:boolean;
    public draw_right_labels:boolean;
    public draw_top_labels:boolean;
    public engine: GoEngine;
    public height:number;
    public last_clock:AdHocClock = null;
    public mode:string;
    public one_click_submit: boolean;
    public pen_marks:Array<any>;
    public readonly game_id: number;
    public readonly review_id: number;
    public review_controller_id: number;
    public review_owner_id: number;
    public score_estimate:any;
    public showing_scores:boolean;
    public submit_move:() => void;
    public title:string;
    public white_pause_text: string = null;
    public width:number;


    protected __board_redraw_pen_layer_timer;
    protected __borders_initialized;
    protected __clock_timer:any = null; /* number for web, Timeout for node - I don't think we can make them both happy so just 'any' */
    protected __draw_state;
    protected __last_pt;
    protected __update_move_tree;
    protected analysis_move_counter;
    protected auto_scoring_done;
    protected autoplaying_puzzle_move;
    protected black_clock;
    protected black_name;
    protected bounded_height:number;
    protected bounded_width:number;
    protected bounds:GobanBounds;
    protected byoyomi_label;
    protected conditional_path;
    public config;
    protected connectToReviewSent;
    protected ctx;
    protected current_cmove;
    protected current_pen_mark;
    protected currently_my_cmove;
    protected destroyed;
    protected dirty_redraw;
    protected disconnectedFromGame;
    protected display_width;
    protected done_loading_review;
    protected dont_draw_last_move;
    protected drawing_enabled;
    protected edit_color;
    protected errorHandler;
    protected heatmap:Array<Array<number>>;
    protected colored_circles:Array<Array<ColoredCircle>>;
    protected game_connection_data;
    protected game_type;
    protected getPuzzlePlacementSetting;
    protected goban_id: number;
    protected has_new_official_move;
    protected highlight_movetree_moves;
    protected interactive;
    protected isInPushedAnalysis;
    protected leavePushedAnalysis;
    protected isPlayerController;
    protected isPlayerOwner;
    protected label_character;
    protected label_mark;
    protected labeling_mode;
    protected last_hover_square;
    protected last_label_position;
    protected last_move;
    protected last_pen_position;
    protected last_phase;
    protected last_review_message;
    protected last_sent_move;
    protected last_sound_played_for_a_stone_placement;
    protected last_stone_sound;
    protected layer_offset_left;
    protected layer_offset_top;
    protected metrics;
    protected move_number;
    protected move_selected;
    protected move_tree_canvas;
    protected move_tree_div;
    protected no_display;
    protected onError;
    protected onPendingResignation;
    protected onPendingResignationCleared;
    protected on_disconnects;
    protected on_game_screen;
    protected original_square_size;
    protected pattern_search_color;
    protected pen_ctx;
    protected pen_layer;
    protected player_id: number;
    protected puzzle_autoplace_delay;
    protected restrict_moves_to_movetree;
    protected review_connection_data;
    protected review_had_gamedata;
    protected scoring_mode;
    protected selectedThemeWatcher;
    protected shift_key_is_down;
    protected show_move_numbers;
    protected show_variation_move_numbers;
    protected socket;
    protected socket_event_bindings = [];
    protected square_size:number;
    protected stone_placement_enabled;
    protected submitBlinkTimer;
    protected syncToCurrentReviewMove;
    public  theme_black;            /* public for access by our MoveTree render methods */
    protected theme_black_stones;
    public  theme_black_text_color; /* public for access by our MoveTree render methods */
    protected theme_blank_text_color;
    public  theme_board;            /* public for access by our MoveTree render methods */
    protected theme_faded_line_color;
    protected theme_faded_star_color;
    protected theme_faded_text_color;
    protected theme_line_color;
    protected theme_star_color;
    protected theme_stone_radius;
    public  theme_white;            /* public for access by our MoveTree render methods */
    protected theme_white_stones;
    public  theme_white_text_color; /* public for access by our MoveTree render methods */
    public  themes;                 /* public for access by our MoveTree render methods */
    protected title_div;
    protected waiting_for_game_to_begin;
    protected white_clock;
    protected white_name;

    /** GobanCore calls some abstract methods as part of the construction
     *  process. Because our subsclasses might (and do) need to do some of their
     *  own config before these are called, we set this function to be called
     *  by our subclass after it's done it's own internal config stuff. */
    protected post_config_constructor:() => void;

    public abstract enablePen();
    public abstract disablePen();
    public abstract clearAnalysisDrawing();
    public abstract drawPenMarks(penmarks);
    public abstract message(msg, timeout?);
    public abstract clearMessage();
    protected abstract setThemes(themes, dont_redraw);
    public abstract drawSquare(i:number, j:number):void;
    public abstract redraw(force_clear?: boolean);

    public static hooks:GobanHooks = {
        getClockDrift: () => 0,
        getNetworkLatency: () => 0,
    };

    constructor(config, preloaded_data?) {
        super();

        this.goban_id = ++last_goban_id;

        /* Apply defaults */
        let C: any = {};
        let default_config = this.defaultConfig();
        for (let k in default_config) {
            C[k] = default_config[k];
        }
        for (let k in config) {
            C[k] = config[k];
        }
        config = C;



        /* Apply config */
        //window['active_gobans'][this.goban_id] = this;
        this.destroyed = false;
        this.on_game_screen = this.getLocation().indexOf("/game/") >= 0;
        this.no_display = false;

        this.width = config.width || 19;
        this.height = config.height || 19;
        this.bounds = config.bounds || {top: 0, left: 0, bottom: this.height - 1, right: this.width - 1};
        this.bounded_width = this.bounds ? (this.bounds.right - this.bounds.left) + 1 : this.width;
        this.bounded_height = this.bounds ? (this.bounds.bottom - this.bounds.top) + 1 : this.height;
        this.title_div = config["title_div"];
        this.black_name = config["black_name"];
        this.white_name = config["white_name"];
        this.move_number = config["move_number"];
        this.__clock_timer = null;
        this.setGameClock(null);
        this.last_stone_sound = -1;
        this.drawing_enabled = true;
        this.scoring_mode = false;
        this.score_estimate = null;

        /* TODO: Remove this after 5.0 and after doing a check to see if any of these still exist somehow */
        if ("game_type" in config && config.game_type === "temporary") {
            config.game_id = "tmp:" + config.game_id;
        }

        this.game_type = config.game_type || "";
        this.one_click_submit = "one_click_submit" in config ? config["one_click_submit"] : false;
        this.double_click_submit = "double_click_submit" in config ? config["double_click_submit"] : true;
        this.original_square_size = config["square_size"] || "auto";
        this.square_size = config["square_size"] || "auto";
        this.interactive = "interactive" in config ? config["interactive"] : false;
        this.pen_marks = [];
        this.move_tree_div = config.move_tree_div || null;
        this.move_tree_canvas = config.move_tree_canvas || null;

        this.engine = null;
        this.last_move = null;
        this.config = config;
        this.__draw_state = GoMath.makeMatrix(this.width, this.height);
        this.game_id = config.game_id;
        this.player_id = config.player_id;
        this.review_id = config.review_id;
        this.last_review_message = {};
        this.review_had_gamedata = false;
        this.puzzle_autoplace_delay = "puzzle_autoplace_delay" in config ? config.puzzle_autoplace_delay : 300;
        this.isPlayerOwner = config.isPlayerOwner || (() => false); /* for reviews  */
        this.isPlayerController = config.isPlayerController || (() => false); /* for reviews  */
        this.isInPushedAnalysis = config.isInPushedAnalysis ? config.isInPushedAnalysis : (() => false);
        this.leavePushedAnalysis = config.leavePushedAnalysis ? config.leavePushedAnalysis : (() => false);
        this.onPendingResignation = config.onPendingResignation;
        this.onPendingResignationCleared = config.onPendingResignationCleared;
        this.onError = "onError" in config ? config.onError : null;
        this.dont_draw_last_move = "dont_draw_last_move" in config ? config.dont_draw_last_move : false;
        this.getPuzzlePlacementSetting = "getPuzzlePlacementSetting" in config ? config.getPuzzlePlacementSetting : null;
        this.has_new_official_move = false;
        this.last_sent_move = null;
        this.mode = "play";
        this.analyze_tool = "stone";
        this.analyze_subtool = "alternate";
        this.label_character = "A";
        this.edit_color = null;
        this.stone_placement_enabled = false;
        this.highlight_movetree_moves = false;
        this.restrict_moves_to_movetree = false;
        this.analysis_move_counter = 0;
        //this.wait_for_game_to_start = config.wait_for_game_to_start;
        this.errorHandler = (e) => {
            if (e.message === _("A stone has already been placed here") || e.message === "A stone has already been placed here") {
                return;
            }
            this.message(e.message, 5000);
            if (this.onError) {
                this.onError(e);
            }
        };

        this.draw_top_labels    = "draw_top_labels"    in config ? config["draw_top_labels"]    : true;
        this.draw_left_labels   = "draw_left_labels"   in config ? config["draw_left_labels"]   : true;
        this.draw_right_labels  = "draw_right_labels"  in config ? config["draw_right_labels"]  : true;
        this.draw_bottom_labels = "draw_bottom_labels" in config ? config["draw_bottom_labels"] : true;
        this.show_move_numbers  = this.getShowMoveNumbers();
        this.show_variation_move_numbers = this.getShowVariationMoveNumbers();

        if (this.bounds.left > 0) { this.draw_left_labels = false; }
        if (this.bounds.top > 0) { this.draw_top_labels = false; }
        if (this.bounds.right < this.width - 1) { this.draw_right_labels = false; }
        if (this.bounds.bottom < this.height - 1) { this.draw_bottom_labels = false; }


        if (typeof(config["square_size"]) === "function") {
            this.square_size = config["square_size"](this);
            if (isNaN(this.square_size)) {
                console.error("Invalid square size set: (NaN)");
                this.square_size = 12;
            }
        }
        if ("display_width" in config && this.original_square_size === "auto") {
            this.display_width = config["display_width"];
            let n_squares = Math.max(
                this.bounded_width  + +this.draw_left_labels + +this.draw_right_labels,
                this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels
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

        this.post_config_constructor = () => {

            let first_pass = true;
            let watcher = this.watchSelectedThemes((themes) => {
                this.setThemes(themes, first_pass ? true : false);
                first_pass = false;
            });
            this.on("destroy", () => watcher.remove());

            this.current_cmove = null; /* set in setConditionalTree */
            this.currently_my_cmove = false;
            this.setConditionalTree(null);

            this.last_hover_square = null;
            this.__last_pt = this.xy2ij(-1, -1);
            if (preloaded_data) {
                this.load(preloaded_data);
            } else {
                this.load(config);
            }

            this.game_connection_data = {
                "game_id": config.game_id,
                "player_id": config.player_id,
                "chat": config.connect_to_chat || 0,
                //"game_type": ("game_type" in config ? config.game_type : "temporary")
            };

            if ("auth" in config) {
                this.game_connection_data.auth = config.auth;
            }
            if ("archive_id" in config) {
                this.game_connection_data.archive_id = config.archive_id;
            }

            this.review_connection_data = {
                "auth": config.auth,
                "review_id": config.review_id,
                "player_id": config.player_id
            };

            if ("server_socket" in config && config["server_socket"]) {
                if (!preloaded_data) {
                    this.message(_("Loading..."), -1);
                }
                this.connect(config["server_socket"]);
            } else {
                this.load(config);
            }
        }
    }

    protected _socket_on(event, cb) {
        this.socket.on(event, cb);
        this.socket_event_bindings.push([event, cb]);
    }

    public static setHooks(hooks:GobanHooks):void {
        for (let name in hooks) {
            GobanCore.hooks[name] = hooks[name];
        }
    }

    protected getClockDrift():number {
        if (GobanCore.hooks.getClockDrift) {
            return GobanCore.hooks.getClockDrift();
        }
        console.warn("getClockDrift not provided for Goban instance");
        return 0;
    }
    protected getNetworkLatency():number {
        if (GobanCore.hooks.getNetworkLatency) {
            return GobanCore.hooks.getNetworkLatency();
        }
        console.warn("getNetworkLatency not provided for Goban instance");
        return 0;
    }
    protected getCoordinateDisplaySystem():'A1'|'1-1' {
        if (GobanCore.hooks.getCoordinateDisplaySystem) {
            return GobanCore.hooks.getCoordinateDisplaySystem();
        }
        return 'A1';
    }
    protected getShowMoveNumbers():boolean {
        if (GobanCore.hooks.getShowMoveNumbers) {
            return GobanCore.hooks.getShowMoveNumbers();
        }
        return false;
    }
    protected getShowVariationMoveNumbers():boolean {
        if (GobanCore.hooks.getShowVariationMoveNumbers) {
            return GobanCore.hooks.getShowVariationMoveNumbers();
        }
        return false;
    }
    public static getMoveTreeNumbering():string {
        if (GobanCore.hooks.getMoveTreeNumbering) {
            return GobanCore.hooks.getMoveTreeNumbering();
        }
        return 'move-number';
    }
    public static getCDNReleaseBase():string {
        if (GobanCore.hooks.getCDNReleaseBase) {
            return GobanCore.hooks.getCDNReleaseBase();
        }
        return '';
    }
    public static getSoundEnabled():boolean {
        if (GobanCore.hooks.getSoundEnabled) {
            return GobanCore.hooks.getSoundEnabled();
        }
        return true;
    }
    public static getSoundVolume():number {
        if (GobanCore.hooks.getSoundVolume) {
            return GobanCore.hooks.getSoundVolume();
        }
        return 0.5;
    }
    protected defaultConfig():any {
        if (GobanCore.hooks.defaultConfig) {
            return GobanCore.hooks.defaultConfig();
        }
        return {};
    }
    protected watchSelectedThemes(cb):{ remove:() => any } {
        if (GobanCore.hooks.watchSelectedThemes) {
            return GobanCore.hooks.watchSelectedThemes(cb);
        }
        return { remove: () => {} };
    }
    protected isAnalysisDisabled(perGameSettingAppliesToNonPlayers:boolean = false):boolean {
        if (GobanCore.hooks.isAnalysisDisabled) {
            return GobanCore.hooks.isAnalysisDisabled(this, perGameSettingAppliesToNonPlayers);
        }
        return false;
    }

    protected getLocation():string {
        if (GobanCore.hooks.getLocation) {
            return GobanCore.hooks.getLocation();
        }
        return window.location.pathname;
    }
    protected getSelectedThemes():GobanSelectedThemes {
        if (GobanCore.hooks.getSelectedThemes) {
            return GobanCore.hooks.getSelectedThemes();
        }
        //return {white:'Plain', black:'Plain', board:'Plain'};
        //return {white:'Plain', black:'Plain', board:'Kaya'};
        return {white:'Shell', black:'Slate', board:'Kaya'};
    }
    protected connect(server_socket) {
        let socket = this.socket = server_socket;

        this.disconnectedFromGame = false;
        this.on_disconnects = [];

        let send_connect_message = () => {
            if (this.disconnectedFromGame) { return; }

            if (this.review_id) {
                this.connectToReviewSent = true;
                this.done_loading_review = false;
                document.title = _("Review");
                if (!this.disconnectedFromGame) {
                    socket.send("review/connect", this.review_connection_data);
                }
                //this.onClearChatLogs();
                this.emit("chat-reset");
            } else if (this.game_id) {
                /*
                if (this.wait_for_game_to_start) {
                    this.message(_("Waiting for game to begin"), -1);
                    this.waiting_for_game_to_begin = true;
                    this.emit('update');
                }
                */

                if (!this.disconnectedFromGame) {
                    socket.send("game/connect", this.game_connection_data);
                }
            }
        };

        if (socket.connected) {
            send_connect_message();
        }

        this._socket_on("connect", send_connect_message);
        this._socket_on("disconnect", () => {
            if (this.disconnectedFromGame) { return; }
        });


        let prefix = null;

        if (this.game_id) {
            prefix = "game/" + this.game_id + "/";
        }
        if (this.review_id) {
            prefix = "review/" + this.review_id + "/";
        }

        this._socket_on(prefix + "reset", (msg) => {
            if (this.disconnectedFromGame) { return; }
            this.emit("reset", msg);

            if (msg.gamestart_beep) {
                this.emit('audio-game-start');
            }
            if (msg.message) {
                if (!window["has_focus"] && !window["user"].anonymous && /^\/game\//.test(this.getLocation())) {
                    swal(_(msg.message));
                } else {
                    console.info(msg.message);
                }
            }
            console.info("Game connection reset");
        });
        this._socket_on(prefix + "error", (msg) => {
            if (this.disconnectedFromGame) { return; }
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
            this._socket_on(prefix + "gamedata", (obj) => {
                if (this.disconnectedFromGame) { return; }

                this.clearMessage();
                //this.onClearChatLogs();
                this.emit("chat-reset");

                if (this.on_game_screen && this.last_phase && this.last_phase !== "finished" && obj.phase === "finished") {
                    this.emit('audio-game-end');
                }
                this.last_phase = obj.phase;
                this.load(obj);
                this.emit("gamedata", obj);

                /*
                if (this.wait_for_game_to_start) {
                    sfx.play('beepbeep', true);
                    if (this.onReset) {
                        this.onReset();
                    }
                }
                */
            });
            this._socket_on(prefix + "chat", (obj) => {
                if (this.disconnectedFromGame) { return; }
                obj.line.channel = obj.channel;
                this.emit("chat", obj.line);
            });
            this._socket_on(prefix + "reset-chats", (obj) => {
                if (this.disconnectedFromGame) { return; }
                this.emit("chat-reset");
            });
            this._socket_on(prefix + "chat/remove", (obj) => {
                if (this.disconnectedFromGame) { return; }
                this.emit("chat-remove", obj);
            });
            this._socket_on(prefix + "message", (msg) => {
                if (this.disconnectedFromGame) { return; }
                this.message(msg);
            });
            this.last_phase = null;

            this._socket_on(prefix + "clock", (obj) => {
                if (this.disconnectedFromGame) { return; }

                this.setGameClock(obj);

                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "phase", (new_phase) => {
                if (this.disconnectedFromGame) { return; }

                this.setMode("play");
                if (new_phase !== "finished") {
                    this.engine.clearRemoved();
                }
                /*
                if (new_phase !== "play") {
                    if (this.estimatingScore) {
                        console.error(toggleScoreEstimation();
                    }
                }
                */
                this.engine.phase = new_phase;

                if (this.engine.phase === "stone removal") {
                    this.autoScore();
                } else {
                    delete this.auto_scoring_done;
                }

                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "undo_requested", (move_number) => {
                if (this.disconnectedFromGame) { return; }

                this.engine.undo_requested = parseInt(move_number);
                this.emit("update");
            });
            this._socket_on(prefix + "undo_accepted", (move_number) => {
                if (this.disconnectedFromGame) { return; }

                if (!this.engine.undo_requested) {
                    console.warn("Undo accepted, but no undo requested, we might be out of sync");
                    swal("Game synchronization error related to undo, please reload your game page");
                    return;
                }

                delete this.engine.undo_requested;

                this.setMode("play");
                this.engine.showPrevious();
                this.engine.setLastOfficialMove();

                /* TODO: clear conditional trees */

                delete this.engine.undo_requested;
                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(prefix + "move", (move_obj) => {
                try {
                    if (this.disconnectedFromGame) { return; }

                    if (move_obj.game_id !== this.game_id) {
                        console.error("Invalid move for this game received [" + this.game_id + "]", move_obj);
                        return;
                    }
                    let move = move_obj.move;

                    if (this.isInPushedAnalysis()) {
                        this.leavePushedAnalysis();
                    }

                    /* clear any undo state that may be hanging around */
                    delete this.engine.undo_requested;

                    let mv = this.engine.decodeMoves(move);

                    if (this.mode === "conditional" || this.mode === "play") {
                        this.setMode("play");
                    }

                    let jumptomove = null;
                    if (this.engine.cur_move.id !== this.engine.last_official_move.id &&
                        (this.engine.cur_move.parent == null
                         && this.engine.cur_move.trunk_next != null
                         || this.engine.cur_move.parent.id !== this.engine.last_official_move.id)
                    ) {
                        jumptomove = this.engine.cur_move;
                    }
                    this.engine.jumpToLastOfficialMove();

                    if (this.engine.playerToMove() !== this.player_id) {
                        let t = this.conditional_tree.getChild(GoMath.encodeMove(mv[0].x, mv[0].y));
                        t.move = null;
                        this.setConditionalTree(t);
                    }

                    if (this.engine.getMoveNumber() !== move_obj.move_number - 1) {
                        this.message(_("Synchronization error, reloading"));
                        setTimeout(() => {
                            window.location.href = window.location.href;
                        }, 2500);
                        console.error("Synchronization error, we thought move should be " + this.engine.getMoveNumber()
                                      + " server thought it should be " + (move_obj.move_number - 1));

                        return;
                    }

                    if (mv[0].edited) {
                        this.engine.editPlace(mv[0].x, mv[0].y, mv[0].color);
                    }
                    else {
                        this.engine.place(mv[0].x, mv[0].y, false, false, false, true, true);
                    }

                    this.setLastOfficialMove();
                    this.move_selected = false;

                    if (jumptomove) {
                        this.engine.jumpTo(jumptomove);
                        this.has_new_official_move = true;
                    } else {
                        this.has_new_official_move = false;
                    }

                    this.emit("update");
                    this.playMovementSound();

                    this.emit('move-made');

                    if (this.move_number) {
                        this.move_number.text(this.engine.getMoveNumber());
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            this._socket_on(prefix + "conditional_moves", (cmoves) => {
                if (this.disconnectedFromGame) { return; }

                if (cmoves.moves == null) {
                    this.setConditionalTree(null);
                } else {
                    this.setConditionalTree(GoConditionalMove.decode(cmoves.moves));
                }
            });
            this._socket_on(prefix + "removed_stones", (cfg) => {
                if (this.disconnectedFromGame) { return; }

                if ("strict_seki_mode" in cfg) {
                    this.engine.strict_seki_mode = cfg.strict_seki_mode;
                } else {
                    let removed = cfg.removed;
                    let stones = cfg.stones;
                    let moves;
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
            this._socket_on(prefix + "removed_stones_accepted", (cfg) => {
                if (this.disconnectedFromGame) { return; }

                let player_id = cfg.player_id;
                let stones = cfg.stones;

                if (player_id === 0) {
                    this.engine.players["white"].accepted_stones = stones;
                    this.engine.players["black"].accepted_stones = stones;
                }
                else {
                    this.engine.players[this.engine.playerColor(player_id)].accepted_stones = stones;
                    this.engine.players[this.engine.playerColor(player_id)].accepted_strict_seki_mode = "strict_seki_mode" in cfg ? cfg.strict_seki_mode : false;
                }
                this.updateTitleAndStonePlacement();
                this.emit("update");
            });

            this._socket_on(prefix + "auto_resign", (obj) => {
                this.emit('auto-resign', {
                    game_id: obj.game_id,
                    player_id: obj.player_id,
                    expiration: obj.expiration,
                });
            });
            this._socket_on(prefix + "clear_auto_resign", (obj) => {
                this.emit('clear-auto-resign', {
                    game_id: obj.game_id,
                    player_id: obj.player_id,
                });
            });
        }


        /*******************/
        /*** Review mode ***/
        /*******************/
        let bulk_processing = false;
        let process_r = (obj) => {
            if (this.disconnectedFromGame) { return; }

            if ("chat" in obj) {
                obj["chat"].channel = "discussion";
                if (!obj.chat.chat_id) {
                    obj.chat.chat_id = obj.chat.player_id + "." + obj.chat.date;
                }
                this.emit("chat", obj["chat"]);
            }

            if ("remove-chat" in obj) {
                this.emit("chat-remove", { chat_ids: [obj['remove-chat']] });
            }

            if ("gamedata" in obj) {
                if (obj.gamedata.phase === "stone removal") {
                    obj.gamedata.phase = "finished";
                }

                this.load(obj.gamedata);
                this.review_had_gamedata = true;
            }

            if ("owner" in obj) {
                this.review_owner_id =  typeof(obj.owner) === "object" ? obj.owner.id : obj.owner;
            }
            if ("controller" in obj) {
                this.review_controller_id = typeof(obj.controller) === "object" ? obj.controller.id : obj.controller;
            }

            if (!this.isPlayerController()
                || !this.done_loading_review
                || "om" in obj   /* official moves are always alone in these object broadcasts */
                || "undo" in obj /* official moves are always alone in these object broadcasts */
            ) {
                let curmove = this.engine.cur_move;
                let follow = this.engine.cur_review_move == null || this.engine.cur_review_move.id === curmove.id;
                let do_redraw = false;
                if ("f" in obj) { /* specifying node */
                    let t = this.done_loading_review;
                    this.done_loading_review = false; /* this prevents drawing from being drawn when we do a follow path. */
                    this.engine.followPath(obj.f, obj.m);
                    this.drawSquare(this.engine.cur_move.x, this.engine.cur_move.y);
                    this.done_loading_review = t;
                    this.engine.setAsCurrentReviewMove();
                    this.scheduleRedrawPenLayer();
                }

                if ("om" in obj) { /* Official move [comes from live review of game] */
                    let t = this.engine.cur_review_move || this.engine.cur_move;
                    let mv = this.engine.decodeMoves([obj.om])[0];
                    let follow_om = t.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.place(mv.x, mv.y, false, false, true, true, true);
                    this.engine.setLastOfficialMove();
                    if ((t.x !== mv.x || t.y !== mv.y)  /* case when a branch has been promoted to trunk */
                        && !follow_om) { /* case when they were on a last official move, autofollow to next */
                        this.engine.jumpTo(t);
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.redrawMoveTree();
                    }
                }

                if ("undo" in obj) { /* Official undo move [comes from live review of game] */
                    let t = this.engine.cur_review_move;
                    let cur_move_undone = this.engine.cur_review_move.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.showPrevious();
                    this.engine.setLastOfficialMove();
                    if (!cur_move_undone) {
                        this.engine.jumpTo(t);
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.redrawMoveTree();
                    }
                }


                if (this.engine.cur_review_move) {
                    if ("t" in obj) { /* set text */
                        this.engine.cur_review_move.text = obj["t"];
                    }
                    if ("t+" in obj) { /* append to text */
                        this.engine.cur_review_move.text += obj["t+"];
                    }
                    if ("k" in obj) { /* set marks */
                        let t = this.engine.cur_move;
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
                        let t = this.engine.cur_review_move.parent;
                        this.engine.cur_review_move.remove();
                        this.engine.jumpTo(t);
                        this.engine.setAsCurrentReviewMove();
                        this.scheduleRedrawPenLayer();
                        if (this.done_loading_review) {
                            this.redrawMoveTree();
                        }
                    }
                    if ("pen" in obj) { /* start pen */
                        this.engine.cur_review_move.pen_marks.push({"color": obj["pen"], "points": []});
                    }
                    if ("pp" in obj) { /* update pen marks */
                        try {
                            let pts = this.engine.cur_review_move.pen_marks[this.engine.cur_review_move.pen_marks.length - 1].points;
                            this.engine.cur_review_move.pen_marks[this.engine.cur_review_move.pen_marks.length - 1].points = pts.concat(obj["pp"]);
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
                        this.redrawMoveTree();
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
                if (!("owner" in obj)) { /* only false at index 0 of the replay log */
                    if (this.isPlayerController()) {
                        this.emit("review.sync-to-current-move");
                    }
                    this.updateTitleAndStonePlacement();

                    this.emit("chat", {
                        "system": true,
                        "chat_id": uuid(),
                        "body": interpolate(_("Control passed to %s"), [typeof(obj.controller) === "number" ? `%%%PLAYER-${obj.controller}%%%` : obj.controller.username]),
                        "channel": "system",
                    });
                    this.emit("update");
                }
            }
            if (!bulk_processing) {
                this.emit("review.updated");
            }
        };

        if (this.review_id) {
            this._socket_on(prefix + "full_state", (entries) => {
                try {
                    if (!entries || entries.length === 0) {
                        console.error('Blank full state received, ignoring');
                        return;
                    }
                    if (this.disconnectedFromGame) { return; }

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
                    this.redrawMoveTree();
                    this.redraw(true);

                } catch (e) {
                    console.error(e);
                }
            });
            this._socket_on(prefix + "r", process_r);
        }



        return socket;
    }
    public destroy() {
        this.emit("destroy");
        //delete window['active_gobans'][this.goban_id];
        this.destroyed = true;
        if (this.socket) {
            this.disconnect();
        }

        /* Clear various timeouts that may be running */
        this.setGameClock(null);
        if (this.submitBlinkTimer) {
            clearTimeout(this.submitBlinkTimer);
        }
        this.submitBlinkTimer = null;
    }
    protected disconnect() {
        this.emit("destroy");
        if (!this.disconnectedFromGame) {
            this.disconnectedFromGame = true;
            if (this.socket) {
                if (this.review_id) {
                    this.socket.send("review/disconnect", {"review_id": this.review_id});
                }
                if (this.game_id) {
                    this.socket.send("game/disconnect", {"game_id": this.game_id});
                }
            }
        }
        for (let pair of this.socket_event_bindings) {
            this.socket.off(pair[0], pair[1]);
        }
        this.socket_event_bindings = [];
    }
    protected scheduleRedrawPenLayer() {
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

    public sendChat(msg_body, type) {
        if (typeof(msg_body) === "string" && msg_body.length === 0) {
            return;
        }

        let msg: any = {
            body: msg_body
        };

        let where = null;
        if (this.game_id) {
            where = "game/chat";
            msg["type"] = type;
            msg["game_id"] = this.config.game_id;
            msg["move_number"] = this.engine.getCurrentMoveNumber();
        } else {
            let diff = this.engine.getMoveDiff();
            where = "review/chat";
            msg["review_id"] = this.config.review_id;
            msg["from"] = diff.from;
            msg["moves"] =  diff.moves;
        }

        this.socket.send(where, msg);
    }

    protected setTitle(title) {
        this.title = title;
        if (this.title_div) {
            if (typeof(title) === "string") {
                this.title_div.html(title);
            } else {
                this.title_div.empty();
                this.title_div.append(title);
            }
        }
        this.emit('title', title);
    }

    protected getWidthForSquareSize(square_size) {
        return (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels) * square_size;
    }
    protected xy2ij(x, y) {
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

        let i = Math.floor(x / this.square_size);
        let j = Math.floor(y / this.square_size);
        return {"i": i, "j": j, "valid": i >= 0 && j >= 0 && i < this.width && j < this.height};
    }
    public setAnalyzeTool(tool, subtool) {
        this.analyze_tool = tool;
        this.analyze_subtool = subtool;
        if (tool === "stone" && subtool === "black") {
            this.edit_color = "black";
        } else if (tool === "stone" && subtool === "white") {
            this.edit_color = "white";

        } else {
            this.edit_color = null;
        }

        this.setLabelCharacterFromMarks(this.analyze_subtool);

        if (tool === "draw") {
            this.enablePen();
        }
    }


    protected putOrClearLabel(x, y, mode?) {
        let ret = null;
        if (mode == null || typeof(mode) === "undefined") {
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
        }
        else {
            if (mode === "put") {
                ret = this.toggleMark(x, y, this.label_mark, this.label_mark.length <= 3, true);
            } else {
                let marks = this.getMarks(x, y);

                for (let i = 0; i < MARK_TYPES.length; ++i) {
                    delete marks[MARK_TYPES[i]];
                }
                this.drawSquare(x, y);
            }
        }

        this.syncReviewMove();
        return ret;
    }
    protected onLabelingStart(ev) {
        let pos = getRelativeEventPosition(ev);
        this.last_label_position = this.xy2ij(pos.x, pos.y);

        {
            let x = this.last_label_position.i;
            let y = this.last_label_position.j;
            if (!((x >= 0 && x < this.width) && (y >= 0 && y < this.height))) {
                return;
            }
        }

        this.labeling_mode = this.putOrClearLabel(this.last_label_position.i, this.last_label_position.j) ? "put" : "clear";

        /* clear hover */
        if (this.__last_pt.valid) {
            let last_hover = this.last_hover_square;
            this.last_hover_square = null;
            this.drawSquare(last_hover.x, last_hover.y);
        }
        this.__last_pt = this.xy2ij(-1, -1);
        this.drawSquare(this.last_label_position.i, this.last_label_position.j);
    }
    protected onLabelingMove(ev) {
        let pos = getRelativeEventPosition(ev);
        let cur = this.xy2ij(pos.x, pos.y);

        {
            let x = cur.i;
            let y = cur.j;
            if (!((x >= 0 && x < this.width) && (y >= 0 && y < this.height))) {
                return;
            }
        }

        if (cur.i !== this.last_label_position.i || cur.j !== this.last_label_position.j) {
            this.last_label_position = cur;
            this.putOrClearLabel(cur.i, cur.j, this.labeling_mode);
            this.setLabelCharacterFromMarks();
        }
    }
    public setSquareSize(new_ss) {
        let redraw = this.square_size !== new_ss;
        this.square_size = new_ss;
        if (redraw) {
            this.redraw(true);
        }
    }
    public setSquareSizeBasedOnDisplayWidth(display_width) {
        let n_squares = Math.max(
            this.bounded_width  + +this.draw_left_labels + +this.draw_right_labels,
            this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels
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

    public setStrictSekiMode(tf) {
        if (this.engine.phase !== "stone removal") {
            throw "Not in stone removal phase";
        }
        if (this.engine.strict_seki_mode === tf) { return; }
        this.engine.strict_seki_mode = tf;

        this.socket.send("game/removed_stones/set", {
            "auth"            : this.config.auth,
            "game_id"         : this.config.game_id,
            "player_id"       : this.config.player_id,
            "strict_seki_mode": tf
        });
    }
    public computeMetrics() {
        if (this.square_size <= 0) {
            //console.error("Non positive square size set", this.square_size);
            //console.error(new Error().stack);
            this.square_size = 12;
        }

        let ret = {
            "width": this.square_size * (this.bounded_width + +this.draw_left_labels + +this.draw_right_labels),
            "height": this.square_size * (this.bounded_height + +this.draw_top_labels + +this.draw_bottom_labels),
            "mid": this.square_size / 2,
            "offset": 0
        };

        if (this.square_size % 2 === 0) { ret.mid -= 0.5; ret.offset = 0.5; }

        return ret;
    }
    protected setSubmit(fn) {
        this.submit_move = fn;
        this.emit("show-submit", fn != null);
    }

    protected enableDrawing() {
        this.drawing_enabled = true;
    }
    protected disableDrawing() {
        this.drawing_enabled = false;
    }
    protected markDirty() {
        if (!this.dirty_redraw) {
            this.dirty_redraw = setTimeout(() => {
                this.dirty_redraw = null;
                this.redraw();
            }, 1);
        }
    }


    protected computeThemeStoneRadius(metrics) {
        // Scale proportionally in general
        let r = this.square_size * 0.488;

        // Prevent pixel sharing in low-res
        if (this.square_size % 2 === 0) {
            r = Math.min(r, (this.square_size - 1) / 2);
        }

        return Math.max(1, r);
    }
    public redrawMoveTree() {
        //let d = $(this.move_tree_div);
        //let c = $(this.move_tree_canvas);
        let d = document.getElementById(this.move_tree_div);
        let c = document.getElementById(this.move_tree_canvas);
        if (d && c) {
            this.engine.move_tree.redraw({
                "board": this,
                "active_path_end": this.engine.cur_move,
                "div": d,
                "canvas": c
            });
        }
    }
    protected updateMoveTree() {
        this.redrawMoveTree();
    }
    protected updateOrRedrawMoveTree() {
        if (MoveTree.layout_dirty) {
            this.redrawMoveTree();
        } else {
            this.updateMoveTree();
        }
    }

    public setBounds(bounds:GobanBounds) {
        this.bounds = bounds || {top: 0, left: 0, bottom: this.height - 1, right: this.width - 1};

        if (this.bounds) {
            this.bounded_width = (this.bounds.right - this.bounds.left) + 1;
            this.bounded_height = (this.bounds.bottom - this.bounds.top) + 1;
        } else {
            this.bounded_width = this.width;
            this.bounded_height = this.height;
        }

        this.draw_left_labels = this.config.draw_left_labels;
        this.draw_right_labels = this.config.draw_right_labels;
        this.draw_top_labels = this.config.draw_top_labels;
        this.draw_bottom_labels = this.config.draw_bottom_labels;

        if (this.bounds.left > 0) { this.draw_left_labels = false; }
        if (this.bounds.top > 0) { this.draw_top_labels = false; }
        if (this.bounds.right < this.width - 1) { this.draw_right_labels = false; }
        if (this.bounds.bottom < this.height - 1) { this.draw_bottom_labels = false; }
    }

    public load(config) {
        for (let k in config) {
            this.config[k] = config[k];
        }
        this.clearMessage();
        this.width = config.width || 19;
        this.height = config.height || 19;
        this.move_selected = false;

        this.bounds = config.bounds || {top: 0, left: 0, bottom: this.height - 1, right: this.width - 1};
        if (this.bounds) {
            this.bounded_width = (this.bounds.right - this.bounds.left) + 1;
            this.bounded_height = (this.bounds.bottom - this.bounds.top) + 1;
        } else {
            this.bounded_width = this.width;
            this.bounded_height = this.height;
        }


        if ("display_width" in config && this.original_square_size === "auto") {
            this.display_width = config["display_width"];
            if (isNaN(this.display_width)) {
                console.error("Invalid display width. (NaN)");
                this.display_width = 320;
            }
            let n_squares = Math.max(this.bounded_width + +this.draw_left_labels + +this.draw_right_labels, this.bounded_height + +this.draw_bottom_labels + +this.draw_top_labels);
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

        if (!this.__draw_state || this.__draw_state.length !== this.height || this.__draw_state[0].length !== this.width) {
            this.__draw_state = GoMath.makeMatrix(this.width, this.height);
        }

        let merged_log = [];
        let main_log = (config.chat_log || []).map((x) => {x.channel = "main"; return x; });
        let spectator_log = (config.spectator_log || []).map((x) => {x.channel = "spectator"; return x; });
        let malkovich_log = (config.malkovich_log || []).map((x) => {x.channel = "malkovich"; return x; });
        merged_log = merged_log.concat(main_log, spectator_log, malkovich_log);
        merged_log.sort((a, b) => a.date - b.date);

        for (let line of merged_log) {
            this.emit("chat", line);
        }


        /* This must be done last as it will invoke the appropriate .set actions to set the board in it's correct state */
        let old_engine = this.engine;
        this.engine = new GoEngine(config, this);
        this.engine.getState_callback = () => { return this.getState(); };
        this.engine.setState_callback = (state) => { return this.setState(state); };
        if (this.move_number) {
            this.move_number.text(this.engine.getMoveNumber());
        }

        if ("marks" in this.config && this.engine) {
            this.setMarks(this.config.marks);
        }
        this.setConditionalTree(null);

        if (this.engine.puzzle_player_move_mode === "fixed" && this.getPuzzlePlacementSetting().mode === "play") {
            this.highlight_movetree_moves = true;
            this.restrict_moves_to_movetree = true;
        }
        if (this.getPuzzlePlacementSetting && this.getPuzzlePlacementSetting().mode !== "play") {
            this.highlight_movetree_moves = true;
        }

        if (!(old_engine && old_engine.boardMatriciesAreTheSame(old_engine.board, this.engine.board))) {
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

        if (this.engine.phase === "stone removal" && !("auto_scoring_done" in this) && !("auto_scoring_done" in (this as any).engine)) {
            (this as any).autoScore();
        }
    }
    protected set(x, y, player) {
        this.markDirty();
    }
    protected setForRemoval(x, y, removed) {
        if (removed) {
            this.getMarks(x, y).stone_removed = true;
            this.getMarks(x, y).remove = true;
        } else {
            this.getMarks(x, y).stone_removed = false;
            this.getMarks(x, y).remove = false;
        }
        this.drawSquare(x, y);
        this.emit("set-for-removal", {x, y, removed});
    }
    public showScores(score) {
        this.hideScores();
        this.showing_scores = true;

        for (let i = 0; i < 2; ++i) {
            let color = i ? "black" : "white";
            let moves = this.engine.decodeMoves(score[color].scoring_positions);
            for (let j = 0; j < moves.length; ++j) {
                let mv = moves[j];
                if (mv.y < 0 || mv.x < 0) {
                    console.error("Negative scoring position: ", mv);
                    console.error("Scoring positions [" + color + "]: ", score[color].scoring_positions);
                } else {
                    this.getMarks(mv.x, mv.y).score = color;
                    this.drawSquare(mv.x, mv.y);
                }
            }
        }
    }
    public hideScores() {
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

    public updatePlayerToMoveTitle() {
        switch (this.engine.phase) {
            case "play":
                if (this.player_id && this.player_id === this.engine.playerToMove() && this.mode !== "edit" && this.engine.cur_move.id === this.engine.last_official_move.id) {
                    if (this.engine.cur_move.passed() && this.engine.handicapMovesLeft() <= 0 && this.engine.cur_move.parent) {
                        this.setTitle(_("Your move - Opponent Passed"));
                        if (this.last_move && this.last_move.x >= 0) {
                            this.drawSquare(this.last_move.x, this.last_move.y);
                        }
                    } else {
                        this.setTitle(_("Your move"));
                    }
                    if (this.engine.cur_move.id === this.engine.last_official_move.id && this.mode === "play") {
                        this.emit("state_text", {title: _("Your Move")});
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
                    if (this.engine.cur_move.id === this.engine.last_official_move.id && this.mode === "play") {
                        this.emit("state_text", {title: title, show_moves_made_count: true});
                    }
                }
                break;

            case "stone removal":
                this.setTitle(_("Stone Removal"));
                this.emit("state_text", {title: _("Stone Removal Phase")});
                break;

            case "finished":
                this.setTitle(_("Game Finished"));
                this.emit("state_text", {title: _("Game Finished")});
                break;

            default:
                this.setTitle(this.engine.phase);
                break;
        }
    }
    public disableStonePlacement() {
        this.stone_placement_enabled = false;
        // console.log("disabled stone placement");
        if (this.__last_pt && this.__last_pt.valid) {
            this.drawSquare(this.__last_pt.i, this.__last_pt.j);
        }
    }
    public enableStonePlacement() {
        if (this.stone_placement_enabled) {
            this.disableStonePlacement();
        }

        if (this.engine.phase === "play" || (this.engine.phase === "finished" && this.mode === "analyze")) {
            let color = this.engine.playerColor(this.engine.playerToMove());
            if (this.mode === "edit" && this.edit_color) {
                color = this.edit_color;
            }
        }

        this.stone_placement_enabled = true;
        // console.log("enabled stone placement");
        if (this.__last_pt && this.__last_pt.valid) {
            this.drawSquare(this.__last_pt.i, this.__last_pt.j);
        }
    }
    public showFirst(dont_update_display?) {
        this.engine.jumpTo(this.engine.move_tree);
        if (!dont_update_display) {
            this.updateTitleAndStonePlacement();
            this.emit("update");
        }
    }
    public showPrevious(dont_update_display?) {
        if (this.mode === "conditional") {
            if (this.conditional_path.length >= 2) {
                let prev_path = this.conditional_path.substr(0, this.conditional_path.length - 2);
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
    public showNext(dont_update_display?) {
        if (this.mode === "conditional") {
            if (this.currently_my_cmove) {
                if (this.current_cmove.move != null) {
                    this.followConditionalPath(this.current_cmove.move);
                }
            } else {
                for (let ch in this.current_cmove.children) {
                    this.followConditionalPath(ch);
                    break;
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
    public prevSibling() {
        let sibling = this.engine.cur_move.prevSibling();
        if (sibling) {
            this.engine.jumpTo(sibling);
            this.emit("update");
        }
    }
    public nextSibling() {
        let sibling = this.engine.cur_move.nextSibling();
        if (sibling) {
            this.engine.jumpTo(sibling);
            this.emit("update");
        }
    }
    public deleteBranch() {
        if (!this.engine.cur_move.trunk) {
            if (this.isPlayerController()) {
                this.syncReviewMove({"delete": 1});
            }
            this.engine.deleteCurMove();
            this.emit("update");
            this.redrawMoveTree();
        }
    }

    public jumpToLastOfficialMove() {
        this.move_selected = false;
        this.engine.jumpToLastOfficialMove();
        this.updateTitleAndStonePlacement();

        this.conditional_path = "";
        this.currently_my_cmove = false;
        if (this.mode === "conditional") {
            this.current_cmove = this.conditional_tree;
        }

        this.emit("update");
    }
    protected setLastOfficialMove() {
        this.engine.setLastOfficialMove();
        this.updateTitleAndStonePlacement();
    }
    protected isLastOfficialMove() {
        return this.engine.isLastOfficialMove();
    }

    public updateTitleAndStonePlacement() {
        this.updatePlayerToMoveTitle();

        if (this.engine.phase === "stone removal" || this.scoring_mode) {
            this.enableStonePlacement();
        }
        else if (this.engine.phase === "play") {
            switch (this.mode) {
                case "play":
                    if (this.isLastOfficialMove() && this.engine.playerToMove() === this.player_id) {
                        this.enableStonePlacement();
                    } else {
                        this.disableStonePlacement();
                    }
                    break;

                case "analyze":
                    this.disableStonePlacement();
                    this.enableStonePlacement();
                    break;

                case "conditional":
                    this.disableStonePlacement();
                    this.enableStonePlacement();
                    break;

                case "edit":
                    this.disableStonePlacement();
                    this.enableStonePlacement();
                    break;
            }
        }
        else if (this.engine.phase === "finished") {
            this.disableStonePlacement();
            if (this.mode === "analyze") {
                this.enableStonePlacement();
            }
        }
    }

    public setConditionalTree(conditional_tree) {
        if (conditional_tree == null) {
            conditional_tree = new GoConditionalMove(null, null);
        }
        this.conditional_tree = conditional_tree;
        this.current_cmove = conditional_tree;

        this.emit("update");
    }
    public followConditionalPath(movepath) {
        let moves = this.engine.decodeMoves(movepath);
        for (let i = 0; i < moves.length; ++i) {
            this.engine.place(moves[i].x, moves[i].y);
            this.followConditionalSegment(moves[i].x, moves[i].y);
        }
    }
    protected followConditionalSegment(x, y) {
        let mv = encodeMove(x, y);
        this.conditional_path += mv;

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
    }
    protected deleteConditionalSegment(x, y) {
        this.conditional_path += encodeMove(x, y);

        if (this.currently_my_cmove) {
            this.current_cmove.children = {};
            this.current_cmove.move = null;
            let cur = this.current_cmove;
            let parent = cur.parent;
            this.current_cmove = parent;
            for (let mv in parent.children) {
                if (parent.children[mv] === cur) {
                    delete parent.children[mv];
                }
            }
        } else {
            console.error("deleteConditionalSegment called on other player's move, which doesn't make sense");
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
    }
    public deleteConditionalPath(movepath) {
        let moves = this.engine.decodeMoves(movepath);
        if (moves.length) {
            for (let i = 0; i < moves.length - 1; ++i) {
                if (i !== moves.length - 2) {
                    this.engine.place(moves[i].x, moves[i].y);
                }
                this.followConditionalSegment(moves[i].x, moves[i].y);
            }
            this.deleteConditionalSegment(moves[moves.length - 1].x, moves[moves.length - 1].y);
        }
    }
    public getCurrentConditionalPath() {
        return this.conditional_path;
    }
    public saveConditionalMoves() {
        this.socket.send("game/conditional_moves/set", {
            "auth"        : this.config.auth,
            "move_number" : this.engine.getCurrentMoveNumber(),
            "game_id"     : this.config.game_id,
            "player_id"   : this.config.player_id,
            "cmoves"      : this.conditional_tree.encode()
        });
    }

    public setModeDeferred(mode) {
        setTimeout(() => { this.setMode(mode); }, 1);
    }
    public setMode(mode, dont_jump_to_official_move?) {
        if (mode === "conditional" && this.player_id === this.engine.playerToMove()) {
            /* this shouldn't ever get called, but incase we screw up.. */
            swal("Can't enter conditional move planning when it's your turn");
            return false;
        }

        this.setSubmit(null);

        if (["play", "analyze", "conditional", "edit", "score estimation", "pattern search", "puzzle"].indexOf(mode) === -1) {
            swal("Invalid mode for Goban: " + mode);
            return;
        }

        if (this.engine.config.disable_analysis && this.engine.phase !== "finished" && (mode === "analyze" || mode === "conditional")) {
            swal("Unable to enter " + mode + " mode");
            return;
        }

        if (mode === "conditional") {
            this.conditional_starting_color = this.engine.playerColor();
        }

        let redraw = true;

        if (this.mode === "play" || this.mode === "finished") {
            this.has_new_official_move = false;
        }

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
    public resign() {
        this.socket.send("game/resign", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }
    protected sendPendingResignation() {
        window["comm_socket"].send("game/delayed_resign", {
            "auth": this.config.auth,
            "game_id": this.config.game_id
        });
    }
    protected clearPendingResignation() {
        window["comm_socket"].send("game/clear_delayed_resign", {
            "auth": this.config.auth,
            "game_id": this.config.game_id
        });
    }
    public cancelGame() {
        this.socket.send("game/cancel", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }
    protected annul() {
        this.socket.send("game/annul", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }
    public pass() {
        this.engine.place(-1, -1);
        if (this.mode === "play") {
            this.sendMove({
                "auth": this.config.auth,
                "game_id": this.config.game_id,
                "player_id": this.config.player_id,
                "move": encodeMove(-1, -1)
            });
        } else {
            this.syncReviewMove();
            if (this.move_tree_div) {
                this.redrawMoveTree();
            }
        }
    }
    public requestUndo() {
        this.socket.send("game/undo/request", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id,
            "move_number": this.engine.getCurrentMoveNumber()
        });
    }
    public acceptUndo() {
        this.socket.send("game/undo/accept", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id,
            "move_number": this.engine.getCurrentMoveNumber()
        });
    }
    public pauseGame() {
        this.socket.send("game/pause", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }
    public resumeGame() {
        this.socket.send("game/resume", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }

    public acceptRemovedStones() {
        let stones = this.engine.getStoneRemovalString();
        this.engine.players[this.engine.playerColor(this.config.player_id)].accepted_stones = stones;
        this.socket.send("game/removed_stones/accept", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id,
            "stones": stones,
            "strict_seki_mode": this.engine.strict_seki_mode
        });
    }
    public rejectRemovedStones() {
        let stones = this.engine.getStoneRemovalString();
        this.engine.players[this.engine.playerColor(this.config.player_id)].accepted_stones = null;
        this.socket.send("game/removed_stones/reject", {
            "auth": this.config.auth,
            "game_id": this.config.game_id,
            "player_id": this.config.player_id
        });
    }
    public setEditColor(color) {
        this.edit_color = color;
        this.updateTitleAndStonePlacement();
    }
    protected editSettings(changes) {
        let need_to_change = false;
        for (let k in changes) {
            if (this.engine[k] !== changes[k]) {
                need_to_change = true;
                break;
            }
        }

        if (need_to_change) {
            /* this will send back a gamedata blob which will in turn update our own state */
            this.socket.send("editSettings", {
                "auth": this.config.auth,
                "game_id": this.config.game_id,
                "player_id": this.config.player_id,
                "changes": changes
            });
        }
    }
    protected playMovementSound() {
        if (this.last_sound_played_for_a_stone_placement === this.engine.cur_move.x + "," + this.engine.cur_move.y) {
            return;
        }
        this.last_sound_played_for_a_stone_placement  = this.engine.cur_move.x + "," + this.engine.cur_move.y;

        let idx;
        do {
            idx = Math.round(Math.random() * 10000) % 5; /* 5 === number of stone sounds */
        } while (idx === this.last_stone_sound);
        this.last_stone_sound = idx;

        if (this.on_game_screen) {
            if (this.last_sound_played_for_a_stone_placement === "-1,-1") {
                this.emit('audio-pass');
            } else {
                this.emit('audio-stone', idx);
            }
        }
    }
    protected setState(state) {
        if ((this.game_type === "review" || this.game_type === "demo") && this.engine) {
            this.drawPenMarks(this.engine.cur_move.pen_marks);
            if (this.isPlayerController() && this.connectToReviewSent) {
                this.syncReviewMove();
            }
        }

        this.setLabelCharacterFromMarks();
        this.markDirty();
    }
    protected getState() {
        /* This is a callback that gets called by GoEngine.getState to store board state in its state stack */
        let ret = { };
        return ret;
    }
    public giveReviewControl(player_id: number) {
        this.syncReviewMove({ "controller": player_id });
    }
    protected giveVoice(player_id: number) {
        this.socket.send("review/voice/give", {
            "review_id": this.review_id,
            "voice_player": {
                "id": player_id,
            }
        });
    }
    protected removeVoice(player_id: number) {
        this.socket.send("review/voice/remove", {
            "review_id": this.review_id,
            "voice_player": {
                "id": player_id,
            }
        });
    }

    public setMarks(marks, dont_draw?) {
        for (let key in marks) {
            let locations = this.engine.decodeMoves(marks[key]);
            for (let i = 0; i < locations.length; ++i) {
                let pt = locations[i];
                this.setMark(pt.x, pt.y, key, dont_draw);
            }
        }
    }
    public setHeatmap(heatmap:Array<Array<number>>, dont_draw?:boolean): Array<Array<number>> {
        let ret = this.heatmap;
        this.heatmap = heatmap;
        if (!dont_draw) {
            this.redraw(true);
        }
        return ret;
    }
    public setColoredCircles(circles:Array<ColoredCircle>, dont_draw?:boolean):void {
        if (!circles || circles.length === 0) {
            this.colored_circles = null;
            return;
        }

        this.colored_circles = GoMath.makeEmptyObjectMatrix<ColoredCircle>(this.width, this.height);
        for (let circle of circles) {
            let xy = GoMath.decodeMoves(circle.move, this.width, this.height)[0];
            this.colored_circles[xy.y][xy.x] = circle;
        }
        if (!dont_draw) {
            this.redraw(true);
        }
    }

    public setColoredMarks(colored_marks) {
        for (let key in colored_marks) {
            let locations = this.engine.decodeMoves(colored_marks[key].move);
            for (let i = 0; i < locations.length; ++i) {
                let pt = locations[i];
                this.setMarkColor(pt.x, pt.y, colored_marks[key].color);
                this.setMark(pt.x, pt.y, key, false);
            }
        }
    }

    protected setMarkColor(x, y, color: string) {
        this.engine.cur_move.getMarks(x, y).color = color;
    }

    protected setLetterMark(x, y, mark: string, drawSquare?) {
        this.engine.cur_move.getMarks(x, y).letter = mark;
        if (drawSquare) { this.drawSquare(x, y);  }
    }
    public setCustomMark(x, y, mark: string, drawSquare?) {
        this.engine.cur_move.getMarks(x, y)[mark] = true;
        if (drawSquare) { this.drawSquare(x, y); }
    }
    public deleteCustomMark(x, y, mark: string, drawSquare?) {
        delete this.engine.cur_move.getMarks(x, y)[mark];
        if (drawSquare) { this.drawSquare(x, y); }
    }

    public setMark(x, y, mark, dont_draw) {
        try {
            if (x >= 0 && y >= 0) {
                if (typeof(mark) === "number") {
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
    protected setTransientMark(x, y, mark, dont_draw) {
        try {
            if (x >= 0 && y >= 0) {
                if (typeof(mark) === "number") {
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
    public getMarks(x, y) {
        if (this.engine && this.engine.cur_move) {
            return this.engine.cur_move.getMarks(x, y);
        }
        return {};
    }
    protected toggleMark(x, y, mark, force_label?, force_put?) {
        let ret = true;
        if (typeof(mark) === "number") {
            mark = "" + mark;
        }
        let marks = this.getMarks(x, y);

        let clearMarks = () => {
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
    protected incrementLabelCharacter() {
        let seq1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        if (parseInt(this.label_character)) {
            this.label_character = "" + (parseInt(this.label_character) + 1);
        } else if (seq1.indexOf(this.label_character) !== -1) {
            this.label_character = seq1[(seq1.indexOf(this.label_character) + 1) % seq1.length];
        }
    }
    protected setLabelCharacterFromMarks(set_override?) {
        if (set_override === "letters" || /^[a-zA-Z]$/.test(this.label_character)) {
            let seq1 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
            let idx = -1;

            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    let ch = this.getMarks(x, y).letter;
                    idx = Math.max(idx, seq1.indexOf(ch));
                }
            }

            this.label_character = seq1[idx + 1 % seq1.length];
        }
        if (set_override === "numbers" || /^[0-9]+$/.test(this.label_character)) {
            let val = 0;

            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (parseInt(this.getMarks(x, y).letter)) {
                        val = Math.max(val, parseInt(this.getMarks(x, y).letter));
                    }
                }
            }

            this.label_character = "" + (val + 1);
        }
    }
    public setLabelCharacter(ch) {
        this.label_character = ch;
        if (this.last_hover_square) {
            this.drawSquare(this.last_hover_square.x, this.last_hover_square.y);
        }
    }
    public clearMark(x, y, mark) {
        try {
            if (typeof(mark) === "number") {
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
    protected clearTransientMark(x, y, mark) {
        try {
            if (typeof(mark) === "number") {
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
    protected updateScoreEstimation() {
        if (this.score_estimate) {
            let est = this.score_estimate.estimated_hard_score - this.engine.komi;
            let color;
            if (GobanCore.hooks.updateScoreEstimation) {
                GobanCore.hooks.updateScoreEstimation(
                    est > 0 ? "black" : "white",
                    Math.abs(est)
                );
            }
        }
    }
    public autoScore() {
        try {
            if (!window["user"] || !this.on_game_screen  || !this.engine || (window["user"].id !== this.engine.black_player_id && window["user"].id !== this.engine.white_player_id)) {
                return;
            }
        } catch (e) {
            console.error(e.stack);
            return;
        }

        this.auto_scoring_done = true;

        this.message(_("Processing..."), -1);
        let do_score_estimation = () => {
            let se = new ScoreEstimator(null);
            se.init(this.engine, AUTOSCORE_TRIALS, AUTOSCORE_TOLERANCE);
            //console.error(se.area);

            let current_removed = this.engine.getStoneRemovalString();
            let new_removed = se.getProbablyDead();

            this.engine.clearRemoved();
            let moves = this.engine.decodeMoves(new_removed);
            for (let i = 0; i < moves.length; ++i) {
                this.engine.setRemoved(moves[i].x, moves[i].y, true);
            }

            this.updateTitleAndStonePlacement();
            this.emit("update");

            this.socket.send("game/removed_stones/set", {
                "auth"        : this.config.auth,
                "game_id"     : this.config.game_id,
                "player_id"   : this.config.player_id,
                "removed"     : false,
                "stones"      : current_removed
            });
            this.socket.send("game/removed_stones/set", {
                "auth"        : this.config.auth,
                "game_id"     : this.config.game_id,
                "player_id"   : this.config.player_id,
                "removed"     : true,
                "stones"      : new_removed
            });

            this.clearMessage();
        };


        setTimeout(() => {
            init_score_estimator()
                .then(do_score_estimation)
                .catch(err => console.error(err));
        }, 10);
    }
    protected sendMove(mv) {
        let timeout = setTimeout(() => {
            this.message(_("Error submitting move"), -1);

            let second_try_timeout = setTimeout(() => {
                window.location.reload();
            }, 4000);
            this.socket.send("game/move", mv, () => {
                let confirmation_time = new Date();
                clearTimeout(second_try_timeout);
                this.clearMessage();
            });

        }, 4000);
        this.socket.send("game/move", mv, () => {
            let confirmation_time = new Date();
            clearTimeout(timeout);
            this.clearMessage();
        });
    }

    public setGameClock(original_clock:AdHocClock):void {
        if (this.__clock_timer) {
            clearTimeout(this.__clock_timer);
            this.__clock_timer = null;
        }

        if (original_clock == null) {
            this.emit('clock', null);
            return;
        }
        this.last_clock = original_clock;

        let time_control:JGOFTimeControl = this.config.time_control;

        let current_server_time:number = null;
        function update_current_server_time() {
            let server_time_offset =  GobanCore.hooks.getClockDrift() - GobanCore.hooks.getNetworkLatency();
            current_server_time = Date.now() - server_time_offset;
        }
        update_current_server_time();

        //this.last_clock = original_clock;

        let clock:JGOFClock = {
            current_player: original_clock.current_player === original_clock.black_player_id ? 'black' : 'white',
            time_of_last_move: original_clock.last_move,
            paused_since: original_clock.paused_since,
            black_clock: null,
            white_clock: null,
        };

        if (original_clock.pause) {
            if (original_clock.pause.paused) {
                this.engine.paused_since = original_clock.pause.paused_since;
                this.engine.pause_control = original_clock.pause.pause_control;

                /* correct for when we used to store paused_since in terms of seconds instead of ms */
                if (this.engine.paused_since < 2000000000) {
                    this.engine.paused_since *= 1000;
                }

                clock.paused_since = original_clock.pause.paused_since;
                clock.pause_state = { }
                for (let k in original_clock.pause.pause_control) {
                    if (/vacation-([0-9]+)/.test(k)) {
                        let player_id = k.match(/vacation-([0-9]+)/)[1];
                        if (!clock.pause_state.vacation) {
                            clock.pause_state.vacation = {};
                        }
                        clock.pause_state.vacation[player_id] = true;
                    } else {
                        switch (k) {
                            case 'stone-removal':
                                clock.pause_state.stone_removal = true;
                                break;

                            case 'weekend':
                                clock.pause_state.weekend = true;
                                break;

                            case 'server':
                                clock.pause_state.server = true;
                                break;

                            case 'paused':
                                clock.pause_state.player = {
                                    player_id: original_clock.pause.pause_control.paused.pausing_player_id.toString(),
                                    pauses_left: original_clock.pause.pause_control.paused.pauses_left,
                                };
                                break;
                            case 'moderator_paused':
                                clock.pause_state.moderator = original_clock.pause.pause_control.moderator_paused.moderator_id.toString();
                                break;

                            default:
                                throw new Error(`Unhandled pause control key: ${k}`);
                        }

                    }
                }
            } else {
                delete this.engine.paused_since;
                delete this.engine.pause_control;
            }
        }


        const make_player_clock = (
            original_clock:AdHocPlayerClock,
            original_clock_expiration:number,
            is_current_player:boolean,
            time_elapsed:number
        ):JGOFPlayerClock => {
            let ret:JGOFPlayerClock = {
                main_time: 0,
            };

            let tcs:string = "" + (time_control.system);
            switch (time_control.system) {
                case 'simple':
                    ret.main_time = is_current_player
                        ?  Math.max(0, (original_clock_expiration - time_elapsed) - current_server_time)
                        : time_control.per_move * 1000;
                    break;

                case 'none':
                    ret.main_time = 0;
                    break;

                case 'absolute':
                    ret.main_time = is_current_player
                        ?  Math.max(0, (original_clock_expiration - time_elapsed) - current_server_time)
                        : Math.max(0, original_clock_expiration - current_server_time);
                    break;

                case 'fischer':
                    ret.main_time = is_current_player
                        ?  Math.max(0, (original_clock.thinking_time * 1000 - time_elapsed))
                        : original_clock.thinking_time*1000;
                    break;

                case 'byoyomi':
                    if (is_current_player) {
                        ret.main_time = original_clock.thinking_time * 1000 - time_elapsed;
                        ret.periods_left = original_clock.periods;
                        ret.period_time_left = time_control.period_time * 1000;
                        if (ret.main_time < 0) {
                            let overtime_usage = - ret.main_time;
                            ret.main_time = 0;

                            let periods_used = Math.floor(overtime_usage / time_control.period_time * 1000);
                            ret.periods_left -= periods_used;
                            ret.period_time_left = overtime_usage - (periods_used * time_control.period_time * 1000);

                            if (ret.periods_left < 0) {
                                ret.periods_left = 0;
                            }

                            if (ret.period_time_left < 0) {
                                ret.period_time_left = 0;
                            }
                        }
                    } else {
                        ret.main_time = original_clock.thinking_time * 1000;
                        ret.periods_left = original_clock.periods;
                        ret.period_time_left = time_control.period_time * 1000;
                    }
                    break;

                case 'canadian':
                    if (is_current_player) {
                        ret.main_time = original_clock.thinking_time * 1000 - time_elapsed;
                        ret.moves_left = original_clock.moves_left;
                        ret.block_time_left = original_clock.block_time * 1000;

                        if (ret.main_time < 0) {
                            let overtime_usage = - ret.main_time;
                            ret.main_time = 0;

                            ret.block_time_left -= overtime_usage;

                            if (ret.block_time_left < 0) {
                                ret.block_time_left = 0;
                            }
                        }
                    } else {
                        ret.main_time = original_clock.thinking_time * 1000;
                        ret.moves_left = original_clock.moves_left;
                        ret.block_time_left = original_clock.block_time * 1000;
                    }
                    break;

                default:
                    throw new Error(`Unsupported time control system: ${tcs}`);
            }

            return ret;
        };

        const do_update = () => {
            update_current_server_time();

            let next_update_time:number = 100;
            const elapsed:number = current_server_time - original_clock.last_move;

            clock.black_clock = make_player_clock(
                typeof(original_clock.black_time) === 'number' ? null : original_clock.black_time as AdHocPlayerClock,
                original_clock.expiration,
                clock.current_player === 'black' && !clock.start_mode,
                elapsed
            );

            clock.white_clock = make_player_clock(
                typeof(original_clock.white_time) === 'number' ? null : original_clock.white_time as AdHocPlayerClock,
                original_clock.expiration,
                clock.current_player === 'white' && !clock.start_mode,
                elapsed
            );

            if (clock.start_mode) {
                clock.start_time_left = original_clock.expiration - current_server_time;
            }

            this.emit('clock', clock);

            this.__clock_timer = setTimeout(do_update, next_update_time);
        };

        do_update();
    }
    public syncReviewMove(msg_override?, node_text?) {
        if (this.review_id && (this.isPlayerController() || (this.isPlayerOwner() && msg_override && msg_override.controller)) && this.done_loading_review) {
            if (this.isInPushedAnalysis()) {
                return;
            }

            let diff = this.engine.getMoveDiff();
            this.engine.setAsCurrentReviewMove();

            let msg;

            if (!msg_override) {
                let marks = {};
                let mark_ct = 0;
                for (let y = 0; y < this.height; ++y) {
                    for (let x = 0; x < this.width; ++x) {
                        let pos = this.getMarks(x, y);
                        for (let i = 0; i < MARK_TYPES.length; ++i) {
                            if (MARK_TYPES[i] in pos && pos[MARK_TYPES[i]]) {
                                let markkey = MARK_TYPES[i] === "letter" ? pos.letter : MARK_TYPES[i];
                                if (!(markkey in marks)) {
                                    marks[markkey] = "";
                                }
                                marks[markkey] += encodeMove(x, y);
                                ++mark_ct;
                            }
                        }
                    }
                }

                if (!node_text && node_text !== "") {
                    node_text = this.engine.cur_move.text || "";
                }

                msg = {
                    "f": diff.from,
                    "t": node_text,
                    "m": diff.moves,
                    "k": marks,
                };
                let tmp = dup(msg);

                if (this.last_review_message.f === msg.f && this.last_review_message.m === msg.m) {
                    delete msg["f"];
                    delete msg["m"];

                    let txt_idx = node_text.indexOf(this.engine.cur_move.text || "");
                    if (txt_idx === 0) {
                        delete msg["t"];
                        if (node_text !== this.engine.cur_move.text) {
                            msg["t+"] = node_text.substr(this.engine.cur_move.text.length);
                        }
                    }

                    if (deepEqual(marks, this.last_review_message.k)) {
                        delete msg["k"];
                    }
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
    public setScoringMode(tf):MoveTree {
        this.scoring_mode = tf;
        let ret = this.engine.cur_move;

        if (this.scoring_mode) {
            this.message(_("Processing..."), -1);
            this.setMode("score estimation", true);
            this.clearMessage();
            this.score_estimate = this.engine.estimateScore(SCORE_ESTIMATION_TRIALS, SCORE_ESTIMATION_TOLERANCE);
            this.enableStonePlacement();
            this.redraw(true);
            this.emit("update");
        } else {
            this.setMode("play");
            this.redraw(true);
        }

        return ret;
    }
    /**
     * Returns true if the user has signed in and if the signed in user is a participating player in this game
     * (and not only spectating), that is, if they are either white or black.
     */
    public isParticipatingPlayer():boolean {
        return this.engine.black_player_id === this.player_id ||
               this.engine.white_player_id === this.player_id;
    }
    public getLastReviewMessage():any {
        return this.last_review_message;
    }
    public setLastReviewMessage(m:any):void {
        this.last_review_message = m;
    }
}
function plurality(num, single, plural) {
    if (num > 0) {
        if (num === 1) {
            return num + " " + single;
        }
        return num + " " + plural;
    }
    return "";
}
function uuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        let r = Math.random() * 16 | 0;
        let v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
