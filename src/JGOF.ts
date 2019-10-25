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



/**
 * JSON Go Format
 */

export interface JGOF {
    /** */
    black: JGOFPlayer | Array<JGOFPlayer>;
    white: JGOFPlayer | Array<JGOFPlayer>;
    time_control: JGOFTimeControl;
    clock: JGOFClock;
}

export interface JGOFPlayer {
    name: string;
    user_id?: string;
}

export interface JGOFClock {
    /** Player to move, and thus player whose clock is running. */
    current_player: "black" | "white";

    /** Player ID of player to move */
    current_player_id: string;

    /** Time the last move was made, in milliseconds since 1970, as observed by the server. */
    time_of_last_move:number;

    /** Time left on blacks clock. */
    black_clock: JGOFPlayerClock;

    /** Time left on whites clock. */
    white_clock: JGOFPlayerClock;

    /** True if the game has not begun yet and we are waiting for the first
     *  move to be played. If this is true, `start_time_left` will be set. */
    start_mode?:boolean;

    /** If `start_mode` is true, this is the number of milliseconds left
     *  on the start clock, when the clock reaches zero the game will be
     *  canceled. */
    start_time_left?:number;

    /** If `puase_State.stone_removal` is true, this is the number of
     * milliseconds left before the result is automatically accepted.
     */
    stone_removal_time_left?:number;

    /** Time the game was paused, in milliseconds since 1970, as observed by the server */
    paused_since?:number;

    /** If this field is set, the game clocks are paused for one or more reasons. */
    pause_state?: JGOFPauseState;
}

export interface JGOFPlayerClock {
    /** Main time left on the clock, in milliseconds. */
    main_time:number;

    /** Used with byo-yomi time control. Number of periods left. */
    periods_left?: number;

    /** Used with byo-yomi time control. Time left on the period time, in milliseconds. */
    period_time_left?: number;

    /** Used with canadian time control. Number of moves left before a new
     *  block of time. */
    moves_left?: number;

    /** Used with canadian time control. Time left in milliseconds to make the
     * remainder of your moves in the current block */
    block_time_left?: number;
}


/* Pause control indicates if the game is currently paused for one or more reasons */
export interface JGOFPauseState {
    /** Paused because the game is in the stone removal phase */
    stone_removal?: true;

    /** Paused because one or more players is on vacation */
    vacation?: {
        /** Player id that is on vacation */
        [player_id:string]: true;
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

export type JGOFTimeControlSpeed = "blitz" | "live" | "correspondence";
export type JGOFTimeControlSystem = "fischer" | "byoyomi" | "canadian" | "simple" | "absolute" | "none";

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
      JGOFFischerTimeControl
    | JGOFByoYomiTimeControl
    | JGOFSimpleTimeControl
    | JGOFCanadianTimeControl
    | JGOFAbsoluteTimeControl
    | JGOFNoneTimeControl;
