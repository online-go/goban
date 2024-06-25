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

import type { JGOFTimeControl } from "../formats";

/**
 * Compute the expected average time per move for a given time control.
 */

export function computeAverageMoveTime(
    time_control: JGOFTimeControl,
    w?: number,
    h?: number,
): number {
    if (typeof time_control !== "object" || time_control === null) {
        console.error(
            `computeAverageMoveTime passed ${time_control} instead of a time_control object`,
        );
        return time_control;
    }
    const moves = w && h ? averageMovesPerGame(w, h) / 2 : 90;

    try {
        let t: number;
        switch (time_control.system) {
            case "fischer":
                t = time_control.initial_time / moves + time_control.time_increment;
                break;
            case "byoyomi":
                t = time_control.main_time / moves + time_control.period_time;
                break;
            case "simple":
                t = time_control.per_move;
                break;
            case "canadian":
                t =
                    time_control.main_time / moves +
                    time_control.period_time / time_control.stones_per_period;
                break;
            case "absolute":
                t = time_control.total_time / moves;
                break;
            case "none":
                t = 0;
                break;
        }
        return Math.round(t);
    } catch (err) {
        console.error("Error computing average move time for time control: ", time_control);
        console.error(err);
        return 60;
    }
}
/**
 * Rough estimate of the average number of moves in a game based on height on
 * and width. See discussion here:
 * https://forums.online-go.com/t/average-game-length-on-different-board-sizes/35042/11
 */
function averageMovesPerGame(w: number, h: number): number {
    return Math.round(0.7 * w * h);
}
