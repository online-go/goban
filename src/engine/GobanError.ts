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

export type GobanErrorMessageId = GobanMoveErrorMessageId | GobanIOErrorMessageId;
export type GobanErrorMessageObject = GobanMoveErrorMessageObject | GobanIOErrorMessageObject;

export type GobanIOErrorMessageId = "failed_to_load_sgf";

export type GobanMoveErrorMessageId =
    | "stone_already_placed_here"
    | "illegal_self_capture"
    | "illegal_ko_move"
    | "illegal_board_repetition"
    | "move_error"; // generic

export interface GobanIOErrorMessageObject {
    message_id: GobanIOErrorMessageId;
    url: string;
}

export interface GobanMoveErrorMessageObject {
    message_id: GobanMoveErrorMessageId;
    move_number: number;
    coords: string;
}

export class GobanError extends Error {
    constructor(message?: string) {
        super(message); // 'Error' breaks prototype chain here
        Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    }
}

export class GobanMoveError extends GobanError {
    game_id: number;
    move_number: number;
    coords: string;
    message_id: GobanMoveErrorMessageId;

    constructor(
        game_id: number,
        move_number: number,
        coords: string,
        message_id: GobanMoveErrorMessageId,
    ) {
        super(`Move error in ${game_id} on move number ${move_number} at ${coords}: ${message_id}`);

        this.game_id = game_id;
        this.move_number = move_number;
        this.coords = coords;
        this.message_id = message_id;
    }
}
