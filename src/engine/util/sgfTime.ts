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

import { JGOFTimeControl, JGOFTimeControlSpeed } from "../formats/JGOF";

/**
 * Parses an SGF OT (overtime) property string into a partial JGOFTimeControl.
 *
 * Recognized formats:
 *   Canadian:  "15/300 Canadian"
 *   Fischer:   "30 Fischer"
 *   Byoyomi:   "5x30 byo-yomi"
 *   Simple:    "60 simple"
 *
 * @param ot The OT property value from an SGF file
 * @param main_time_ms Main time in milliseconds (from TM property), used to
 *                     populate required fields on the time control object
 * @returns A JGOFTimeControl if the format is recognized, or null otherwise
 */
export function parseSGFOvertime(ot: string, main_time_ms: number = 0): JGOFTimeControl | null {
    const cleaned = ot.trim();

    // Canadian: "15/300 Canadian" — stones_per_period/period_time
    const canadian = cleaned.match(/^(\d+)\/(\d+(?:\.\d+)?)\s+canadian$/i);
    if (canadian) {
        const stones_per_period = parseInt(canadian[1]);
        const period_time = parseFloat(canadian[2]) * 1000;
        if (stones_per_period <= 0) {
            return null;
        }
        return {
            system: "canadian",
            speed: estimateSpeed(main_time_ms + period_time / stones_per_period),
            main_time: main_time_ms,
            stones_per_period,
            period_time,
            pause_on_weekends: false,
        };
    }

    // Fischer: "30 Fischer" — time_increment in seconds
    const fischer = cleaned.match(/^(\d+(?:\.\d+)?)\s+fischer$/i);
    if (fischer) {
        const increment = parseFloat(fischer[1]) * 1000;
        return {
            system: "fischer",
            speed: estimateSpeed(main_time_ms + increment),
            initial_time: main_time_ms,
            time_increment: increment,
            max_time: Math.max(main_time_ms * 2, increment * 20),
            pause_on_weekends: false,
        };
    }

    // Byoyomi: "5x30 byo-yomi" — periods x period_time
    const byoyomi = cleaned.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s+byo-?yomi$/i);
    if (byoyomi) {
        const periods = parseInt(byoyomi[1]);
        const period_time = parseFloat(byoyomi[2]) * 1000;
        return {
            system: "byoyomi",
            speed: estimateSpeed(main_time_ms + periods * period_time),
            main_time: main_time_ms,
            periods,
            period_time,
            pause_on_weekends: false,
        };
    }

    // Simple: "60 simple" — per_move in seconds
    const simple = cleaned.match(/^(\d+(?:\.\d+)?)\s+simple$/i);
    if (simple) {
        const per_move = parseFloat(simple[1]) * 1000;
        return {
            system: "simple",
            speed: estimateSpeed(per_move),
            per_move,
            pause_on_weekends: false,
        };
    }

    return null;
}

/**
 * Estimate the speed category from total available time in milliseconds.
 */
export function estimateSpeed(total_time_ms: number): JGOFTimeControlSpeed {
    if (total_time_ms <= 5 * 60 * 1000) {
        return "blitz";
    }
    if (total_time_ms <= 15 * 60 * 1000) {
        return "rapid";
    }
    if (total_time_ms <= 3600 * 1000) {
        return "live";
    }
    return "correspondence";
}

/**
 * Compute the speed category from a complete JGOFTimeControl object,
 * considering both main time and overtime components.
 */
export function computeTimeControlSpeed(tc: JGOFTimeControl): JGOFTimeControlSpeed {
    switch (tc.system) {
        case "canadian": {
            const per_move =
                tc.stones_per_period > 0 ? tc.period_time / tc.stones_per_period : tc.period_time;
            return estimateSpeed(tc.main_time + per_move);
        }
        case "fischer":
            return estimateSpeed(tc.initial_time + tc.time_increment);
        case "byoyomi":
            return estimateSpeed(tc.main_time + tc.periods * tc.period_time);
        case "simple":
            return estimateSpeed(tc.per_move);
        case "absolute":
            return estimateSpeed(tc.total_time);
        case "none":
            return "correspondence";
    }
}
