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

import { JGOFNumericPlayerColor, JGOFIntersection } from "./formats/JGOF";

/** A raw stone string is simply an array of intersections */
export type RawStoneString = Array<JGOFIntersection>;

/**
 * A StoneString instance represents a group of intersections that
 * are connected to each other and are all the same color.
 */
export class StoneString {
    public readonly intersections: Array<JGOFIntersection>;
    public readonly neighbors: Array<StoneString>;
    public readonly color: JGOFNumericPlayerColor;
    public readonly id: number;
    public territory_color: JGOFNumericPlayerColor = 0;
    public is_territory: boolean = false;

    private __added_neighbors: { [group_id: number]: boolean };
    private neighboring_space: StoneString[];
    private neighboring_stone_strings: StoneString[];

    constructor(id: number, color: JGOFNumericPlayerColor) {
        this.intersections = [];
        this.neighbors = [];
        this.neighboring_space = [];
        this.neighboring_stone_strings = [];
        this.id = id;
        this.color = color;

        this.__added_neighbors = {};
    }
    public map(fn: (loc: JGOFIntersection) => void): void {
        for (let i = 0; i < this.intersections.length; ++i) {
            fn(this.intersections[i]);
        }
    }
    public foreachNeighboringString(fn: (stone_string: StoneString) => void): void {
        for (let i = 0; i < this.neighbors.length; ++i) {
            fn(this.neighbors[i]);
        }
    }
    public foreachNeighboringEmptyString(fn: (stone_string: StoneString) => void): void {
        for (let i = 0; i < this.neighboring_space.length; ++i) {
            fn(this.neighboring_space[i]);
        }
    }
    public foreachNeighboringStoneString(fn: (stone_string: StoneString) => void): void {
        for (let i = 0; i < this.neighboring_stone_strings.length; ++i) {
            fn(this.neighboring_stone_strings[i]);
        }
    }
    public size(): number {
        return this.intersections.length;
    }

    /** Add a stone to the group.  This should probably only be called by StoneStringBuilder. */
    _addStone(x: number, y: number): void {
        this.intersections.push({ x: x, y: y });
    }

    /** Adds a stone string to our neighbor list. This should probably only be called by StoneStringBuilder. */
    _addNeighborGroup(group: StoneString): void {
        if (!(group.id in this.__added_neighbors)) {
            this.neighbors.push(group);
            this.__added_neighbors[group.id] = true;

            if (group.color !== this.color) {
                if (group.color === JGOFNumericPlayerColor.EMPTY) {
                    this.neighboring_space.push(group);
                } else {
                    this.neighboring_stone_strings.push(group);
                }
            }
        }
    }

    /**
     * Compute if this string is considered potential territory (if all of it's
     * neighbors are the same color). NOTE: This does not perform any advanced
     * logic to determine seki status or anything like that, this only looks to
     * see if the string contains EMPTY locations and that all of the
     * surrounding neighboring are the same color.  This should probably only
     * be called by StoneStringBuilder.
     */
    _computeIsTerritory(): void {
        /* An empty group is considered territory if all of it's neighbors are
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

        this.foreachNeighboringString((gr) => {
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
