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

import { JGOFAIReview, JGOFIntersection, JGOFNumericPlayerColor } from './JGOF';
import { MoveTree } from './MoveTree';


export interface AIReviewWorstMoveEntry {
    player:JGOFNumericPlayerColor;
    delta:number;
    move_number:number;
    move:JGOFIntersection;
}

/**
 * Returns a list of all moves in the game, sorted by the negative change
 * in winrate for the player that made the move. So the first entry will be the
 * worst move in the game according to the ai.
 */
export function computeWorstMoves(starting_move:MoveTree, ai_review:JGOFAIReview):Array<AIReviewWorstMoveEntry> {
    let ret:Array<AIReviewWorstMoveEntry> = [];
    let cur_move = starting_move;

    if (ai_review.win_rates === undefined) {
        return [];
    }

    while (cur_move.trunk_next) {
        let next_move = cur_move.trunk_next;

        let cur_win_rate = ai_review.win_rates[cur_move.move_number] || 0.5;
        let next_win_rate = ai_review.win_rates[next_move.move_number] || 0.5;

        let delta:number = next_move.player === JGOFNumericPlayerColor.WHITE
            ? (cur_win_rate) - (next_win_rate)
            : (next_win_rate) - (cur_win_rate);

        ret.push({
            player: next_move.player,
            delta: delta,
            move_number: next_move.move_number,
            move: {
                x: next_move.x,
                y: next_move.y
            }
        });

        cur_move = next_move;
    }

    ret.sort((a, b) => a.delta - b.delta);

    return ret;
}
