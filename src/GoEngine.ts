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

import { GobanMoveError } from "./GobanError";
import { MoveTree, MoveTreeJson } from "./MoveTree";
import { GoMath, Move, Intersection, Group } from "./GoMath";
import { ScoreEstimator } from "./ScoreEstimator";
import { GobanCore, Events } from "./GobanCore";
import { JGOFTimeControl, JGOFNumericPlayerColor, JGOFMove, JGOFPlayerSummary } from "./JGOF";
import { AdHocPackedMove } from "./AdHocFormat";
import { _ } from "./translate";
import { TypedEventEmitter } from "./TypedEventEmitter";

declare const CLIENT: boolean;
declare const SERVER: boolean;

export const AUTOSCORE_TRIALS = 1000;
export const AUTOSCORE_TOLERANCE = 0.3;

export type GoEnginePhase = "play" | "stone removal" | "finished";
export type GoEngineRules = "chinese" | "aga" | "japanese" | "korean" | "ing" | "nz";
export type GoEngineSuperKoAlgorithm =
    | "psk"
    | "csk"
    | "ssk"
    | "noresult"
    | "ing"; /* note, only psk, ssk, and noresult are implemented, ing and csk are treated as psk */

export interface PlayerScore {
    total: number;
    stones: number;
    territory: number;
    prisoners: number;
    scoring_positions: string;
    handicap: number;
    komi: number;
}
export interface Score {
    white: PlayerScore;
    black: PlayerScore;
}

export interface GoEngineState {
    player: JGOFNumericPlayerColor;
    board_is_repeating: boolean;
    white_prisoners: number;
    black_prisoners: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
    isobranch_hash?: string;

    /** User data state, the Goban's usually want to store some state in here, which is
     *  obtained and set by calling the getState_callback
     */
    udata_state: any;
}

export interface GoEnginePlayerEntry {
    id: number;
    username: string;
    country?: string;
    rank?: number;

    /** The accepted stones for the stone removal phase that the player has accepted */
    accepted_stones?: string;

    /** Whether or not the player has accepted scoring with strict seki mode on or not */
    accepted_strict_seki_mode?: boolean;

    /** XXX: The server is using these, the client may or may not be, we need to normalize this */
    name?: string;
    pro?: boolean;
}

export interface GoEngineConfig {
    game_id?: number | string;
    review_id?: number;
    game_name?: string;
    player_id?: number;
    tournament_id?: number;
    ladder_id?: number;
    group_ids?: Array<number>;
    initial_player?: PlayerColor;
    width?: number;
    height?: number;
    disable_analysis?: boolean;
    handicap?: number;
    komi?: number;
    rules?: GoEngineRules;
    phase?: GoEnginePhase;
    initial_state?: GoEngineInitialState;
    marks?: { [mark: string]: string };
    player_pool?: { [id: number]: GoEnginePlayerEntry }; // we need this to get player details from player_id in player_update events
    players?: {
        black: GoEnginePlayerEntry;
        white: GoEnginePlayerEntry;
    };
    rengo?: boolean;
    rengo_teams?: {
        black: Array<GoEnginePlayerEntry>;
        white: Array<GoEnginePlayerEntry>;
    };

    //time_control?:JGOFTimeControl;
    moves?: Array<AdHocPackedMove> | Array<JGOFMove>;
    move_tree?: MoveTreeJson;
    ranked?: boolean;
    original_disable_analysis?: boolean;
    original_sgf?: string;
    free_handicap_placement?: boolean;
    score?: Score;
    outcome?: string;
    winner?: number; // Player ID of the winner

    start_time?: number;
    end_time?: number;
    game_date?: string; // as reported by an SGF

    allow_self_capture?: boolean;
    automatic_stone_removal?: boolean;
    allow_ko?: boolean;
    allow_superko?: boolean;
    score_territory?: boolean;
    score_territory_in_seki?: boolean;
    strict_seki_mode?: boolean;
    score_stones?: boolean;
    score_passes?: boolean;
    score_prisoners?: boolean;
    score_handicap?: boolean;
    white_must_pass_last?: boolean;
    aga_handicap_scoring?: boolean;
    opponent_plays_first_after_resume?: boolean;
    superko_algorithm?: GoEngineSuperKoAlgorithm;

    /** When loading initial state or moves, by default GoEngine will try and
     *  handle bad data by just resorting to 'edit placing' moves. If this is
     *  true, then those errors are thrown instead.
     */
    throw_all_errors?: boolean;

    /** Removed stones in stone removal phase */
    removed?: string;

    // this is weird, we should migrate away from this
    ogs?: {
        black_stones: string;
        black_territory: string;
        black_seki_eyes: string;
        black_dead_stones: string;
        white_stones: string;
        white_territory: string;
        white_seki_eyes: string;
        white_dead_stones: string;
    };
    time_per_move?: number;

    // unknown if we use this
    errors?: Array<{ error: string; stack: any }>;

    /** Deprecated, I dno't think we need this anymore, but need to be sure */
    ogs_import?: boolean;

    // deprecated, normalized out
    ladder?: number;
    black_player_id?: number;
    white_player_id?: number;
}

export interface GoEngineInitialState {
    black?: string;
    white?: string;
}

export interface ReviewMessage {
    ts?: number /* timestamp (ms) */;
    f?: number /* from (move) */;
    m?: string /* moves */;
    om?: [number, number, number] /* offical move [reviewing live game] */;
    undo?: boolean /* offical undo [reviewing live game] */;
    t?: string /* text */;
    "t+"?: string /* text append */;
    k?: { [mark: string]: string } /* marks */;
    pp?: [number, number] /* pen point */;
    pen?: string /* pen color / pen start */;
    chat?: {
        chat_id: string;
        player_id: number;
        channel: string;
        date: number;
        from: number /* turn number */;
        moves: AdHocPackedMove | string /* this might just be "string", i'm not entirely sure */;
    };
    "remove-chat"?: string;
    //"remove-chat";
    //"voice";
    //"unvoice";
    clearpen?: boolean;
    delete?: number;
    //"id";
    owner?: number | { id: number; username: string };
    gamedata?: GoEngineConfig;
    controller?: number | { id: number; username: string };
    // not stored, but used for auth and message routing
    auth?: string;
    review_id?: number;
    player_id?: number;
    username?: string;
    player_update?: JGOFPlayerSummary;
}

export interface PuzzleConfig {
    //mode: "puzzle";
    mode?: string;
    name?: string;
    puzzle_type?: string;
    width?: number;
    height?: number;
    initial_state?: GoEngineInitialState;
    marks?: { [mark: string]: string };
    puzzle_autoplace_delay?: number;
    puzzle_opponent_move_mode?: PuzzleOpponentMoveMode;
    puzzle_player_move_mode?: PuzzlePlayerMoveMode;

    puzzle_rank?: number;
    puzzle_description?: string;
    puzzle_collection?: number;
    initial_player?: PlayerColor;
    move_tree?: MoveTreeJson;
}

export type PuzzlePlayerMoveMode = "free" | "fixed";
export type PuzzleOpponentMoveMode = "manual" | "automatic";
export type PuzzlePlacementSetting =
    | { mode: "play" }
    | { mode: "setup"; color: JGOFNumericPlayerColor }
    | { mode: "place"; color: 0 };

let __currentMarker = 0;

export function encodeMove(x: number | Move, y?: number): string {
    if (typeof x === "number") {
        if (typeof y !== "number") {
            throw new Error(`Invalid y value passed to encodeMove`);
        }
        return GoMath.num2char(x) + GoMath.num2char(y);
    } else {
        let mv: Move = x as Move;

        if (!mv.edited) {
            return GoMath.num2char(mv.x) + GoMath.num2char(mv.y);
        } else {
            return "!" + mv.color + GoMath.num2char(mv.x) + GoMath.num2char(mv.y);
        }
    }
}
export function encodeMoves(lst: Array<Move>) {
    let ret = "";
    for (let i = 0; i < lst.length; ++i) {
        ret += encodeMove(lst[i]);
    }
    return ret;
}

export type PlayerColor = "black" | "white";

export class GoEngine extends TypedEventEmitter<Events> {
    //public readonly players.black.id:number;
    //public readonly players.white.id:number;
    public throw_all_errors?: boolean;
    public board: Array<Array<JGOFNumericPlayerColor>>;
    public cur_move: MoveTree;
    public cur_review_move?: MoveTree;
    public getState_callback?: () => any;
    public handicap: number = NaN;
    public initial_state: GoEngineInitialState = { black: "", white: "" };
    public komi: number = NaN;
    public last_official_move: MoveTree;
    public move_tree: MoveTree;
    public move_tree_layout_vector: Array<number> =
        []; /* For use by MoveTree layout and rendering */
    public move_tree_layout_hash: { [coords: string]: MoveTree } =
        {}; /* For use by MoveTree layout and rendering */
    public move_tree_layout_dirty: boolean = false; /* For use by MoveTree layout and rendering */
    public readonly name: string = "";
    public outcome: string = "";
    public phase: GoEnginePhase = "play";
    public player: JGOFNumericPlayerColor;
    player_pool: { [id: number]: GoEnginePlayerEntry };
    public players: {
        black: GoEnginePlayerEntry;
        white: GoEnginePlayerEntry;
    } = {
        black: { username: "black", id: NaN },
        white: { username: "white", id: NaN },
    };
    public puzzle_collection: number = NaN;
    public puzzle_description: string = "[missing puzzle descripton]";
    public puzzle_opponent_move_mode: PuzzleOpponentMoveMode = "manual";
    public puzzle_player_move_mode: PuzzlePlayerMoveMode = "free";
    public puzzle_rank: number = NaN;
    public puzzle_type: string = "[missing puzzle type]";
    public readonly config: GoEngineConfig;
    public readonly disable_analysis: boolean = false;
    public readonly height: number = 19;
    //public readonly rules:GoEngineRules = 'japanese';
    public rules: GoEngineRules = "japanese"; // can't be readonly at this point since parseSGF sets it
    public readonly width: number = 19;
    public removal: Array<Array<-1 | 0 | 1>>;
    public setState_callback?: (state: any) => void;
    public strict_seki_mode: boolean = false;
    public time_control: JGOFTimeControl = {
        system: "none",
        speed: "correspondence",
        pause_on_weekends: true,
    };
    public undo_requested?: number = NaN;
    public winner?: "black" | "white";
    public game_id: number = NaN;
    public review_id?: number;
    public decoded_moves: Array<Move> = [];
    public automatic_stone_removal: boolean = false;
    public group_ids?: Array<number>;

    rengo?: boolean;
    rengo_teams?: {
        [colour: string]: Array<GoEnginePlayerEntry>; // TBD index this by PlayerColour
    };

    private aga_handicap_scoring: boolean = false;
    private allow_ko: boolean = false;
    private allow_self_capture: boolean = false;
    private allow_superko: boolean = false;
    private superko_algorithm: GoEngineSuperKoAlgorithm = "psk";
    private black_prisoners: number = 0;
    private white_prisoners: number = 0;
    private board_is_repeating: boolean;
    private goban_callback?: GobanCore;
    private dontStoreBoardHistory: boolean;
    public free_handicap_placement: boolean = false;
    private loading_sgf: boolean = false;
    private marks: Array<Array<number>>;
    private move_before_jump?: MoveTree;
    //private mv:Move;
    public score_prisoners: boolean = false;
    public score_stones: boolean = false;
    public score_handicap: boolean = false;
    public score_territory: boolean = false;
    public score_territory_in_seki: boolean = false;
    public territory_included_in_sgf: boolean = false;

    constructor(
        config: GoEngineConfig,
        goban_callback?: GobanCore,
        dontStoreBoardHistory?: boolean,
    ) {
        super();
        try {
            /* We had a bug where we were filling in some initial state data incorrectly when we were dealing with
             * sgfs, so this code exists for sgf 'games' < 800k in the database.. -anoek 2014-08-13 */
            if ("original_sgf" in config) {
                config.initial_state = { black: "", white: "" };
            }
        } catch (e) {
            console.log(e);
        }

        GoEngine.normalizeConfig(config);
        GoEngine.fillDefaults(config);

        for (let k in config) {
            if (k !== "move_tree") {
                (this as any)[k] = (config as any)[k];
            }
        }

        let self = this;
        this.config = config;
        this.dontStoreBoardHistory =
            !!dontStoreBoardHistory; /* Server side, we don't want to store board snapshots */

        if (goban_callback) {
            this.goban_callback = goban_callback;
            this.goban_callback.engine = this;
        }
        this.board = [];
        this.removal = [];
        this.marks = [];
        this.white_prisoners = 0;
        this.black_prisoners = 0;
        this.board_is_repeating = false;
        this.players = config.players || {
            black: { username: "black", id: NaN },
            white: { username: "white", id: NaN },
        };
        this.player_pool = config.player_pool || {};

        for (let y = 0; y < this.height; ++y) {
            let row: Array<JGOFNumericPlayerColor> = [];
            let mark_row = [];
            let removal_row: Array<-1 | 0 | 1> = [];
            for (let x = 0; x < this.width; ++x) {
                row.push(0);
                mark_row.push(0);
                removal_row.push(0);
            }
            this.board.push(row);
            this.marks.push(mark_row);
            this.removal.push(removal_row);
        }

        try {
            this.config.original_disable_analysis = this.config.disable_analysis;
            if (
                typeof window !== "undefined" &&
                typeof (window as any)["user"] !== "undefined" &&
                (window as any)["user"] &&
                ((window as any)["user"].id as number) !== this.players.black.id &&
                ((window as any)["user"].id as number) !== this.players.white.id
            ) {
                this.disable_analysis = false;
                this.config.disable_analysis = false;
            }
        } catch (e) {
            console.log(e);
        }

        this.player = 1;

        if ("initial_player" in config) {
            this.player = config["initial_player"] === "white" ? 2 : 1;
        }

        if (config.players) {
            this.player_pool[config.players.black.id] = config.players.black;
            this.player_pool[config.players.white.id] = config.players.white;
        }

        if (config.rengo && config.rengo_teams) {
            for (let player of config.rengo_teams.black.concat(config.rengo_teams.white)) {
                this.player_pool[player.id] = player;
            }
        }

        let load_sgf_moves_if_needed = () => {};
        if (config.original_sgf) {
            config.initial_state = {
                black: config.initial_state?.black || "",
                white: config.initial_state?.white || "",
            };

            if (this.phase === "play") {
                this.phase = "finished";
            }

            load_sgf_moves_if_needed = this.parseSGF(config.original_sgf);
        }

        if (config.initial_state) {
            this.initial_state = config.initial_state;
            let black_moves = this.decodeMoves(config.initial_state.black || "");
            let white_moves = this.decodeMoves(config.initial_state.white || "");
            for (let i = 0; i < black_moves.length; ++i) {
                let x = black_moves[i].x;
                let y = black_moves[i].y;
                this.initialStatePlace(x, y, 1, true);
            }
            for (let i = 0; i < white_moves.length; ++i) {
                let x = white_moves[i].x;
                let y = white_moves[i].y;
                this.initialStatePlace(x, y, 2, true);
            }
        }

        /* Must be after initial state setup */
        this.move_tree = new MoveTree(this, true, -1, -1, false, 0, 0, null, this.getState());

        this.cur_move = this.move_tree;
        this.last_official_move = this.cur_move;
        delete this.move_before_jump;

        try {
            this.loading_sgf = true;
            load_sgf_moves_if_needed();
            this.loading_sgf = false;
        } catch (e) {
            console.log("Error loading SGF: ", e.message);
            if (e.stack) {
                console.log(e.stack);
            }
        }

        if (config.moves) {
            let moves = (this.decoded_moves = this.decodeMoves(config.moves));

            //var have_edited = false;
            for (let i = 0; i < moves.length; ++i) {
                let mv = moves[i];
                if (mv.edited) {
                    this.editPlace(mv.x, mv.y, mv.color || 0, true);
                    //have_edited = true;
                } else {
                    try {
                        this.place(mv.x, mv.y, false, false, true, true, true);
                        if (mv.player_update) {
                            this.cur_move.player_update = mv.player_update;
                            this.updatePlayers(mv.player_update);
                        }
                    } catch (e) {
                        if (this.throw_all_errors) {
                            throw e;
                        }

                        if (!config.errors) {
                            config.errors = [];
                        }
                        config.errors.push({
                            error: `Error placing ${
                                this.cur_move.player === JGOFNumericPlayerColor.BLACK
                                    ? "black"
                                    : "white"
                            } at ${this.prettyCoords(mv.x, mv.y)} (${mv.x}, ${mv.y})`,
                            stack: e.stack,
                        });
                        console.log(config.errors[config.errors.length - 1]);
                        this.editPlace(mv.x, mv.y, mv.color || 0, true);
                    }
                }
            }
        }

        if (config.move_tree) {
            unpackMoveTree(this.move_tree, config.move_tree);
        }

        let removed;
        if (config.removed) {
            removed = this.decodeMoves(config.removed);
        }
        if (
            CLIENT &&
            !this.territory_included_in_sgf &&
            typeof config.removed === "undefined" &&
            config.original_sgf &&
            /[0-9.]+/.test(self.outcome)
        ) {
            // Game data for SGF uploaded games don't always include removed stones, so we use score
            // estimator to find probably dead stones to get a closer approximation of what
            // territories should be marked in the final board position.
            //
            // NOTE: Some Go clients (not OGS, at least for now) do include dead stones in their
            // SGFs, which we respect if present and skip using the score estimator.
            let se = new ScoreEstimator(
                this.goban_callback,
                this,
                AUTOSCORE_TRIALS,
                AUTOSCORE_TOLERANCE,
                true,
            );
            removed = this.decodeMoves(se.getProbablyDead());
        }
        if (removed) {
            for (let i = 0; i < removed.length; ++i) {
                this.setRemoved(removed[i].x, removed[i].y, true);
            }
        }

        function unpackMoveTree(cur: MoveTree, tree: MoveTreeJson): void {
            cur.loadJsonForThisNode(tree);
            if (tree.trunk_next) {
                let n = tree.trunk_next;
                self.place(n.x, n.y, false, false, true, true, true);
                unpackMoveTree(self.cur_move, n);
                self.jumpTo(cur);
            }

            if (tree.branches) {
                for (let i = 0; i < tree.branches.length; ++i) {
                    let n = tree.branches[i];
                    self.place(n.x, n.y, false, false, true, true, false);
                    unpackMoveTree(self.cur_move, n);
                    self.jumpTo(cur);
                }
            }
        }
    }

    public decodeMoves(
        move_obj: AdHocPackedMove | string | Array<AdHocPackedMove> | [object] | Array<JGOFMove>,
    ): Array<JGOFMove> {
        return GoMath.decodeMoves(move_obj, this.width, this.height);
    }
    private getState(): GoEngineState {
        let state: GoEngineState = {
            player: this.player,
            board_is_repeating: this.board_is_repeating,
            white_prisoners: this.white_prisoners,
            black_prisoners: this.black_prisoners,
            udata_state: this.getState_callback ? this.getState_callback() : null,
            board: new Array(this.height),
        };

        for (let y = 0; y < this.height; ++y) {
            let row = new Array(this.width);
            for (let x = 0; x < this.width; ++x) {
                row[x] = this.board[y][x];
            }
            state.board[y] = row;
        }

        return state;
    }
    private setState(state: GoEngineState): GoEngineState {
        this.player = state.player;
        this.white_prisoners = state.white_prisoners;
        this.black_prisoners = state.black_prisoners;
        this.board_is_repeating = state.board_is_repeating;

        if (this.setState_callback) {
            this.setState_callback(state.udata_state);
        }

        let redrawn: { [s: string]: boolean } = {};

        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (
                    this.board[y][x] !== state.board[y][x] ||
                    (this.cur_move.x === x && this.cur_move.y === y)
                ) {
                    this.board[y][x] = state.board[y][x];
                    if (this.goban_callback) {
                        this.goban_callback.set(x, y, this.board[y][x]);
                    }
                    redrawn[x + "," + y] = true;
                }
            }
        }

        return state;
    }
    public boardMatriciesAreTheSame(
        m1: Array<Array<JGOFNumericPlayerColor>>,
        m2: Array<Array<JGOFNumericPlayerColor>>,
    ): boolean {
        if (m1.length !== m2.length || m1[0].length !== m2[0].length) {
            return false;
        }

        for (let y = 0; y < m1.length; ++y) {
            for (let x = 0; x < m1[0].length; ++x) {
                if (m1[y][x] !== m2[y][x]) {
                    return false;
                }
            }
        }
        return true;
    }
    private boardStatesAreTheSame(state1: GoEngineState, state2: GoEngineState): boolean {
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (state1.board[y][x] !== state2.board[y][x]) {
                    return false;
                }
            }
        }

        return true;
    }

    public followPath(
        from_turn: number,
        moves: AdHocPackedMove | string,
        cb?: (x: number, y: number, edited: boolean, color: number) => void,
    ): Array<MoveTree> {
        try {
            let ret = [];
            let from = this.move_tree.index(from_turn);
            let cur: MoveTree;
            if (from) {
                cur = from;
            } else {
                cur = this.last_official_move;
            }

            let _moves = this.decodeMoves(moves);
            let i = 0;

            while (i < _moves.length) {
                let mv = _moves[i];
                let existing: MoveTree | null = cur.lookupMove(
                    mv.x,
                    mv.y,
                    this.playerByColor(mv.color || 0),
                    !!mv.edited,
                );
                if (existing) {
                    cur = existing;
                    ++i;
                    if (cb) {
                        cb(mv.x, mv.y, !!mv.edited, mv.color || 0);
                    }
                } else {
                    break;
                }
            }

            this.jumpTo(cur);

            for (; i < _moves.length; ++i) {
                let mv = _moves[i];

                if (mv.edited) {
                    this.editPlace(mv.x, mv.y, mv.color || 0);
                } else {
                    this.place(mv.x, mv.y, false, false, true, true);
                }

                if (cb) {
                    cb(mv.x, mv.y, !!mv.edited, mv.color || 0);
                }

                ret.push(this.cur_move);
            }

            return ret;
        } catch (e) {
            console.log(e.stack);
            this.jumpTo(this.last_official_move);
            return [];
        }
    }

    public updatePlayers(player_update: JGOFPlayerSummary): void {
        // note: the players sent to us in player_update must be in the pool already
        // totally new players can only be added with a gamedata event
        if (!this.player_pool) {
            throw new Error("updatePlayers called with no player_pool available");
        }
        this.players.black = this.player_pool[player_update.players.black];
        this.players.white = this.player_pool[player_update.players.white];

        try {
            if (this.config.rengo && player_update.rengo_teams) {
                this.rengo_teams = { black: [], white: [] };
                for (let colour of ["black", "white"]) {
                    //console.log("looking at", colour, player_update.rengo_teams[colour]);
                    for (let id of player_update.rengo_teams[colour as "black" | "white"]) {
                        this.rengo_teams[colour as "black" | "white"].push(this.player_pool[id]);
                    }
                }
            }
        } catch (e) {
            console.error(e);
            console.error(e.stack);
        }

        // keep deprecated fields up to date
        this.config.black_player_id = player_update.players.black;
        this.config.white_player_id = player_update.players.white;
    }

    /** Returns true if there was a previous to show */
    public showPrevious(): boolean {
        if (this.dontStoreBoardHistory) {
            return false;
        }

        if (this.cur_move.prev()) {
            this.jumpTo(this.cur_move.prev());
            return true;
        }

        return false;
    }
    /** Returns true if there was a next to show */
    public showNext(): boolean {
        if (this.dontStoreBoardHistory) {
            return false;
        }

        if (this.cur_move.next()) {
            this.jumpTo(this.cur_move.next());
            return true;
        }
        return false;
    }
    /** Returns true if there was a next to show */
    public showNextTrunk(): boolean {
        if (this.dontStoreBoardHistory) {
            return false;
        }

        if (this.cur_move.trunk_next) {
            this.jumpTo(this.cur_move.trunk_next);
            return true;
        }
        return false;
    }
    public jumpTo(node?: MoveTree | null): void {
        if (!node) {
            throw new Error("Attempted to jump to a null/undefined node");
        }
        this.move_before_jump = this.cur_move;
        this.cur_move = node;
        if (node.state) {
            this.setState(node.state);
        }
        if (node.player_update) {
            //console.log("Engine jumpTo doing player_update...");
            this.updatePlayers(node.player_update);
            this.emit("update");
        }
    }
    public jumpToLastOfficialMove(): void {
        if (this.dontStoreBoardHistory) {
            return;
        }

        this.jumpTo(this.last_official_move);
    }
    /** Saves our current move as our last official move */
    public setLastOfficialMove(): void {
        if (this.dontStoreBoardHistory) {
            return;
        }
        if (!this.cur_move.trunk) {
            if (!("original_sgf" in this.config)) {
                throw new Error("Attempted to set official move to non-trunk move.");
            }
        }

        this.last_official_move = this.cur_move;
    }

    /** return strue if our current move is our last official move */
    public isLastOfficialMove(): boolean {
        return this.cur_move.is(this.last_official_move);
    }
    /** Returns a move string from the given official move number (aka branch point) */
    public getMoveDiff(): { from: number; moves: string } {
        let branch_point = this.cur_move.getBranchPoint();
        let cur: MoveTree | null = this.cur_move;
        let moves: Array<Move> = [];

        while (cur && cur.id !== branch_point.id) {
            moves.push({
                x: cur.x,
                y: cur.y,
                color: cur.player,
                edited: cur.edited,
            });
            cur = cur.parent;
        }

        moves.reverse();
        return { from: branch_point.getMoveIndex(), moves: encodeMoves(moves) };
    }
    public setAsCurrentReviewMove(): void {
        if (this.dontStoreBoardHistory) {
            return;
        }
        this.cur_review_move = this.cur_move;
    }
    public deleteCurMove(): void {
        if (this.cur_move.id === this.move_tree.id) {
            console.log("Wont remove move tree itself.");
            return;
        }
        if (this.cur_move.trunk) {
            console.log("Wont remove trunk node");
            return;
        }
        let t = this.cur_move.parent;
        this.cur_move.remove();
        this.cur_move = t ? t : this.move_tree;
        this.jumpTo(t);
    }
    public gameCanBeCanceled(): boolean {
        if (this.phase !== "play") {
            return false;
        }

        if ("tournament_id" in this.config && this.config.tournament_id) {
            return false;
        }

        if ("ladder_id" in this.config && this.config.ladder_id) {
            return false;
        }

        let move_number = this.getMoveNumber();
        let max_moves_played = 1 + (this.free_handicap_placement ? this.handicap : 1);

        if (move_number < max_moves_played) {
            return true;
        }

        return false;
    }
    public jumpToOfficialMoveNumber(move_number: number): void {
        if (this.dontStoreBoardHistory) {
            return;
        }

        while (this.showPrevious()) {
            // spin
        }
        for (let i = 0; i < move_number; ++i) {
            if (this.cur_move.next(true)) {
                this.jumpTo(this.cur_move.next(true));
            }
        }
    }

    private opponent(): JGOFNumericPlayerColor {
        return this.player === 1 ? 2 : 1;
    }
    public prettyCoords(x: number, y: number): string {
        return GoMath.prettyCoords(x, y, this.height);
    }
    private incrementCurrentMarker(): void {
        ++__currentMarker;
    }
    private markGroup(group: Group): void {
        for (let i = 0; i < group.length; ++i) {
            this.marks[group[i].y][group[i].x] = __currentMarker;
        }
    }

    private foreachNeighbor_checkAndDo(
        x: number,
        y: number,
        done_array: Array<boolean>,
        fn_of_neighbor_pt: (x: number, y: number) => void,
    ): void {
        let idx = x + y * this.width;
        if (done_array[idx]) {
            return;
        }
        done_array[idx] = true;
        fn_of_neighbor_pt(x, y);
    }
    /** Public for usage in GoStoneGroup */
    public foreachNeighbor(
        pt_or_group: Intersection | Group,
        fn_of_neighbor_pt: (x: number, y: number) => void,
    ): void {
        if (pt_or_group instanceof Array) {
            let group = pt_or_group;
            let done_array = new Array(this.height * this.width);
            for (let i = 0; i < group.length; ++i) {
                done_array[group[i].x + group[i].y * this.width] = true;
            }

            for (let i = 0; i < group.length; ++i) {
                let pt = group[i];
                if (pt.x - 1 >= 0) {
                    this.foreachNeighbor_checkAndDo(pt.x - 1, pt.y, done_array, fn_of_neighbor_pt);
                }
                if (pt.x + 1 !== this.width) {
                    this.foreachNeighbor_checkAndDo(pt.x + 1, pt.y, done_array, fn_of_neighbor_pt);
                }
                if (pt.y - 1 >= 0) {
                    this.foreachNeighbor_checkAndDo(pt.x, pt.y - 1, done_array, fn_of_neighbor_pt);
                }
                if (pt.y + 1 !== this.height) {
                    this.foreachNeighbor_checkAndDo(pt.x, pt.y + 1, done_array, fn_of_neighbor_pt);
                }
            }
        } else {
            let pt = pt_or_group;
            if (pt.x - 1 >= 0) {
                fn_of_neighbor_pt(pt.x - 1, pt.y);
            }
            if (pt.x + 1 !== this.width) {
                fn_of_neighbor_pt(pt.x + 1, pt.y);
            }
            if (pt.y - 1 >= 0) {
                fn_of_neighbor_pt(pt.x, pt.y - 1);
            }
            if (pt.y + 1 !== this.height) {
                fn_of_neighbor_pt(pt.x, pt.y + 1);
            }
        }
    }
    /** Returns an array of x/y pairs of all the same color */
    private getGroup(x: number, y: number, clearMarks: boolean): Group {
        let color = this.board[y][x];
        if (clearMarks) {
            this.incrementCurrentMarker();
        }
        let toCheckX = [x];
        let toCheckY = [y];
        let ret = [];
        while (toCheckX.length) {
            x = toCheckX.pop() || 0;
            y = toCheckY.pop() || 0;

            if (this.marks[y][x] === __currentMarker) {
                continue;
            }
            this.marks[y][x] = __currentMarker;

            if (this.board[y][x] === color) {
                let pt = { x: x, y: y };
                ret.push(pt);
                this.foreachNeighbor(pt, addToCheck);
            }
        }
        function addToCheck(x: number, y: number): void {
            toCheckX.push(x);
            toCheckY.push(y);
        }

        return ret;
    }
    /** Returns an array of groups connected to the given group */
    private getConnectedGroups(group: Group): Array<Group> {
        let gr = group;
        this.incrementCurrentMarker();
        this.markGroup(group);
        let ret: Array<Group> = [];
        this.foreachNeighbor(group, (x, y) => {
            if (this.board[y][x]) {
                this.incrementCurrentMarker();
                this.markGroup(gr);
                for (let i = 0; i < ret.length; ++i) {
                    this.markGroup(ret[i]);
                }
                let g = this.getGroup(x, y, false);
                if (g.length) {
                    /* can be zero if the peice has already been marked */
                    ret.push(g);
                }
            }
        });
        return ret;
    }
    private getConnectedOpenSpace(group: Group): Group {
        let gr = group;
        this.incrementCurrentMarker();
        this.markGroup(group);
        let ret: Group = [];
        let included: { [s: string]: boolean } = {};

        this.foreachNeighbor(group, (x, y) => {
            if (!this.board[y][x]) {
                this.incrementCurrentMarker();
                this.markGroup(gr);
                //for (let i = 0; i < ret.length; ++i) {
                this.markGroup(ret);
                //}
                let g = this.getGroup(x, y, false);
                for (let i = 0; i < g.length; ++i) {
                    if (!included[g[i].x + "," + g[i].y]) {
                        ret.push(g[i]);
                        included[g[i].x + "," + g[i].y] = true;
                    }
                }
            }
        });
        return ret;
    }
    private countLiberties(group: Group): number {
        let ct = 0;
        let counter = (x: number, y: number): number => (ct += this.board[y][x] ? 0 : 1);
        for (let i = 0; i < group.length; ++i) {
            this.foreachNeighbor(group[i], counter);
        }
        return ct;
    }
    private captureGroup(group: Group): number {
        for (let i = 0; i < group.length; ++i) {
            let x = group[i].x;
            let y = group[i].y;
            if (this.board[y][x] === 1) {
                ++this.white_prisoners;
            }
            if (this.board[y][x] === 2) {
                ++this.black_prisoners;
            }
            this.board[y][x] = 0;
            if (this.goban_callback) {
                this.goban_callback.set(x, y, 0);
            }
        }
        return group.length;
    }
    public playerToMove(): number {
        return this.player === 1 ? this.players.black.id : this.players.white.id;
    }
    public playerNotToMove(): number {
        return this.player === 2 ? this.players.black.id : this.players.white.id;
    }
    public otherPlayer(): JGOFNumericPlayerColor {
        return this.player === 2 ? 1 : 2;
    }
    public playerColor(player_id?: number): "black" | "white" | "invalid" {
        if (typeof player_id === "number") {
            return player_id === this.players.black.id
                ? "black"
                : player_id === this.players.white.id
                ? "white"
                : "invalid";
        } else {
            return this.colorToMove();
        }
    }
    public colorToMove(): "black" | "white" {
        return this.player === 1 ? "black" : "white";
    }
    public colorNotToMove(): "black" | "white" {
        return this.player !== 1 ? "black" : "white";
    }
    public playerByColor(color: PlayerColor | JGOFNumericPlayerColor): JGOFNumericPlayerColor {
        if (color === "black") {
            return 1;
        }
        if (color === "white") {
            return 2;
        }
        if (color === 1 || color === 2) {
            return color as JGOFNumericPlayerColor;
        }
        return 0;
    }
    public place(
        x: number,
        y: number,
        checkForKo?: boolean,
        errorOnSuperKo?: boolean,
        dontCheckForSuperKo?: boolean,
        dontCheckForSuicide?: boolean,
        isTrunkMove?: boolean,
    ): number {
        let peices_removed = 0;

        try {
            if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
                if (this.board[y][x]) {
                    if ("loading_sgf" in this && this.loading_sgf) {
                        if (this.board[y][x] !== this.player) {
                            console.log(
                                "Invalid duplicate stone placement at " +
                                    this.prettyCoords(x, y) +
                                    " board color: " +
                                    this.board[y][x] +
                                    "   placed color: " +
                                    this.player +
                                    " - edit placing into new branch",
                            );
                            this.editPlace(x, y, this.player);
                            this.player = this.opponent();
                        }
                        return 0;
                    }

                    throw new GobanMoveError(
                        this.game_id || this.review_id || 0,
                        this.cur_move?.move_number ?? -1,
                        this.prettyCoords(x, y),
                        "stone_already_placed_here",
                    );
                }
                this.board[y][x] = this.player;

                let suicide_move = false;
                let player_group = this.getGroup(x, y, true);
                let opponent_groups = this.getConnectedGroups(player_group);

                for (let i = 0; i < opponent_groups.length; ++i) {
                    if (this.countLiberties(opponent_groups[i]) === 0) {
                        peices_removed += this.captureGroup(opponent_groups[i]);
                    }
                }
                if (peices_removed === 0) {
                    if (this.countLiberties(player_group) === 0) {
                        if (this.allow_self_capture || dontCheckForSuicide) {
                            peices_removed += this.captureGroup(player_group);
                            suicide_move = true;
                        } else {
                            this.board[y][x] = 0;
                            throw new GobanMoveError(
                                this.game_id || this.review_id || 0,
                                this.cur_move?.move_number ?? -1,
                                this.prettyCoords(x, y),
                                "move_is_suicidal",
                            );
                        }
                    }
                }

                if (checkForKo && !this.allow_ko) {
                    let current_state = this.getState();
                    if (
                        !this.cur_move.edited &&
                        this.boardStatesAreTheSame(current_state, this.cur_move.index(-1).state)
                    ) {
                        throw new GobanMoveError(
                            this.game_id || this.review_id || 0,
                            this.cur_move?.move_number ?? -1,
                            this.prettyCoords(x, y),
                            "illegal_ko_move",
                        );
                    }
                }

                this.board_is_repeating = false;
                if (!dontCheckForSuperKo && !this.allow_superko) {
                    this.board_is_repeating = this.isBoardRepeating(this.superko_algorithm);
                    if (this.board_is_repeating) {
                        if (errorOnSuperKo) {
                            throw new GobanMoveError(
                                this.game_id || this.review_id || 0,
                                this.cur_move?.move_number ?? -1,
                                this.prettyCoords(x, y),
                                "illegal_board_repetition",
                            );
                        }
                    }
                }

                if (!suicide_move) {
                    if (this.goban_callback) {
                        this.goban_callback.set(x, y, this.player);
                    }
                }
            }

            if (x < 0 && this.handicapMovesLeft() > 0) {
                //console.log("Skipping old-style implicit pass on handicap: ", this.player);
                return 0;
            }

            let color = this.player;
            if (this.handicapMovesLeft() < 2) {
                this.player = this.opponent();
            }
            let next_move_number = this.cur_move.move_number + 1;
            //var trunk = this.loading_trunk_moves || (!this.goban_callback || this.goban_callback.mode === "play");
            let trunk = isTrunkMove ? true : false;
            //console.log("Trunk move: ", trunk, this.goban_callback.mode);
            //this.cur_move = this.cur_move.move(x, y, trunk, false, color, next_move_number, !this.dontStoreBoardHistory ? this.getState() : null);
            this.cur_move = this.cur_move.move(
                x,
                y,
                trunk,
                false,
                color,
                next_move_number,
                this.getState(),
            );
        } catch (e) {
            this.jumpTo(this.cur_move);
            /*
               if (e.message) {
            //console.log(e.message);
            if (e.stack) {
            console.log(e.stack);
            }
            }
             */
            //console.log(e);
            /*
               if (e.stack) {
               console.log(e.stack);
               }
             */
            throw e;
        }

        return peices_removed;
    }
    public isBoardRepeating(superko_rule: GoEngineSuperKoAlgorithm): boolean {
        let MAX_SUPERKO_SEARCH = 30; /* any more than this is probably a waste of time. This may be overkill even. */
        let current_state = this.getState();
        //var current_state = this.cur_move.state;
        let current_player_to_move = this.player;
        const check_situational = superko_rule === "ssk";

        let t: MoveTree | null | undefined = this.cur_move.index(-2);
        for (
            let i = Math.min(MAX_SUPERKO_SEARCH, this.cur_move.move_number - 2);
            i > 0;
            --i, t = t?.prev()
        ) {
            if (t) {
                if (!check_situational || t.player === current_player_to_move) {
                    if (this.boardStatesAreTheSame(t.state, current_state)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    public editPlace(
        x: number,
        y: number,
        color: JGOFNumericPlayerColor,
        isTrunkMove?: boolean,
    ): void {
        let player = this.playerByColor(color);

        if (x >= 0 && y >= 0) {
            this.board[y][x] = player;
            if (this.goban_callback) {
                this.goban_callback.set(x, y, player);
            }
        }

        let trunk = isTrunkMove ? true : false;

        this.cur_move = this.cur_move.move(
            x,
            y,
            trunk,
            true,
            player,
            this.cur_move.move_number,
            this.getState(),
        );
    }
    public initialStatePlace(
        x: number,
        y: number,
        color: JGOFNumericPlayerColor,
        dont_record_placement?: boolean,
    ): void {
        let moves = null;
        let p = this.player;

        if (this.move_tree) {
            this.jumpTo(this.move_tree);
        }

        this.player = p;

        if (x >= 0 && y >= 0) {
            this.board[y][x] = color;
            if (this.goban_callback) {
                this.goban_callback.set(x, y, color);
            }
        }

        if (!dont_record_placement) {
            /* Remove */
            moves = this.decodeMoves(this.initial_state?.black || "");
            for (let i = 0; i < moves.length; ++i) {
                if (moves[i].x === x && moves[i].y === y) {
                    moves.splice(i, 1);
                    break;
                }
            }
            this.initial_state.black = encodeMoves(moves);

            moves = this.decodeMoves(this.initial_state?.white || "");
            for (let i = 0; i < moves.length; ++i) {
                if (moves[i].x === x && moves[i].y === y) {
                    moves.splice(i, 1);
                    break;
                }
            }
            this.initial_state.white = encodeMoves(moves);

            /* Then add if applicable */
            if (color) {
                let moves = this.decodeMoves(
                    this.initial_state[color === 1 ? "black" : "white"] || "",
                );
                moves.push({ x: x, y: y, color: color });
                this.initial_state[color === 1 ? "black" : "white"] = encodeMoves(moves);
            }
        }

        this.resetMoveTree();
    }
    public resetMoveTree(): void {
        let marks = null;
        if (this.move_tree) {
            marks = this.move_tree.getAllMarks();
        }

        this.move_tree = new MoveTree(this, true, -1, -1, false, 0, 0, null, this.getState());
        this.cur_move = this.move_tree;
        this.last_official_move = this.cur_move;
        delete this.move_before_jump;

        if (marks) {
            this.move_tree.setAllMarks(marks);
        }

        if ("initial_player" in this.config) {
            this.player = this.config["initial_player"] === "white" ? 2 : 1;
        }
    }
    public computeInitialStateForForkedGame(): { black: string; white: string } {
        let black = "";
        let white = "";
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.board[y][x] === 1) {
                    black += encodeMove(x, y);
                } else if (this.board[y][x] === 2) {
                    white += encodeMove(x, y);
                }
            }
        }

        return {
            black: black,
            white: white,
        };
    }

    public toggleMetaGroupRemoval(x: number, y: number): Array<[-1 | 0 | 1, Group]> {
        try {
            if (x >= 0 && y >= 0) {
                let removing: -1 | 0 | 1 = !this.removal[y][x] ? 1 : 0;
                let group = this.getGroup(x, y, true);
                let removed_stones = this.setGroupForRemoval(x, y, removing)[1];
                let empty_spaces = [];

                let group_color = this.board[y][x];
                if (group_color === 0) {
                    /* just toggle open area */
                } else {
                    /* for stones though, toggle the selected stone group any any stone
                     * groups which are adjacent to it through open area */
                    let already_done: { [str: string]: boolean } = {};

                    let space = this.getConnectedOpenSpace(group);
                    for (let i = 0; i < space.length; ++i) {
                        let pt = space[i];

                        if (already_done[pt.x + "," + pt.y]) {
                            continue;
                        }
                        already_done[pt.x + "," + pt.y] = true;

                        if (this.board[pt.y][pt.x] === 0) {
                            let far_neighbors = this.getConnectedGroups([space[i]]);
                            for (let j = 0; j < far_neighbors.length; ++j) {
                                let fpt = far_neighbors[j][0];
                                if (this.board[fpt.y][fpt.x] === group_color) {
                                    let res = this.setGroupForRemoval(fpt.x, fpt.y, removing);
                                    removed_stones = removed_stones.concat(res[1]);
                                    space = space.concat(this.getConnectedOpenSpace(res[1]));
                                }
                            }
                            empty_spaces.push(pt);
                        }
                    }
                }

                if (!removing) {
                    return [[removing, removed_stones]];
                } else {
                    return [
                        [removing, removed_stones],
                        [!removing ? 1 : 0, empty_spaces],
                    ];
                }
            }
        } catch (err) {
            console.log(err.stack);
        }

        return [[0, []]];
    }
    private setGroupForRemoval(x: number, y: number, toggle_set: -1 | 0 | 1): [-1 | 0 | 1, Group] {
        /*
           If toggle_set === -1, toggle the selection from marked / unmarked.
           If toggle_set === 0, unmark the group for removal
           If toggle_set === 1, mark the group for removal

           returns [removing 0/1, [group removed]];
         */

        if (x >= 0 && y >= 0) {
            let group = this.getGroup(x, y, true);
            let removing = toggle_set === -1 ? (!this.removal[y][x] ? 1 : 0) : toggle_set;

            for (let i = 0; i < group.length; ++i) {
                let x = group[i].x;
                let y = group[i].y;
                this.setRemoved(x, y, removing);
            }

            return [removing, group];
        }
        return [0, []];
    }
    public setRemoved(x: number, y: number, removed: boolean | 0 | 1): void {
        if (x < 0 || y < 0) {
            return;
        }
        if (x > this.width || y > this.height) {
            return;
        }
        this.removal[y][x] = removed ? 1 : 0;
        if (this.goban_callback) {
            this.goban_callback.setForRemoval(x, y, this.removal[y][x]);
        }
    }
    public clearRemoved(): void {
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    this.setRemoved(x, y, 0);
                }
            }
        }
    }
    public getStoneRemovalString(): string {
        let ret = "";
        let arr = [];
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    arr.push(encodeMove(x, y));
                }
            }
        }
        for (let i = 0; i < arr.length; ++i) {
            ret += arr[i];
        }

        return GoMath.sortMoves(ret, this.width, this.height);
    }

    public getMoveNumber(): number {
        return this.cur_move ? this.cur_move.move_number : 0;
    }
    public getCurrentMoveNumber(): number {
        return this.last_official_move.move_number;
    }

    /* Returns a details object containing the total score and the breakdown of the
     * scoring details */
    public computeScore(only_prisoners?: boolean): Score {
        let ret = {
            white: {
                total: 0,
                stones: 0,
                territory: 0,
                prisoners: 0,
                scoring_positions: "",
                handicap: this.handicap,
                komi: this.komi,
            },
            black: {
                total: 0,
                stones: 0,
                territory: 0,
                prisoners: 0,
                scoring_positions: "",
                handicap: 0,
                komi: 0,
            },
        };

        if (this.aga_handicap_scoring && ret.white.handicap > 0) {
            ret.white.handicap -= 1;
        }

        let removed_black = 0;
        let removed_white = 0;

        /* clear removed */
        if (!this.goban_callback || this.goban_callback.mode !== "analyze") {
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (this.removal[y][x]) {
                        if (this.board[y][x] === 1) {
                            ++removed_black;
                        }
                        if (this.board[y][x] === 2) {
                            ++removed_white;
                        }
                        this.board[y][x] = 0;
                    }
                }
            }
        }

        let scored: Array<Array<number>> = [];
        for (let y = 0; y < this.height; ++y) {
            let row = [];
            for (let x = 0; x < this.width; ++x) {
                row.push(0);
            }
            scored.push(row);
        }

        let markScored = (group: Group) => {
            let ct = 0;
            for (let i = 0; i < group.length; ++i) {
                let x = group[i].x;
                let y = group[i].y;

                let oldboard = this.cur_move.state.board;

                /* XXX: TODO: When we implement stone removal and scoring stuff
                 * into the review mode and analysis mode, this needs to change to
                 appropriately consider removals */
                let in_review = false;
                try {
                    /*
                    if (this.board && this.board.review_id) {
                        in_review = true;
                    }
                    */
                } catch (e) {}
                if (!this.removal[y][x] || oldboard[y][x] || in_review) {
                    ++ct;
                    scored[y][x] = 1;
                }
            }
            return ct;
        };

        //if (this.phase !== "play") {
        if (!only_prisoners && this.score_territory) {
            let gm = new GoMath(this, this.cur_move.state.board);
            //console.log(gm);

            gm.foreachGroup((gr) => {
                if (gr.is_territory) {
                    //console.log(gr);
                    if (
                        !this.score_territory_in_seki &&
                        gr.is_territory_in_seki &&
                        this.strict_seki_mode
                    ) {
                        return;
                    }
                    if (gr.territory_color === 1) {
                        ret["black"].scoring_positions += encodeMoves(gr.points);
                        ret["black"].territory += markScored(gr.points);
                    } else {
                        ret["white"].scoring_positions += encodeMoves(gr.points);
                        ret["white"].territory += markScored(gr.points);
                    }
                    for (let i = 0; i < gr.points.length; ++i) {
                        let pt = gr.points[i];
                        if (this.board[pt.y][pt.x] && !this.removal[pt.y][pt.x]) {
                            /* This can happen as peopel are using the edit tool to force stone position colors */
                            /* This can also happen now that we are doing estimate based scoring */
                            //console.log("Point "+ GoMath.prettyCoords(pt.x, pt.y, this.height) +" should be removed, but is not because of an edit");
                            //throw "Fucking hell: " + pt.x + "," + pt.y;
                        }
                    }
                }
            });
        }

        if (!only_prisoners && this.score_stones) {
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (this.board[y][x]) {
                        if (this.board[y][x] === 1) {
                            ++ret.black.stones;
                            ret.black.scoring_positions += encodeMove(x, y);
                        } else {
                            ++ret.white.stones;
                            ret.white.scoring_positions += encodeMove(x, y);
                        }
                    }
                }
            }
        }
        //}

        if (only_prisoners || this.score_prisoners) {
            ret["black"].prisoners = this.black_prisoners + removed_white;
            ret["white"].prisoners = this.white_prisoners + removed_black;
        }

        ret["black"].total =
            ret["black"].stones +
            ret["black"].territory +
            ret["black"].prisoners +
            ret["black"].komi;
        if (this.score_handicap) {
            ret["black"].total += ret["black"].handicap;
        }
        ret["white"].total =
            ret["white"].stones +
            ret["white"].territory +
            ret["white"].prisoners +
            ret["white"].komi;
        if (this.score_handicap) {
            ret["white"].total += ret["white"].handicap;
        }

        try {
            if (this.outcome && this.aga_handicap_scoring) {
                /* We used to have an AGA scoring bug where we'd give one point per
                 * handicap stone instead of per handicap stone - 1, so this check
                 * is for those games that we incorrectly scored so that our little
                 * drop down box tallies up to be "correct" for those old games
                 *   - anoek 2015-02-01
                 */
                let f = parseFloat(this.outcome);
                if (f - 1 === Math.abs(ret.white.total - ret.black.total)) {
                    ret.white.handicap += 1;
                }
            }
        } catch (e) {
            console.log(e);
        }

        this.jumpTo(this.cur_move);

        return ret;
    }
    public handicapMovesLeft(): number {
        if (this.free_handicap_placement) {
            return Math.max(0, this.handicap - this.getMoveNumber());
        }
        return 0;
    }

    private static normalizeConfig(config: GoEngineConfig): void {
        if (config.ladder !== config.ladder_id) {
            config.ladder_id = config.ladder;
        }
        if ("ladder" in config) {
            delete config["ladder"];
        }

        if (config.outcome === "resign" || config.outcome === "r") {
            // SGF games sometimes have these non-standard outcomes, so we correct it.
            config.outcome = "Resignation";
        }

        if (config.black_player_id || config.white_player_id) {
            if (!config.players) {
                config.players = {
                    black: {
                        username: "black",
                        id: config.black_player_id || NaN,
                    },
                    white: {
                        username: "white",
                        id: config.white_player_id || NaN,
                    },
                };
            }

            if (!config.players || !config.players.black || !config.players.white) {
                throw new Error(`config.players is invalid: ${JSON.stringify(config.players)}`);
            }

            config.players.black.id = config.players.black.id ?? config.black_player_id;
            config.players.white.id = config.players.white.id ?? config.white_player_id;

            if (config.players.black.id !== config.black_player_id) {
                throw new Error(
                    `config.players.black.id (${config.players.black.id}) !== deprecated config.black_player_id (${config.black_player_id})`,
                );
            }
            if (config.players.white.id !== config.white_player_id) {
                throw new Error(
                    `config.players.white.id (${config.players.white.id}) !== deprecated config.white_player_id (${config.white_player_id})`,
                );
            }
        }
    }
    public static fillDefaults(game_obj: GoEngineConfig): GoEngineConfig {
        if (!("phase" in game_obj)) {
            game_obj.phase = "play";
        }
        if (!("rules" in game_obj)) {
            game_obj.rules = "japanese";
        }

        let defaults: GoEngineConfig = {};

        //defaults.history = [];
        defaults.game_id = 0;
        defaults.initial_player = "black";
        defaults.moves = [];
        defaults.width = 19;
        defaults.height = 19;
        defaults.rules = "chinese";

        defaults.allow_self_capture = false;
        defaults.automatic_stone_removal = false;
        defaults.handicap = 0;
        defaults.free_handicap_placement = false;
        defaults.aga_handicap_scoring = false;
        defaults.allow_ko = false;
        defaults.allow_superko = false;
        defaults.superko_algorithm = "psk";
        defaults.players = {
            black: { username: "Black", id: NaN, rank: -1 },
            white: { username: "White", id: NaN, rank: -1 },
        };
        defaults.player_pool = {};
        defaults.disable_analysis = false;

        defaults.score_territory = true;
        defaults.score_territory_in_seki = true;
        defaults.score_stones = true;
        defaults.score_handicap = false;
        defaults.score_prisoners = true;
        defaults.score_passes = true;
        defaults.white_must_pass_last = false;
        defaults.opponent_plays_first_after_resume = false;
        defaults.strict_seki_mode = game_obj.phase === "finished" ? true : false;

        let rules = game_obj.rules || defaults.rules;

        switch (rules.toLowerCase()) {
            case "chinese":
                //defaults.komi = 5.5;
                defaults.komi = 7.5;
                defaults.score_prisoners = false;
                defaults.allow_superko = false;
                defaults.free_handicap_placement = true;
                defaults.superko_algorithm = "csk";
                defaults.score_handicap = true;
                if ("ogs_import" in game_obj) {
                    defaults.free_handicap_placement = false;
                }
                break;

            case "aga":
                defaults.komi = 7.5;
                defaults.score_prisoners = false;
                defaults.allow_superko = false;
                defaults.superko_algorithm = "ssk";
                defaults.white_must_pass_last = true;
                defaults.aga_handicap_scoring = true;
                defaults.score_handicap = true;
                break;

            case "japanese":
                defaults.komi = 6.5;
                defaults.allow_superko = true;
                defaults.score_territory_in_seki = false;
                defaults.score_stones = false;
                defaults.superko_algorithm = "noresult";
                defaults.opponent_plays_first_after_resume = true;
                break;

            case "korean":
                defaults.komi = 6.5;
                defaults.allow_superko = true;
                defaults.score_territory_in_seki = false;
                defaults.score_stones = false;
                defaults.superko_algorithm = "noresult";
                defaults.opponent_plays_first_after_resume = true;
                break;

            case "ing":
                defaults.komi = 8;
                defaults.score_prisoners = false;
                defaults.allow_superko = false;
                defaults.superko_algorithm = "ing";
                defaults.free_handicap_placement = true;
                defaults.allow_self_capture = true;
                break;

            case "nz":
                defaults.komi = 7;
                defaults.score_prisoners = false;
                defaults.allow_superko = false;
                defaults.superko_algorithm = "ssk";
                defaults.free_handicap_placement = true;
                defaults.allow_self_capture = true;
                break;

            default:
                console.log("Unsupported rule set: " + rules + " error setting komi");
                defaults.komi = 0;
                defaults.score_prisoners = false;
                defaults.allow_superko = true;
                defaults.free_handicap_placement = true;
                defaults.allow_self_capture = true;
        }

        if (!("komi" in game_obj) && game_obj.handicap) {
            defaults["komi"] -= Math.floor(defaults["komi"]);
        }

        for (let k in defaults) {
            if (!(k in game_obj)) {
                (game_obj as any)[k] = (defaults as any)[k];
            }
        }

        //if (typeof(game_obj.time_control) !== "object") {
        //    throw new Error(`Unhandled time control: was not object, instead found ${game_obj.time_control}`)
        /*
            if (!game_obj.time_control) {
                game_obj.time_control = "none";
            }

            let tc: any = {
                time_control: game_obj.time_control,
            };
            let time_per_move = game_obj.time_per_move;
            switch (tc.time_control) {
                case "simple":
                    tc.per_move = time_per_move;
                break;
                case "fischer":
                    tc.initial_time = time_per_move * 3;
                tc.time_increment = time_per_move;
                tc.max_time = Math.min(3600 * 24 * 21, time_per_move * 6);
                break;
                case "byoyomi":
                    throw "byoyomi time should never have an unpopulated time control structure";
                case "canadian":
                    tc.main_time = Math.min(3600 * 24 * 21, time_per_move * 120);
                tc.period_time = 20 * time_per_move;
                tc.stones_per_period = 20;
                break;
                case "absolute":
                    tc.total_time = 180 * time_per_move;
                break;
                case "none":
                    break;
            }
            //console.log(tc);
            game_obj.time_control = tc;
            */
        //}

        if (!("initial_state" in game_obj) && !("original_sgf" in game_obj)) {
            if (
                (game_obj.width !== 19 || game_obj.height !== 19) &&
                (game_obj.width !== 13 || game_obj.height !== 13) &&
                (game_obj.width !== 9 || game_obj.height !== 9)
            ) {
                game_obj.free_handicap_placement = true;
            }

            if (game_obj.handicap && !game_obj.free_handicap_placement) {
                let white = "";
                let black = "";
                let stars;
                if (game_obj.width === 19) {
                    stars = [
                        [encodeMove(3, 3), encodeMove(9, 3), encodeMove(15, 3)],
                        [encodeMove(3, 9), encodeMove(9, 9), encodeMove(15, 9)],
                        [encodeMove(3, 15), encodeMove(9, 15), encodeMove(15, 15)],
                    ];
                }
                if (game_obj.width === 13) {
                    stars = [
                        [encodeMove(3, 3), encodeMove(6, 3), encodeMove(9, 3)],
                        [encodeMove(3, 6), encodeMove(6, 6), encodeMove(9, 6)],
                        [encodeMove(3, 9), encodeMove(6, 9), encodeMove(9, 9)],
                    ];
                }
                if (game_obj.width === 9) {
                    stars = [
                        [encodeMove(2, 2), encodeMove(4, 2), encodeMove(6, 2)],
                        [encodeMove(2, 4), encodeMove(4, 4), encodeMove(6, 4)],
                        [encodeMove(2, 6), encodeMove(4, 6), encodeMove(6, 6)],
                    ];
                }

                if (stars) {
                    switch (game_obj.handicap) {
                        case 8:
                            black += stars[0][1] + stars[2][1];
                        /* falls through */
                        case 6:
                            black += stars[1][0] + stars[1][2];
                        /* falls through */
                        case 4:
                            black += stars[0][0];
                        /* falls through */
                        case 3:
                            black += stars[2][2];
                        /* falls through */
                        case 2:
                            black += stars[0][2] + stars[2][0];
                            /* falls through */
                            game_obj.initial_player = "white";
                            break;

                        case 9:
                            black += stars[0][1] + stars[2][1];
                        /* falls through */
                        case 7:
                            black += stars[1][0] + stars[1][2];
                        /* falls through */
                        case 5:
                            black += stars[1][1];
                            black += stars[0][0];
                            black += stars[2][2];
                            black += stars[0][2] + stars[2][0];
                            game_obj.initial_player = "white";
                            break;

                        default:
                            /* covers 1 stone too */
                            game_obj.free_handicap_placement = true;
                            break;
                    }

                    if ("ogs_import" in game_obj) {
                        /* ogs had the starting stones for 2 and 3 swapped from the cannonical positioning */
                        if (game_obj.handicap === 2) {
                            black = stars[0][0] + stars[2][2];
                        }
                        if (game_obj.handicap === 3) {
                            black = stars[0][0] + stars[0][2] + stars[2][2];
                        }
                    }
                } else {
                    game_obj.free_handicap_placement = true;
                }

                game_obj.initial_state = { black: black, white: white };
            } else {
                game_obj.initial_state = { black: "", white: "" };
            }
        }

        if (game_obj.phase === "finished" && game_obj.ogs && game_obj.score) {
            let ogs = game_obj.ogs;
            game_obj.score.white.scoring_positions =
                (game_obj.rules !== "japanese" ? ogs.white_stones : "") + ogs.white_territory;
            game_obj.score.black.scoring_positions =
                (game_obj.rules !== "japanese" ? ogs.black_stones : "") + ogs.black_territory;
            let dead =
                ogs.black_seki_eyes +
                ogs.white_seki_eyes +
                ogs.black_dead_stones +
                ogs.white_dead_stones;
            if (game_obj.players?.white) {
                game_obj.players.white.accepted_stones = dead;
            }
            if (game_obj.players?.black) {
                game_obj.players.black.accepted_stones = dead;
            }
            game_obj.removed = dead;
        }

        return game_obj;
    }
    public static clearRuleSettings(game_obj: GoEngineConfig): GoEngineConfig {
        delete game_obj.allow_self_capture;
        delete game_obj.automatic_stone_removal;
        delete game_obj.allow_ko;
        delete game_obj.allow_superko;
        delete game_obj.score_territory;
        delete game_obj.score_territory_in_seki;
        delete game_obj.strict_seki_mode;
        delete game_obj.score_stones;
        delete game_obj.score_prisoners;
        delete game_obj.score_passes;
        delete game_obj.white_must_pass_last;
        delete game_obj.komi;
        return game_obj;
    }
    private parseSGF(sgf: string): () => void {
        /* This callback is eventually returned after the parse. It is the function
         * that should be run which will perform the actual moves. This function is
         * constructed by making a bunch of dyanmic functions and chaining them
         * together.. slick or sick, depending on your PoV..  */
        let instructions: Array<() => void> = [];

        let self = this;
        let pos = 0;
        let line = 1;

        let inMainBranch = true;
        let gametree_depth = 0;
        let farthest_move: MoveTree;
        let initial_player: "black" | "white" | undefined;

        if (sgf.charCodeAt(0) > 255) {
            /* Assume this is a Byte Order Mark */
            sgf = sgf.substr(1);
        }

        function collection() {
            let ret = [];
            while (pos < sgf.length) {
                ret.push(gametree());
                inMainBranch = false;
            }
            return ret;
        }

        function whitespace() {
            while (
                sgf[pos] === " " ||
                sgf[pos] === "\t" ||
                sgf[pos] === "\n" ||
                sgf[pos] === "\r"
            ) {
                if (sgf[pos] === "\n") {
                    ++line;
                }
                ++pos;
            }
        }

        function gametree() {
            gametree_depth++;
            if (gametree_depth > 1) {
                inMainBranch = false;
            }

            let ret = [];
            whitespace();
            if (sgf[pos] !== "(") {
                throw new Error("Expecting '(' to start a GameTree");
            }
            ++pos;
            let s = sequence();
            ret.push(s);
            whitespace();
            while (sgf[pos] === "(") {
                process();
            }
            function process(): void {
                let cur: MoveTree;
                instructions.push(() => {
                    cur = self.cur_move;
                    //console.log("Stashing jump pos: ", cur.id);
                });

                let g = gametree();
                ret.push(g);

                instructions.push(() => {
                    //console.log("Jumping back to ", cur.id);
                    self.jumpTo(cur);
                });
            }

            whitespace();
            if (sgf[pos] !== ")") {
                throw new Error(
                    "Expecting ')' to end GameTree (found 0x" + sgf.charCodeAt(pos) + ")",
                );
            }
            ++pos;
            whitespace();
            --gametree_depth;
            return ret;
        }

        function sequence(): Array<Array<Array<string>>> {
            whitespace();
            let ret: Array<Array<Array<string>>> = [];
            while (sgf[pos] === ";") {
                let n = node();
                ret.push(n);
            }
            if (ret.length === 0) {
                throw new Error("Expecting Sequence");
            }
            return ret;
        }

        function node(): Array<Array<string>> {
            let ret: Array<Array<string>> = [];
            if (sgf[pos] !== ";") {
                throw new Error("Expecting ';' to start a Node");
            }
            ++pos;
            whitespace();
            while (/[A-Za-z]/.test(sgf[pos])) {
                ret.push(property());
            }
            return ret;
        }

        function property(): Array<string> {
            let ret: Array<string> = [];
            let ident = "";
            while (/[a-zA-Z]/.test(sgf[pos])) {
                ident += sgf[pos++];
            }
            if (ident === "") {
                throw new Error("Expecting PropIdent");
            }
            ret.push(ident);

            whitespace();

            if (sgf[pos] !== "[") {
                throw new Error("Expecting '[' to start a PropValue");
            }

            while (sgf[pos] === "[") {
                ++pos;
                let value = "";

                while (sgf[pos] !== "]") {
                    if (sgf[pos] === "\n") {
                        line++;
                    }
                    if (sgf[pos] === "\\") {
                        ++pos;
                    }
                    value += sgf[pos++];
                }
                ret.push(value);

                if (sgf[pos] !== "]") {
                    throw new Error("Expecting ']' to close a PropValue");
                }
                ++pos;
                whitespace();
            }

            processProperty(ident, ret);
            return ret;
        }

        function parseRank(rank: string): number {
            let b = parseInt(rank);
            if (/[kK]/.test(rank)) {
                return 30 - b;
            }
            if (/[d]/.test(rank)) {
                return 29 + b;
            }
            if (/[p]/.test(rank)) {
                return 1000 + 36 + b;
            }
            return -100;
        }

        function processProperty(ident: string, values: Array<string>) {
            for (let i = 1; i < values.length; ++i) {
                process(values[i]);
            }

            function process(val: string) {
                switch (ident) {
                    case "AB":
                    case "AW":
                        {
                            if (!inMainBranch) {
                                instructions.push(() => {
                                    if (val === "") {
                                    } else {
                                        let mv = self.decodeMoves(val)[0];
                                        self.editPlace(mv.x, mv.y, ident === "AB" ? 1 : 2);
                                    }
                                });
                            } else {
                                if (!self.config.initial_state) {
                                    self.config.initial_state = {
                                        black: "",
                                        white: "",
                                    };
                                }

                                if (ident === "AB") {
                                    self.config.initial_state.black += val;
                                } else {
                                    self.config.initial_state.white += val;
                                }

                                // If we have initial stones, we assume these
                                // account for any free placement of handicap
                                // stones
                                self.config.free_handicap_placement = false;
                                self.free_handicap_placement = false;
                            }
                        }
                        break;

                    case "W":
                    case "B":
                        {
                            if (!initial_player) {
                                initial_player = ident === "B" ? "black" : "white";
                                self.config.initial_player = initial_player;
                            }

                            inMainBranch = false;
                            instructions.push(() => {
                                if (val === "") {
                                    val = ".."; // make it a pass
                                }

                                let mv = self.decodeMoves(val)[0];
                                if (
                                    (self.player === 1 && ident === "B") ||
                                    (self.player !== 1 && ident === "W")
                                ) {
                                    self.place(mv.x, mv.y, false, false, false, true, false);
                                } else {
                                    self.editPlace(mv.x, mv.y, ident === "B" ? 1 : 2);
                                }
                                if (
                                    self.cur_move &&
                                    (farthest_move == null ||
                                        self.cur_move.move_number > farthest_move.move_number)
                                ) {
                                    farthest_move = self.cur_move;
                                }
                            });
                        }

                        break;
                    case "C":
                        {
                            instructions.push(() => {
                                self.cur_move.text += val;
                            });
                        }
                        break;
                    case "LB":
                    case "TR":
                    case "CR":
                    case "SQ":
                    case "XX":
                        {
                            instructions.push(() => {
                                try {
                                    let s: string = val.substr(0, 2);
                                    let extra = val.substr(3);
                                    let mv = self.decodeMoves(s)[0];
                                    //console.log(mv);

                                    let marks = self.cur_move.getMarks(mv.x, mv.y);
                                    switch (ident) {
                                        case "LB":
                                            marks.letter = extra;
                                            break;
                                        case "TR":
                                            marks.triangle = true;
                                            break;
                                        case "CR":
                                            marks.circle = true;
                                            break;
                                        case "SQ":
                                            marks.square = true;
                                            break;
                                        case "XX":
                                            marks.cross = true;
                                            break;
                                    }
                                } catch (e) {
                                    console.error(e);
                                }
                            });
                        }
                        break;
                    case "HA":
                        {
                            instructions.push(() => {
                                self.handicap = parseInt(val);
                                if (self.config.initial_player) {
                                    self.player =
                                        self.config.initial_player === "black"
                                            ? JGOFNumericPlayerColor.BLACK
                                            : JGOFNumericPlayerColor.WHITE;
                                }
                                /*
                                if (self.handicap !== 0) {
                                    self.player = JGOFNumericPlayerColor.WHITE;
                                }
                                */
                            });
                        }
                        break;
                    case "RU":
                        {
                            instructions.push(() => {
                                let rules: GoEngineRules = "japanese";

                                switch (val.toLowerCase()) {
                                    case "japanese":
                                    case "jp":
                                        rules = "japanese";
                                        break;

                                    case "chinese":
                                    case "cn":
                                    case "zh":
                                        rules = "chinese";
                                        break;

                                    case "nz":
                                        rules = "nz";
                                        break;

                                    case "aga":
                                    case "us":
                                        rules = "aga";
                                        break;

                                    case "korean":
                                    case "ko":
                                        rules = "korean";
                                        break;

                                    case "goe":
                                    case "ing":
                                        rules = "ing";
                                        break;

                                    default:
                                        console.warn(
                                            `Unknown rule set ${val}, defaulting to Japanese`,
                                        );
                                }

                                self.rules = rules;
                            });
                        }
                        break;
                    case "RE":
                        {
                            instructions.push(() => {
                                if (val[0].toLowerCase() === "b") {
                                    self.winner = "black";
                                }
                                if (val[0].toLowerCase() === "w") {
                                    self.winner = "white";
                                }

                                if (self.outcome === "") {
                                    let result;
                                    let match = val.match(/[BW]\+(.*)/);
                                    if (match === null) {
                                        result = val;
                                    } else {
                                        result = match[1];
                                    }

                                    if (match !== null && /[0-9.]+/.test(result)) {
                                        // There's a numeric score.
                                        self.outcome = result;
                                    } else {
                                        switch (result[0].toUpperCase()) {
                                            case "0": // Draw.
                                            case "D": // Draw.
                                                self.outcome = "0";
                                                break;
                                            case "R": // Resignation.
                                                self.outcome = "Resignation";
                                                break;
                                            case "T": // Timeout.
                                                self.outcome = "Timeout";
                                                break;
                                            case "F": // Forfeit.
                                                // Disqualification seems the closest to forfeit.
                                                self.outcome = "Disqualification";
                                                break;
                                            case "V": // Void.
                                            case "?": // Unknown.
                                                self.outcome = "";
                                                break;
                                            default:
                                                self.outcome = "";
                                                console.warn(`Unknown result: ${result}`);
                                        }
                                    }
                                }
                            });
                        }
                        break;

                    case "DT":
                        self.config.game_date = val;
                        break;

                    case "GN":
                        self.config.game_name = val;
                        break;

                    case "PW":
                        if (self.config.players?.white) {
                            self.config.players.white.username = val;
                        }
                        break;

                    case "PB":
                        if (self.config.players?.black) {
                            self.config.players.black.username = val;
                        } else {
                            console.log("SHIT no dice");
                        }
                        break;

                    case "WR":
                        if (self.config.players?.white) {
                            self.config.players.white.rank = parseRank(val);
                            console.log("PARSED wr", val, self.config.players.white.rank);
                        }
                        break;

                    case "BR":
                        if (self.config.players?.black) {
                            self.config.players.black.rank = parseRank(val);
                        }
                        break;

                    case "TB":
                        {
                            instructions.push(() => {
                                self.territory_included_in_sgf = true;
                                let black_territory_point = self.decodeMoves(val)[0];
                                if (
                                    self.board[black_territory_point.y][black_territory_point.x] ===
                                    JGOFNumericPlayerColor.WHITE
                                ) {
                                    self.setRemoved(
                                        black_territory_point.x,
                                        black_territory_point.y,
                                        true,
                                    );
                                }
                            });
                        }
                        break;

                    case "TW":
                        {
                            instructions.push(() => {
                                self.territory_included_in_sgf = true;
                                let white_territory_point = self.decodeMoves(val)[0];
                                if (
                                    self.board[white_territory_point.y][white_territory_point.x] ===
                                    JGOFNumericPlayerColor.BLACK
                                ) {
                                    self.setRemoved(
                                        white_territory_point.x,
                                        white_territory_point.y,
                                        true,
                                    );
                                }
                            });
                        }
                        break;
                }
            }
        }

        try {
            collection();
        } catch (e) {
            console.log(
                "Failed to parse SGF on line " +
                    line +
                    " at char '" +
                    sgf[pos] +
                    "' (right after '" +
                    sgf.substr(pos - 10, 10) +
                    "')",
            );
            console.log(e.stack);
        }

        return () => {
            self.config.players = self.config.players || {
                white: {
                    id: 0,
                    username: "White",
                    rank: 0,
                },
                black: {
                    id: 0,
                    username: "Black",
                    rank: 0,
                },
            };

            instructions.map((f) => f());

            this.move_tree.hoistFirstBranchToTrunk();

            /* jump to farthest loaded move so we don't begin at the first branch point */
            if (farthest_move) {
                self.jumpTo(farthest_move);
            }
        };
    }
    public estimateScore(trials: number, tolerance: number, prefer_remote: boolean = false): Score {
        let se = new ScoreEstimator(this.goban_callback, this, trials, tolerance, prefer_remote);
        return se.score();
    }
    public getMoveByLocation(x: number, y: number): MoveTree | null {
        let m: MoveTree | null = null;
        let cur_move: MoveTree | null = this.cur_move;
        while (!m && cur_move) {
            if (cur_move.x === x && cur_move.y === y) {
                m = cur_move;
            }
            cur_move = cur_move.next();
        }
        cur_move = this.cur_move.parent;
        while (!m && cur_move) {
            if (cur_move.x === x && cur_move.y === y) {
                m = cur_move;
            }
            cur_move = cur_move.parent;
        }
        return m;
    }

    public exportAsPuzzle(): PuzzleConfig {
        return {
            mode: "puzzle",
            name: this.name,
            puzzle_type: this.puzzle_type,
            width: this.width,
            height: this.height,
            initial_state: this.initial_state,
            puzzle_opponent_move_mode: this.puzzle_opponent_move_mode,
            puzzle_player_move_mode: this.puzzle_player_move_mode,
            puzzle_rank: this.puzzle_rank,
            puzzle_description: this.puzzle_description,
            puzzle_collection: this.puzzle_collection,
            initial_player: this.config.initial_player,
            move_tree: this.move_tree.toJson(),
        };
    }
    public getBlackPrisoners(): number {
        return this.black_prisoners;
    }
    public getWhitePrisoners(): number {
        return this.white_prisoners;
    }
    /* Returns the amount of points that should be given to white for any
     * handicap stones in the game. */
    public getHandicapPointAdjustmentForWhite(): number {
        let ret = 0;
        if (this.score_handicap) {
            if (this.aga_handicap_scoring && this.handicap > 0) {
                ret = this.handicap - 1;
            } else {
                ret = this.handicap;
            }
        }
        return ret;
    }
}
