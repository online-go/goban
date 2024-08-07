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

import { GobanMoveErrorMessageId } from "../GobanError";

/**
 * JGOF (JSON Go Format) is an attempt at normalizing the AdHocFormat.
 */

export interface JGOF {
    /** JGOF version number */
    jgof: 1;

    /** Player information for those playing Black */
    black?: JGOFPlayer | Array<JGOFPlayer>;

    /** Player information for those playing White */
    white?: JGOFPlayer | Array<JGOFPlayer>;

    /** Time control settings for the game */
    time_control?: JGOFTimeControl;

    /** Current clock information, this is used for ongoing games */
    clock?: JGOFClock;

    /** AI Review information computed for this game */
    ai_reviews?: {
        [id: string]: JGOFAIReview;
    };
}

export interface JGOFIntersection {
    /** Horizontal coordinate, counting left to right, starting with zero */
    x: number;

    /** Vertical coordinate, counting top to bottom, starting with zero */
    y: number;
}

export interface JGOFSealingIntersection extends JGOFIntersection {
    /** Color the intersection is probably presumed to be by the players, but
     *  is in fact empty. */
    color: JGOFNumericPlayerColor;
}

export interface JGOFPlayer {
    /** Name or username of the player */
    name: string;

    /** Identifier for the player */
    id?: string;
}

export enum JGOFNumericPlayerColor {
    EMPTY = 0,
    BLACK = 1,
    WHITE = 2,
}

export interface JGOFPlayerSummary {
    players: {
        black: number;
        white: number;
    };
    rengo_teams: {
        black: number[];
        white: number[];
    };
    dropped_players?: {
        black?: number[];
        white?: number[];
    };
}

export interface JGOFMove extends JGOFIntersection {
    color?: JGOFNumericPlayerColor;
    timedelta?: number;
    edited?: boolean;
    played_by?: number; // player_id of person who played the move
    player_update?: JGOFPlayerSummary; // who the resulting players are after effects of this move
    // typically restricted information...
    blur?: number; // maximum time the player was not focused on the window
    // while it was their turn to make a move
    sgf_downloaded_by?: Array<number>; // Array of users who downloaded the
    // game SGF before this move was made

    /** Stone removal reasoning, primarily for debugging */
    removal_reason?: string;
}

/*********/
/* Clock */
/*********/

export interface JGOFClock {
    /** Player to move, and thus player whose clock is running. */
    current_player: "black" | "white";

    /** Player ID of player to move */
    current_player_id: string;

    /** Time the last move was made, in milliseconds since 1970, as observed by the server. */
    time_of_last_move: number;

    /** Time left on blacks clock. */
    black_clock: JGOFPlayerClock;

    /** Time left on whites clock. */
    white_clock: JGOFPlayerClock;

    /**
     * True if the game has not begun yet and we are waiting for the first
     * move to be played. If this is true, `start_time_left` will be set.
     */
    start_mode?: boolean;

    /**
     * If `start_mode` is true, this is the number of milliseconds left
     * on the start clock, when the clock reaches zero the game will be
     * canceled.
     */
    start_time_left?: number;

    /**
     * If `pause_State.stone_removal` is true, this is the number of
     * milliseconds left before the result is automatically accepted.
     */
    stone_removal_time_left?: number;

    /** Time the game was paused, in milliseconds since 1970, as observed by the server */
    paused_since?: number;

    /** If this field is set, the game clocks are paused for one or more reasons. */
    pause_state?: JGOFPauseState;
}

export interface JGOFPlayerClock {
    /** Main time left on the clock, in milliseconds. */
    main_time: number;

    /** Used with byo-yomi time control. Number of periods left. */
    periods_left?: number;

    /** Used with byo-yomi time control. Time left on the period time, in milliseconds. */
    period_time_left?: number;

    /**
     * Used with canadian time control. Number of moves left before a new
     * block of time.
     */
    moves_left?: number;

    /**
     * Used with canadian time control. Time left in milliseconds to make the
     * remainder of your moves in the current block
     */
    block_time_left?: number;
}

/* Pause control indicates if the game is currently paused for one or more reasons */
export interface JGOFPauseState {
    /** Paused because the game is in the stone removal phase */
    stone_removal?: true;

    /** Paused because one or more players is on vacation */
    vacation?: {
        /** Player id that is on vacation */
        [player_id: string]: true;
    };

    /** Paused by the server */
    server?: true;

    /** Paused because it is the weekend */
    weekend?: true;

    /** Paused by a player. The game can only be paused by one player at a time. */
    player?: {
        /** Player id of the player who paused the game. */
        player_id: string;

        /** Number of pauses left for the pausing player. */
        pauses_left: number;
    };

    /** Paused by a moderator, value of this field is the moderator's id */
    moderator?: string;
}

export type JGOFTimeControlSpeed = "blitz" | "rapid" | "live" | "correspondence";
export type JGOFTimeControlSystem =
    | "fischer"
    | "byoyomi"
    | "canadian"
    | "simple"
    | "absolute"
    | "none";

export interface JGOFFischerTimeControl {
    system: "fischer";
    speed: JGOFTimeControlSpeed;
    initial_time: number;
    time_increment: number;
    max_time: number;
    pause_on_weekends: boolean;
}
export interface JGOFByoYomiTimeControl {
    system: "byoyomi";
    speed: JGOFTimeControlSpeed;
    main_time: number;
    period_time: number;
    periods: number;
    pause_on_weekends: boolean;
}
export interface JGOFCanadianTimeControl {
    system: "canadian";
    speed: JGOFTimeControlSpeed;
    main_time: number;
    period_time: number;
    stones_per_period: number;
    pause_on_weekends: boolean;
}
export interface JGOFSimpleTimeControl {
    system: "simple";
    speed: JGOFTimeControlSpeed;
    per_move: number;
    pause_on_weekends: boolean;
}
export interface JGOFAbsoluteTimeControl {
    system: "absolute";
    speed: JGOFTimeControlSpeed;
    total_time: number;
    pause_on_weekends: boolean;
}
export interface JGOFNoneTimeControl {
    system: "none";
    speed: "correspondence";
    pause_on_weekends: boolean;
}

export type JGOFTimeControl =
    | JGOFFischerTimeControl
    | JGOFByoYomiTimeControl
    | JGOFSimpleTimeControl
    | JGOFCanadianTimeControl
    | JGOFAbsoluteTimeControl
    | JGOFNoneTimeControl;

/******/
/* AI */
/******/

export interface JGOFAIReview {
    id: string;
    uuid: string;

    /**
     * A fast review typically only has a few moves reviewed, whereas a full
     * review is expected to have every move reviewed. Note that this sets an
     * expectation but not a requirement on what values are stored in `moves`,
     * and while games are being reviewed these objects will have zero or more
     * entries in `moves` regardless of the type.
     */
    type: "fast" | "full";
    engine: string;
    engine_version: string;
    network: string;
    network_size: string;
    strength: number;

    /** millisecond epoch time (ms from 1970 UTC) */
    date: number;

    /** predicted probability that black will win the last move */
    win_rate: number;

    /** predicted probability that black will win for all moves */
    win_rates?: Array<number>;

    /** predicted scores that black will win or lose by (negative for loss) for all moves */
    scores?: Array<number>;

    /** Analysis of moves in the game. */
    moves: {
        [move_number: string]: JGOFAIReviewMove;
    };

    /** Analysis of variations in the game. */
    analyzed_variations?: {
        [var_key: string]: JGOFAIReviewMove;
    };

    /** If there was an error processing the review, it can be stored here */
    error?: {
        message_id: GobanMoveErrorMessageId;
        move_number: number;
        coords: string;
    };
}

export interface JGOFAIReviewMove {
    /**
     * The move number. This is 1 indexed.
     */
    move_number: number;

    /** The move that was played. */
    move: JGOFIntersection;

    /** Probability of black winning after this move was made */
    win_rate: number;

    /** How many points black is predicted to win by (if positive, lose by if negative) */
    score?: number;

    /** Followup move branches explored */
    branches: Array<JGOFAIReviewMoveVariation>;

    /** A width*height array of ownership values */
    ownership?: Array<Array<number>>;
}

export interface JGOFAIReviewMoveVariation {
    /** Followup predicted moves by the AI */
    moves: Array<JGOFIntersection>;

    /** Probability of black wining to report for this variation */
    win_rate: number;

    /** How many points black is predicted to win for this variation (or lose by if negative) */
    score?: number;

    /** Number of times the AI considered the first move of this variation */
    visits: number;

    /** lower confidence bound, both KataGo and LeelaZero provide this */
    lcb?: number;

    /** From KataGo */
    score_mean?: number;

    /** From KataGo */
    score_stdev?: number;

    /** From KataGo */
    utility?: number;

    /** From KataGo */
    utility_lcb?: number;

    /** From Leela Zero */
    policy?: number;
}
