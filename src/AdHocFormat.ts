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

import { JGOFTimeControl, JGOFNumericPlayerColor } from "./JGOF";

/**
 * The to-be-deprecated format used by Online-Go.com, will be replaced by JGOF
 * as we develop a migration plan
 */

export interface AdHocFormat {
    black: AdHocPlayer;
    white: AdHocPlayer;
    clock: AdHocClock;
    time_control: JGOFTimeControl;
    pause_control: AdHocPauseControl;
}

export interface AdHocPlayer {
    name: string;
    id: number;
}

export type AdHocPackedMove = [
    number /* x */,
    number /* y */,
    number? /* time delta */,
    JGOFNumericPlayerColor? /* color */,
    { [index: string]: any }? /* extra */,
];

export interface AdHocClock {
    /** OGS Game id */
    game_id: number;

    /** Current player to move */
    current_player: number;

    /** OGS player id for black */
    black_player_id: number;

    /** OGS player id for white */
    white_player_id: number;

    /** Title of the game. This field will be removed. */
    title: string;

    /** Time the last move was made, in milliseconds since 1970 */
    last_move: number;

    /** Time the game will end if no move is played, in milliseconds since
     *  1970.  This is computed by adding together any main and overtime left
     *  on the clock. If start_mode is set, this is the number of milliseconds
     *  left on the start clock.
     */
    expiration: number;

    /** Time left on black's clock. If this is a number (such as is the case
     *  with simple time), it is expressed in milliseconds. */
    black_time: AdHocPlayerClock | number;

    /** Time left on white's clock. If this is a number (such as is the case
     *  with simple time), it is expressed in milliseconds.k */
    white_time: AdHocPlayerClock | number;

    /** Current server time, in milliseconds since 1970 */
    //now:number;

    /** Time the game was paused. This field erroneously exists even after the
     *  game has been resumed, this will be removed in these cases. */
    paused_since?: number;

    /** If true, the game has not started and this is the count down until
     *  the game is canceled if a move has not been played yet. If this is
     *  true, then the duration left on the start clock is stored in
     *  `expiration` (in ms) */
    start_mode?: boolean;

    /** If set, this AdHocClock is updating the pause state */
    pause?: {
        paused: boolean;
        paused_since: number;
        pause_control: AdHocPauseControl;
    };
}

export interface AdHocPlayerClock {
    /** Thinking time left, in seconds. Also used as main time for byo-yomi and
     *  canadian clocks. */
    thinking_time: number;

    /** Used with fischer time control to denote that the next move should not
     *  increment the clock. */
    skip_bonus?: boolean;

    /** Used with byo-yomi time control. Number of periods left. */
    periods?: number;

    /** Used with byo-yomi time control. Length of each period, in seconds. */
    period_time?: number;

    /** Used with canadian time control. Number of moves left before a new
     *  block of time. */
    moves_left?: number;

    /** Used with canadian time control. Time left (in seconds) to make the
     *  remainder of your moves in yu */
    block_time?: number;
}

export interface AdHocPauseControl {
    "stone-removal"?: true;
    "weekend"?: true;
    "system"?: true;
    "paused"?: {
        pausing_player_id: number;
        pauses_left: number;
    };
    "moderator_paused"?: {
        moderator_id: number;
    };
    [
        vacation: string
    ]: any /* This is a string in the format of "vacation-${player_id}", it is always true - the any here is to make typescript happy with object and undefined possible values */;
}
