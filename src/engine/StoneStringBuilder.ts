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

import { StoneString } from "./StoneString";
import { BoardState } from "./BoardState";
import { JGOFNumericPlayerColor } from "./formats/JGOF";
import { makeMatrix } from "./util";

export class StoneStringBuilder {
    private state: BoardState;
    public readonly stone_string_id_map: number[][];
    public readonly stone_strings: StoneString[];

    constructor(state: BoardState, original_board?: JGOFNumericPlayerColor[][]) {
        const stone_strings: StoneString[] = Array(1); // this is indexed by group_id, so we 1 index this array so group_id >= 1
        const group_id_map = makeMatrix(state.width, state.height, 0);

        this.state = state;
        this.stone_string_id_map = group_id_map;
        this.stone_strings = stone_strings;

        const floodFill = (
            x: number,
            y: number,
            color: JGOFNumericPlayerColor,
            dame: boolean,
            id: number,
        ): void => {
            if (x >= 0 && x < this.state.width) {
                if (y >= 0 && y < this.state.height) {
                    if (
                        this.state.board[y][x] === color &&
                        group_id_map[y][x] === 0 &&
                        (!original_board ||
                            (!dame && (original_board[y][x] !== 0 || !this.state.removal[y][x])) ||
                            (dame && original_board[y][x] === 0 && this.state.removal[y][x]))
                    ) {
                        group_id_map[y][x] = id;
                        floodFill(x - 1, y, color, dame, id);
                        floodFill(x + 1, y, color, dame, id);
                        floodFill(x, y - 1, color, dame, id);
                        floodFill(x, y + 1, color, dame, id);
                    }
                }
            }
        };

        /* Build groups */
        let groupId = 1;
        for (let y = 0; y < this.state.height; ++y) {
            for (let x = 0; x < this.state.width; ++x) {
                if (group_id_map[y][x] === 0) {
                    floodFill(
                        x,
                        y,
                        this.state.board[y][x],
                        !!(
                            original_board &&
                            this.state.removal[y][x] &&
                            original_board[y][x] === 0
                        ),
                        groupId++,
                    );
                }

                if (!(group_id_map[y][x] in stone_strings)) {
                    stone_strings.push(new StoneString(group_id_map[y][x], this.state.board[y][x]));
                }
                stone_strings[group_id_map[y][x]]._addStone(x, y);
            }
        }

        /* Compute group neighbors */
        this.foreachGroup((gr) => {
            gr.map((pt) => {
                const x = pt.x;
                const y = pt.y;
                if (x - 1 >= 0 && group_id_map[y][x - 1] !== gr.id) {
                    gr._addNeighborGroup(stone_strings[group_id_map[y][x - 1]]);
                }
                if (x + 1 < this.state.width && group_id_map[y][x + 1] !== gr.id) {
                    gr._addNeighborGroup(stone_strings[group_id_map[y][x + 1]]);
                }
                if (y - 1 >= 0 && group_id_map[y - 1][x] !== gr.id) {
                    gr._addNeighborGroup(stone_strings[group_id_map[y - 1][x]]);
                }
                if (y + 1 < this.state.height && group_id_map[y + 1][x] !== gr.id) {
                    gr._addNeighborGroup(stone_strings[group_id_map[y + 1][x]]);
                }
            });
        });

        this.foreachGroup((gr) => {
            gr._computeIsTerritory();
        });
    }

    public foreachGroup(fn: (gr: StoneString) => void) {
        for (let i = 1; i < this.stone_strings.length; ++i) {
            fn(this.stone_strings[i]);
        }
    }

    public getGroup(x: number, y: number): StoneString {
        return this.stone_strings[this.stone_string_id_map[y][x]];
    }
}
