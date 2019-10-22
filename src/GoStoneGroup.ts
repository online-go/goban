/*
 * Copyright 2012-2019 Online-Go.com
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

import { NumericPlayerColor } from './GoEngine';
import { BoardState, Intersection, Group } from './GoMath';

export class GoStoneGroup {
    probable_color: NumericPlayerColor;
    dame: boolean;
    corner_groups: {[y:string]: {[x:string]: GoStoneGroup}};
    points: Array<Intersection>;
    neighbors: Array<GoStoneGroup>;
    is_territory: boolean;
    color: NumericPlayerColor;
    is_probably_dead: boolean;
    is_probably_dame: boolean;
    board_state: BoardState;
    id: number;
    is_strong_eye: boolean;
    adjacent_white: number;
    adjacent_black: number;
    is_eye: boolean;
    is_strong_string: boolean;
    territory_color: NumericPlayerColor;
    is_territory_in_seki: boolean;

    private __added_neighbors: {[group_id:number]: boolean};


    constructor(board_state:BoardState, id:number, color:NumericPlayerColor, dame:boolean) {
        this.board_state = board_state;
        this.points = [];
        this.neighbors = [];
        this.id = id;
        this.color = color;
        this.is_strong_eye = false;
        this.adjacent_black = 0;
        this.adjacent_white = 0;
        this.probable_color = 0;
        this.dame = dame;

        this.__added_neighbors = {};
        this.corner_groups = {};
    }
    addStone(x:number, y:number):void {
        this.points.push({"x": x, "y": y});
    }
    addNeighborGroup(group:GoStoneGroup):void {
        if (!(group.id in this.__added_neighbors)) {
            this.neighbors.push(group);
            this.__added_neighbors[group.id] = true;
        }
    }
    addCornerGroup(x:number, y:number, group:GoStoneGroup):void {
        if (!(y in this.corner_groups)) { this.corner_groups[y]  = {}; }
        this.corner_groups[y][x] = group;
    }
    foreachStone(fn:(pt:Intersection)=>void):void {
        for (let i = 0; i < this.points.length; ++i) {
            fn(this.points[i]);
        }
    }
    foreachNeighborGroup(fn:(group:GoStoneGroup)=>void):void {
        for (let i = 0; i < this.neighbors.length; ++i) {
            fn(this.neighbors[i]);
        }
    }
    computeIsEye():void {
        this.is_eye = false;

        if (this.points.length > 1) {
            return;
        }

        this.is_eye = this.is_territory;
    }
    size():number {
        return this.points.length;
    }
    computeIsStrongEye():void {
        /* If a single eye is surrounded by 7+ stones of the same color, 5 stones
         * for edges, and 3 stones for corners, or if any of those spots are
         * territory owned by the same color, it is considered strong. */
        this.is_strong_eye = false;
        let color;
        let board_state = this.board_state;
        if (this.is_eye) {
            let x = this.points[0].x;
            let y = this.points[0].y;
            color = board_state.board[y][x === 0 ? x + 1 : x - 1];
            let not_color = 0;

            let chk = (x, y) => {
                /* If there is a stone on the board and it's not our color,
                 * or if the spot is part of some territory which is not our color,
                 * then return true, else false. */
                return (color !== board_state.board[y][x] && (!this.corner_groups[y][x].is_territory || this.corner_groups[y][x].territory_color !== color)) ? 1 : 0;
            };

            not_color =
                (x - 1 >= 0                && y - 1 >= 0            ? chk(x - 1, y - 1) : 0) +
                (x + 1 < board_state.width && y - 1 >= 0            ? chk(x + 1, y - 1) : 0) +
                (x - 1 >= 0                && y + 1 < board_state.height ? chk(x - 1, y + 1) : 0) +
                (x + 1 < board_state.width && y + 1 < board_state.height ? chk(x + 1, y + 1) : 0);

            if (x - 1 >= 0 && x + 1 < board_state.width && y - 1 >= 0 && y + 1 < board_state.height) {
                this.is_strong_eye = not_color <= 1;
            } else {
                this.is_strong_eye = not_color === 0;
            }
        }

    }
    computeIsStrongString():void {
        /* A group is considered a strong string if it is adjacent to two strong eyes */
        let strong_eye_count = 0;
        this.foreachNeighborGroup((gr) => {
            strong_eye_count += (gr.is_strong_eye ? 1 : 0);
        });
        this.is_strong_string = strong_eye_count >= 2;
    }
    computeIsTerritory():void {
        /* An empty group is considered territory if all of it's neighbors are of
         * the same color */
        this.is_territory = false;
        this.territory_color = 0;
        if (this.color) {
            return;
        }

        let color:NumericPlayerColor = 0;
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
    computeIsTerritoryInSeki():void {
        /* An empty group is considered territory if all of it's neighbors are of
         * the same color */
        this.is_territory_in_seki = false;
        if (this.is_territory) {
            this.foreachNeighborGroup((border_stones) => {
                border_stones.foreachNeighborGroup((border_of_border) => {
                    if (border_of_border.color === 0 && !border_of_border.is_territory) {
                        /* only mark in seki if the neighboring would-be-blocking
                         * territory hasn't been negated. */
                        let is_not_negated = true;
                        for (let i = 0; i < border_of_border.points.length; ++i) {
                            let x = border_of_border.points[i].x;
                            let y = border_of_border.points[i].y;
                            if (!this.board_state.removal[y][x]) {
                                is_not_negated = false;
                            }
                        }
                        if (!is_not_negated) {
                            this.is_territory_in_seki = true;
                        }
                    }
                });
            });
        }
    }
    computeProbableColor():void {
        /* For open area that has no definitive owner, compute the weight
         * of how much of who is touching the area */
        this.adjacent_black = 0;
        this.adjacent_white = 0;
        this.probable_color = 0;
        this.board_state.foreachNeighbor(this.points, (x, y) => {
            let color = this.board_state.board[y][x];
            if (color === 1) { this.adjacent_black++; }
            if (color === 2) { this.adjacent_white++; }
        });
        if (this.adjacent_white >= this.adjacent_black * 3) { this.probable_color = 2; }
        if (this.adjacent_black >= this.adjacent_white * 3) { this.probable_color = 1; }
    }
    computeProbablyDead():void {
        this.is_probably_dead = false;

        if (this.color) {
            let probably_alive = false;
            let open_areas = [];

            this.foreachNeighborGroup((gr) => {
                if (gr.is_territory && gr.territory_color === this.color) {
                    probably_alive = true;
                }
                if (!gr.is_territory && gr.probable_color === this.color) {
                    probably_alive = true;
                }
                if (gr.color === 0) {
                    open_areas.push(gr);
                }
            });

            this.is_probably_dead = !probably_alive;
        }

    }
    computeProbablyDame():void {
        this.is_probably_dame = false;
        if (!this.is_territory && this.color === 0 && this.size() < 2) {
            this.is_probably_dame = true;
        }
    }

}
