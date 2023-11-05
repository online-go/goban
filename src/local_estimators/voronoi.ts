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

import { makeEmptyObjectMatrix, makeMatrix } from "../GoMath";

/* The OGSScoreEstimator method is a wasm compiled C program that
 * does simple random playouts. On the client, the OGSScoreEstimator script
 * is loaded in an async fashion, so at some point that global variable
 * becomes not null and can be used.
 */

export function estimateScoreVoronoi(board: number[][]) {
    const black_distance_map = distanceMap(board, 1);
    const white_distance_map = distanceMap(board, -1);

    const { width, height } = get_dims(board);

    const ownership = makeMatrix(width, height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (white_distance_map[y][x] < black_distance_map[y][x]) {
                ownership[y][x] = -1;
            } else if (white_distance_map[y][x] > black_distance_map[y][x]) {
                ownership[y][x] = 1;
            } else {
                ownership[y][x] = 0;
            }
        }
    }

    return { ownership, estimated_score: 0 };
}

export function distanceMap(board: number[][], color: -1 | 1) {
    const { width, height } = get_dims(board);
    let points = getPoints(board, (pt) => pt === color);
    if (points.length === 0) {
        return makeMatrix(width, height, Infinity);
    }

    let i = 0;
    const distance_map = makeEmptyObjectMatrix<number>(width, height);
    while (points.length) {
        const next_points: Coordinate[] = [];
        for (const pt of points) {
            if (distance_map[pt.y][pt.x] !== undefined) {
                continue;
            }
            distance_map[pt.y][pt.x] = i;
            for (const n of getNeighbors(width, height, pt)) {
                next_points.push(n);
            }
        }
        points = next_points;
        i++;
    }
    return distance_map;
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
