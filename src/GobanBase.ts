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
    GobanEngineConfig,
    GobanEnginePhase,
    GobanEngineRules,
    PlayerColor,
    PuzzleConfig,
    PuzzlePlacementSetting,
} from "./engine";
import { MoveTree, MoveTreePenMarks } from "./engine/MoveTree";
import { ScoreEstimator } from "./engine/ScoreEstimator";
import { setGobanTranslations } from "./engine/translate";
import {
    JGOFClock,
    JGOFIntersection,
    JGOFTimeControl,
    JGOFPlayerClock,
    JGOFTimeControlSystem,
    JGOFPlayerSummary,
    JGOFSealingIntersection,
    JGOFNumericPlayerColor,
    JGOFMove,
} from "./engine/formats/JGOF";
import { AdHocPackedMove, AdHocPauseControl } from "./engine/formats/AdHocFormat";
import { MessageID } from "./engine/messages";
import type { GobanSocket } from "./engine/GobanSocket";
import type { ServerToClient, GameChatLine } from "./engine/protocol";
import { EventEmitter } from "eventemitter3";
import { setGobanCallbacks } from "./Goban/callbacks";

let last_goban_id = 0;

export type GobanModes = "play" | "puzzle" | "score estimation" | "analyze" | "conditional";

export type AnalysisTool = "stone" | "draw" | "label" | "score" | "removal";
export type AnalysisSubTool =
    | "black"
    | "white"
    | "alternate"
    | "letters"
    | "numbers"
    | string /* label character(s) */;

export interface GobanBounds {
    top: number;
    left: number;
    right: number;
    bottom: number;
}

export type GobanChatLog = Array<GameChatLine>;

export interface GobanConfig extends GobanEngineConfig, PuzzleConfig {
    display_width?: number;

    interactive?: boolean;
    mode?: GobanModes;
    square_size?: number | ((goban: GobanBase) => number) | "auto";

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
    dont_show_messages?: boolean;
    last_move_radius?: number;
    circle_radius?: number;
    one_click_submit?: boolean;
    double_click_submit?: boolean;
    variation_stone_opacity?: number;
    stone_font_scale?: number;

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
    server_socket?: GobanSocket;
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

export interface JGOFClockWithTransmitting extends JGOFClock {
    black_move_transmitting: number; // estimated ms left for transmission, or 0 if complete
    white_move_transmitting: number; // estimated ms left for transmission, or 0 if complete
}

export interface StateUpdateEvents {
    mode: (d: GobanModes) => void;
    title: (d: string) => void;
    phase: (d: GobanEnginePhase) => void;
    cur_move: (d: MoveTree) => void;
    cur_review_move: (d: MoveTree | undefined) => void;
    last_official_move: (d: MoveTree) => void;
    submit_move: (d: (() => void) | undefined) => void;
    analyze_tool: (d: AnalysisTool) => void;
    analyze_subtool: (d: AnalysisSubTool) => void;
    score_estimate: (d: ScoreEstimator | null) => void;
    strict_seki_mode: (d: boolean) => void;
    rules: (d: GobanEngineRules) => void;
    winner: (d: number | undefined) => void;
    undo_requested: (d: number | undefined) => void; // move number of the last undo request
    undo_canceled: () => void;
    paused: (d: boolean) => void;
    outcome: (d: string) => void;
    review_owner_id: (d: number | undefined) => void;
    review_controller_id: (d: number | undefined) => void;
    stalling_score_estimate: ServerToClient["game/:id/stalling_score_estimate"];
}

export interface GobanEvents extends StateUpdateEvents {
    "destroy": () => void;
    "update": () => void;
    "chat-reset": () => void;
    "error": (d: any) => void;
    "gamedata": (d: any) => void;
    "chat": (d: any) => void;
    "engine.updated": (engine: GobanEngine) => void;
    "load": (config: GobanConfig) => void;
    "show-message": (message: {
        formatted: string;
        message_id: string;
        parameters?: { [key: string]: any };
    }) => void;
    "clear-message": () => void;
    "submitting-move": (tf: boolean) => void;
    "chat-remove": (ids: { chat_ids: Array<string> }) => void;
    "move-made": () => void;
    "player-update": (player: JGOFPlayerSummary) => void;
    "played-by-click": (player: { player_id: number; x: number; y: number }) => void;
    "review.sync-to-current-move": () => void;
    "review.updated": () => void;
    "review.load-start": () => void;
    "review.load-end": () => void;
    "puzzle-wrong-answer": () => void;
    "puzzle-correct-answer": () => void;
    "state_text": (state: { title: string; show_moves_made_count?: boolean }) => void;
    "advance-to-next-board": () => void;
    "auto-resign": (obj: { game_id: number; player_id: number; expiration: number }) => void;
    "clear-auto-resign": (obj: { game_id: number; player_id: number }) => void;
    "set-for-removal": { x: number; y: number; removed: boolean };
    "captured-stones": (obj: { removed_stones: Array<JGOFIntersection> }) => void;
    "stone-removal.accepted": () => void;
    "stone-removal.updated": () => void;
    "stone-removal.needs-sealing": (positions: undefined | JGOFSealingIntersection[]) => void;
    "stone-removal.auto-scoring-started": () => void;
    "stone-removal.auto-scoring-complete": () => void;
    "conditional-moves.updated": () => void;
    "puzzle-place": (obj: {
        x: number;
        y: number;
        width: number;
        height: number;
        color: "black" | "white";
    }) => void;
    "clock": (clock: JGOFClockWithTransmitting | null) => void;
    "audio-game-started": (obj: {
        /**  Player to move */
        player_id: number;
    }) => void;
    "audio-game-ended": (winner: "black" | "white" | "tie") => void;
    "audio-pass": () => void;
    "audio-stone": (obj: {
        x: number;
        y: number;
        width: number;
        height: number;
        color: "black" | "white";
    }) => void;
    "audio-other-player-disconnected": (obj: { player_id: number }) => void;
    "audio-other-player-reconnected": (obj: { player_id: number }) => void;
    "audio-clock": (event: AudioClockEvent) => void;
    "audio-disconnected": () => void; // your connection has been lost to the server
    "audio-reconnected": () => void; // your connection has been reestablished
    "audio-capture-stones": (obj: {
        count: number /* number of stones we just captured */;
        already_captured: number /* number of stones that have already been captured by this player */;
    }) => void;
    "audio-game-paused": () => void;
    "audio-game-resumed": () => void;
    "audio-enter-stone-removal": () => void;
    "audio-resume-game-from-stone-removal": () => void;
    "audio-undo-requested": () => void;
    "audio-undo-granted": () => void;
}

/**
 * Goban serves as a base class for our renderers as well as a namespace for various
 * classes, types, and enums.
 *
 * You can't create an instance of a Goban directly, you have to create an instance of
 * one of the renderers, such as GobanSVG.
 */

export abstract class GobanBase extends EventEmitter<GobanEvents> {
    /* Static functions */
    static setTranslations = setGobanTranslations;
    static setCallbacks = setGobanCallbacks;

    /**  Base fields **/
    public readonly goban_id = ++last_goban_id;

    private _destroyed = false;
    public get destroyed(): boolean {
        return this._destroyed;
    }

    /* The rest of these fields are for subclasses of Goban, namely used by the renderers */
    public abstract engine: GobanEngine;

    public abstract enablePen(): void;
    public abstract disablePen(): void;
    public abstract clearAnalysisDrawing(): void;
    public abstract drawPenMarks(pen_marks: MoveTreePenMarks): void;
    public abstract showMessage(
        msg_id: MessageID,
        parameters?: { [key: string]: any },
        timeout?: number,
    ): void;
    public abstract clearMessage(): void;
    public abstract drawSquare(i: number, j: number): void;
    public abstract redraw(force_clear?: boolean): void;
    public abstract move_tree_redraw(no_warp?: boolean): void;
    /* Because this is used on the server side too, we can't have the HTMLElement
     * type here. */
    public abstract setMoveTreeContainer(container: any /* HTMLElement */): void;

    /** Called by engine when a location has been set to a color. */
    public abstract set(x: number, y: number, player: JGOFNumericPlayerColor): void;
    /** Called when a location is marked or unmarked for removal */
    public abstract setForRemoval(
        x: number,
        y: number,
        removed: boolean,
        emit_stone_removal_updated: boolean,
    ): void;
    /** Called when Engine.setState loads a previously saved board state. */
    public abstract setState(): void;

    public abstract updateScoreEstimation(): void;

    constructor() {
        super();
    }

    public destroy() {
        this.emit("destroy");
        this._destroyed = true;
        this.engine.removeAllListeners();
        this.removeAllListeners();
    }

    /**
     *  Decodes any of the various ways we express moves that we've accumulated over the years into
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
        return this.engine.decodeMoves(move_obj);
    }

    /* Encodes a move list like `[{x: 0, y: 0}, {x:1, y:2}]` into our move string
     * format `"aabc"` */
    public encodeMoves(lst: JGOFMove[]): string {
        return this.engine.encodeMoves(lst);
    }

    /* Encodes a single move `{x:1, y:2}` into our move string
     * format `"bc"` */
    public encodeMove(lst: JGOFMove): string {
        return this.engine.encodeMove(lst);
    }

    /** Encodes an x,y pair or a move object like {x: 0, y: 0} into a move string like "A1" */
    public prettyCoordinates(x: JGOFMove): string;
    public prettyCoordinates(x: number, y: number): string;
    public prettyCoordinates(x: number | JGOFMove, y?: number): string {
        return this.engine.prettyCoordinates(x as any, y as any);
    }

    /**
     * Decodes a move string like `"A11"` into a move object like `{x: 0, y: 10}`. Also
     * handles the special cases like `".."` and "pass" which map to `{x: -1, y: -1}`.
     */
    public decodePrettyCoordinates(coordinates: string): JGOFMove {
        return this.engine.decodePrettyCoordinates(coordinates);
    }

    /** True if the game is a game record of a real life game */
    public get is_game_record(): boolean {
        return this.engine.is_game_record;
    }
}
