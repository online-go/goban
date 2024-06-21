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

import { JGOFMove } from "../formats/JGOF";
import { decodeMoves, encodeMoves } from "./move_encoding";

/** Returns a sorted move string, this is used in our stone removal logic */
export function sortMoves(moves: string, width: number, height: number): string;
export function sortMoves(moves: JGOFMove[], width: number, height: number): JGOFMove[];
export function sortMoves(
    moves: string | JGOFMove[],
    width: number,
    height: number,
): string | JGOFMove[] {
    if (moves instanceof Array) {
        return moves.sort(compare_moves);
    } else {
        const arr = decodeMoves(moves, width, height);
        arr.sort(compare_moves);
        return encodeMoves(arr);
    }
}

function compare_moves(a: JGOFMove, b: JGOFMove): number {
    const av = (a.edited ? 1 : 0) * 10000 + a.x + a.y * 100;
    const bv = (b.edited ? 1 : 0) * 10000 + b.x + b.y * 100;
    return av - bv;
}
