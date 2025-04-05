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

import { GobanEvents } from "../GobanBase";
import { EventEmitter } from "eventemitter3";
import { JGOFIntersection, JGOFNumericPlayerColor } from "./formats/JGOF";
import { makeMatrix } from "./util";
import * as goscorer from "goscorer";
import { StoneStringBuilder } from "./StoneStringBuilder";
import type { GobanBase } from "../GobanBase";
import { RawStoneString } from "./StoneString";
import { cloneMatrix, matricesAreEqual } from "./util";
import { callbacks } from "../Goban/callbacks";

export interface BoardConfig {
    width?: number;
    height?: number;
    board?: JGOFNumericPlayerColor[][];
    removal?: boolean[][];
    player?: JGOFNumericPlayerColor;
    board_is_repeating?: boolean;
    white_prisoners?: number;
    black_prisoners?: number;
    isobranch_hash?: string;
    //udata_state?: any;
}

export interface ScoringLocations {
    black: {
        territory: number;
        stones: number;
        locations: JGOFIntersection[];
    };
    white: {
        territory: number;
        stones: number;
        locations: JGOFIntersection[];
    };
}

/* When flood filling we use these to keep track of locations we've visited */
let __current_flood_fill_value = 0;
const __flood_fill_scratch_pad: number[] = Array(25 * 25).fill(0);

export class BoardState extends EventEmitter<GobanEvents> implements BoardConfig {
    public readonly height: number = 19;
    //public readonly rules:GobanEngineRules = 'japanese';
    public readonly width: number = 19;
    public board: JGOFNumericPlayerColor[][];
    public removal: boolean[][];
    protected goban_callback?: GobanBase;

    public player: JGOFNumericPlayerColor;
    public board_is_repeating: boolean;
    public white_prisoners: number;
    public black_prisoners: number;

    /**
     * Constructs a new board with the given configuration. If height/width
     * are not provided, they will be inferred from the board array, or will
     * default to 19x19 if no board is provided.
     *
     * Any state matrices (board, removal, etc..) provided will be cloned
     * and must have the same dimensionality.
     */
    constructor(config: BoardConfig, goban_callback?: GobanBase) {
        super();

        this.goban_callback = goban_callback;
        this.width = config.width ?? config.board?.[0]?.length ?? 19;
        this.height = config.height ?? config.board?.length ?? 19;

        /* Clone our boards if they are provided, otherwise make new ones */
        this.board = config.board
            ? cloneMatrix(config.board)
            : makeMatrix(this.width, this.height, JGOFNumericPlayerColor.EMPTY);
        this.removal = config.removal
            ? cloneMatrix(config.removal)
            : makeMatrix(this.width, this.height, false);

        /* Sanity check */
        if (this.height !== this.board.length || this.width !== this.board[0].length) {
            throw new Error("Board size mismatch");
        }

        if (this.height !== this.removal.length || this.width !== this.removal[0].length) {
            throw new Error("Removal size mismatch");
        }

        this.player = config.player ?? JGOFNumericPlayerColor.EMPTY;
        this.board_is_repeating = config.board_is_repeating ?? false;
        this.white_prisoners = config.white_prisoners ?? 0;
        this.black_prisoners = config.black_prisoners ?? 0;
    }

    /** Clone the entire BoardState */
    public cloneBoardState(): BoardState {
        return new BoardState(this, this.goban_callback);
    }

    /** Returns a clone of .board */
    public cloneBoard(): JGOFNumericPlayerColor[][] {
        return this.board.map((row) => row.slice());
    }

    /**
     * Toggles a group of stones for removal or restoration.
     *
     * By default, if we are marking a group for removal but the group is
     * almost certainly alive (two eyes, etc), this will result in a no-op,
     * unless force_removal is set to true.
     */
    public toggleSingleGroupRemoval(
        x: number,
        y: number,
        force_removal: boolean = false,
    ): {
        removed: boolean;
        group: RawStoneString;
    } {
        const empty = { removed: false, group: [] };
        if (x < 0 || y < 0) {
            return empty;
        }

        try {
            if (x >= 0 && y >= 0) {
                const removing = !this.removal[y][x];
                const group_color = this.board[y][x];

                if (group_color === JGOFNumericPlayerColor.EMPTY) {
                    /* Nothing to toggle. Note: we used to allow allow specific marking of
                     * dame by "removing" empty locations, however now we let our scoring
                     * engine figure dame out and if we need to communicate dame, we use
                     * the score drawing functionality */
                    return empty;
                }

                const groups = new StoneStringBuilder(this, this.board);
                const selected_group = groups.getGroup(x, y);

                /* If we're clicking on a group, do a sanity check to see if we think
                 * there is a very good chance that the group is actually definitely alive.
                 * If so, refuse to remove it, unless a player has instructed us to forcefully
                 * remove it. */
                if (removing && !force_removal) {
                    const scores = goscorer.territoryScoring(
                        this.board,
                        this.removal as any,
                        false,
                    );
                    let total_territory_adjacency_count = 0;
                    let total_territory_group_count = 0;
                    selected_group.foreachNeighboringEmptyString((gr) => {
                        let is_territory_group = false;
                        gr.map((pt) => {
                            if (
                                scores[pt.y][pt.x].isTerritoryFor === this.board[y][x] &&
                                !scores[pt.y][pt.x].isFalseEye
                            ) {
                                is_territory_group = true;
                            }
                        });

                        if (is_territory_group) {
                            total_territory_group_count += 1;
                            total_territory_adjacency_count += gr.intersections.length;
                        }
                    });
                    if (total_territory_adjacency_count >= 5 || total_territory_group_count >= 2) {
                        console.log("This group is almost assuredly alive, refusing to remove");
                        callbacks.toast?.("refusing_to_remove_group_is_alive", 4000);
                        return empty;
                    }
                }

                /* Otherwise, if it might be fine to mark as dead, or we are restoring the
                 * stone string, or we are forcefully removing the group, do the marking.
                 */
                selected_group.map(({ x, y }) => this.setRemoved(x, y, removing, false));

                this.emit("stone-removal.updated");
                return { removed: removing, group: selected_group.intersections };
            }
        } catch (err) {
            console.log(err.stack);
        }

        return empty;
    }

    /** Sets a position as being removed or not removed. If
     * `emit_stone_removal_updated` is set to false, the
     * "stone-removal.updated" event will not be emitted, and it is up to the
     * caller to emit this event appropriately.
     */
    public setRemoved(
        x: number,
        y: number,
        removed: boolean,
        emit_stone_removal_updated: boolean = true,
    ): void {
        if (x < 0 || y < 0) {
            return;
        }
        if (x > this.width || y > this.height) {
            return;
        }
        this.removal[y][x] = removed;
        if (this.goban_callback) {
            this.goban_callback.setForRemoval(x, y, this.removal[y][x], emit_stone_removal_updated);
        }
    }

    /** Clear all stone removals */
    public clearRemoved(): void {
        let updated = false;
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    updated = true;
                    this.setRemoved(x, y, false, false);
                }
            }
        }
        if (updated) {
            this.emit("stone-removal.updated");
        }
    }

    /**
     * Returns an array of groups connected to the given group. This is a bit
     * faster than using StoneGroupBuilder because we only compute the values
     * we need.
     */
    public getNeighboringRawStoneStrings(raw_stone_string: RawStoneString): RawStoneString[] {
        const gr = raw_stone_string;
        ++__current_flood_fill_value;
        this._floodFillMarkFilled(raw_stone_string);
        const ret: Array<RawStoneString> = [];
        this.foreachNeighbor(raw_stone_string, (x, y) => {
            if (this.board[y][x]) {
                ++__current_flood_fill_value;
                this._floodFillMarkFilled(gr);
                for (let i = 0; i < ret.length; ++i) {
                    this._floodFillMarkFilled(ret[i]);
                }
                const g = this.getRawStoneString(x, y, false);
                if (g.length) {
                    /* can be zero if the piece has already been marked */
                    ret.push(g);
                }
            }
        });
        return ret;
    }

    /** Returns an array of x/y pairs of all the same color */
    public getRawStoneString(x: number, y: number, clearMarks: boolean): RawStoneString {
        const color = this.board[y][x];
        if (clearMarks) {
            ++__current_flood_fill_value;
        }
        const toCheckX = [x];
        const toCheckY = [y];
        const ret = [];
        while (toCheckX.length) {
            x = toCheckX.pop() || 0;
            y = toCheckY.pop() || 0;

            if (__flood_fill_scratch_pad[y * this.width + x] === __current_flood_fill_value) {
                continue;
            }
            __flood_fill_scratch_pad[y * this.width + x] = __current_flood_fill_value;

            if (this.board[y][x] === color) {
                const pt = { x: x, y: y };
                ret.push(pt);
                this.foreachNeighbor(pt, addToCheck);
            }
        }
        function addToCheck(x: number, y: number): void {
            toCheckX.push(x);
            toCheckY.push(y);
        }

        return ret;
    }

    private _floodFillMarkFilled(group: RawStoneString): void {
        for (let i = 0; i < group.length; ++i) {
            __flood_fill_scratch_pad[group[i].y * this.width + group[i].x] =
                __current_flood_fill_value;
        }
    }
    public countLiberties(raw_stone_string: RawStoneString): number {
        let ct = 0;
        const mat = makeMatrix(this.width, this.height, 0);
        const counter = (x: number, y: number) => {
            if (this.board[y][x] === 0 && mat[y][x] === 0) {
                mat[y][x] = 1;
                ct += 1;
            }
        };
        for (let i = 0; i < raw_stone_string.length; ++i) {
            this.foreachNeighbor(raw_stone_string[i], counter);
        }
        return ct;
    }

    /**
     * Compute the liberty map for the current board.
     * This is used by kidsgo
     */
    public computeLibertyMap(): Array<Array<number>> {
        const liberties = makeMatrix(this.width, this.height, 0);

        if (!this.board) {
            return liberties;
        }

        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.board[y][x] && !liberties[y][x]) {
                    const group = this.getRawStoneString(x, y, true);
                    const count = this.countLiberties(group);

                    for (const e of group) {
                        liberties[e.y][e.x] = count;
                    }
                }
            }
        }

        return liberties;
    }

    public foreachNeighbor(
        pt_or_raw_stone_string: JGOFIntersection | RawStoneString,
        callback: (x: number, y: number) => void,
    ): void {
        if (pt_or_raw_stone_string instanceof Array) {
            const group = pt_or_raw_stone_string;
            const callback_done = new Array(this.height * this.width);
            for (let i = 0; i < group.length; ++i) {
                callback_done[group[i].x + group[i].y * this.width] = true;
            }

            /* We only want to call the callback once per point */
            const callback_one_time = (x: number, y: number) => {
                const idx = x + y * this.width;
                if (callback_done[idx]) {
                    return;
                }
                callback_done[idx] = true;
                callback(x, y);
            };

            for (let i = 0; i < group.length; ++i) {
                const pt = group[i];
                if (pt.x - 1 >= 0) {
                    callback_one_time(pt.x - 1, pt.y);
                }
                if (pt.x + 1 !== this.width) {
                    callback_one_time(pt.x + 1, pt.y);
                }
                if (pt.y - 1 >= 0) {
                    callback_one_time(pt.x, pt.y - 1);
                }
                if (pt.y + 1 !== this.height) {
                    callback_one_time(pt.x, pt.y + 1);
                }
            }
        } else {
            const pt = pt_or_raw_stone_string;
            if (pt.x - 1 >= 0) {
                callback(pt.x - 1, pt.y);
            }
            if (pt.x + 1 !== this.width) {
                callback(pt.x + 1, pt.y);
            }
            if (pt.y - 1 >= 0) {
                callback(pt.x, pt.y - 1);
            }
            if (pt.y + 1 !== this.height) {
                callback(pt.x, pt.y + 1);
            }
        }
    }

    /** Returns true if the `.board` field from the other board is equal to this one */
    public boardEquals(other: BoardState): boolean {
        return matricesAreEqual(this.board, other.board);
    }

    /**
     * Computes scoring locations for the board. If `area_scoring` is true, we
     * will use area scoring rules, otherwise we will use territory scoring rules
     * (which implies omitting territory in seki).
     */
    public computeScoringLocations(area_scoring: boolean): ScoringLocations {
        const ret: ScoringLocations = {
            black: {
                territory: 0,
                stones: 0,
                locations: [],
            },
            white: {
                territory: 0,
                stones: 0,
                locations: [],
            },
        };

        if (area_scoring) {
            const scoring = goscorer.areaScoring(this.board, this.removal);
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (scoring[y][x] === goscorer.BLACK) {
                        if (this.board[y][x] === JGOFNumericPlayerColor.BLACK) {
                            ret.black.stones += 1;
                        } else {
                            ret.black.territory += 1;
                        }
                        ret.black.locations.push({ x, y });
                    } else if (scoring[y][x] === goscorer.WHITE) {
                        if (this.board[y][x] === JGOFNumericPlayerColor.WHITE) {
                            ret.white.stones += 1;
                        } else {
                            ret.white.territory += 1;
                        }
                        ret.white.locations.push({ x, y });
                    }
                }
            }
        } else {
            const scoring = goscorer.territoryScoring(this.board, this.removal);
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (scoring[y][x].isTerritoryFor === goscorer.BLACK) {
                        ret.black.territory += 1;
                        ret.black.locations.push({ x, y });
                    } else if (scoring[y][x].isTerritoryFor === goscorer.WHITE) {
                        ret.white.territory += 1;
                        ret.white.locations.push({ x, y });
                    }
                }
            }
        }

        return ret;
    }
}
