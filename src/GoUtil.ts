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

import { _, interpolate } from "./translate";
import type { JGOFTimeControl } from "./JGOF";

export function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min)) + min;
}
export function shortDurationString(seconds: number) {
    const weeks = Math.floor(seconds / (86400 * 7));
    seconds -= weeks * 86400 * 7;
    const days = Math.floor(seconds / 86400);
    seconds -= days * 86400;
    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;
    return (
        "" +
        (weeks ? " " + interpolate(_("%swk"), [weeks]) : "") +
        (days ? " " + interpolate(_("%sd"), [days]) : "") +
        (hours ? " " + interpolate(_("%sh"), [hours]) : "") +
        (minutes ? " " + interpolate(_("%sm"), [minutes]) : "") +
        (seconds ? " " + interpolate(_("%ss"), [seconds]) : "")
    );
}
export function dup(obj: any): any {
    let ret: any;
    if (typeof obj === "object") {
        if (Array.isArray(obj)) {
            ret = [];
            for (let i = 0; i < obj.length; ++i) {
                ret.push(dup(obj[i]));
            }
        } else {
            ret = {};
            for (const i in obj) {
                ret[i] = dup(obj[i]);
            }
        }
    } else {
        return obj;
    }
    return ret;
}
export function deepEqual(a: any, b: any) {
    if (typeof a !== typeof b) {
        return false;
    }

    if (typeof a === "object") {
        if (Array.isArray(a)) {
            if (Array.isArray(b)) {
                if (a.length !== b.length) {
                    return false;
                }
                for (let i = 0; i < a.length; ++i) {
                    if (!deepEqual(a[i], b[i])) {
                        return false;
                    }
                }
            } else {
                return false;
            }
        } else {
            for (const i in a) {
                if (!(i in b)) {
                    return false;
                }
                if (!deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            for (const i in b) {
                if (!(i in a)) {
                    return false;
                }
            }
        }
        return true;
    } else {
        return a === b;
    }
}

function averageMovesPerGame(w: number, h: number): number {
    // Rough estimate based on discussion at https://forums.online-go.com/t/average-game-length-on-different-board-sizes/35042/11
    return Math.round(0.7 * w * h);
}

export function computeAverageMoveTime(
    time_control: JGOFTimeControl,
    w?: number,
    h?: number,
): number {
    if (typeof time_control !== "object" || time_control === null) {
        console.error(
            `computAverageMoveTime passed ${time_control} instead of a time_control object`,
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
        console.error("Error computing avergate move time for time control: ", time_control);
        console.error(err);
        return 60;
    }
}

/* Like setInterval, but debounces catchups that happen
 * when tabs wake up on some browsers. Cleared with
 * the standard clearInterval. */
export function niceInterval(
    callback: () => void,
    interval: number,
): ReturnType<typeof setInterval> {
    let last = performance.now();
    return setInterval(() => {
        const now = performance.now();
        const diff = now - last;
        if (diff >= interval * 0.9) {
            last = now;
            callback();
        }
    }, interval);
}
