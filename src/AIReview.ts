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
 *
 * @param starting_move - The root of the move tree.
 * @param ai_review - Corresponding AI Review.
 * @param use_score - If true, this function uses score as the metric for
 *     determining the worst moves, rather than win rate. This is useful for
 *     handicap games where the winrate is 100% for a large portion of the game.
 */
export function computeWorstMoves(starting_move:MoveTree,
                                  ai_review:JGOFAIReview,
                                  use_score = false):Array<AIReviewWorstMoveEntry> {
    let ret:Array<AIReviewWorstMoveEntry> = [];
    let cur_move = starting_move;

    const metric_array = use_score ? ai_review.scores : ai_review.win_rates;
    const DEFAULT_VALUE = use_score ? 0.0 : 0.5;

    if (metric_array === undefined) {
        return [];
    }

    while (cur_move.trunk_next) {
        let next_move = cur_move.trunk_next;

        let cur_win_rate = metric_array[cur_move.move_number] || DEFAULT_VALUE;
        let next_win_rate = metric_array[next_move.move_number] || DEFAULT_VALUE;

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
