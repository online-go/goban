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

import { GobanInteractive, MARK_TYPES, MoveCommand } from "./InteractiveBase";
import { AudioClockEvent, GobanConfig, JGOFClockWithTransmitting } from "../GobanBase";
import { callbacks } from "./callbacks";
import { _, interpolate } from "../engine/translate";
import { focus_tracker } from "./focus_tracker";
import {
    AdHocClock,
    AdHocPauseControl,
    AdHocPlayerClock,
    AUTOSCORE_TOLERANCE,
    AUTOSCORE_TRIALS,
    ConditionalMoveResponse,
    deepEqual,
    deepClone,
    encodeMove,
    GobanSocket,
    GobanSocketEvents,
    ConditionalMoveTree,
    GobanEngine,
    init_wasm_ownership_estimator,
    JGOFIntersection,
    JGOFPauseState,
    JGOFPlayerClock,
    JGOFPlayerSummary,
    JGOFTimeControl,
    MarkInterface,
    niceInterval,
    ReviewMessage,
    ScoreEstimator,
    JGOFMove,
    makeMatrix,
} from "../engine";
import {
    //ServerToClient,
    GameChatMessage,
    //GameChatLine,
    //StallingScoreEstimate,
} from "../engine/protocol";

declare let swal: any;

interface JGOFPlayerClockWithTimedOut extends JGOFPlayerClock {
    timed_out: boolean;
}
/**
 * This class serves as a functionality layer encapsulating the logic connection
 * that manages connections to the online-go.com servers.
 *
 * We have it as a separate base class simply to help with code organization
 * and to keep our Goban class size down.
 */
export abstract class OGSConnectivity extends GobanInteractive {
    public sent_timed_out_message: boolean = false;
    protected socket!: GobanSocket;
    protected socket_event_bindings: Array<[keyof GobanSocketEvents, () => void]> = [];
    protected connectToReviewSent?: boolean;

    constructor(config: GobanConfig, preloaded_data?: GobanConfig) {
        super(config, preloaded_data);
        this.setGameClock(null);

        this.on("load", (config) => {
            if (
                this.engine.phase === "stone removal" &&
                !("auto_scoring_done" in this) &&
                !("auto_scoring_done" in (this as any).engine)
            ) {
                this.performStoneRemovalAutoScoring();
            }
        });
    }

    protected override post_config_constructor(): GobanEngine {
        const ret = super.post_config_constructor();

        if ("server_socket" in this.config && this.config["server_socket"]) {
            if (!this.preloaded_data) {
                this.showMessage("loading", undefined, -1);
            }
            this.connect(this.config["server_socket"]);
        }

        return ret;
    }

    public override destroy(): void {
        super.destroy();
        if (this.socket) {
            this.disconnect();
        }
        if (this.sendLatencyTimer) {
            clearInterval(this.sendLatencyTimer);
            delete this.sendLatencyTimer;
        }

        /* Clear various timeouts that may be running */
        this.clock_should_be_paused_for_move_submission = false;
        this.setGameClock(null);
    }

    protected _socket_on<KeyT extends keyof GobanSocketEvents>(event: KeyT, cb: any) {
        this.socket.on(event, cb);
        this.socket_event_bindings.push([event, cb]);
    }

    protected getClockDrift(): number {
        if (callbacks.getClockDrift) {
            return callbacks.getClockDrift();
        }
        console.warn("getClockDrift not provided for Goban instance");
        return 0;
    }
    protected getNetworkLatency(): number {
        if (callbacks.getNetworkLatency) {
            return callbacks.getNetworkLatency();
        }
        console.warn("getNetworkLatency not provided for Goban instance");
        return 0;
    }

    protected connect(server_socket: GobanSocket): void {
        const socket = (this.socket = server_socket);

        this.disconnectedFromGame = false;
        //this.on_disconnects = [];

        const send_connect_message = () => {
            if (this.disconnectedFromGame) {
                return;
            }

            if (this.review_id) {
                this.connectToReviewSent = true;
                this.done_loading_review = false;
                this.setTitle(_("Review"));
                if (!this.disconnectedFromGame) {
                    socket.send("review/connect", {
                        review_id: this.review_id,
                    });
                }
                this.emit("chat-reset");
            } else if (this.game_id) {
                if (!this.disconnectedFromGame) {
                    socket.send("game/connect", {
                        game_id: this.game_id,
                        chat: !!this.config.connect_to_chat,
                    });
                }
            }

            if (!this.sendLatencyTimer) {
                const sendLatency = () => {
                    if (!this.interactive) {
                        return;
                    }
                    if (!this.isCurrentUserAPlayer()) {
                        return;
                    }
                    if (!callbacks.getNetworkLatency) {
                        return;
                    }
                    const latency = callbacks.getNetworkLatency();
                    if (!latency) {
                        return;
                    }

                    if (!this.game_id || this.game_id <= 0) {
                        return;
                    }

                    this.socket.send("game/latency", {
                        game_id: this.game_id,
                        latency: this.getNetworkLatency(),
                    });
                };
                this.sendLatencyTimer = niceInterval(sendLatency, 5000);
                sendLatency();
            }
        };

        if (socket.connected) {
            send_connect_message();
        }

        this._socket_on("connect", send_connect_message);
        this._socket_on("disconnect", (): void => {
            if (this.disconnectedFromGame) {
                return;
            }
        });

        let reconnect = false;

        this._socket_on("connect", () => {
            if (this.disconnectedFromGame) {
                return;
            }
            if (reconnect) {
                this.emit("audio-reconnected");
            }
            reconnect = true;
        });
        this._socket_on("disconnect", (): void => {
            if (this.disconnectedFromGame) {
                return;
            }
            this.emit("audio-disconnected");
        });

        let prefix = null;

        if (this.game_id) {
            prefix = "game/" + this.game_id + "/";
        }
        if (this.review_id) {
            prefix = "review/" + this.review_id + "/";
        }

        this._socket_on((prefix + "error") as keyof GobanSocketEvents, (msg: any): void => {
            if (this.disconnectedFromGame) {
                return;
            }
            this.emit("error", msg);
            let duration = 500;

            if (msg === "This is a protected game" || msg === "This is a protected review") {
                duration = -1;
            }

            this.showMessage("error", { error: { message: _(msg) } }, duration);
            console.error("ERROR: ", msg);
        });

        /*****************/
        /*** Game mode ***/
        /*****************/
        if (this.game_id) {
            this._socket_on(
                (prefix + "gamedata") as keyof GobanSocketEvents,
                (obj: GobanConfig): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    this.clearMessage();
                    //this.onClearChatLogs();

                    this.emit("chat-reset");
                    focus_tracker.reset();

                    if (
                        this.last_phase &&
                        this.last_phase !== "finished" &&
                        obj.phase === "finished"
                    ) {
                        const winner = obj.winner;
                        let winner_color: "black" | "white" | "tie" | undefined;

                        if (typeof winner === "string") {
                            winner_color = winner;
                        } else if (typeof winner === "number") {
                            switch (winner) {
                                case 0:
                                    winner_color = "tie";
                                    break;
                                case obj.black_player_id:
                                    winner_color = "black";
                                    break;
                                case obj.white_player_id:
                                    winner_color = "white";
                                    break;
                            }
                        }

                        if (winner_color) {
                            this.emit("audio-game-ended", winner_color);
                        }
                    }
                    if (obj.phase) {
                        this.last_phase = obj.phase;
                    } else {
                        console.warn(`Game gamedata missing phase`);
                    }
                    this.load(obj);
                    this.emit("gamedata", obj);
                },
            );
            this._socket_on(
                (prefix + "chat") as keyof GobanSocketEvents,
                (obj: GameChatMessage): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }
                    obj.line.channel = obj.channel;
                    this.chat_log.push(obj.line);
                    this.emit("chat", obj.line);
                },
            );
            this._socket_on((prefix + "reset-chats") as keyof GobanSocketEvents, (): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                this.emit("chat-reset");
            });
            this._socket_on(
                (prefix + "chat/remove") as keyof GobanSocketEvents,
                (obj: any): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }
                    this.emit("chat-remove", obj);
                },
            );
            this._socket_on((prefix + "message") as keyof GobanSocketEvents, (msg: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }
                this.showMessage("server_message", { message: msg });
            });
            delete this.last_phase;

            this._socket_on((prefix + "latency") as keyof GobanSocketEvents, (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                if (this.engine) {
                    if (!this.engine.latencies) {
                        this.engine.latencies = {};
                    }
                    this.engine.latencies[obj.player_id] = obj.latency;
                }
            });
            this._socket_on((prefix + "clock") as keyof GobanSocketEvents, (obj: any): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.clock_should_be_paused_for_move_submission = false;
                this.setGameClock(obj);

                this.updateTitleAndStonePlacement();
                this.emit("update");
            });
            this._socket_on(
                (prefix + "phase") as keyof GobanSocketEvents,
                (new_phase: any): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    this.setMode("play");
                    if (new_phase !== "finished") {
                        this.engine.clearRemoved();
                    }

                    if (this.engine.phase !== new_phase) {
                        if (new_phase === "stone removal") {
                            this.emit("audio-enter-stone-removal");
                        }
                        if (new_phase === "play" && this.engine.phase === "stone removal") {
                            this.emit("audio-resume-game-from-stone-removal");
                        }
                    }

                    this.engine.phase = new_phase;

                    if (this.engine.phase === "stone removal") {
                        this.performStoneRemovalAutoScoring();
                    } else {
                        delete this.stone_removal_auto_scoring_done;
                    }

                    this.updateTitleAndStonePlacement();
                    this.emit("update");
                },
            );
            this._socket_on(
                (prefix + "undo_requested") as keyof GobanSocketEvents,
                (move_number: string): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    this.engine.undo_requested = parseInt(move_number);
                    this.emit("update");
                    this.emit("audio-undo-requested");
                    if (this.getShowUndoRequestIndicator()) {
                        this.redraw(true); // need to update the mark on the last move
                    }
                },
            );
            this._socket_on((prefix + "undo_canceled") as keyof GobanSocketEvents, (): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                this.engine.undo_requested = undefined; // can't call delete here because this is a getter/setter
                this.emit("update");
                this.emit("undo_canceled");
                if (this.getShowUndoRequestIndicator()) {
                    this.redraw(true);
                }
            });
            this._socket_on((prefix + "undo_accepted") as keyof GobanSocketEvents, (): void => {
                if (this.disconnectedFromGame) {
                    return;
                }

                if (!this.engine.undo_requested) {
                    console.warn("Undo accepted, but no undo requested, we might be out of sync");
                    try {
                        swal.fire(
                            "Game synchronization error related to undo, please reload your game page",
                        );
                    } catch (e) {
                        console.error(e);
                    }
                    return;
                }

                this.engine.undo_requested = undefined;

                this.setMode("play");
                this.engine.showPrevious();
                this.engine.setLastOfficialMove();

                this.setConditionalTree();

                this.engine.undo_requested = undefined;
                this.updateTitleAndStonePlacement();
                this.emit("update");
                this.emit("audio-undo-granted");
            });
            this._socket_on((prefix + "move") as keyof GobanSocketEvents, (move_obj: any): void => {
                try {
                    if (this.disconnectedFromGame) {
                        return;
                    }
                    focus_tracker.reset();

                    if (move_obj.game_id !== this.game_id) {
                        console.error(
                            "Invalid move for this game received [" + this.game_id + "]",
                            move_obj,
                        );
                        return;
                    }
                    const move = move_obj.move;

                    if (this.isInPushedAnalysis()) {
                        this.leavePushedAnalysis();
                    }

                    /* clear any undo state that may be hanging around */
                    this.engine.undo_requested = undefined;

                    const mv = this.engine.decodeMoves(move);

                    if (mv.length > 1) {
                        console.warn(
                            "More than one move provided in encoded move in a `move` event.  That's odd.",
                        );
                    }

                    const the_move = mv[0];

                    if (this.mode === "conditional" || this.mode === "play") {
                        this.setMode("play");
                    }

                    let jump_to_move = null;
                    if (
                        this.engine.cur_move.id !== this.engine.last_official_move.id &&
                        ((this.engine.cur_move.parent == null &&
                            this.engine.cur_move.trunk_next != null) ||
                            this.engine.cur_move.parent?.id !== this.engine.last_official_move.id)
                    ) {
                        jump_to_move = this.engine.cur_move;
                    }
                    this.engine.jumpToLastOfficialMove();

                    if (this.engine.playerToMove() !== this.player_id) {
                        const t = this.conditional_tree.getChild(
                            encodeMove(the_move.x, the_move.y),
                        );
                        t.move = null;
                        this.setConditionalTree(t);
                    }

                    if (this.engine.getMoveNumber() !== move_obj.move_number - 1) {
                        this.showMessage("synchronization_error");
                        setTimeout(() => {
                            window.location.href = window.location.href;
                        }, 2500);
                        console.error(
                            "Synchronization error, we thought move should be " +
                                this.engine.getMoveNumber() +
                                " server thought it should be " +
                                (move_obj.move_number - 1),
                        );

                        return;
                    }

                    const score_before_move =
                        this.engine.computeScore(true)[this.engine.colorToMove()].prisoners;

                    let removed_count = 0;
                    const removed_stones: Array<JGOFIntersection> = [];
                    if (the_move.edited) {
                        this.engine.editPlace(the_move.x, the_move.y, the_move.color || 0);
                    } else {
                        removed_count = this.engine.place(
                            the_move.x,
                            the_move.y,
                            false,
                            false,
                            false,
                            true,
                            true,
                            removed_stones,
                        );
                    }

                    if (the_move.player_update && this.engine.player_pool) {
                        //console.log("`move` got player update:", the_move.player_update);
                        this.engine.cur_move.player_update = the_move.player_update;
                        this.engine.updatePlayers(the_move.player_update);
                    }

                    if (the_move.played_by) {
                        this.engine.cur_move.played_by = the_move.played_by;
                    }

                    this.setLastOfficialMove();
                    delete this.move_selected;

                    if (jump_to_move) {
                        this.engine.jumpTo(jump_to_move);
                    }

                    this.emit("update");
                    this.playMovementSound();
                    if (removed_count) {
                        console.log("audio-capture-stones", {
                            count: removed_count,
                            already_captured: score_before_move,
                        });
                        this.emit("audio-capture-stones", {
                            count: removed_count,
                            already_captured: score_before_move,
                        });
                        this.debouncedEmitCapturedStones(removed_stones);
                    }

                    this.emit("move-made");

                    /*
                    if (this.move_number) {
                        this.move_number.text(this.engine.getMoveNumber());
                    }
                    */
                } catch (e) {
                    console.error(e);
                }
            });

            this._socket_on(
                (prefix + "player_update") as keyof GobanSocketEvents,
                (player_update: JGOFPlayerSummary): void => {
                    try {
                        let jump_to_move = null;
                        if (
                            this.engine.cur_move.id !== this.engine.last_official_move.id &&
                            ((this.engine.cur_move.parent == null &&
                                this.engine.cur_move.trunk_next != null) ||
                                this.engine.cur_move.parent?.id !==
                                    this.engine.last_official_move.id)
                        ) {
                            jump_to_move = this.engine.cur_move;
                        }
                        this.engine.jumpToLastOfficialMove();

                        this.engine.cur_move.player_update = player_update;
                        this.engine.updatePlayers(player_update);

                        if (this.mode === "conditional" || this.mode === "play") {
                            this.setMode("play");
                        } else {
                            console.warn("unexpected player_update received!");
                        }

                        if (jump_to_move) {
                            this.engine.jumpTo(jump_to_move);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                    this.emit("player-update", player_update);
                },
            );

            this._socket_on(
                (prefix + "conditional_moves") as keyof GobanSocketEvents,
                (cmoves: {
                    player_id: number;
                    move_number: number;
                    moves: ConditionalMoveResponse | null;
                }): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    if (cmoves.moves == null) {
                        this.setConditionalTree();
                    } else {
                        this.setConditionalTree(ConditionalMoveTree.decode(cmoves.moves));
                    }
                },
            );
            this._socket_on(
                (prefix + "removed_stones") as keyof GobanSocketEvents,
                (cfg: any): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    if ("strict_seki_mode" in cfg) {
                        this.engine.strict_seki_mode = cfg.strict_seki_mode;
                    } else {
                        const removed = cfg.removed;
                        const stones = cfg.stones;
                        let moves: JGOFMove[];
                        if (!stones) {
                            moves = [];
                        } else {
                            moves = this.engine.decodeMoves(stones);
                        }

                        for (let i = 0; i < moves.length; ++i) {
                            this.engine.setRemoved(moves[i].x, moves[i].y, removed, false);
                        }
                        this.emit("stone-removal.updated");
                    }
                    this.updateTitleAndStonePlacement();
                    this.emit("update");
                },
            );
            this._socket_on(
                (prefix + "removed_stones_accepted") as keyof GobanSocketEvents,
                (cfg: any): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }

                    const player_id = cfg.player_id;
                    const stones = cfg.stones;

                    if (player_id === 0) {
                        this.engine.players["white"].accepted_stones = stones;
                        this.engine.players["black"].accepted_stones = stones;
                    } else {
                        const color = this.engine.playerColor(player_id);
                        if (color === "invalid") {
                            console.error(
                                `Invalid player_id ${player_id} in removed_stones_accepted`,
                                {
                                    cfg,
                                    player_id: this.player_id,
                                    players: this.engine.players,
                                },
                            );
                            throw new Error(
                                `Invalid player_id ${player_id} in removed_stones_accepted`,
                            );
                        } else {
                            this.engine.players[color].accepted_stones = stones;
                            this.engine.players[color].accepted_strict_seki_mode =
                                "strict_seki_mode" in cfg ? cfg.strict_seki_mode : false;
                        }
                    }
                    this.updateTitleAndStonePlacement();
                    this.emit("stone-removal.accepted");
                    this.emit("update");
                },
            );

            const auto_resign_state: { [id: number]: boolean } = {};

            this._socket_on((prefix + "auto_resign") as keyof GobanSocketEvents, (obj: any) => {
                this.emit("auto-resign", {
                    game_id: obj.game_id,
                    player_id: obj.player_id,
                    expiration: obj.expiration,
                });
                auto_resign_state[obj.player_id] = true;
                this.emit("audio-other-player-disconnected", {
                    player_id: obj.player_id,
                });
            });
            this._socket_on(
                (prefix + "clear_auto_resign") as keyof GobanSocketEvents,
                (obj: any) => {
                    this.emit("clear-auto-resign", {
                        game_id: obj.game_id,
                        player_id: obj.player_id,
                    });
                    if (auto_resign_state[obj.player_id]) {
                        this.emit("audio-other-player-reconnected", {
                            player_id: obj.player_id,
                        });
                        delete auto_resign_state[obj.player_id];
                    }
                },
            );
            this._socket_on(
                (prefix + "stalling_score_estimate") as keyof GobanSocketEvents,
                (obj: any): void => {
                    if (this.disconnectedFromGame) {
                        return;
                    }
                    console.log("Score estimate received: ", obj);
                    //obj.line.channel = obj.channel;
                    //this.chat_log.push(obj.line);
                    this.engine.stalling_score_estimate = obj;
                    this.engine.config.stalling_score_estimate = obj;
                    this.emit("stalling_score_estimate", obj);
                },
            );
        }

        /*******************/
        /*** Review mode ***/
        /*******************/
        let bulk_processing = false;
        const process_r = (obj: ReviewMessage) => {
            if (this.disconnectedFromGame) {
                return;
            }

            if (obj.chat) {
                obj.chat.channel = "discussion";
                if (!obj.chat.chat_id) {
                    obj.chat.chat_id = obj.chat.player_id + "." + obj.chat.date;
                }
                this.chat_log.push(obj.chat as any);
                this.emit("chat", obj.chat);
            }

            if (obj["remove-chat"]) {
                this.emit("chat-remove", { chat_ids: [obj["remove-chat"]] });
            }

            if (obj.gamedata) {
                if (obj.gamedata.phase === "stone removal") {
                    obj.gamedata.phase = "finished";
                }

                this.load(obj.gamedata);
                this.review_had_gamedata = true;
            }

            if (obj.player_update && this.engine.player_pool) {
                console.log("process_r got player update:", obj.player_update);
                this.engine.updatePlayers(obj.player_update);
            }

            if (obj.owner) {
                this.review_owner_id = typeof obj.owner === "object" ? obj.owner.id : obj.owner;
            }
            if (obj.controller) {
                this.review_controller_id =
                    typeof obj.controller === "object" ? obj.controller.id : obj.controller;
            }

            if (
                !this.isPlayerController() ||
                !this.done_loading_review ||
                "om" in obj /* official moves are always alone in these object broadcasts */ ||
                "undo" in obj /* official moves are always alone in these object broadcasts */
            ) {
                const cur_move = this.engine.cur_move;
                const follow =
                    this.engine.cur_review_move == null ||
                    this.engine.cur_review_move.id === cur_move.id;
                let do_redraw = false;
                if ("f" in obj && typeof obj.m === "string") {
                    /* specifying node */
                    const t = this.done_loading_review;
                    this.done_loading_review =
                        false; /* this prevents drawing from being drawn when we do a follow path. */
                    this.engine.followPath(obj.f || 0, obj.m);
                    this.drawSquare(this.engine.cur_move.x, this.engine.cur_move.y);
                    this.done_loading_review = t;
                    this.engine.setAsCurrentReviewMove();
                    this.scheduleRedrawPenLayer();
                }

                if ("om" in obj) {
                    /* Official move [comes from live review of game] */
                    const t = this.engine.cur_review_move || this.engine.cur_move;
                    const mv = this.engine.decodeMoves([obj.om] as any)[0];
                    const follow_om = t.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.place(mv.x, mv.y, false, false, true, true, true);
                    this.engine.setLastOfficialMove();
                    if (
                        (t.x !== mv.x ||
                            t.y !== mv.y) /* case when a branch has been promoted to trunk */ &&
                        !follow_om
                    ) {
                        /* case when they were on a last official move, auto-follow to next */
                        this.engine.jumpTo(t);
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.move_tree_redraw();
                    }
                }

                if ("undo" in obj) {
                    /* Official undo move [comes from live review of game] */
                    const t = this.engine.cur_review_move;
                    const cur_move_undone =
                        this.engine.cur_review_move?.id === this.engine.last_official_move.id;
                    this.engine.jumpToLastOfficialMove();
                    this.engine.showPrevious();
                    this.engine.setLastOfficialMove();
                    if (!cur_move_undone) {
                        if (t) {
                            this.engine.jumpTo(t);
                        } else {
                            console.warn(
                                `No valid move to jump back to in review game relay of undo`,
                            );
                        }
                    }
                    this.engine.setAsCurrentReviewMove();
                    if (this.done_loading_review) {
                        this.move_tree_redraw();
                    }
                }

                if (this.engine.cur_review_move) {
                    if (typeof obj["t"] === "string") {
                        /* set text */
                        this.engine.cur_review_move.text = obj["t"];
                    }
                    if ("t+" in obj) {
                        /* append to text */
                        this.engine.cur_review_move.text += obj["t+"];
                    }
                    if (typeof obj.k !== "undefined") {
                        /* set marks */
                        const t = this.engine.cur_move;
                        this.engine.cur_review_move.clearMarks();
                        this.engine.cur_move = this.engine.cur_review_move;
                        this.setMarks(obj["k"], this.engine.cur_move.id !== t.id);
                        this.engine.cur_move = t;
                        if (this.engine.cur_move.id === t.id) {
                            this.redraw();
                        }
                    }
                    if ("clearpen" in obj) {
                        this.engine.cur_review_move.pen_marks = [];
                        this.scheduleRedrawPenLayer();
                        do_redraw = false;
                    }
                    if ("delete" in obj) {
                        const t = this.engine.cur_review_move.parent;
                        this.engine.cur_review_move.remove();
                        this.engine.jumpTo(t);
                        this.engine.setAsCurrentReviewMove();
                        this.scheduleRedrawPenLayer();
                        if (this.done_loading_review) {
                            this.move_tree_redraw();
                        }
                    }
                    if (typeof obj.pen !== "undefined") {
                        /* start pen */
                        this.engine.cur_review_move.pen_marks.push({
                            color: obj["pen"],
                            points: [],
                        });
                    }
                    if (typeof obj.pp !== "undefined") {
                        /* update pen marks */
                        try {
                            const pts =
                                this.engine.cur_review_move.pen_marks[
                                    this.engine.cur_review_move.pen_marks.length - 1
                                ].points;
                            this.engine.cur_review_move.pen_marks[
                                this.engine.cur_review_move.pen_marks.length - 1
                            ].points = pts.concat(obj["pp"]);
                            this.scheduleRedrawPenLayer();
                            do_redraw = false;
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }

                if (this.done_loading_review) {
                    if (!follow) {
                        this.engine.jumpTo(cur_move);
                        this.move_tree_redraw();
                    } else {
                        if (do_redraw) {
                            this.redraw(true);
                        }
                        if (!this.__update_move_tree) {
                            this.__update_move_tree = setTimeout(() => {
                                this.__update_move_tree = null;
                                this.updateOrRedrawMoveTree();
                                this.emit("update");
                            }, 100);
                        }
                    }
                }
            }

            if ("controller" in obj) {
                if (!("owner" in obj)) {
                    /* only false at index 0 of the replay log */
                    if (this.isPlayerController()) {
                        this.emit("review.sync-to-current-move");
                    }
                    this.updateTitleAndStonePlacement();
                    const line = {
                        system: true,
                        chat_id: uuid(),
                        body: interpolate(_("Control passed to %s"), [
                            typeof obj.controller === "number"
                                ? `%%%PLAYER-${obj.controller}%%%`
                                : obj.controller?.username || "[missing controller name]",
                        ]),
                        channel: "system",
                    };
                    //this.chat_log.push(line);
                    this.emit("chat", line);
                    this.emit("update");
                }
            }
            if (!bulk_processing) {
                this.emit("review.updated");
            }
        };

        if (this.review_id) {
            this._socket_on(
                `review/${this.review_id}/full_state`,
                (entries: Array<ReviewMessage>) => {
                    try {
                        if (!entries || entries.length === 0) {
                            console.error("Blank full state received, ignoring");
                            return;
                        }
                        if (this.disconnectedFromGame) {
                            return;
                        }

                        this.disableDrawing();
                        /* TODO: Clear our state here better */

                        this.emit("review.load-start");
                        bulk_processing = true;
                        for (let i = 0; i < entries.length; ++i) {
                            process_r(entries[i]);
                        }
                        bulk_processing = false;

                        this.enableDrawing();
                        /*
                    if (this.isPlayerController()) {
                        this.done_loading_review = true;
                        this.drawPenMarks(this.engine.cur_move.pen_marks);
                        this.redraw(true);
                        return;
                    }
                    */

                        this.done_loading_review = true;
                        this.drawPenMarks(this.engine.cur_move.pen_marks);
                        this.emit("review.load-end");
                        this.emit("review.updated");
                        this.move_tree_redraw();
                        this.redraw(true);
                    } catch (e) {
                        console.error(e);
                    }
                },
            );
            this._socket_on(`review/${this.review_id}/r`, process_r);
        }

        return;
    }

    protected disconnect(): void {
        this.emit("destroy");
        if (!this.disconnectedFromGame) {
            this.disconnectedFromGame = true;
            if (this.socket && this.socket.connected) {
                if (this.review_id) {
                    this.socket.send("review/disconnect", { review_id: this.review_id });
                }
                if (this.game_id) {
                    this.socket.send("game/disconnect", { game_id: this.game_id });
                }
            }
        }
        for (const pair of this.socket_event_bindings) {
            this.socket.off(pair[0], pair[1]);
        }
        this.socket_event_bindings = [];
    }

    public sendChat(msg_body: string, type: string) {
        if (typeof msg_body === "string" && msg_body.length === 0) {
            return;
        }

        const msg: any = {
            body: msg_body,
        };

        if (this.game_id) {
            msg["type"] = type;
            msg["game_id"] = this.game_id;
            msg["move_number"] = this.engine.getCurrentMoveNumber();
            this.socket.send("game/chat", msg);
        } else {
            const diff = this.engine.getMoveDiff();
            msg["review_id"] = this.review_id;
            msg["from"] = diff.from;
            msg["moves"] = diff.moves;
            this.socket.send("review/chat", msg);
        }
    }

    /**
     * When we think our clock has runout, send a message to the server
     * letting it know. Otherwise we have to wait for the server grace
     * period to expire for it to time us out.
     */
    public sendTimedOut(): void {
        if (!this.sent_timed_out_message) {
            if (this.engine?.phase === "play") {
                console.log("Sending timed out");

                this.sent_timed_out_message = true;
                this.socket.send("game/timed_out", {
                    game_id: this.game_id,
                });
            }
        }
    }
    public syncReviewMove(msg_override?: ReviewMessage, node_text?: string): void {
        if (
            this.review_id &&
            (this.isPlayerController() ||
                (this.isPlayerOwner() && msg_override && msg_override.controller)) &&
            this.done_loading_review
        ) {
            if (this.isInPushedAnalysis()) {
                return;
            }

            const diff = this.engine.getMoveDiff();
            this.engine.setAsCurrentReviewMove();

            let msg: ReviewMessage;

            if (!msg_override) {
                const marks: { [mark: string]: string } = {};
                for (let y = 0; y < this.height; ++y) {
                    for (let x = 0; x < this.width; ++x) {
                        const pos = this.getMarks(x, y);
                        for (let i = 0; i < MARK_TYPES.length; ++i) {
                            if (MARK_TYPES[i] in pos && pos[MARK_TYPES[i]]) {
                                const mark_key: keyof MarkInterface =
                                    MARK_TYPES[i] === "letter"
                                        ? pos.letter || "[ERR]"
                                        : MARK_TYPES[i] === "score"
                                          ? `score-${pos.score}`
                                          : MARK_TYPES[i];
                                if (!(mark_key in marks)) {
                                    marks[mark_key] = "";
                                }
                                marks[mark_key] += encodeMove(x, y);
                            }
                        }
                    }
                }

                if (!node_text && node_text !== "") {
                    node_text = this.engine.cur_move.text || "";
                }

                msg = {
                    f: diff.from,
                    t: node_text,
                    m: diff.moves,
                    k: marks,
                };
                const tmp = deepClone(msg);

                if (this.last_review_message.f === msg.f && this.last_review_message.m === msg.m) {
                    delete msg["f"];
                    delete msg["m"];

                    const txt_idx = node_text.indexOf(this.engine.cur_move.text || "");
                    if (txt_idx === 0) {
                        delete msg["t"];
                        if (node_text !== this.engine.cur_move.text) {
                            msg["t+"] = node_text.substr(this.engine.cur_move.text.length);
                        }
                    }

                    if (deepEqual(marks, this.last_review_message.k)) {
                        delete msg["k"];
                    }
                } else {
                    this.scheduleRedrawPenLayer();
                }
                this.engine.cur_move.text = node_text;
                this.last_review_message = tmp;

                if (Object.keys(msg).length === 0) {
                    return;
                }
            } else {
                msg = msg_override;
                if (msg.clearpen) {
                    this.engine.cur_move.pen_marks = [];
                }
            }

            msg.review_id = this.review_id;

            this.socket.send("review/append", msg);
        }
    }

    protected sendMove(mv: MoveCommand, cb?: () => void): boolean {
        if (!mv.blur) {
            mv.blur = focus_tracker.getMaxBlurDurationSinceLastReset();
            focus_tracker.reset();
        }
        this.setConditionalTree();

        // Add `.clock` to the move sent to the server
        try {
            if (this.player_id) {
                if (this.__clock_timer) {
                    clearTimeout(this.__clock_timer);
                    delete this.__clock_timer;
                    this.clock_should_be_paused_for_move_submission = true;
                }

                const original_clock = this.last_clock;
                if (!original_clock) {
                    throw new Error(`No last_clock when calling sendMove()`);
                }
                let color: "black" | "white";

                if (this.player_id === original_clock.black_player_id) {
                    color = "black";
                } else if (this.player_id === original_clock.white_player_id) {
                    color = "white";
                } else {
                    throw new Error(`Player id ${this.player_id} not found in clock`);
                }

                if (color) {
                    const clock_drift = callbacks?.getClockDrift ? callbacks?.getClockDrift() : 0;

                    const current_server_time = Date.now() - clock_drift;

                    const pause_control = this.pause_control;

                    const paused = pause_control
                        ? isPaused(AdHocPauseControl2JGOFPauseState(pause_control))
                        : false;

                    const elapsed: number = original_clock.start_mode
                        ? 0
                        : paused && original_clock.paused_since
                          ? Math.max(original_clock.paused_since, original_clock.last_move) -
                            original_clock.last_move
                          : current_server_time - original_clock.last_move;

                    const clock = this.computeNewPlayerClock(
                        original_clock[`${color}_time`] as any,
                        true,
                        elapsed,
                        this.config.time_control as any,
                    );

                    if (clock.timed_out) {
                        this.sendTimedOut();
                        return false;
                    }

                    mv.clock = clock;
                } else {
                    throw new Error(`No color for player_id ${this.player_id}`);
                }
            }
        } catch (e) {
            console.error(e);
        }

        // Send the move. If we aren't getting a response, show a message
        // indicating such and try reloading after a few more seconds.
        let reload_timeout: ReturnType<typeof setTimeout>;
        const timeout = setTimeout(() => {
            this.showMessage("error_submitting_move", undefined, -1);

            reload_timeout = setTimeout(() => {
                window.location.reload();
            }, 5000);
        }, 5000);
        this.emit("submitting-move", true);
        this.socket.send("game/move", mv, () => {
            if (reload_timeout) {
                clearTimeout(reload_timeout);
            }
            clearTimeout(timeout);
            this.clearMessage();
            this.emit("submitting-move", false);
            if (cb) {
                cb();
            }
        });

        return true;
    }
    public giveReviewControl(player_id: number): void {
        this.syncReviewMove({ controller: player_id });
    }

    public saveConditionalMoves(): void {
        this.socket.send("game/conditional_moves/set", {
            move_number: this.engine.getCurrentMoveNumber(),
            game_id: this.game_id,
            conditional_moves: this.conditional_tree.encode(),
        });
        this.emit("conditional-moves.updated");
    }

    public resign(): void {
        this.socket.send("game/resign", {
            game_id: this.game_id,
        });
    }
    protected sendPendingResignation(): void {
        this.socket.send("game/delayed_resign", {
            game_id: this.game_id,
        });
    }
    protected clearPendingResignation(): void {
        this.socket.send("game/clear_delayed_resign", {
            game_id: this.game_id,
        });
    }
    public cancelGame(): void {
        this.socket.send("game/cancel", {
            game_id: this.game_id,
        });
    }
    protected annul(): void {
        this.socket.send("game/annul", {
            game_id: this.game_id,
        });
    }
    public pass(): void {
        if (this.mode === "conditional") {
            this.followConditionalSegment(-1, -1);
        }

        this.engine.place(-1, -1);
        if (this.mode === "play") {
            this.sendMove({
                game_id: this.game_id,
                move: encodeMove(-1, -1),
            });
        } else {
            this.syncReviewMove();
            this.move_tree_redraw();
        }
    }
    public requestUndo(): void {
        this.socket.send("game/undo/request", {
            game_id: this.game_id,
            move_number: this.engine.getCurrentMoveNumber(),
        });
    }
    public acceptUndo(): void {
        this.socket.send("game/undo/accept", {
            game_id: this.game_id,
            move_number: this.engine.getCurrentMoveNumber(),
        });
    }
    public cancelUndo(): void {
        this.socket.send("game/undo/cancel", {
            game_id: this.game_id,
            move_number: this.engine.getCurrentMoveNumber(),
        });
    }
    public pauseGame(): void {
        this.socket.send("game/pause", {
            game_id: this.game_id,
        });
    }
    public resumeGame(): void {
        this.socket.send("game/resume", {
            game_id: this.game_id,
        });
    }

    public deleteBranch(): void {
        if (!this.engine.cur_move.trunk) {
            if (this.isPlayerController()) {
                this.syncReviewMove({ delete: 1 });
            }
            this.engine.deleteCurMove();
            this.emit("update");
            this.move_tree_redraw();
        }
    }

    /** This is a callback that gets called by GobanEngine.setState to load
     * previously saved board state. */
    //public setState(state: any): void {
    public setState(): void {
        if ((this.game_type === "review" || this.game_type === "demo") && this.engine) {
            this.drawPenMarks(this.engine.cur_move.pen_marks);
            if (this.isPlayerController() && this.connectToReviewSent) {
                this.syncReviewMove();
            }
        }

        this.setLabelCharacterFromMarks();
        this.markDirty();
    }

    public sendPreventStalling(winner: "black" | "white"): void {
        this.socket.send("game/prevent_stalling", {
            game_id: this.game_id,
            winner,
        });
    }
    public sendPreventEscaping(winner: "black" | "white", annul: boolean): void {
        this.socket.send("game/prevent_escaping", {
            game_id: this.game_id,
            winner,
            annul,
        });
    }

    public performStoneRemovalAutoScoring(): void {
        try {
            if (
                !(window as any)["user"] ||
                !this.on_game_screen ||
                !this.engine ||
                (((window as any)["user"].id as number) !== this.engine.players.black.id &&
                    ((window as any)["user"].id as number) !== this.engine.players.white.id)
            ) {
                return;
            }
        } catch (e) {
            console.error(e.stack);
            return;
        }

        this.stone_removal_auto_scoring_done = true;

        this.showMessage("processing", undefined, -1);
        this.emit("stone-removal.auto-scoring-started");
        const do_score_estimation = () => {
            const se = new ScoreEstimator(
                this.engine,
                this,
                AUTOSCORE_TRIALS,
                AUTOSCORE_TOLERANCE,
                true /* prefer remote */,
                true /* autoscore */,
                /* Don't use existing stone removal markings for auto scoring */
                makeMatrix(this.width, this.height, false),
            );

            se.when_ready
                .then(() => {
                    const current_removed = this.engine.getStoneRemovalString();
                    const new_removed = se.getProbablyDead();

                    this.engine.clearRemoved();
                    const moves = this.engine.decodeMoves(new_removed);
                    for (let i = 0; i < moves.length; ++i) {
                        this.engine.setRemoved(moves[i].x, moves[i].y, true, false);
                    }

                    this.emit("stone-removal.updated");

                    this.engine.needs_sealing = se.autoscored_needs_sealing;
                    this.emit("stone-removal.needs-sealing", se.autoscored_needs_sealing);

                    this.updateTitleAndStonePlacement();
                    this.emit("update");

                    this.socket.send("game/removed_stones/set", {
                        game_id: this.game_id,
                        removed: false,
                        needs_sealing: se.autoscored_needs_sealing,
                        stones: current_removed,
                    });
                    this.socket.send("game/removed_stones/set", {
                        game_id: this.game_id,
                        removed: true,
                        needs_sealing: se.autoscored_needs_sealing,
                        stones: new_removed,
                    });

                    this.clearMessage();
                    this.emit("stone-removal.auto-scoring-complete");
                })
                .catch((err) => {
                    console.error(`Auto-scoring error: `, err);
                    this.clearMessage();
                    this.showMessage(
                        "error",
                        {
                            error: {
                                message: "Auto-scoring failed, please manually score the game",
                            },
                        },
                        3000,
                    );
                });
        };

        setTimeout(() => {
            init_wasm_ownership_estimator()
                .then(do_score_estimation)
                .catch((err) => console.error(err));
        }, 10);
    }

    public acceptRemovedStones(): void {
        const stones = this.engine.getStoneRemovalString();
        this.engine.players[
            this.engine.playerColor(this.config.player_id) as "black" | "white"
        ].accepted_stones = stones;
        this.socket.send("game/removed_stones/accept", {
            game_id: this.game_id,
            stones: stones,
            strict_seki_mode: this.engine.strict_seki_mode,
        });
    }
    public rejectRemovedStones(): void {
        delete this.engine.players[
            this.engine.playerColor(this.config.player_id) as "black" | "white"
        ].accepted_stones;
        this.socket.send("game/removed_stones/reject", {
            game_id: this.game_id,
        });
    }

    /* Computes the relative latency between the target player and the current viewer.
     * For example, if player P has a latency of 500ms and we have a latency of 200ms,
     * the relative latency will be 300ms. This is used to artificially delay the clock
     * countdown for that player to minimize the amount of apparent time jumping that can
     * happen as clocks are synchronized */
    public getPlayerRelativeLatency(player_id: number): number {
        if (player_id === this.player_id) {
            return 0;
        }

        // If the other latency is not available for whatever reason, use our own latency as a better-than-0 guess */
        const other_latency = this.engine?.latencies?.[player_id] || this.getNetworkLatency();

        return other_latency - this.getNetworkLatency();
    }
    public getLastReviewMessage(): ReviewMessage {
        return this.last_review_message;
    }
    public setLastReviewMessage(m: ReviewMessage): void {
        this.last_review_message = m;
    }

    public setGameClock(original_clock: AdHocClock | null): void {
        if (this.__clock_timer) {
            clearTimeout(this.__clock_timer);
            delete this.__clock_timer;
        }

        if (!original_clock) {
            this.emit("clock", null);
            return;
        }

        if (!this.config.time_control || !this.config.time_control.system) {
            this.emit("clock", null);
            return;
        }
        const time_control: JGOFTimeControl = this.config.time_control;

        this.last_clock = original_clock;

        let current_server_time = 0;
        function update_current_server_time() {
            if (callbacks.getClockDrift) {
                const server_time_offset = callbacks.getClockDrift();
                current_server_time = Date.now() - server_time_offset;
            }
        }
        update_current_server_time();

        const clock: JGOFClockWithTransmitting = {
            current_player:
                original_clock.current_player === original_clock.black_player_id
                    ? "black"
                    : "white",
            current_player_id: original_clock.current_player.toString(),
            time_of_last_move: original_clock.last_move,
            paused_since: original_clock.paused_since,
            black_clock: { main_time: 0 },
            white_clock: { main_time: 0 },
            black_move_transmitting: 0,
            white_move_transmitting: 0,
        };

        if (original_clock.pause) {
            if (original_clock.pause.paused) {
                this.paused_since = original_clock.pause.paused_since;
                this.pause_control = original_clock.pause.pause_control;

                /* correct for when we used to store paused_since in terms of seconds instead of ms */
                if (this.paused_since < 2000000000) {
                    this.paused_since *= 1000;
                }

                clock.paused_since = original_clock.pause.paused_since;
                clock.pause_state = AdHocPauseControl2JGOFPauseState(
                    original_clock.pause.pause_control,
                );
            } else {
                delete this.paused_since;
                delete this.pause_control;
            }
        }

        if (original_clock.start_mode) {
            clock.start_mode = true;
        }

        const last_audio_event: { [player_id: string]: AudioClockEvent } = {
            black: {
                countdown_seconds: 0,
                clock: { main_time: 0 },
                player_id: "",
                color: "black",
                time_control_system: "none",
                in_overtime: false,
            },
            white: {
                countdown_seconds: 0,
                clock: { main_time: 0 },
                player_id: "",
                color: "white",
                time_control_system: "none",
                in_overtime: false,
            },
        };

        const do_update = () => {
            if (!time_control || !time_control.system) {
                return;
            }

            update_current_server_time();

            const next_update_time = 100;

            if (clock.start_mode) {
                clock.start_time_left = original_clock.expiration - current_server_time;
            }

            if (this.paused_since) {
                clock.paused_since = this.paused_since;
                if (!this.pause_control) {
                    throw new Error(`Invalid pause_control state when performing clock do_update`);
                }
                clock.pause_state = AdHocPauseControl2JGOFPauseState(this.pause_control);
                if (clock.pause_state.stone_removal) {
                    clock.stone_removal_time_left = original_clock.expiration - current_server_time;
                }
            }

            if (!clock.pause_state || Object.keys(clock.pause_state).length === 0) {
                delete clock.paused_since;
                delete clock.pause_state;
            }

            if (this.last_paused_state === null) {
                this.last_paused_state = !!clock.pause_state;
            } else {
                const cur_paused = !!clock.pause_state;
                if (cur_paused !== this.last_paused_state) {
                    this.last_paused_state = cur_paused;
                    if (cur_paused) {
                        this.emit("audio-game-paused");
                    } else {
                        this.emit("audio-game-resumed");
                    }
                }
            }

            if (this.last_paused_by_player_state === null) {
                this.last_paused_by_player_state = !!this.pause_control?.paused;
            } else {
                const cur_paused = !!this.pause_control?.paused;
                if (cur_paused !== this.last_paused_by_player_state) {
                    this.last_paused_by_player_state = cur_paused;
                    if (cur_paused) {
                        this.emit("paused", cur_paused);
                    } else {
                        this.emit("paused", cur_paused);
                    }
                }
            }

            const elapsed: number = clock.paused_since
                ? Math.max(clock.paused_since, original_clock.last_move) - original_clock.last_move
                : current_server_time - original_clock.last_move;

            const black_relative_latency = this.getPlayerRelativeLatency(
                original_clock.black_player_id,
            );
            const white_relative_latency = this.getPlayerRelativeLatency(
                original_clock.white_player_id,
            );

            const black_elapsed = Math.max(0, elapsed - Math.abs(black_relative_latency));
            const white_elapsed = Math.max(0, elapsed - Math.abs(white_relative_latency));

            clock.black_clock = this.computeNewPlayerClock(
                original_clock.black_time as AdHocPlayerClock,
                clock.current_player === "black" && !clock.start_mode,
                black_elapsed,
                time_control,
            );

            clock.white_clock = this.computeNewPlayerClock(
                original_clock.white_time as AdHocPlayerClock,
                clock.current_player === "white" && !clock.start_mode,
                white_elapsed,
                time_control,
            );

            const wall_clock_elapsed = current_server_time - original_clock.last_move;
            clock.black_move_transmitting =
                clock.current_player === "black"
                    ? Math.max(0, black_relative_latency - wall_clock_elapsed)
                    : 0;
            clock.white_move_transmitting =
                clock.current_player === "white"
                    ? Math.max(0, white_relative_latency - wall_clock_elapsed)
                    : 0;

            if (!this.sent_timed_out_message && !this.clock_should_be_paused_for_move_submission) {
                if (
                    clock.current_player === "white" &&
                    this.player_id === this.engine.config.white_player_id
                ) {
                    if ((clock.white_clock as JGOFPlayerClockWithTimedOut).timed_out) {
                        this.sendTimedOut();
                    }
                }
                if (
                    clock.current_player === "black" &&
                    this.player_id === this.engine.config.black_player_id
                ) {
                    if ((clock.black_clock as JGOFPlayerClockWithTimedOut).timed_out) {
                        this.sendTimedOut();
                    }
                }
            }

            if (this.clock_should_be_paused_for_move_submission && this.last_emitted_clock) {
                this.emit("clock", this.last_emitted_clock);
            } else {
                this.emit("clock", clock);
            }

            // check if we need to update our audio
            if (
                (this.mode === "play" ||
                    this.mode === "analyze" ||
                    this.mode === "conditional" ||
                    this.mode === "score estimation") &&
                this.engine.phase === "play"
            ) {
                // Move's and clock events are separate, so this just checks to make sure that when we
                // update, we are updating when the engine and clock agree on whose turn it is.
                const current_color =
                    this.engine.last_official_move.stoneColor === "black" ? "white" : "black";
                const current_player = this.engine.players[current_color].id.toString();

                if (current_color === clock.current_player) {
                    const player_clock: JGOFPlayerClock =
                        clock.current_player === "black" ? clock.black_clock : clock.white_clock;
                    const audio_clock: AudioClockEvent = {
                        countdown_seconds: 0,
                        clock: player_clock,
                        player_id: current_player,
                        color: current_color,
                        time_control_system: time_control.system,
                        in_overtime: false,
                    };

                    switch (time_control.system) {
                        case "simple":
                            if (audio_clock.countdown_seconds === time_control.per_move) {
                                // When byo-yomi resets, we don't want to play the sound for the
                                // top of the second mark because it's going to get clipped short
                                // very soon as time passes and we're going to start playing the
                                // next second sound.
                                audio_clock.countdown_seconds = -1;
                            } else {
                                audio_clock.countdown_seconds = Math.ceil(
                                    player_clock.main_time / 1000,
                                );
                            }
                            break;

                        case "absolute":
                        case "fischer":
                            audio_clock.countdown_seconds = Math.ceil(
                                player_clock.main_time / 1000,
                            );
                            break;

                        case "byoyomi":
                            if (player_clock.main_time > 0) {
                                audio_clock.countdown_seconds = Math.ceil(
                                    player_clock.main_time / 1000,
                                );
                            } else {
                                audio_clock.in_overtime = true;
                                audio_clock.countdown_seconds = Math.ceil(
                                    (player_clock.period_time_left || 0) / 1000,
                                );
                                if ((player_clock.periods_left || 0) <= 0) {
                                    audio_clock.countdown_seconds = -1;
                                }

                                /*
                                if (
                                    audio_clock.countdown_seconds === time_control.period_time &&
                                    audio_clock.in_overtime == last_audio_event[clock.current_player].in_overtime
                                ) {
                                    // When byo-yomi resets, we don't want to play the sound for the
                                    // top of the second mark because it's going to get clipped short
                                    // very soon as time passes and we're going to start playing the
                                    // next second sound.
                                    audio_clock.countdown_seconds = -1;
                                }
                                */
                            }
                            break;

                        case "canadian":
                            if (player_clock.main_time > 0) {
                                audio_clock.countdown_seconds = Math.ceil(
                                    player_clock.main_time / 1000,
                                );
                            } else {
                                audio_clock.in_overtime = true;
                                audio_clock.countdown_seconds = Math.ceil(
                                    (player_clock.block_time_left || 0) / 1000,
                                );

                                if (audio_clock.countdown_seconds === time_control.period_time) {
                                    // When we start a new period, we don't want to play the sound for the
                                    // top of the second mark because it's going to get clipped short
                                    // very soon as time passes and we're going to start playing the
                                    // next second sound.
                                    audio_clock.countdown_seconds = -1;
                                }
                            }
                            break;

                        case "none":
                            break;

                        default:
                            throw new Error(
                                `Unsupported time control system: ${(time_control as any).system}`,
                            );
                    }

                    const cur = audio_clock;
                    const last = last_audio_event[clock.current_player];
                    if (
                        cur.countdown_seconds !== last.countdown_seconds ||
                        cur.player_id !== last.player_id ||
                        cur.in_overtime !== last.in_overtime
                    ) {
                        last_audio_event[clock.current_player] = audio_clock;
                        if (audio_clock.countdown_seconds > 0) {
                            this.emit("audio-clock", audio_clock);
                        }
                    }
                } else {
                    // Engine and clock code didn't agree on whose turn it was, don't emit audio-clock event yet
                }
            }

            if (this.engine.phase !== "finished") {
                this.__clock_timer = setTimeout(do_update, next_update_time);
            }
        };

        do_update();
    }

    protected computeNewPlayerClock(
        original_player_clock: Readonly<AdHocPlayerClock>,
        is_current_player: boolean,
        time_elapsed: number,
        time_control: Readonly<JGOFTimeControl>,
    ): JGOFPlayerClockWithTimedOut {
        const ret: JGOFPlayerClockWithTimedOut = {
            main_time: 0,
            timed_out: false,
        };

        const original_clock = this.last_clock;
        if (!original_clock) {
            throw new Error(`No last_clock when computing new player clock`);
        }

        const tcs: string = "" + time_control.system;
        switch (time_control.system) {
            case "simple":
                ret.main_time = is_current_player
                    ? Math.max(0, time_control.per_move - time_elapsed / 1000) * 1000
                    : time_control.per_move * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "none":
                ret.main_time = 0;
                break;

            case "absolute":
                /*
                ret.main_time = is_current_player
                    ? Math.max(
                          0,
                          original_clock_expiration + raw_clock_pause_offset - current_server_time,
                      )
                    : Math.max(0, original_player_clock.thinking_time * 1000);
                    */
                ret.main_time = is_current_player
                    ? Math.max(0, original_player_clock.thinking_time * 1000 - time_elapsed)
                    : original_player_clock.thinking_time * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "fischer":
                ret.main_time = is_current_player
                    ? Math.max(0, original_player_clock.thinking_time * 1000 - time_elapsed)
                    : original_player_clock.thinking_time * 1000;
                if (ret.main_time <= 0) {
                    ret.timed_out = true;
                }
                break;

            case "byoyomi":
                if (is_current_player) {
                    let overtime_usage = 0;
                    if (original_player_clock.thinking_time > 0) {
                        ret.main_time = original_player_clock.thinking_time * 1000 - time_elapsed;
                        if (ret.main_time <= 0) {
                            overtime_usage = -ret.main_time;
                            ret.main_time = 0;
                        }
                    } else {
                        ret.main_time = 0;
                        overtime_usage = time_elapsed;
                    }
                    ret.periods_left = original_player_clock.periods || 0;
                    ret.period_time_left = time_control.period_time * 1000;
                    if (overtime_usage > 0) {
                        const periods_used = Math.floor(
                            overtime_usage / (time_control.period_time * 1000),
                        );
                        ret.periods_left -= periods_used;
                        ret.period_time_left =
                            time_control.period_time * 1000 -
                            (overtime_usage - periods_used * time_control.period_time * 1000);

                        if (ret.periods_left < 0) {
                            ret.periods_left = 0;
                        }

                        if (ret.period_time_left < 0) {
                            ret.period_time_left = 0;
                        }
                    }
                } else {
                    ret.main_time = original_player_clock.thinking_time * 1000;
                    ret.periods_left = original_player_clock.periods;
                    ret.period_time_left = time_control.period_time * 1000;
                }

                if (ret.main_time <= 0 && (ret.periods_left || 0) === 0) {
                    ret.timed_out = true;
                }
                break;

            case "canadian":
                if (is_current_player) {
                    let overtime_usage = 0;
                    if (original_player_clock.thinking_time > 0) {
                        ret.main_time = original_player_clock.thinking_time * 1000 - time_elapsed;
                        if (ret.main_time <= 0) {
                            overtime_usage = -ret.main_time;
                            ret.main_time = 0;
                        }
                    } else {
                        ret.main_time = 0;
                        overtime_usage = time_elapsed;
                    }
                    ret.moves_left = original_player_clock.moves_left;
                    ret.block_time_left = (original_player_clock.block_time || 0) * 1000;

                    if (overtime_usage > 0) {
                        ret.block_time_left -= overtime_usage;

                        if (ret.block_time_left < 0) {
                            ret.block_time_left = 0;
                        }
                    }
                } else {
                    ret.main_time = original_player_clock.thinking_time * 1000;
                    ret.moves_left = original_player_clock.moves_left;
                    ret.block_time_left = (original_player_clock.block_time || 0) * 1000;
                }

                if (ret.main_time <= 0 && ret.block_time_left <= 0) {
                    ret.timed_out = true;
                }
                break;

            default:
                throw new Error(`Unsupported time control system: ${tcs}`);
        }

        return ret;
    }

    /* DEPRECATED - this method should no longer be used and will likely be
     * removed in the future, all Japanese games will start using strict seki
     * scoring in the near future */
    public setStrictSekiMode(tf: boolean): void {
        if (this.engine.phase !== "stone removal") {
            throw "Not in stone removal phase";
        }
        if (this.engine.strict_seki_mode === tf) {
            return;
        }
        this.engine.strict_seki_mode = tf;

        this.socket.send("game/removed_stones/set", {
            game_id: this.game_id,
            stones: "",
            removed: false,
            strict_seki_mode: tf,
        });
    }
}

function uuid(): string {
    // cspell: words yxxx
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function isPaused(pause_state: JGOFPauseState): boolean {
    for (const _key in pause_state) {
        return true;
    }
    return false;
}
function AdHocPauseControl2JGOFPauseState(pause_control: AdHocPauseControl): JGOFPauseState {
    const ret: JGOFPauseState = {};

    for (const k in pause_control) {
        const matches = k.match(/vacation-([0-9]+)/);
        if (matches) {
            const player_id = matches[1];
            if (!ret.vacation) {
                ret.vacation = {};
            }
            ret.vacation[player_id] = true;
        } else {
            switch (k) {
                case "stone-removal":
                    ret.stone_removal = true;
                    break;

                case "weekend":
                    ret.weekend = true;
                    break;

                case "server":
                case "system":
                    ret.server = true;
                    break;

                case "paused":
                    ret.player = {
                        player_id: pause_control.paused?.pausing_player_id.toString() || "0",
                        pauses_left: pause_control.paused?.pauses_left || 0,
                    };
                    break;

                case "moderator_paused":
                    ret.moderator = pause_control.moderator_paused?.moderator_id.toString() || "0";
                    break;

                default:
                    throw new Error(`Unhandled pause control key: ${k}`);
            }
        }
    }

    return ret;
}
