/*
 * Copyright (C) Benjamin P. Jones
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

import { AdHocPackedMove, JGOFNumericPlayerColor } from "engine/formats";

type Coordinate = { x: number; y: number };

function forEach2D<T>(grid: T[][], callbackfn: (val: T, index: Coordinate) => void) {
    for (let y = 0; y < grid.length; ++y) {
        for (let x = 0; x < grid[y].length; ++x) {
            callbackfn(grid[y][x], { x, y });
        }
    }
}

function getStonePositions(board: JGOFNumericPlayerColor[][], color: JGOFNumericPlayerColor) {
    const ret: Coordinate[] = [];

    forEach2D(board, (val, index) => {
        if (val === color) {
            ret.push(index);
        }
    });

    return ret;
}

function isPass([x, y]: AdHocPackedMove) {
    return x === -1 && y === -1;
}

/**
 * Returns a list of moves such that the board state would be equivalent to `board`.
 * @param board The desired board state.
 */
export function movesFromBoardState(board: JGOFNumericPlayerColor[][]): AdHocPackedMove[] {
    const black_pos: Coordinate[] = getStonePositions(board, JGOFNumericPlayerColor.BLACK);
    const white_pos: Coordinate[] = getStonePositions(board, JGOFNumericPlayerColor.WHITE);

    const ret: AdHocPackedMove[] = [];

    while (black_pos.length || white_pos.length) {
        const b = black_pos.pop();
        const w = white_pos.pop();
        ret.push(b ? [b.x, b.y] : [-1, -1]);
        ret.push(w ? [w.x, w.y] : [-1, -1]);
    }

    // We clear out trailing passes to prevent ambiguity about whether the
    // game is about to end
    while (isPass(ret[ret.length - 1])) {
        ret.pop();
    }

    return ret;
}

test("movesFromBoardState", () => {
    const board = [
        [1, 2, 0, 0],
        [2, 1, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ];

    const moves = movesFromBoardState(board);

    expect(moves).toEqual([
        [1, 1],
        [0, 1],
        [0, 0],
        [1, 0],
    ]);
});
