/*
 * Copyright (C)  Online-Go.com
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

/** Returns a random integer between min (inclusive) and max (exclusive) */
export function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min)) + min;
}

/** Returns a cloned copy of the provided matrix */
export function cloneMatrix<T>(matrix: T[][]): T[][] {
    return matrix.map((row) => row.slice());
}

/** Takes a number of seconds and returns a string like "1d 3h 2m 52s" */
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

/** Deep clones an object */
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

/** Deep compares two objects */
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

/**
 * Rough estimate of the average number of moves in a game based on height on
 * and width. See discussion here:
 * https://forums.online-go.com/t/average-game-length-on-different-board-sizes/35042/11
 */
function averageMovesPerGame(w: number, h: number): number {
    return Math.round(0.7 * w * h);
}

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
 * Like setInterval, but debounces catchups (multiple invocation in rapid
 * succession less than our desired interval) that happen in some browsers when
 * tabs wake up from sleep. Cleared with the standard clearInterval.
 * */
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

/*
 * SPEC: https://www.red-bean.com/sgf/sgf4.html#text
 *
 * in sgf (as per spec):
 * - slash is an escape char
 * - closing bracket is a special symbol
 * - whitespaces other than space & newline should be converted to space
 * - in compose data type, we should also escape ':'
 *   (but that is only used in special SGF properties)
 *
 * so we gotta:
 * - escape (double) all slashes in the text (so that they do not have the special meaning)
 * - escape any closing brackets ] (as it closes e.g. the comment section)
 * - replace whitespace
 * - [opt] handle colon
 */
export function escapeSGFText(txt: string, escapeColon: boolean = false): string {
    // escape slashes first
    // 'blah\blah' -> 'blah\\blah'
    txt = txt.replace(/\\/g, "\\\\");

    // escape closing square bracket ]
    // 'blah[9dan]' -> 'blah[9dan\]'
    txt = txt.replace(/]/g, "\\]");

    // no need to escape opening bracket, SGF grammar handles that
    // 'C[[[[[[blah blah]'
    //   ^ after it finds the first [, it is only looking for the closing bracket
    // parsing SGF properties, so the remaining [ are safely treated as text
    //txt = txt.replace(/[/g, "\\[");

    // sub whitespace except newline & carriage return by space
    txt = txt.replace(/[^\S\r\n]/g, " ");

    if (escapeColon) {
        txt = txt.replace(/:/g, "\\:");
    }
    return txt;
}

/**
 * SGF "simple text", eg used in the LB property, we can't have newlines. This
 * strips them and replaces them with spaces.
 */
export function newlines_to_spaces(txt: string): string {
    return txt.replace(/[\r\n]/g, " ");
}

/** Simple 50% blend of two colors in hex format */
export function color_blend(c1: string, c2: string): string {
    const c1_rgb = hexToRgb(c1);
    const c2_rgb = hexToRgb(c2);
    const blend = (a: number, b: number) => Math.round((a + b) / 2);
    return rgbToHex(
        blend(c1_rgb.r, c2_rgb.r),
        blend(c1_rgb.g, c2_rgb.g),
        blend(c1_rgb.b, c2_rgb.b),
    );
}

/** Convert hex color to RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        throw new Error("invalid hex color");
    }
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
    };
}

/** Convert RGB color to hex */
function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
