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

import { cloneMatrix } from "../util";

/**
 * This estimator simply marks territory for whichever color has a
 * closer stone (Manhattan distance).  See discussion at
 * https://forums.online-go.com/t/weak-score-estimator-and-japanese-rules/41041/70
 */
export function voronoi_estimate_ownership(board: number[][]) {
    const { width, height } = get_dims(board);
    const ownership: number[][] = cloneMatrix(board);
    let points = getPoints(board, (pt) => pt !== 0);
    while (points.length) {
        const unvisited = points
            .flatMap((pt) => getNeighbors(width, height, pt))
            .filter((pt) => ownership[pt.y][pt.x] === 0);
        unvisited
            .map((pt) => ({ x: pt.x, y: pt.y, color: getOwningColor(ownership, pt) }))
            .forEach(({ x, y, color }) => {
                ownership[y][x] = color;
            });
        points = unvisited.filter(({ x, y }) => ownership[y][x] !== 0);
    }
    return ownership;
}

function getOwningColor(board: number[][], pt: Coordinate): -1 | 0 | 1 {
    const { width, height } = get_dims(board);
    const neighbors = getNeighbors(width, height, pt);
    const non_neutral_neighbors = neighbors.filter((pt) => board[pt.y][pt.x] !== 0);
    if (non_neutral_neighbors.every((pt) => board[pt.y][pt.x] === 1)) {
        return 1;
    }
    if (non_neutral_neighbors.every((pt) => board[pt.y][pt.x] === -1)) {
        return -1;
    }
    return 0;
}

type Coordinate = { x: number; y: number };
function getPoints(board: number[][], f: (pt: number) => boolean): Coordinate[] {
    const { width, height } = get_dims(board);
    const points: Coordinate[] = [];
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            if (f(board[y][x])) {
                points.push({ x, y });
            }
        }
    }
    return points;
}
function getNeighbors(width: number, height: number, { x, y }: Coordinate): Coordinate[] {
    const neighbors: Coordinate[] = [];
    if (x > 0) {
        neighbors.push({ x: x - 1, y });
    }
    if (x < width - 1) {
        neighbors.push({ x: x + 1, y });
    }
    if (y > 0) {
        neighbors.push({ x, y: y - 1 });
    }
    if (y < height - 1) {
        neighbors.push({ x, y: y + 1 });
    }

    return neighbors;
}

function get_dims(board: unknown[][]) {
    return { width: board[0].length, height: board.length };
}
