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

import { JGOFNumericPlayerColor } from "../formats";
import { encodeMove } from "./move_encoding";

/**
 * This is intended to be an "easy to understand" method of generating a unique id
 * for a board position.
 *
 * The "id" is the list of all the positions of the stones, black first then white,
 * separated by a colon.
 *
 * There are in fact 8 possible ways to list the positions (all the rotations and
 * reflections of the position).   The id is the lowest (alpha-numerically) of these.
 *
 * Colour independence for the position is achieved by takeing the lexically lower
 * of the ids of the position with black and white reversed.
 *
 * The "easy to understand" part is that the id can be compared visually to the
 * board position
 *
 * The downside is that the id string can be moderately long for boards with lots of stones
 */

export type BoardTransform = (x: number, y: number) => { x: number; y: number };
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
