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

import { JGOFMove } from "../formats";

/* Lower case, includes i, used for our string encoding of moves */
const COORDINATE_SEQUENCE = "abcdefghijklmnopqrstuvwxyz";

/* Upper case, and doesn't have I */
const PRETTY_COORDINATE_SEQUENCE = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

/** Decodes a single coordinate to a number */
export function decodeCoordinate(ch: string): number {
    return COORDINATE_SEQUENCE.indexOf(ch?.toLowerCase());
}

/** Encodes a single coordinate to a number */
export function encodeCoordinate(coor: number): string {
    return COORDINATE_SEQUENCE[coor];
}

/** Decodes the pretty X coordinate to a number */
export function decodePrettyXCoordinate(ch: string): number {
    return PRETTY_COORDINATE_SEQUENCE.indexOf(ch?.toUpperCase());
}

/** Encodes an X coordinate to a display encoding */
export function encodePrettyXCoordinate(coor: number): string {
    return PRETTY_COORDINATE_SEQUENCE[coor];
}

/** Encodes an x,y pair to "pretty" coordinates, like `"A3"`, or `"K10"` */
export function prettyCoordinates(x: number, y: number, board_height: number): string {
    if (x >= 0) {
        return encodePrettyXCoordinate(x) + ("" + (board_height - y));
    }
    return "pass";
}

/** Decodes GTP coordinates to a JGOFMove */
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

/** Decodes pretty coordinates to a JGOFMove, this is an alias of decodeGTPCoordinates */
export function decodePrettyCoordinates(move: string, height: number): JGOFMove {
    return decodeGTPCoordinates(move, -1, height);
}
