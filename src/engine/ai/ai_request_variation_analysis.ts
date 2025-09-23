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
import { protocol } from "..";
import { GobanSocket } from "../GobanSocket";
import { MoveTree } from "../MoveTree";

const analysis_requests_made: { [id: string]: boolean } = {};

export function ai_request_variation_analysis(
    ai_socket: GobanSocket<protocol.ClientToAIServer, protocol.AIServerToClient>,
    uuid: string,
    game_id: number,
    ai_review_id: number,
    cur_move: MoveTree,
    trunk_move: MoveTree,
): void {
    if (!ai_socket?.connected) {
        console.warn(
            "Not sending request for variation analysis since we weren't connected to the AI server",
        );
        return;
    }

    const trunk_move_string = trunk_move.getMoveStringToThisPoint();
    const cur_move_string = cur_move.getMoveStringToThisPoint();
    const variation = cur_move_string.slice(trunk_move_string.length);

    if (trunk_move_string.includes("undefined")) {
        console.error("Trunk move string includes undefined", trunk_move_string);
    } else if (cur_move_string.includes("undefined")) {
        console.error("Current move string includes undefined", cur_move_string);
    } else if (variation.includes("undefined")) {
        console.error("Variation includes undefined", variation);
    } else {
        console.log("Sending request for variation analysis", variation);
    }

    const key = `${uuid}-${game_id}-${ai_review_id}-${trunk_move.move_number}-${variation}`;
    if (key in analysis_requests_made) {
        return;
    }
    analysis_requests_made[key] = true;

    const req = {
        uuid: uuid,
        game_id: game_id,
        ai_review_id: ai_review_id,
        from: trunk_move.move_number,
        variation: variation,
    };
    ai_socket?.send("ai-analyze-variation", req);
}
