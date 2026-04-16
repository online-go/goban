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
    const speed: JGOFTimeControlSpeed = estimateSpeed(main_time_ms);

    // Canadian: "15/300 Canadian" — stones_per_period/period_time
    const canadian = ot.match(/^(\d+)\/(\d+(?:\.\d+)?)\s+canadian$/i);
    if (canadian) {
        return {
            system: "canadian",
            speed,
            main_time: main_time_ms,
            stones_per_period: parseInt(canadian[1]),
            period_time: parseFloat(canadian[2]) * 1000,
            pause_on_weekends: false,
        };
    }

    // Fischer: "30 Fischer" — time_increment in seconds
    const fischer = ot.match(/^(\d+(?:\.\d+)?)\s+fischer$/i);
    if (fischer) {
        const increment = parseFloat(fischer[1]) * 1000;
        return {
            system: "fischer",
            speed,
            initial_time: main_time_ms,
            time_increment: increment,
            max_time: main_time_ms * 2 || increment * 20,
            pause_on_weekends: false,
        };
    }

    // Byoyomi: "5x30 byo-yomi" — periods x period_time
    const byoyomi = ot.match(/^(\d+)x(\d+(?:\.\d+)?)\s+byo-?yomi$/i);
    if (byoyomi) {
        return {
            system: "byoyomi",
            speed,
            main_time: main_time_ms,
            periods: parseInt(byoyomi[1]),
            period_time: parseFloat(byoyomi[2]) * 1000,
            pause_on_weekends: false,
        };
    }

    // Simple: "60 simple" — per_move in seconds
    const simple = ot.match(/^(\d+(?:\.\d+)?)\s+simple$/i);
    if (simple) {
        return {
            system: "simple",
            speed,
            per_move: parseFloat(simple[1]) * 1000,
            pause_on_weekends: false,
        };
    }

    return null;
}

function estimateSpeed(main_time_ms: number): JGOFTimeControlSpeed {
    if (main_time_ms <= 5 * 60 * 1000) {
        return "blitz";
    }
    if (main_time_ms <= 15 * 60 * 1000) {
        return "live";
    }
    if (main_time_ms <= 3600 * 1000) {
        return "rapid";
    }
    return "correspondence";
}
