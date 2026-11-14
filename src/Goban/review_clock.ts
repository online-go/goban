/*
 * Copyright (C)  Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Clock arithmetic for review and demo board clocks. Clocks are
 * JGOFPlayerClock (ms); time controls are JGOFTimeControl (seconds). This is
 * deliberately separate from the live game clock code.
 */

import type { JGOFPlayerClock, JGOFTimeControl } from "../engine/formats/JGOF";
import type { MoveTree } from "../engine/MoveTree";

/** The clock set for `color` on `node` or the nearest node before it */
export function findClock(
    node: MoveTree | null,
    color: "black" | "white",
): JGOFPlayerClock | undefined {
    for (let cur = node; cur; cur = cur.parent) {
        const clock = cur[`${color}_clock`];
        if (clock) {
            return clock;
        }
    }
    return undefined;
}

/** Each player's clock before their first move, or undefined with no time control */
export function startingClock(tc: JGOFTimeControl): JGOFPlayerClock | undefined {
    switch (tc.system) {
        case "fischer":
            return { main_time: tc.initial_time * 1000 };
        case "byoyomi":
            return tc.main_time > 0
                ? { main_time: tc.main_time * 1000 }
                : {
                      main_time: 0,
                      periods_left: tc.periods,
                      period_time_left: tc.period_time * 1000,
                  };
        case "canadian":
            return tc.main_time > 0
                ? { main_time: tc.main_time * 1000 }
                : {
                      main_time: 0,
                      moves_left: tc.stones_per_period,
                      block_time_left: tc.period_time * 1000,
                  };
        case "simple":
            return { main_time: tc.per_move * 1000 };
        case "absolute":
            return { main_time: tc.total_time * 1000 };
        default:
            return undefined;
    }
}

/** `clock` after `elapsed_ms` of thinking, with no move made. Stops at zero. */
export function runClock(
    clock: JGOFPlayerClock,
    elapsed_ms: number,
    tc: JGOFTimeControl,
): JGOFPlayerClock {
    if (elapsed_ms <= clock.main_time) {
        return { ...clock, main_time: clock.main_time - elapsed_ms };
    }
    let overtime = elapsed_ms - clock.main_time;

    if (tc.system === "byoyomi") {
        const period_ms = tc.period_time * 1000;
        let periods_left = clock.periods_left ?? tc.periods;
        let period_left = clock.period_time_left ?? period_ms;
        while (periods_left > 0 && overtime >= period_left) {
            overtime -= period_left;
            periods_left -= 1;
            period_left = period_ms;
        }
        if (periods_left <= 0) {
            return { main_time: 0, periods_left: 0, period_time_left: 0 };
        }
        return { main_time: 0, periods_left, period_time_left: period_left - overtime };
    }

    if (tc.system === "canadian") {
        const block = clock.block_time_left ?? tc.period_time * 1000;
        return {
            main_time: 0,
            moves_left: clock.moves_left ?? tc.stones_per_period,
            block_time_left: Math.max(0, block - overtime),
        };
    }

    return { main_time: 0 };
}

/** The mover's clock after a move made `elapsed_ms` into their turn */
export function clockAfterMove(
    clock: JGOFPlayerClock,
    elapsed_ms: number,
    tc: JGOFTimeControl,
): JGOFPlayerClock {
    const after = runClock(clock, elapsed_ms, tc);
    switch (tc.system) {
        case "fischer":
            return {
                main_time: Math.min(tc.max_time * 1000, after.main_time + tc.time_increment * 1000),
            };
        case "simple":
            return { main_time: tc.per_move * 1000 };
        case "byoyomi":
            if (after.main_time === 0 && (after.periods_left ?? tc.periods) > 0) {
                return {
                    main_time: 0,
                    periods_left: after.periods_left ?? tc.periods,
                    period_time_left: tc.period_time * 1000,
                };
            }
            return after;
        case "canadian":
            if (after.main_time === 0) {
                const moves_left = (after.moves_left ?? tc.stones_per_period) - 1;
                return moves_left > 0
                    ? {
                          main_time: 0,
                          moves_left,
                          block_time_left: after.block_time_left ?? tc.period_time * 1000,
                      }
                    : {
                          main_time: 0,
                          moves_left: tc.stones_per_period,
                          block_time_left: tc.period_time * 1000,
                      };
            }
            return after;
        default:
            return after;
    }
}
