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

import { BoardState, BoardConfig } from "./BoardState";
import { GobanMoveError } from "./GobanError";
import { MoveTree, MoveTreeJson } from "./MoveTree";
import {
    decodeMoves,
    decodePrettyCoordinates,
    encodeMove,
    encodeMoves,
    makeMatrix,
    positionId,
    prettyCoordinates,
    sortMoves,
} from "./util";
import { RawStoneString } from "./StoneString";
import { ScoreEstimator } from "./ScoreEstimator";
import { GobanBase, GobanEvents } from "../GobanBase";
import {
    JGOFTimeControl,
    JGOFNumericPlayerColor,
    JGOFMove,
    JGOFPlayerSummary,
    JGOFIntersection,
    JGOFSealingIntersection,
} from "./formats/JGOF";
import { AdHocPackedMove } from "./formats/AdHocFormat";
import { _ } from "./translate";
import { EventEmitter } from "eventemitter3";
import { GameClock, StallingScoreEstimate } from "./protocol";
import * as goscorer from "goscorer";

declare const CLIENT: boolean;
declare const SERVER: boolean;

export const AUTOSCORE_TRIALS = 1000;
export const AUTOSCORE_TOLERANCE = 0.1;

export type GobanEnginePhase = "play" | "stone removal" | "finished";
export type GobanEngineRules = "chinese" | "aga" | "japanese" | "korean" | "ing" | "nz";
export type GobanEngineSuperKoAlgorithm =
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

export interface GobanEnginePlayerEntry {
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

// The word "array" is deliberately included in the type name to differentiate from a move tree.
export type GobanMovesArray = Array<AdHocPackedMove> | Array<JGOFMove>;

export interface GobanEngineConfig extends BoardConfig {
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
    handicap_rank_difference?: number;
    handicap?: number;
    komi?: number;
    rules?: GobanEngineRules;
    phase?: GobanEnginePhase;
    initial_state?: GobanEngineInitialState;
    marks?: { [mark: string]: string };
    latencies?: { [player_id: string]: number };
    player_pool?: { [id: number]: GobanEnginePlayerEntry }; // we need this to get player details from player_id in player_update events
    players?: {
        black: GobanEnginePlayerEntry;
        white: GobanEnginePlayerEntry;
    };
    rengo?: boolean;
    rengo_teams?: {
        black: Array<GobanEnginePlayerEntry>;
        white: Array<GobanEnginePlayerEntry>;
    };
    rengo_casual_mode?: boolean;
    reviews?: {
        [review_id: number]: GobanEnginePlayerEntry;
    };
    is_game_record?: boolean /* Indicates that this game is a game record of a real life game */;

    time_control?: JGOFTimeControl;
    moves?: GobanMovesArray;
    move_tree?: MoveTreeJson;
    ranked?: boolean;
    original_disable_analysis?: boolean;
    original_sgf?: string;
    free_handicap_placement?: boolean;
    score?: Score;
    outcome?: string;
    winner?: number | "black" | "white" | "tie"; // Player ID of the winner

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
    superko_algorithm?: GobanEngineSuperKoAlgorithm;
    stalling_score_estimate?: StallingScoreEstimate;

    // This is used in gtp2ogs
    clock?: GameClock;

    /** When loading initial state or moves, by default GobanEngine will try and
     *  handle bad data by just resorting to 'edit placing' moves. If this is
     *  true, then those errors are thrown instead.
     */
    throw_all_errors?: boolean;

    /** Removed stones in stone removal phase
     *  Passing an array of JGOFMove objects is preferred, the string
     *  format exists for historical backwards compatibility. It is an
     *  encoded move string, e.g. "aa" for A19
     */
    removed?: string | JGOFMove[];

    /** Intersections that need to be sealed before scoring should happen */
    needs_sealing?: JGOFSealingIntersection[];

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

    /** Deprecated, I don't think we need this anymore, but need to be sure */
    ogs_import?: boolean;

    // deprecated, normalized out
    ladder?: number;
    black_player_id?: number;
    white_player_id?: number;
}

export interface GobanEngineInitialState {
    black?: string;
    white?: string;
}

/** Reviews are constructed by a stream of modifications messages,
 *  this interface describes the format of those modification messages.
 *  A message can contain any number of the fields listed. */
export interface ReviewMessage {
    /** The review ID. This is used when sending from the client to the server,
     * but is not sent by the server back to the client (as the id is encoded
     * in the message event name) */
    "review_id"?: number;

    /** timestamp (ms) */
    "ts"?: number;
    /** from (move number) */
    "f"?: number;
    /** Moves made */
    "m"?: string;
    /** official move [reviewing live game] */
    "om"?: [number, number, number];
    /** official undo [reviewing live game] */
    "undo"?: boolean;
    /** text note for the current node */
    "t"?: string;
    /** text append to the current node */
    "t+"?: string;
    /** Marks made */
    "k"?: { [mark: string]: string };
    /** pen point */
    "pp"?: [number, number];
    /** pen color / pen start */
    "pen"?: string;
    /** Chat message */
    "chat"?: {
        chat_id: string;
        player_id: number;
        channel: string;
        date: number;
        /** Turn number */
        from: number;
        /** this might just be "string", i'm not entirely sure */
        moves: AdHocPackedMove | string;
    };
    /** Remove's the given chat by id */
    "remove-chat"?: string;
    /** Clears the pen drawings on the node */
    "clearpen"?: boolean;
    /** Delete */
    "delete"?: number;
    /** Sets the owner of the review */
    "owner"?: number | { id: number; username: string };
    /** Initial gamedata to review */
    "gamedata"?: GobanEngineConfig;
    /** Sets the controller of the review */
    "controller"?: number | { id: number; username: string };
    /** Updated information about the players, such as name etc. */
    "player_update"?: JGOFPlayerSummary;
}

export interface PuzzleConfig extends BoardConfig {
    //mode: "puzzle";
    mode?: string;
    name?: string;
    puzzle_type?: string;
    initial_state?: GobanEngineInitialState;
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

export type PlayerColor = "black" | "white";

export class GobanEngine extends BoardState {
    //public readonly players.black.id:number;
    //public readonly players.white.id:number;
    public throw_all_errors?: boolean;
    //public cur_review_move?: MoveTree;
    public handicap_rank_difference?: number;
    public handicap: number = NaN;
    public initial_state: GobanEngineInitialState = { black: "", white: "" };
    public komi: number = NaN;
    public move_tree: MoveTree;
    public move_tree_layout_vector: Array<number> =
        []; /* For use by MoveTree layout and rendering */
    public move_tree_layout_hash: { [coords: string]: MoveTree } =
        {}; /* For use by MoveTree layout and rendering */
    public move_tree_layout_dirty: boolean = false; /* For use by MoveTree layout and rendering */
    public readonly name: string = "";
    public player_pool: { [id: number]: GobanEnginePlayerEntry };
    public latencies?: { [player_id: string]: number };
    public players: {
        black: GobanEnginePlayerEntry;
        white: GobanEnginePlayerEntry;
    } = {
        black: { username: "black", id: NaN },
        white: { username: "white", id: NaN },
    };
    public puzzle_collection: number = NaN;
    public puzzle_description: string = "[missing puzzle description]";
    public puzzle_opponent_move_mode: PuzzleOpponentMoveMode = "manual";
    public puzzle_player_move_mode: PuzzlePlayerMoveMode = "free";
    public puzzle_rank: number = NaN;
    public puzzle_type: string = "[missing puzzle type]";
    public readonly config: GobanEngineConfig;
    public readonly disable_analysis: boolean = false;
    //public readonly rules:GobanEngineRules = 'japanese';
    public time_control: JGOFTimeControl = {
        system: "none",
        speed: "correspondence",
        pause_on_weekends: true,
    };
    public game_id: number = NaN;
    public review_id?: number;
    public decoded_moves: Array<JGOFMove> = [];
    public automatic_stone_removal: boolean = false;
    public group_ids?: Array<number>;
    public rengo?: boolean;
    public rengo_teams?: {
        [colour: string]: Array<GobanEnginePlayerEntry>; // TBD index this by PlayerColour
    };
    public rengo_casual_mode: boolean;
    public stalling_score_estimate?: StallingScoreEstimate;
    public readonly is_game_record: boolean = false;

    /* Properties that emit change events */
    private _phase: GobanEnginePhase = "play";
    public get phase(): GobanEnginePhase {
        return this._phase;
    }
    public set phase(phase: GobanEnginePhase) {
        if (this._phase === phase) {
            return;
        }
        this._phase = phase;
        this.emit("phase", this.phase);
    }

    private _cur_move: MoveTree;
    public get cur_move(): MoveTree {
        return this._cur_move;
    }
    public set cur_move(cur_move: MoveTree) {
        if (this._cur_move === cur_move) {
            return;
        }
        this._cur_move = cur_move;
        this.emit("cur_move", this.cur_move);
    }

    private _cur_review_move: MoveTree | undefined;
    public get cur_review_move(): MoveTree | undefined {
        return this._cur_review_move;
    }
    public set cur_review_move(cur_review_move: MoveTree | undefined) {
        if (this._cur_review_move === cur_review_move) {
            return;
        }
        this._cur_review_move = cur_review_move;
        this.emit("cur_review_move", this.cur_review_move);
    }

    private _last_official_move: MoveTree;
    public get last_official_move(): MoveTree {
        return this._last_official_move;
    }
    public set last_official_move(last_official_move: MoveTree) {
        if (this._last_official_move === last_official_move) {
            return;
        }
        this._last_official_move = last_official_move;
        this.emit("last_official_move", this.last_official_move);
    }

    private _strict_seki_mode: boolean = false;
    public get strict_seki_mode(): boolean {
        return this._strict_seki_mode;
    }
    public set strict_seki_mode(strict_seki_mode: boolean) {
        if (this._strict_seki_mode === strict_seki_mode) {
            return;
        }
        this._strict_seki_mode = strict_seki_mode;
        this.emit("strict_seki_mode", this.strict_seki_mode);
    }

    private _rules: GobanEngineRules = "japanese"; // can't be readonly at this point since parseSGF sets it
    public get rules(): GobanEngineRules {
        return this._rules;
    }
    public set rules(rules: GobanEngineRules) {
        if (this._rules === rules) {
            return;
        }
        this._rules = rules;
        this.emit("rules", this.rules);
    }

    private _winner?: number | "black" | "white";
    public get winner(): number | "black" | "white" | undefined {
        return this._winner;
    }
    public set winner(winner: number | "black" | "white" | undefined) {
        if (this._winner === winner) {
            return;
        }
        this._winner = winner;
        if (typeof winner === "number") {
            this.emit("winner", this.winner as number);
        }
    }

    private _undo_requested?: number; // move number of the last undo request
    public get undo_requested(): number | undefined {
        return this._undo_requested;
    }
    public set undo_requested(undo_requested: number | undefined) {
        if (this._undo_requested === undo_requested) {
            return;
        }
        this._undo_requested = undo_requested;
        this.emit("undo_requested", this.undo_requested);
    }

    private _outcome: string = "";
    public get outcome(): string {
        return this._outcome;
    }
    public set outcome(outcome: string) {
        if (this._outcome === outcome) {
            return;
        }
        this._outcome = outcome;
        this.emit("outcome", this.outcome);
    }

    private aga_handicap_scoring: boolean = false;
    private allow_ko: boolean = false;
    private allow_self_capture: boolean = false;
    private allow_superko: boolean = false;
    private superko_algorithm: GobanEngineSuperKoAlgorithm = "psk";
    private dontStoreBoardHistory: boolean;
    public free_handicap_placement: boolean = false;
    private loading_sgf: boolean = false;
    private move_before_jump?: MoveTree;
    public needs_sealing?: Array<JGOFSealingIntersection>;
    //private mv:Move;
    public score_prisoners: boolean = false;
    public score_stones: boolean = false;
    public score_handicap: boolean = false;
    public score_territory: boolean = false;
    public score_territory_in_seki: boolean = false;
    public territory_included_in_sgf: boolean = false;

    constructor(
        config: GobanEngineConfig,
        goban_callback?: GobanBase,
        dontStoreBoardHistory?: boolean,
    ) {
        super(
            GobanEngine.fillDefaults(
                GobanEngine.migrateConfig(
                    ((config: GobanEngineConfig): GobanEngineConfig => {
                        /* We had a bug where we were filling in some initial state
                         * data incorrectly when we were dealing with sgfs, so this
                         * code exists for sgf 'games' < 800k in the database..
                         * -anoek 2014-08-13 */
                        try {
                            if ("original_sgf" in config) {
                                config.initial_state = { black: "", white: "" };
                            }
                        } catch (e) {
                            console.log(e);
                        }
                        return config;
                    })(config),
                ),
            ),
            goban_callback,
        );

        for (const k in config) {
            if (k !== "move_tree") {
                (this as any)[k] = (config as any)[k];
            }
        }

        const self = this;
        this.config = config;
        this.is_game_record = !!config.is_game_record;
        this.dontStoreBoardHistory =
            !!dontStoreBoardHistory; /* Server side, we don't want to store board snapshots */

        if (goban_callback) {
            this.goban_callback = goban_callback;
            this.goban_callback.engine = this;
        }
        this.white_prisoners = 0;
        this.black_prisoners = 0;
        this.board_is_repeating = false;
        this.players = config.players || {
            black: { username: "black", id: NaN },
            white: { username: "white", id: NaN },
        };
        this.player_pool = config.player_pool || {};

        this.rengo_casual_mode = config.rengo_casual_mode || false;

        try {
            this.config.original_disable_analysis = this.config.disable_analysis;
            if (
                typeof window !== "undefined" &&
                typeof (window as any)["user"] !== "undefined" &&
                (window as any)["user"] &&
                !this.isParticipant((window as any)["user"].id)
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
            for (const player of config.rengo_teams.black.concat(config.rengo_teams.white)) {
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
            const black_moves = this.decodeMoves(config.initial_state.black || "");
            const white_moves = this.decodeMoves(config.initial_state.white || "");
            for (let i = 0; i < black_moves.length; ++i) {
                const x = black_moves[i].x;
                const y = black_moves[i].y;
                this.initialStatePlace(x, y, 1, true);
            }
            for (let i = 0; i < white_moves.length; ++i) {
                const x = white_moves[i].x;
                const y = white_moves[i].y;
                this.initialStatePlace(x, y, 2, true);
            }
        }

        /* Must be after initial state setup */
        this.move_tree = new MoveTree(this, true, -1, -1, false, 0, 0, null, this.getState());

        this._cur_move = this.move_tree;
        this._last_official_move = this.cur_move;
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
            const moves = (this.decoded_moves = this.decodeMoves(config.moves));

            //var have_edited = false;
            for (let i = 0; i < moves.length; ++i) {
                const mv = moves[i];
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
                        if (mv.played_by) {
                            this.cur_move.played_by = mv.played_by;
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
                            } at ${this.prettyCoordinates(mv.x, mv.y)} (${mv.x}, ${mv.y})`,
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
        if (removed) {
            for (let i = 0; i < removed.length; ++i) {
                this.setRemoved(removed[i].x, removed[i].y, true, false);
            }
            this.emit("stone-removal.updated");
        }
        if (config.needs_sealing) {
            this.needs_sealing = config.needs_sealing;
            if (this.phase === "stone removal") {
                for (const intersection of config.needs_sealing) {
                    this.setNeedsSealing(intersection.x, intersection.y, true);
                }
            }

            this.emit("stone-removal.needs-sealing", config.needs_sealing);
        }

        function unpackMoveTree(cur: MoveTree, tree: MoveTreeJson): void {
            cur.loadJsonForThisNode(tree);
            if (tree.trunk_next) {
                const n = tree.trunk_next;
                self.place(n.x, n.y, false, false, true, true, true);
                unpackMoveTree(self.cur_move, n);
                self.jumpTo(cur);
            }

            if (tree.branches) {
                for (let i = 0; i < tree.branches.length; ++i) {
                    const n = tree.branches[i];
                    self.place(n.x, n.y, false, false, true, true, false);
                    unpackMoveTree(self.cur_move, n);
                    self.jumpTo(cur);
                }
            }
        }
    }

    /**
     * Decodes any of the various ways we express moves that we've accumulated over the years into
     * a unified `JGOFMove[]`.
     */
    public decodeMoves(
        move_obj:
            | string
            | AdHocPackedMove
            | AdHocPackedMove[]
            | JGOFMove
            | JGOFMove[]
            | [object]
            | undefined,
    ): JGOFMove[] {
        return decodeMoves(move_obj, this.width, this.height);
    }

    /* Encodes a move list like `[{x: 0, y: 0}, {x:1, y:2}]` into our move string
     * format `"aabc"` */
    public encodeMoves(lst: JGOFMove[]): string {
        return encodeMoves(lst);
    }

    /* Encodes a single move `{x:1, y:2}` into our move string
     * format `"bc"` */
    public encodeMove(lst: JGOFMove): string {
        return encodeMoves([lst]);
    }

    /**
     * Decodes a move string like `"A11"` into a move object like `{x: 0, y: 10}`. Also
     * handles the special cases like `".."` and "pass" which map to `{x: -1, y: -1}`.
     */
    public decodePrettyCoordinates(coordinates: string): JGOFMove {
        return decodePrettyCoordinates(coordinates, this.height);
    }

    /** Encodes an x,y pair or a move object like {x: 0, y: 0} into a move string like "A1" */
    public prettyCoordinates(x: JGOFMove): string;
    public prettyCoordinates(x: number, y: number): string;
    public prettyCoordinates(x: number | JGOFMove, y?: number): string {
        if (typeof x !== "number") {
            y = x.y;
            x = x.x;
        }
        return prettyCoordinates(x, y as number, this.height);
    }

    private getState(): BoardState {
        return this.cloneBoardState();
    }
    private setState(state: BoardState): BoardState {
        this.player = state.player;
        this.white_prisoners = state.white_prisoners;
        this.black_prisoners = state.black_prisoners;
        this.board_is_repeating = state.board_is_repeating;

        //this.goban_callback?.setState(state.udata_state);
        this.goban_callback?.setState?.();

        const redrawn = makeMatrix<boolean>(this.width, this.height, false);

        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (
                    this.board[y][x] !== state.board[y][x] ||
                    (this.cur_move.x === x && this.cur_move.y === y)
                ) {
                    this.board[y][x] = state.board[y][x];
                    redrawn[y][x] = true;
                }

                if (
                    this.removal[y][x] !== state.removal[y][x] ||
                    (this.cur_move.x === x && this.cur_move.y === y)
                ) {
                    this.removal[y][x] = state.removal[y][x];
                    redrawn[y][x] = true;
                }
            }
        }

        if (this.goban_callback) {
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    this.goban_callback.set(x, y, this.board[y][x]);
                }
            }
        }

        return state;
    }

    public currentPositionId(): string {
        return positionId(this.board, this.height, this.width);
    }

    public followPath(
        from_turn: number,
        moves: AdHocPackedMove | string,
        cb?: (x: number, y: number, edited: boolean, color: number) => void,
    ): Array<MoveTree> {
        try {
            const ret = [];
            const from = this.move_tree.index(from_turn);
            let cur: MoveTree;
            if (from) {
                cur = from;
            } else {
                cur = this.last_official_move;
            }

            const _moves = this.decodeMoves(moves);
            let i = 0;

            while (i < _moves.length) {
                const mv = _moves[i];
                const existing: MoveTree | null = cur.lookupMove(
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
                const mv = _moves[i];

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

                for (const colour of ["black", "white"]) {
                    //console.log("looking at", colour, player_update.rengo_teams[colour]);
                    for (const id of player_update.rengo_teams[colour as "black" | "white"]) {
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

        this.emit("player-update", player_update);
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
            //throw new Error("Attempted to jump to a null/undefined node");
            return;
        }
        this.move_before_jump = this.cur_move;
        this.setState(node.state);
        this.cur_move = node;
        if (node.player_update) {
            //console.log("Engine jumpTo doing player_update...");
            this.updatePlayers(node.player_update);
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

    /** returns true if our current move is our last official move */
    public isLastOfficialMove(): boolean {
        return this.cur_move.is(this.last_official_move);
    }
    /** Returns a move string from the given official move number (aka branch point) */
    public getMoveDiff(): { from: number; moves: string } {
        const branch_point = this.cur_move.getBranchPoint();
        let cur: MoveTree | null = this.cur_move;
        const moves: JGOFMove[] = [];

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
        const t = this.cur_move.parent;
        this.cur_move.remove();
        this.cur_move = t ? t : this.move_tree;
        this.jumpTo(t);
    }
    public gameCanBeCancelled(): boolean {
        if (this.phase !== "play") {
            return false;
        }

        if ("tournament_id" in this.config && this.config.tournament_id) {
            return false;
        }

        if ("ladder_id" in this.config && this.config.ladder_id) {
            return false;
        }

        if (this.rengo && this.rengo_casual_mode) {
            return false; // casual mode players exit by resigning.
        }

        const move_number = this.getMoveNumber();
        // can play up to 6 moves (plus handicap moves) and still cancel the game
        // so it's not ranked
        const max_moves_played = 5 + (this.free_handicap_placement ? this.handicap : 1);

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

    private captureGroup(group: RawStoneString): number {
        for (let i = 0; i < group.length; ++i) {
            const x = group[i].x;
            const y = group[i].y;
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

    public isParticipant(player_id: number): boolean {
        // Note: in theory we get participants from the engine each move, with the intention that we store and use here,
        // which would be more efficient, but needs careful consideration of timing and any other gotchas
        const players =
            this.rengo && this.rengo_teams
                ? this.rengo_teams.black.concat(this.rengo_teams.white)
                : [this.players.black, this.players.white];
        return players.map((p) => p.id).includes(player_id);
    }

    public isActivePlayer(player_id: number): boolean {
        const players = [this.players.black, this.players.white];
        return players.map((p) => p.id).includes(player_id);
    }

    public playerToMoveOnOfficialBranch(): number {
        return this.last_official_move.state.player === 1
            ? this.players.black.id
            : this.players.white.id;
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

    /** Returns the number of stones removed. If you want the coordinates of
     * the stones removed, pass in a removed_stones array to append the moves
     * to. */
    public place(
        x: number,
        y: number,
        checkForKo?: boolean,
        errorOnSuperKo?: boolean,
        dontCheckForSuperKo?: boolean,
        dontCheckForSelfCapture?: boolean,
        isTrunkMove?: boolean,
        removed_stones?: Array<JGOFIntersection>,
    ): number {
        let pieces_removed = 0;

        try {
            if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
                if (this.board[y][x]) {
                    if ("loading_sgf" in this && this.loading_sgf) {
                        if (this.board[y][x] !== this.player) {
                            console.log(
                                "Invalid duplicate stone placement at " +
                                    this.prettyCoordinates(x, y) +
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
                        this.prettyCoordinates(x, y),
                        "stone_already_placed_here",
                    );
                }
                this.board[y][x] = this.player;

                let self_capture_move = false;
                const player_group = this.getRawStoneString(x, y, true);
                const opponent_groups = this.getNeighboringRawStoneStrings(player_group);

                for (let i = 0; i < opponent_groups.length; ++i) {
                    if (this.countLiberties(opponent_groups[i]) === 0) {
                        if (removed_stones !== undefined) {
                            opponent_groups[i].map((x) => removed_stones.push(x));
                        }
                        pieces_removed += this.captureGroup(opponent_groups[i]);
                    }
                }
                if (pieces_removed === 0) {
                    if (this.countLiberties(player_group) === 0) {
                        if (this.allow_self_capture || dontCheckForSelfCapture) {
                            pieces_removed += this.captureGroup(player_group);
                            self_capture_move = true;
                        } else {
                            this.board[y][x] = 0;
                            throw new GobanMoveError(
                                this.game_id || this.review_id || 0,
                                this.cur_move?.move_number ?? -1,
                                this.prettyCoordinates(x, y),
                                "illegal_self_capture",
                            );
                        }
                    }
                }

                if (checkForKo && !this.allow_ko) {
                    if (!this.cur_move.edited && this.boardEquals(this.cur_move.index(-1).state)) {
                        throw new GobanMoveError(
                            this.game_id || this.review_id || 0,
                            this.cur_move?.move_number ?? -1,
                            this.prettyCoordinates(x, y),
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
                                this.prettyCoordinates(x, y),
                                "illegal_board_repetition",
                            );
                        }
                    }
                }

                if (!self_capture_move) {
                    if (this.goban_callback) {
                        this.goban_callback.set(x, y, this.player);
                    }
                }
            }

            if (x < 0 && this.handicapMovesLeft() > 0) {
                //console.log("Skipping old-style implicit pass on handicap: ", this.player);
                return 0;
            }

            const color = this.player;
            if (this.handicapMovesLeft() < 2) {
                this.player = this.opponent();
            }
            const next_move_number = this.cur_move.move_number + 1;
            const trunk = isTrunkMove ? true : false;
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
            throw e;
        }

        return pieces_removed;
    }
    public isBoardRepeating(superko_rule: GobanEngineSuperKoAlgorithm): boolean {
        const MAX_SUPERKO_SEARCH = 30; /* any more than this is probably a waste of time. This may be overkill even. */
        const current_player_to_move = this.player;
        const check_situational = superko_rule === "ssk";

        let t: MoveTree | null | undefined = this.cur_move.index(-2);
        for (
            let i = Math.min(MAX_SUPERKO_SEARCH, this.cur_move.move_number - 2);
            i > 0;
            --i, t = t?.prev()
        ) {
            if (t) {
                if (!check_situational || t.player === current_player_to_move) {
                    if (this.boardEquals(t.state)) {
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
        const player = this.playerByColor(color);

        if (x >= 0 && y >= 0) {
            this.board[y][x] = player;
            if (this.goban_callback) {
                this.goban_callback.set(x, y, player);
            }
        }

        const trunk = isTrunkMove ? true : false;

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
        const p = this.player;

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
                const moves = this.decodeMoves(
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

    public setNeedsSealing(x: number, y: number, needs_sealing?: boolean): void {
        this.cur_move.getMarks(x, y).needs_sealing = needs_sealing;
    }

    public getStoneRemovalString(): string {
        let ret = "";
        const arr = [];
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

        return sortMoves(ret, this.width, this.height);
    }

    public getMoveNumber(): number {
        return this.cur_move ? this.cur_move.move_number : 0;
    }
    public getCurrentMoveNumber(): number {
        return this.last_official_move.move_number;
    }

    /**
     * Computes the score of the current board state.
     *
     * If only_prisoners is true, we return the same data structure for convenience, but only
     * the prisoners will be counted, other sources of points will be zero.
     */
    public computeScore(only_prisoners?: boolean): Score {
        const ret = {
            white: {
                total: 0,
                stones: 0,
                territory: 0,
                prisoners: 0,
                scoring_positions: "",
                handicap: this.getHandicapPointAdjustmentForWhite(),
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

        // Tally up prisoners when appropriate
        if (only_prisoners || this.score_prisoners) {
            ret.white.prisoners = this.white_prisoners;
            ret.black.prisoners = this.black_prisoners;

            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (this.removal[y][x]) {
                        if (this.board[y][x] === JGOFNumericPlayerColor.BLACK) {
                            ret.white.prisoners += 1;
                        }
                        if (this.board[y][x] === JGOFNumericPlayerColor.WHITE) {
                            ret.black.prisoners += 1;
                        }
                    }
                }
            }
        }

        // Tally everything else if we want that information
        if (!only_prisoners) {
            if (!this.score_territory) {
                throw new Error("The score_territory flag should always be set to true");
            }

            if (this.score_stones) {
                const scoring = goscorer.areaScoring(this.board, this.removal);
                for (let y = 0; y < this.height; ++y) {
                    for (let x = 0; x < this.width; ++x) {
                        if (scoring[y][x] === goscorer.BLACK) {
                            if (this.board[y][x] === JGOFNumericPlayerColor.BLACK) {
                                ret.black.stones += 1;
                            } else {
                                ret.black.territory += 1;
                            }
                            ret.black.scoring_positions += encodeMove(x, y);
                        } else if (scoring[y][x] === goscorer.WHITE) {
                            if (this.board[y][x] === JGOFNumericPlayerColor.WHITE) {
                                ret.white.stones += 1;
                            } else {
                                ret.white.territory += 1;
                            }
                            ret.white.scoring_positions += encodeMove(x, y);
                        }
                    }
                }
            } else {
                const scoring = goscorer.territoryScoring(this.board, this.removal);
                for (let y = 0; y < this.height; ++y) {
                    for (let x = 0; x < this.width; ++x) {
                        if (scoring[y][x].isTerritoryFor === goscorer.BLACK) {
                            ret.black.territory += 1;
                            ret.black.scoring_positions += encodeMove(x, y);
                        } else if (scoring[y][x].isTerritoryFor === goscorer.WHITE) {
                            ret.white.territory += 1;
                            ret.white.scoring_positions += encodeMove(x, y);
                        }
                    }
                }
            }
        }

        ret["black"].total =
            ret["black"].stones +
            ret["black"].territory +
            ret["black"].prisoners +
            ret["black"].handicap +
            ret["black"].komi;
        ret["white"].total =
            ret["white"].stones +
            ret["white"].territory +
            ret["white"].prisoners +
            ret["white"].handicap +
            ret["white"].komi;

        try {
            if (this.outcome && this.aga_handicap_scoring) {
                /* We used to have an AGA scoring bug where we'd give one point per
                 * handicap stone instead of per handicap stone - 1, so this check
                 * is for those games that we incorrectly scored so that our little
                 * drop down box tallies up to be "correct" for those old games
                 *   - anoek 2015-02-01
                 */
                const f = parseFloat(this.outcome);
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

    /**
     * This function migrates old config's to whatever our current standard is
     * for configs.
     */
    private static migrateConfig(config: GobanEngineConfig): GobanEngineConfig {
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

        return config;
    }
    /**
     * This function fills in default values for any missing fields in the
     * config.
     */
    public static fillDefaults(game_obj: GobanEngineConfig): GobanEngineConfig {
        if (!("phase" in game_obj)) {
            game_obj.phase = "play";
        }
        if (!("rules" in game_obj)) {
            game_obj.rules = "japanese";
        }

        const defaults: GobanEngineConfig = {};

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

        const rules = game_obj.rules || defaults.rules;

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
                // https://www.usgo-archive.org/sites/default/files/pdf/IngRules2006.pdf
                //
                // pg. 26:
                //
                // Fixed compensation: Mandatory eight points handicap, black
                // wins in case of drawn games.
                defaults.komi = 7.5;
                defaults.score_prisoners = false;
                defaults.allow_superko = false;
                defaults.superko_algorithm = "ing";
                defaults.free_handicap_placement = true;
                defaults.allow_self_capture = true;

                // https://www.cs.cmu.edu/~wjh/go/rules/KSS.html
                //
                // 2. Playing the game:
                //
                // Counting:
                //
                //     5. In handicap games of N-stone handicap, White must
                //     receive N-point compensation to make the result
                //     equivalent to territory counting. [...] In handicap
                //     games, White wins ties.
                //
                // Note that Black giving compensation in handicap games is not
                // found in any official documentation of the Ing rules. AGA
                // President Phil Straus has requested this convention so that
                // territory and area counting can give the same result in
                // handicap games.
                defaults.score_handicap = true;
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

        for (const k in defaults) {
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
                const white = "";
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
                        /* ogs had the starting stones for 2 and 3 swapped from the canonical positioning */
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
            const ogs = game_obj.ogs;
            game_obj.score.white.scoring_positions =
                (game_obj.rules !== "japanese" ? ogs.white_stones : "") + ogs.white_territory;
            game_obj.score.black.scoring_positions =
                (game_obj.rules !== "japanese" ? ogs.black_stones : "") + ogs.black_territory;
            const dead =
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
    public static clearRuleSettings(game_obj: GobanEngineConfig): GobanEngineConfig {
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
         * constructed by making a bunch of dynamic functions and chaining them
         * together.. slick or sick, depending on your PoV..  */
        const instructions: Array<() => void> = [];

        const self = this;
        let pos = 0;
        let line = 1;

        let inMainBranch = true;
        let game_tree_depth = 0;
        let farthest_move: MoveTree;
        let initial_player: "black" | "white" | undefined;

        if (sgf.charCodeAt(0) > 255) {
            /* Assume this is a Byte Order Mark */
            sgf = sgf.substr(1);
        }

        function collection() {
            const ret = [];
            while (pos < sgf.length) {
                ret.push(game_tree());
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

        function game_tree() {
            game_tree_depth++;
            if (game_tree_depth > 1) {
                inMainBranch = false;
            }

            const ret = [];
            whitespace();
            if (sgf[pos] !== "(") {
                throw new Error("Expecting '(' to start a GameTree");
            }
            ++pos;
            const s = sequence();
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

                const g = game_tree();
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
            --game_tree_depth;
            return ret;
        }

        function sequence(): Array<Array<Array<string>>> {
            whitespace();
            const ret: Array<Array<Array<string>>> = [];
            while (sgf[pos] === ";") {
                const n = node();
                ret.push(n);
            }
            if (ret.length === 0) {
                throw new Error("Expecting Sequence");
            }
            return ret;
        }

        function node(): Array<Array<string>> {
            const ret: Array<Array<string>> = [];
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
            const ret: Array<string> = [];
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
            const b = parseInt(rank);
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
                                        const mv = self.decodeMoves(val)[0];
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

                                const mv = self.decodeMoves(val)[0];
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
                    case "XX": // Legacy
                    case "MA":
                        {
                            instructions.push(() => {
                                try {
                                    const s: string = val.substr(0, 2);
                                    const extra = val.substr(3);
                                    const mv = self.decodeMoves(s)[0];
                                    //console.log(mv);

                                    const marks = self.cur_move.getMarks(mv.x, mv.y);
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
                                        case "XX": // Legacy - Old OGS SGF used XX to denote an X
                                        case "MA":
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
                                let rules: GobanEngineRules = "japanese";

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
                                /* TODO: Most of our code assumes this .winner
                                 * is a number, the player id of who won.
                                 * Except this code, we need to work our way
                                 * through what to do here. */
                                if (val.length > 0) {
                                    if (val[0].toLowerCase() === "b") {
                                        (self as any).winner = "black";
                                    }
                                    if (val[0].toLowerCase() === "w") {
                                        (self as any).winner = "white";
                                    }
                                }

                                if (self.outcome === "") {
                                    let result;
                                    const match = val.match(/[BW]\+(.*)/);
                                    if (match === null) {
                                        result = val;
                                    } else {
                                        result = match[1];
                                    }

                                    if (match !== null && /[0-9.]+/.test(result)) {
                                        // There's a numeric score.
                                        self.outcome = result;
                                    } else {
                                        if (!result) {
                                            result = "V";
                                        }
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
                        }
                        break;

                    case "WR":
                        if (self.config.players?.white) {
                            self.config.players.white.rank = parseRank(val);
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
                                const black_territory_point = self.decodeMoves(val)[0];
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
                                const white_territory_point = self.decodeMoves(val)[0];
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
    public estimateScore(
        trials: number,
        tolerance: number,
        prefer_remote: boolean = false,
        should_autoscore: boolean = false,
    ): ScoreEstimator {
        const se = new ScoreEstimator(
            this,
            this.goban_callback,
            trials,
            tolerance,
            prefer_remote,
            should_autoscore,
        );
        return se.score();
    }
    /* Returns the move by location if it exists within our current branch. If
     * include_forward_search is true, we also search forward in the tree along
     * the last selected branch. */
    public getMoveByLocation(
        x: number,
        y: number,
        include_forward_search: boolean,
    ): MoveTree | null {
        let m: MoveTree | null = null;
        let cur_move: MoveTree | null = this.cur_move;
        if (include_forward_search) {
            while (!m && cur_move) {
                if (cur_move.x === x && cur_move.y === y) {
                    m = cur_move;
                }
                cur_move = cur_move.next();
            }
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

    public parentEventEmitter?: EventEmitter<GobanEvents>;
    public override emit<K extends keyof GobanEvents>(
        event: K,
        ...args: EventEmitter.EventArgs<GobanEvents, K>
    ): boolean {
        let ret: boolean = super.emit(event, ...args);
        if (this.parentEventEmitter) {
            ret = this.parentEventEmitter.emit(event, ...args) || ret;
        }
        return ret;
    }

    public override setRemoved(
        x: number,
        y: number,
        removed: boolean,
        emit_stone_removal_updated: boolean = true,
    ): void {
        this.cur_move.state.setRemoved(x, y, removed, false);
        super.setRemoved(x, y, removed, emit_stone_removal_updated);
    }
}
