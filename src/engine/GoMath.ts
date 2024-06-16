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

import { JGOFIntersection, JGOFMove, JGOFNumericPlayerColor } from "./formats/JGOF";
import { AdHocPackedMove } from "./formats/AdHocFormat";

export type Intersection = JGOFIntersection;
export type Matrix<T> = T[][];
export type NumberMatrix = Matrix<number>;
export type StringMatrix = Matrix<string>;

export function makeMatrix<T = number>(width: number, height: number, initialValue: T): Matrix<T> {
    const ret: Matrix<T> = [];
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

/* Lower case, includes i, used for our string encoding of moves */
const COORDINATE_SEQUENCE = "abcdefghijklmnopqrstuvwxyz";

/** Decodes a single coordinate to a number */
export function decodeCoordinate(ch: string): number {
    return COORDINATE_SEQUENCE.indexOf(ch?.toLowerCase());
}

/** Encodes a single coordinate to a number */
export function encodeCoordinate(coor: number): string {
    return COORDINATE_SEQUENCE[coor];
}

/* Upper case, and doesn't have I */
const PRETTY_COORDINATE_SEQUENCE = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

/** Decodes the pretty X coordinate to a number */
export function decodePrettyXCoordinate(ch: string): number {
    return PRETTY_COORDINATE_SEQUENCE.indexOf(ch?.toUpperCase());
}

/** Encodes an X coordinate to a display encoding */
export function encodePrettyXCoordinate(coor: number): string {
    return PRETTY_COORDINATE_SEQUENCE[coor];
}

export function prettyCoordinates(x: number, y: number, board_height: number): string {
    if (x >= 0) {
        return encodePrettyXCoordinate(x) + ("" + (board_height - y));
    }
    return "pass";
}
export function decodeGTPCoordinates(move: string, width: number, height: number): JGOFMove {
    if (move === ".." || move.toLowerCase() === "pass") {
        return { x: -1, y: -1 };
    }
    let y = height - parseInt(move.substr(1));
    const x = decodePrettyXCoordinate(move[0]);
    if (x === -1) {
        y = -1;
    }
    return { x, y };
}
export function decodePrettyCoordinates(move: string, height: number): JGOFMove {
    return decodeGTPCoordinates(move, -1, height);
}

/**
 *  Decodes any of the various ways we express moves that we've accumulated over the years into
 * a unified `JGOFMove[]`.
 */
export function decodeMoves(
    move_obj:
        | string
        | AdHocPackedMove
        | AdHocPackedMove[]
        | JGOFMove
        | JGOFMove[]
        | [object]
        | undefined,
    width: number,
    height: number,
): JGOFMove[] {
    const ret: Array<JGOFMove> = [];

    // undefined or empty string? return empty array.
    if (!move_obj) {
        return [];
    }

    function decodeSingleMoveArray(arr: [number, number, number, number?, object?]): JGOFMove {
        const obj: JGOFMove = {
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
    return decodeCoordinate(ch);
}
function pretty_char2num(ch: string): number {
    if (ch === ".") {
        return -1;
    }
    return decodePrettyXCoordinate(ch);
}
export function num2char(num: number): string {
    if (num === -1) {
        return ".";
    }
    return encodeCoordinate(num);
}

export function encodeMove(x: number | JGOFMove, y?: number): string {
    if (typeof x === "number") {
        if (typeof y !== "number") {
            throw new Error(`Invalid y parameter to encodeMove y = ${y}`);
        }
        return num2char(x) + num2char(y);
    } else {
        const mv: JGOFMove = x;

        if (!mv.edited) {
            return num2char(mv.x) + num2char(mv.y);
        } else {
            return "!" + mv.color + num2char(mv.x) + num2char(mv.y);
        }
    }
}

/* Encodes a move list like [{x: 0, y: 0}, {x:1, y:2}] into our move string
 * format "aabc" */
export function encodeMoves(lst: JGOFMove[]): string {
    let ret = "";
    for (let i = 0; i < lst.length; ++i) {
        ret += encodeMove(lst[i]);
    }
    return ret;
}

export function encodeMoveToArray(mv: JGOFMove): AdHocPackedMove {
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
export function encodeMovesToArray(moves: Array<JGOFMove>): Array<AdHocPackedMove> {
    const ret: Array<AdHocPackedMove> = [];
    for (let i = 0; i < moves.length; ++i) {
        ret.push(encodeMoveToArray(moves[i]));
    }
    return ret;
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
export function sortMoves(moves: string, width: number, height: number): string;
export function sortMoves(moves: JGOFMove[], width: number, height: number): JGOFMove[];
export function sortMoves(
    moves: string | JGOFMove[],
    width: number,
    height: number,
): string | JGOFMove[] {
    if (moves instanceof Array) {
        return moves.sort((a, b) => {
            const av = (a.edited ? 1 : 0) * 10000 + a.x + a.y * 100;
            const bv = (b.edited ? 1 : 0) * 10000 + b.x + b.y * 100;
            return av - bv;
        });
    } else {
        const arr = decodeMoves(moves, width, height);
        arr.sort((a, b) => {
            const av = (a.edited ? 1 : 0) * 10000 + a.x + a.y * 100;
            const bv = (b.edited ? 1 : 0) * 10000 + b.x + b.y * 100;
            return av - bv;
        });
        return encodeMoves(arr);
    }
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
        return decodeGTPCoordinates(play, 19, 19);
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
