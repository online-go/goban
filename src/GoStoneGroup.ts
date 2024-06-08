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

import { Intersection } from "./GoMath";
import { JGOFNumericPlayerColor, JGOFIntersection } from "./JGOF";

export type Group = Array<JGOFIntersection>;

export interface BoardState {
    width: number;
    height: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
    removal: Array<Array<number>>;
}

export class GoStoneGroup {
    public readonly points: Array<Intersection>;
    public readonly neighbors: Array<GoStoneGroup>;
    public readonly color: JGOFNumericPlayerColor;
    public readonly id: number;
    public territory_color: JGOFNumericPlayerColor = 0;
    public is_territory: boolean = false;

    private __added_neighbors: { [group_id: number]: boolean };
    private corner_groups: { [y: string]: { [x: string]: GoStoneGroup } };
    private neighboring_space: GoStoneGroup[];
    private neighboring_enemy: GoStoneGroup[];

    constructor(board_state: BoardState, id: number, color: JGOFNumericPlayerColor) {
        this.points = [];
        this.neighbors = [];
        this.neighboring_space = [];
        this.neighboring_enemy = [];
        this.id = id;
        this.color = color;

        this.__added_neighbors = {};
        this.corner_groups = {};
    }
    addStone(x: number, y: number): void {
        this.points.push({ x: x, y: y });
    }
    addNeighborGroup(group: GoStoneGroup): void {
        if (!(group.id in this.__added_neighbors)) {
            this.neighbors.push(group);
            this.__added_neighbors[group.id] = true;

            if (group.color !== this.color) {
                if (group.color === JGOFNumericPlayerColor.EMPTY) {
                    this.neighboring_space.push(group);
                } else {
                    this.neighboring_enemy.push(group);
                }
            }
        }
    }
    addCornerGroup(x: number, y: number, group: GoStoneGroup): void {
        if (!(y in this.corner_groups)) {
            this.corner_groups[y] = {};
        }
        this.corner_groups[y][x] = group;
    }
    foreachStone(fn: (pt: Intersection) => void): void {
        for (let i = 0; i < this.points.length; ++i) {
            fn(this.points[i]);
        }
    }
    foreachNeighborGroup(fn: (group: GoStoneGroup) => void): void {
        for (let i = 0; i < this.neighbors.length; ++i) {
            fn(this.neighbors[i]);
        }
    }
    foreachNeighborSpaceGroup(fn: (group: GoStoneGroup) => void): void {
        for (let i = 0; i < this.neighboring_space.length; ++i) {
            fn(this.neighboring_space[i]);
        }
    }
    foreachNeighborEnemyGroup(fn: (group: GoStoneGroup) => void): void {
        for (let i = 0; i < this.neighbors.length; ++i) {
            fn(this.neighboring_enemy[i]);
        }
    }
    size(): number {
        return this.points.length;
    }
    computeIsTerritory(): void {
        /* An empty group is considered territory if all of it's neighbors are of
         * the same color */
        this.is_territory = false;
        this.territory_color = 0;
        if (this.color) {
            return;
        }

        let color: JGOFNumericPlayerColor = 0;
        for (let i = 0; i < this.neighbors.length; ++i) {
            if (this.neighbors[i].color !== 0) {
                color = this.neighbors[i].color;
                break;
            }
        }

        this.foreachNeighborGroup((gr) => {
            if (gr.color !== 0 && color !== gr.color) {
                color = 0;
            }
        });

        if (color) {
            this.is_territory = true;
            this.territory_color = color;
        }
    }
}
