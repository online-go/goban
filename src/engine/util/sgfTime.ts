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
import { computeAverageMoveTime } from "./computeAverageMoveTime";

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
        if (stones_per_period <= 0 || period_time <= 0) {
            return null;
        }
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "live",
            main_time: main_time_ms,
            stones_per_period,
            period_time,
            pause_on_weekends: false,
        };
        tc.speed = computeTimeControlSpeed(tc);
        return tc;
    }

    // Fischer: "30 Fischer" — time_increment in seconds
    const fischer = cleaned.match(/^(\d+(?:\.\d+)?)\s+fischer$/i);
    if (fischer) {
        const increment = parseFloat(fischer[1]) * 1000;
        if (increment <= 0) {
            return null;
        }
        // SGF doesn't specify a max_time cap; use the larger of 2x main time
        // or ~20 moves of increments as a reasonable playable ceiling.
        const tc: JGOFTimeControl = {
            system: "fischer",
            speed: "live",
            initial_time: main_time_ms,
            time_increment: increment,
            max_time: Math.max(main_time_ms * 2, increment * 20),
            pause_on_weekends: false,
        };
        tc.speed = computeTimeControlSpeed(tc);
        return tc;
    }

    // Byoyomi: "5x30 byo-yomi" — periods x period_time
    const byoyomi = cleaned.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s+byo-?yomi$/i);
    if (byoyomi) {
        const periods = parseInt(byoyomi[1]);
        const period_time = parseFloat(byoyomi[2]) * 1000;
        if (periods <= 0 || period_time <= 0) {
            return null;
        }
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "live",
            main_time: main_time_ms,
            periods,
            period_time,
            pause_on_weekends: false,
        };
        tc.speed = computeTimeControlSpeed(tc);
        return tc;
    }

    // Simple: "60 simple" — per_move in seconds.
    // JGOFSimpleTimeControl has no main_time field, so main_time_ms is
    // intentionally discarded here and by the TM handler's ordering logic.
    const simple = cleaned.match(/^(\d+(?:\.\d+)?)\s+simple$/i);
    if (simple) {
        const per_move = parseFloat(simple[1]) * 1000;
        if (per_move <= 0) {
            return null;
        }
        const tc: JGOFTimeControl = {
            system: "simple",
            speed: "live",
            per_move,
            pause_on_weekends: false,
        };
        tc.speed = computeTimeControlSpeed(tc);
        return tc;
    }

    return null;
}

/**
 * Classify a per-move time (in milliseconds) into a speed category.
 * Thresholds mirror the server's `getGameSpeed`:
 *   blitz:          0 < tpm < 10s
 *   live:           10s <= tpm < 3600s
 *   correspondence: tpm >= 3600s or tpm == 0
 */
export function estimateSpeed(time_per_move_ms: number): JGOFTimeControlSpeed {
    const tpm = time_per_move_ms / 1000;
    if (tpm > 0 && tpm < 10) {
        return "blitz";
    }
    if (tpm >= 10 && tpm < 3600) {
        return "live";
    }
    return "correspondence";
}

/**
 * Compute the speed category from a complete JGOFTimeControl, based on
 * expected time-per-move rather than total budget. Mirrors the server's
 * `calculate_average_move_time` + `getGameSpeed` pairing.
 */
export function computeTimeControlSpeed(
    tc: JGOFTimeControl,
    width?: number,
    height?: number,
): JGOFTimeControlSpeed {
    if (tc.system === "none") {
        return "correspondence";
    }
    return estimateSpeed(computeAverageMoveTime(tc, width, height));
}
