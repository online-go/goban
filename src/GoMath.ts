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

import { JGOFIntersection, JGOFMove, JGOFNumericPlayerColor } from "./JGOF";
import { AdHocPackedMove } from "./AdHocFormat";

export type Move = JGOFMove;
export type Intersection = JGOFIntersection;
export type NumberMatrix = Array<Array<number>>;
export type StringMatrix = Array<Array<string>>;

export function makeMatrix(width: number, height: number, initialValue: number = 0): NumberMatrix {
    const ret: NumberMatrix = [];
    for (let y = 0; y < height; ++y) {
        ret.push([]);
        for (let x = 0; x < width; ++x) {
            ret[y].push(initialValue);
        }
    }
    return ret;
}
export function makeStringMatrix(
    width: number,
    height: number,
    initialValue: string = "",
): StringMatrix {
    const ret: StringMatrix = [];
    for (let y = 0; y < height; ++y) {
        ret.push([]);
        for (let x = 0; x < width; ++x) {
            ret[y].push(initialValue);
        }
    }
    return ret;
}
export function makeObjectMatrix<T>(width: number, height: number): Array<Array<T>> {
    const ret = new Array<Array<T>>(height);
    for (let y = 0; y < height; ++y) {
        const row = new Array<T>(width);
        for (let x = 0; x < width; ++x) {
            row[x] = {} as T;
        }
        ret[y] = row;
    }
    return ret;
}
export function makeEmptyObjectMatrix<T>(width: number, height: number): Array<Array<T>> {
    const ret = new Array<Array<T>>(height);
    for (let y = 0; y < height; ++y) {
        const row = new Array<T>(width);
        ret[y] = row;
    }
    return ret;
}
const COOR_SEQ = "abcdefghijklmnopqrstuvwxyz";

export function coor_ch2num(ch: string): number {
    return COOR_SEQ.indexOf(ch?.toLowerCase());
}

export function coor_num2ch(coor: number): string {
    return COOR_SEQ[coor];
}

const PRETTY_COOR_SEQ = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export function pretty_coor_ch2num(ch: string): number {
    return PRETTY_COOR_SEQ.indexOf(ch?.toUpperCase());
}

export function pretty_coor_num2ch(coor: number): string {
    return PRETTY_COOR_SEQ[coor];
}

export function prettyCoords(x: number, y: number, board_height: number): string {
    if (x >= 0) {
        return pretty_coor_num2ch(x) + ("" + (board_height - y));
    }
    return "pass";
}
export function decodeGTPCoordinate(move: string, width: number, height: number): JGOFMove {
    if (move === ".." || move.toLowerCase() === "pass") {
        return { x: -1, y: -1 };
    }
    let y = height - parseInt(move.substr(1));
    const x = pretty_coor_ch2num(move[0]);
    if (x === -1) {
        y = -1;
    }
    return { x, y };
}

//  TBD: A description of the scope, intent, and even known use-cases of this would be very helpful.
//     (My head spins trying to understand what this takes care of, and how not to break that)
export function decodeMoves(
    move_obj:
        | AdHocPackedMove
        | string
        | Array<AdHocPackedMove>
        | [object]
        | Array<JGOFMove>
        | JGOFMove
        | undefined,
    width: number,
    height: number,
): Array<JGOFMove> {
    const ret: Array<Move> = [];

    if (!move_obj) {
        return [];
    }

    function decodeSingleMoveArray(arr: [number, number, number, number?, object?]): Move {
        const obj: Move = {
            x: arr[0],
            y: arr[1],
            timedelta: arr.length > 2 ? arr[2] : -1,
            color: (arr.length > 3 ? arr[3] : 0) as JGOFNumericPlayerColor,
        };
        const extra: any = arr.length > 4 ? arr[4] : {};
        for (const k in extra) {
            (obj as any)[k] = extra[k];
        }
        return obj;
    }

    if (move_obj instanceof Array) {
        if (move_obj.length === 0) {
            return [];
        }
        if (typeof move_obj[0] === "number") {
            ret.push(decodeSingleMoveArray(move_obj as [number, number, number, number]));
        } else {
            if (
                typeof move_obj[0] === "object" &&
                "x" in move_obj[0] &&
                typeof move_obj[0].x === "number"
            ) {
                return move_obj as Array<JGOFMove>;
            }

            for (let i = 0; i < move_obj.length; ++i) {
                const mv: any = move_obj[i];
                if (mv instanceof Array && typeof mv[0] === "number") {
                    ret.push(decodeSingleMoveArray(mv as [number, number, number, number]));
                } else {
                    throw new Error(`Unrecognized move format: ${mv}`);
                }
            }
        }
    } else if (typeof move_obj === "string") {
        if (!height || !width) {
            throw new Error(
                `decodeMoves requires a height and width to be set when decoding a string coordinate`,
            );
        }

        if (/[a-zA-Z][0-9]/.test(move_obj)) {
            /* coordinate form, used from human input. */
            const move_string = move_obj;

            const moves = move_string.split(/([a-zA-Z][0-9]+|pass|[.][.])/);
            for (let i = 0; i < moves.length; ++i) {
                if (i % 2) {
                    /* even are the 'splits', which should always be blank unless there is an error */
                    let x = pretty_char2num(moves[i][0]);
                    let y = height - parseInt(moves[i].substring(1));
                    if ((width && x >= width) || x < 0) {
                        x = y = -1;
                    }
                    if ((height && y >= height) || y < 0) {
                        x = y = -1;
                    }
                    ret.push({ x: x, y: y, edited: false, color: 0 });
                } else {
                    if (moves[i] !== "") {
                        throw "Unparsed move input: " + moves[i];
                    }
                }
            }
        } else {
            /* Pure letter encoded form, used for all records */
            const move_string = move_obj;

            for (let i = 0; i < move_string.length - 1; i += 2) {
                let edited = false;
                let color: JGOFNumericPlayerColor = 0;
                if (move_string[i + 0] === "!") {
                    edited = true;
                    if (move_string.substr(i, 10) === "!undefined") {
                        /* bad data */
                        color = 0;
                        i += 10;
                    } else {
                        color = parseInt(move_string[i + 1]) as JGOFNumericPlayerColor;
                        i += 2;
                    }
                }

                let x = char2num(move_string[i]);
                let y = char2num(move_string[i + 1]);
                if (width && x >= width) {
                    x = y = -1;
                }
                if (height && y >= height) {
                    x = y = -1;
                }
                ret.push({ x: x, y: y, edited: edited, color: color });
            }
        }
    } else if (typeof move_obj === "object" && "x" in move_obj && typeof move_obj.x === "number") {
        return [move_obj] as Array<JGOFMove>;
    } else {
        throw new Error("Invalid move format: " + JSON.stringify(move_obj));
    }

    return ret;
}
export function char2num(ch: string): number {
    if (ch === ".") {
        return -1;
    }
    return coor_ch2num(ch);
}
function pretty_char2num(ch: string): number {
    if (ch === ".") {
        return -1;
    }
    return pretty_coor_ch2num(ch);
}
export function num2char(num: number): string {
    if (num === -1) {
        return ".";
    }
    return coor_num2ch(num);
}

export function encodeMove(x: number | Move, y?: number): string {
    if (typeof x === "number") {
        if (typeof y !== "number") {
            throw new Error(`Invalid y parameter to encodeMove y = ${y}`);
        }
        return num2char(x) + num2char(y);
    } else {
        const mv: Move = x;

        if (!mv.edited) {
            return num2char(mv.x) + num2char(mv.y);
        } else {
            return "!" + mv.color + num2char(mv.x) + num2char(mv.y);
        }
    }
}

export function encodeMoves(lst: Array<Move>): string {
    let ret = "";
    for (let i = 0; i < lst.length; ++i) {
        ret += encodeMove(lst[i]);
    }
    return ret;
}

export function encodePrettyCoord(coord: string, height: number): string {
    // "C12" with no "I".   TBD: give these different `string`s proper type names.
    const x = num2char(pretty_char2num(coord.charAt(0).toLowerCase()));
    const y = num2char(height - parseInt(coord.substring(1)));
    return x + y;
}

export function encodeMoveToArray(mv: Move): AdHocPackedMove {
    // Note: despite the name here, AdHocPackedMove became a tuple at some point!
    let extra: any = {};
    if (mv.blur) {
        extra.blur = mv.blur;
    }
    if (mv.sgf_downloaded_by) {
        extra.sgf_downloaded_by = mv.sgf_downloaded_by;
    }
    if (mv.played_by) {
        extra.played_by = mv.played_by;
    }
    if (mv.player_update) {
        extra.player_update = mv.player_update;
    }

    // don't add an extra if there is nothing extra...
    if (Object.keys(extra).length === 0) {
        extra = undefined;
    }

    const arr: AdHocPackedMove = [mv.x, mv.y, mv.timedelta ? mv.timedelta : -1, undefined, extra];
    if (mv.edited) {
        arr[3] = mv.color;
        if (!extra) {
            arr.pop();
        }
    } else {
        if (!extra) {
            arr.pop(); // extra
            arr.pop(); // edited
        }
    }
    return arr;
}
export function encodeMovesToArray(moves: Array<Move>): Array<AdHocPackedMove> {
    const ret: Array<AdHocPackedMove> = [];
    for (let i = 0; i < moves.length; ++i) {
        ret.push(encodeMoveToArray(moves[i]));
    }
    return ret;
}

export function stripModeratorOnlyExtraInformation(move: AdHocPackedMove): AdHocPackedMove {
    const moderator_only_extra_info = ["blur", "sgf_downloaded_by"];

    if (move.length === 5 && move[4]) {
        // the packed move has a defined `extra` field that we have to filter
        let filtered_extra: any = { ...move[4] };
        for (const field of moderator_only_extra_info) {
            delete filtered_extra[field];
        }
        if (Object.keys(filtered_extra).length === 0) {
            filtered_extra = undefined;
        }

        //filtered_extra.stripped = true;  // this is how you can tell by looking at a move structure in flight whether it went through here.
        const filtered_move = [...move.slice(0, 4), filtered_extra];
        while (filtered_move.length > 3 && !filtered_move[filtered_move.length - 1]) {
            filtered_move.pop();
        }
        return filtered_move as AdHocPackedMove;
    }
    return move;
}

/**
 * Removes superfluous fields from the JGOFMove objects, such as
 * edited=false and color=0. This does not modify the original array.
 */
export function trimJGOFMoves(arr: Array<JGOFMove>): Array<JGOFMove> {
    return arr.map((o) => {
        const r: JGOFMove = {
            x: o.x,
            y: o.y,
        };
        if (o.edited) {
            r.edited = o.edited;
        }
        if (o.color) {
            r.color = o.color;
        }
        if (o.timedelta) {
            r.timedelta = o.timedelta;
        }
        return r;
    });
}

/** Returns a sorted move string, this is used in our stone removal logic */
export function sortMoves(move_string: string, width: number, height: number): string {
    const moves = decodeMoves(move_string, width, height);
    moves.sort((a, b) => {
        const av = (a.edited ? 1 : 0) * 10000 + a.x + a.y * 100;
        const bv = (b.edited ? 1 : 0) * 10000 + b.x + b.y * 100;
        return av - bv;
    });
    return encodeMoves(moves);
}

// OJE Sequence format is '.root.K10.Q1'  ...
export function ojeSequenceToMoves(sequence: string): Array<JGOFMove> {
    const plays = sequence.split(".");

    if (plays.shift() !== "" || plays.shift() !== "root") {
        throw new Error("Sequence passed to sequenceToMoves does not start with .root");
    }

    const moves = plays.map((play) => {
        if (play === "pass") {
            return { x: -1, y: -1 };
        }
        return decodeGTPCoordinate(play, 19, 19);
    });

    return moves;
}

// This is intended to be an "easy to understand" method of generating a unique id
// for a board position.

// The "id" is the list of all the positions of the stones, black first then white,
// separated by a colon.

// There are in fact 8 possible ways to list the positions (all the rotations and
// reflections of the position).   The id is the lowest (alpha-numerically) of these.

// Colour independence for the position is achieved by takeing the lexically lower
// of the ids of the position with black and white reversed.

// The "easy to understand" part is that the id can be compared visually to the
// board position

// The downside is that the id string can be moderately long for boards with lots of stones

type BoardTransform = (x: number, y: number) => { x: number; y: number };

export function positionId(
    position: Array<Array<JGOFNumericPlayerColor>>,
    height: number,
    width: number,
): string {
    // The basic algorithm is to list where each of the stones are, in a long string.
    // We do this once for each transform, selecting the lowest (lexically) as we go.

    const transforms: Array<BoardTransform> = [
        (x, y) => ({ x, y }),
        (x, y) => ({ x, y: height - y - 1 }),
        (x, y) => ({ x: y, y: x }),
        (x, y) => ({ x: y, y: width - x - 1 }),
        (x, y) => ({ x: height - y - 1, y: x }),
        (x, y) => ({ x: height - y - 1, y: width - x - 1 }),
        (x, y) => ({ x: width - x - 1, y }),
        (x, y) => ({ x: width - x - 1, y: height - y - 1 }),
    ];

    const ids = [];

    for (const transform of transforms) {
        let black_state = "";
        let white_state = "";
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const c = transform(x, y);
                if (position[x][y] === JGOFNumericPlayerColor.BLACK) {
                    black_state += encodeMove(c.x, c.y);
                }
                if (position[x][y] === JGOFNumericPlayerColor.WHITE) {
                    white_state += encodeMove(c.x, c.y);
                }
            }
        }

        ids.push(`${black_state}.${white_state}`);
    }

    return ids.reduce((prev, current) => (current < prev ? current : prev));
}
