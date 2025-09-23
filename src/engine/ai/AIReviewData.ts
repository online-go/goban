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

import EventEmitter from "eventemitter3";
import { GobanSocket, GobanSocketEvents } from "../GobanSocket";
import { JGOFAIReview, JGOFAIReviewMove } from "../formats/JGOF";
import * as protocol from "../protocol";
import { MoveTree } from "../MoveTree";
import { deepClone } from "../util";
import { GobanMoveErrorMessageId } from "../GobanError";

export interface AIReviewDataEvents {
    connected: () => void;
    destroy: () => void;
    metadata: (ai_review: JGOFAIReview) => void;
    update: () => void;
}

export class AIReviewData extends EventEmitter<AIReviewDataEvents> implements JGOFAIReview {
    public readonly socket: GobanSocket<protocol.ClientToAIServer, protocol.AIServerToClient>;
    public readonly uuid: string;
    private ai_review: JGOFAIReview;
    public readonly move_tree: MoveTree;

    constructor(
        socket: GobanSocket<protocol.ClientToAIServer, protocol.AIServerToClient>,
        move_tree: MoveTree,
        ai_review: JGOFAIReview,
        game_id: number | string,
    ) {
        super();
        this.socket = socket;
        this.uuid = ai_review.uuid;
        this.ai_review = deepClone(ai_review);
        this.move_tree = move_tree;

        /* Set up socket listeners */
        const onConnect = () => {
            this.socket.send("ai-review-connect", {
                uuid: this.uuid,
                game_id: game_id,
                ai_review_id: this.ai_review.id,
            });
            this.emit("connected");
        };
        const onMessage = (data: JGOFAIReviewMove) => {
            this.processUpdate(data);
            this.emit("update");
        };

        this.socket.on(this.uuid as keyof GobanSocketEvents, onMessage as any);
        this.socket.on("connect", onConnect);
        if (this.socket.connected) {
            onConnect();
        }

        this.on("destroy", () => {
            if (this.socket.connected) {
                this.socket.send("ai-review-disconnect", {
                    uuid: this.uuid,
                });
            }
            this.socket.off("connect", onConnect);
            this.socket.off(this.uuid as keyof GobanSocketEvents, onMessage as any);
        });
    }

    public destroy() {
        this.emit("destroy");
    }

    public get id(): string {
        return this.ai_review.id;
    }

    public get type(): "fast" | "full" {
        return this.ai_review.type;
    }

    public get network(): string {
        return this.ai_review.network;
    }

    public get network_size(): string {
        return this.ai_review.network_size;
    }

    public get engine(): string {
        return this.ai_review.engine;
    }

    public get engine_version(): string {
        return this.ai_review.engine_version;
    }

    public get strength(): number {
        return this.ai_review.strength;
    }

    public get date(): number {
        return this.ai_review.date;
    }

    public get win_rate(): number {
        return this.ai_review.win_rate;
    }

    public get win_rates(): Array<number> {
        if (!this.ai_review.win_rates) {
            this.ai_review.win_rates = [];
        }
        return this.ai_review.win_rates;
    }

    public get scores(): Array<number> | undefined {
        return this.ai_review.scores;
    }

    public get moves(): { [key: string]: JGOFAIReviewMove } {
        return this.ai_review.moves;
    }

    public get analyzed_variations(): { [key: string]: JGOFAIReviewMove } | undefined {
        return this.ai_review.analyzed_variations;
    }

    public get error():
        | undefined
        | {
              message_id: GobanMoveErrorMessageId;
              move_number: number;
              coords: string;
          } {
        return this.ai_review.error;
    }

    private updateAIReviewMetadata(ai_review: JGOFAIReview): void {
        if (!this.ai_review || this.ai_review.uuid !== ai_review.uuid) {
            this.ai_review = ai_review;
        } else {
            for (const k in ai_review) {
                if (k !== "moves" || !this.ai_review["moves"]) {
                    (this.ai_review as any)[k] = (ai_review as any)[k];
                } else {
                    for (const move in ai_review["moves"]) {
                        this.ai_review["moves"][move] = ai_review["moves"][move];
                    }
                }
            }
        }

        this.emit("metadata", ai_review);
    }

    private deferred_update_timeout?: ReturnType<typeof setTimeout>;
    private deferred_queue?: { [key: string]: any };

    private processUpdate(data: { [key: string]: any }) {
        const move_tree = this.move_tree;

        if (this.deferred_queue) {
            for (const key in data) {
                this.deferred_queue[key] = data[key];
            }
        } else {
            this.deferred_queue = data;
            this.deferred_update_timeout = setTimeout(() => {
                const data = this.deferred_queue;
                delete this.deferred_update_timeout;
                delete this.deferred_queue;

                for (const key in data) {
                    const value = data[key];
                    if (key === "metadata") {
                        this.updateAIReviewMetadata(value as JGOFAIReview);
                    } else if (key === "error") {
                        if (this.ai_review) {
                            this.ai_review.error = value;
                        } else {
                            console.error("AI Review missing, cannot update error", value);
                        }
                    } else if (/move-[0-9]+/.test(key)) {
                        if (!this.ai_review) {
                            console.warn(
                                "AI Review move received but ai review not initialized yet",
                            );
                            return;
                        }

                        const m = key.match(/move-([0-9]+)/) as string[];
                        const move_number = parseInt(m[1]);

                        // Store the new move data
                        this.ai_review.moves[move_number] = value;

                        // Back-propagation: Update previous move's branches to include this move
                        if (move_number > 0 && this.ai_review.moves[move_number - 1]) {
                            const prev_move = this.ai_review.moves[move_number - 1];
                            if (!prev_move.branches) {
                                prev_move.branches = [];
                            }

                            // Get move coordinates - try from AI data first, then from move tree
                            let move_coords = value.move;
                            if (!move_coords || move_coords.x === undefined) {
                                const mv = move_tree.index(move_number);
                                move_coords = { x: mv.x, y: mv.y };
                            }

                            let found = false;
                            for (const branch of prev_move.branches) {
                                if (
                                    branch.moves &&
                                    branch.moves.length > 0 &&
                                    branch.moves[0].x === move_coords.x &&
                                    branch.moves[0].y === move_coords.y
                                ) {
                                    // Update with latest data
                                    branch.win_rate = value.win_rate;
                                    branch.score = value.score;
                                    // we don't update branch.visits here because it would make the heatmap too intense
                                    found = true;
                                    break;
                                }
                            }

                            // If not found, add it to ensure it's tracked
                            if (!found) {
                                prev_move.branches.push({
                                    moves: [move_coords],
                                    win_rate: value.win_rate,
                                    score: value.score,
                                    visits: 1, // very light heatmap
                                });
                            }
                        }

                        // Pull next move into our branches: If we already have the next move, update this move's branches
                        if (this.ai_review.moves[move_number + 1]) {
                            const next_move = this.ai_review.moves[move_number + 1];
                            if (!value.branches) {
                                value.branches = [];
                            }

                            // Get next move coordinates - try from AI data first, then from move tree
                            let next_coords = next_move.move;
                            if (!next_coords || next_coords.x === undefined) {
                                const mv = move_tree.index(move_number + 1);
                                next_coords = { x: mv.x, y: mv.y };
                            }

                            let found = false;
                            for (const branch of value.branches) {
                                if (
                                    branch.moves &&
                                    branch.moves.length > 0 &&
                                    branch.moves[0].x === next_coords.x &&
                                    branch.moves[0].y === next_coords.y
                                ) {
                                    // Update with latest data
                                    branch.win_rate = next_move.win_rate;
                                    branch.score = next_move.score;
                                    // we don't update branch.visits here because it would make the heatmap too intense
                                    found = true;
                                    break;
                                }
                            }

                            // If not found, add it
                            if (!found) {
                                value.branches.push({
                                    moves: [next_coords],
                                    win_rate: next_move.win_rate,
                                    score: next_move.score,
                                    visits: 1, // very light heatmap
                                });
                            }
                        }
                    } else if (/variation-([0-9]+)-([!12a-z.A-Z-]+)/.test(key)) {
                        if (!this.ai_review) {
                            console.warn(
                                "AI Review move received but ai review not initialized yet",
                            );
                            return;
                        }
                        if (!this.ai_review.analyzed_variations) {
                            this.ai_review.analyzed_variations = {};
                        }
                        const m = key.match(/variation-([!0-9a-z.A-Z-]+)/) as string[];
                        const var_key = m[1];
                        this.ai_review.analyzed_variations[var_key] = value;
                    } else {
                        console.warn(`Unrecognized key in updateAiReview data: ${key}`, value);
                    }
                }

                this.emit("update");
            }, 100);
        }
    }
}
