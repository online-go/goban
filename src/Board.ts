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

import { Events } from "./GobanCore";
import { EventEmitter } from "eventemitter3";
import { JGOFNumericPlayerColor } from "./JGOF";
import { makeMatrix } from "./GoMath";
import * as goscorer from "./goscorer/goscorer";
import { StoneStringBuilder } from "./StoneStringBuilder";
import { GobanCore } from "./GobanCore";
import { RawStoneString } from "./StoneString";
import { cloneMatrix } from "./util";
import { callbacks } from "./callbacks";

export interface BoardConfig {
    width?: number;
    height?: number;
    board?: JGOFNumericPlayerColor[][];
    removal?: boolean[][];
}

export class Board extends EventEmitter<Events> {
    public readonly height: number = 19;
    //public readonly rules:GoEngineRules = 'japanese';
    public readonly width: number = 19;
    public board: JGOFNumericPlayerColor[][];
    public removal: boolean[][];
    protected goban_callback?: GobanCore;

    /**
     * Constructs a new board with the given configuration. If height/width
     * are not provided, they will be inferred from the board array, or will
     * default to 19x19 if no board is provided.
     *
     * Any state matrices (board, removal, etc..) provided will be cloned
     * and must have the same dimensionality.
     */
    constructor(config: BoardConfig, goban_callback?: GobanCore) {
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
}
