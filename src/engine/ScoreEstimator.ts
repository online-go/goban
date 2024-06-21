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

import { encodeMove, makeMatrix, NumberMatrix } from "./util";
import { StoneString } from "./StoneString";
import { StoneStringBuilder } from "./StoneStringBuilder";
import type { GobanBase } from "../GobanBase";
import { GobanEngine, PlayerScore, GobanEngineRules } from "./GobanEngine";
import { JGOFMove, JGOFNumericPlayerColor, JGOFSealingIntersection } from "./formats/JGOF";
import { _ } from "./translate";
import { wasm_estimate_ownership, remote_estimate_ownership } from "./ownership_estimators";
import * as goscorer from "goscorer";
import { BoardState } from "./BoardState";

/* In addition to the local estimators, we have a RemoteScoring system
 * which needs to be initialized by either the client or the server if we want
 * remote scoring enabled.
 */

export interface ScoreEstimateRequest {
    player_to_move: "black" | "white";
    width: number;
    height: number;
    board_state: JGOFNumericPlayerColor[][];
    rules: GobanEngineRules;
    black_prisoners?: number;
    white_prisoners?: number;
    komi?: number;
    jwt: string;

    /** Whether to run autoscoring logic. If true, player_to_move is
     * essentially ignored as we compute estimates with each player moving
     * first in turn. */
    autoscore?: boolean;
}

export interface ScoreEstimateResponse {
    /** Matrix of ownership estimates ranged from -1 (white) to 1 (black) */
    ownership: number[][];

    /** Estimated score */
    score?: number;

    /** Estimated win rate */
    win_rate?: number;

    /** Board state after autoscoring logic has been run. Only defined if autoscore was true in the request. */
    autoscored_board_state?: JGOFNumericPlayerColor[][];

    /** Intersections that are dead or dame.  Only defined if autoscore was true in the request. */
    autoscored_removed?: JGOFMove[];

    /** Coordinates that still need sealing */
    autoscored_needs_sealing?: JGOFSealingIntersection[];
}

/**
 * The interface that local estimators should follow.
 *
 * @param board representation of the board with any dead stones already
 *              removed (black = 1, empty = 0, white = -1)
 * @param color_to_move the player whose turn it is
 * @param trials number of playouts.  Not applicable to all estimators, but
 *               higher generally means higher accuracy and higher compute cost
 * @param tolerance (0.0-1.0) confidence required to mark an intersection not neutral.
 */
type LocalEstimator = (
    board: number[][],
    color_to_move: "black" | "white",
    trials: number,
    tolerance: number,
) => NumberMatrix;
let local_ownership_estimator = wasm_estimate_ownership;
export function set_local_ownership_estimator(estimator: LocalEstimator) {
    local_ownership_estimator = estimator;
}

export class ScoreEstimator extends BoardState {
    white: PlayerScore = {
        total: 0,
        stones: 0,
        territory: 0,
        prisoners: 0,
        scoring_positions: "",
        handicap: 0,
        komi: 0,
    };
    black: PlayerScore = {
        total: 0,
        stones: 0,
        territory: 0,
        prisoners: 0,
        scoring_positions: "",
        handicap: 0,
        komi: 0,
    };

    engine: GobanEngine;
    private groups: StoneStringBuilder;
    tolerance: number;
    amount: number = NaN;
    ownership: Array<Array<number>>;
    territory: Array<Array<number>>;
    trials: number;
    winner: string = "";
    color_to_move: "black" | "white";
    estimated_hard_score: number;
    when_ready: Promise<void>;
    prefer_remote: boolean;
    autoscored_state?: JGOFNumericPlayerColor[][];
    autoscored_removed?: JGOFMove[];
    autoscore: boolean = false;
    public autoscored_needs_sealing?: JGOFSealingIntersection[];

    constructor(
        engine: GobanEngine,
        goban_callback: GobanBase | undefined,
        trials: number,
        tolerance: number,
        prefer_remote: boolean = false,
        autoscore: boolean = false,
        removal?: boolean[][],
    ) {
        super(engine, goban_callback);

        if (removal) {
            this.removal = removal;
        }

        this.engine = engine;
        this.color_to_move = engine.colorToMove();
        this.board = engine.cloneBoard();
        this.ownership = makeMatrix(this.width, this.height, 0);
        this.territory = makeMatrix(this.width, this.height, 0);
        this.estimated_hard_score = 0.0;
        this.trials = trials;
        this.tolerance = tolerance;
        this.prefer_remote = prefer_remote;
        this.autoscore = autoscore;

        this.territory = makeMatrix(this.width, this.height, 0);
        this.groups = new StoneStringBuilder(this);

        this.when_ready = this.estimateScore(this.trials, this.tolerance, autoscore);
    }

    public estimateScore(trials: number, tolerance: number, autoscore: boolean): Promise<void> {
        if (!this.prefer_remote || this.height > 19 || this.width > 19) {
            return this.estimateScoreLocal(trials, tolerance);
        }

        if (remote_estimate_ownership) {
            return this.estimateScoreRemote(autoscore);
        } else {
            return this.estimateScoreLocal(trials, tolerance);
        }
    }

    private estimateScoreRemote(autoscore: boolean): Promise<void> {
        const komi = this.engine.komi;
        const captures_delta = this.engine.score_prisoners
            ? this.engine.getBlackPrisoners() - this.engine.getWhitePrisoners()
            : 0;

        return new Promise<void>((resolve, reject) => {
            if (!remote_estimate_ownership) {
                throw new Error("Remote scoring not setup");
            }

            const board_state: Array<Array<number>> = [];
            for (let y = 0; y < this.height; ++y) {
                const row: Array<number> = [];
                for (let x = 0; x < this.width; ++x) {
                    row.push(this.removal[y][x] ? 0 : this.board[y][x]);
                }
                board_state.push(row);
            }

            remote_estimate_ownership({
                player_to_move: this.engine.colorToMove(),
                width: this.engine.width,
                height: this.engine.height,
                rules: this.engine.rules,
                board_state: board_state,
                autoscore: autoscore,
                jwt: "", // this gets set by the remote_scorer method
            })
                .then((res: ScoreEstimateResponse) => {
                    let score_estimate = 0;
                    for (let y = 0; y < this.height; ++y) {
                        for (let x = 0; x < this.width; ++x) {
                            score_estimate += res.ownership[y][x] > 0 ? 1 : -1;
                        }
                    }

                    if (!res.score) {
                        res.score = 0;
                    }

                    res.score += 7.5 - komi; // we always ask katago to use 7.5 komi, so correct if necessary
                    res.score += captures_delta;
                    res.score -= this.engine.getHandicapPointAdjustmentForWhite();
                    this.autoscored_removed = res.autoscored_removed;
                    this.autoscored_state = res.autoscored_board_state;
                    this.autoscored_needs_sealing = res.autoscored_needs_sealing;

                    if (this.autoscored_state) {
                        this.updateEstimate(
                            score_estimate,
                            this.autoscored_state.map((row) =>
                                row.map((cell) => (cell === 2 ? -1 : cell)),
                            ),
                            res.score,
                        );
                    } else {
                        console.error(
                            "Remote scorer didn't have an autoscore board state, this should be unreachable",
                        );
                        // this was the old code, probably still works in case
                        // we have messed something up. Eventually this should
                        // be removed. - anoek 2024-06-01
                        this.updateEstimate(score_estimate, res.ownership, res.score);
                    }
                    resolve();
                })
                .catch((err: any) => {
                    reject(err);
                });
        });
    }

    /* Somewhat deprecated in-browser score estimator that utilizes our WASM compiled
     * OGSScoreEstimatorModule */
    private estimateScoreLocal(trials: number, tolerance: number): Promise<void> {
        if (!trials) {
            trials = 1000;
        }
        if (!tolerance) {
            tolerance = 0.25;
        }

        const board = makeMatrix(this.width, this.height, 0);
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                board[y][x] = this.board[y][x] === 2 ? -1 : this.board[y][x];
                if (this.removal[y][x]) {
                    board[y][x] = 0;
                }
            }
        }

        const ownership = local_ownership_estimator(
            board,
            this.engine.colorToMove(),
            trials,
            tolerance,
        );

        const estimated_score = sum_board(ownership);
        const adjusted = adjust_estimate(this.engine, this.board, ownership, estimated_score);

        this.updateEstimate(adjusted.score, adjusted.ownership);
        return Promise.resolve();
    }

    updateEstimate(estimated_score: number, ownership: Array<Array<number>>, score?: number) {
        /* Build up our heat map and ownership */
        /* negative for black, 0 for neutral, positive for white */
        this.ownership = ownership;
        this.estimated_hard_score = estimated_score - this.engine.komi;

        if (typeof score === "undefined") {
            this.winner = this.estimated_hard_score > 0 ? _("Black") : _("White");
            this.amount = Math.abs(this.estimated_hard_score);
        } else {
            this.winner = score > 0 ? _("Black") : _("White");
            this.amount = Math.abs(score);
        }

        if (this.goban_callback && this.goban_callback.updateScoreEstimation) {
            this.goban_callback.updateScoreEstimation();
        }
    }

    getProbablyDead(): string {
        if (this.autoscored_removed) {
            console.info("Returning autoscored_removed for getProbablyDead");
            return this.autoscored_removed.map(encodeMove).join("");
        } else {
            // This still happens with local scoring I believe, we should probably run the autoscore
            // logic for local scoring and ensure the autoscore_removed field is always set, then
            // remove this probably dead code all together.
            console.warn("Not able to use autoscored_removed for getProbablyDead");
        }

        let ret = "";
        const arr = [];

        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                const current = this.board[y][x];
                const estimated =
                    this.ownership[y][x] < -this.tolerance
                        ? 2 // white
                        : this.ownership[y][x] > this.tolerance
                          ? 1 // black
                          : 0; // unclear
                if (estimated === 0 /* dame */ || (current !== 0 && current !== estimated)) {
                    arr.push(encodeMove(x, y));
                }
            }
        }

        arr.sort();
        for (let i = 0; i < arr.length; ++i) {
            ret += arr[i];
        }
        return ret;
    }
    handleClick(i: number, j: number, mod_key: boolean, press_duration_ms: number): void {
        this.toggleSingleGroupRemoval(i, j, mod_key || press_duration_ms > 500);

        this.estimateScore(this.trials, this.tolerance, this.autoscore).catch(() => {
            /* empty */
        });
    }

    public override setRemoved(x: number, y: number, removed: boolean): void {
        this.clearAutoScore();
        super.setRemoved(x, y, removed);
    }

    public override clearRemoved(): void {
        this.clearAutoScore();
        super.clearRemoved();
    }

    clearAutoScore(): void {
        if (this.autoscored_removed || this.autoscored_state) {
            this.autoscored_removed = undefined;
            this.autoscored_state = undefined;
            console.warn("Clearing autoscored state");
        }
    }

    getStoneRemovalString(): string {
        if (this.autoscored_removed) {
            console.info("Returning autoscored_removed for getStoneRemovalString");
            return this.autoscored_removed.map(encodeMove).join("");
        } else {
            console.warn("Not able to use autoscored_removed for getStoneRemovalString");
        }

        let ret = "";
        const arr = [];
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    arr.push(encodeMove(x, y));
                }
            }
        }
        arr.sort();
        for (let i = 0; i < arr.length; ++i) {
            ret += arr[i];
        }
        return ret;
    }
    getGroup(x: number, y: number): StoneString {
        return this.groups.stone_strings[this.groups.stone_string_id_map[y][x]];
    }

    /**
     * Computes a rough estimation of ownership and score.
     */
    score(): ScoreEstimator {
        this.white = {
            total: 0,
            stones: 0,
            territory: 0,
            prisoners: 0,
            scoring_positions: "",
            handicap: this.engine.handicap,
            komi: this.engine.komi,
        };
        this.black = {
            total: 0,
            stones: 0,
            territory: 0,
            prisoners: 0,
            scoring_positions: "",
            handicap: 0,
            komi: 0,
        };

        let removed_black = 0;
        let removed_white = 0;

        // clear removed
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    if (this.board[y][x] === 1) {
                        ++removed_black;
                    }
                    if (this.board[y][x] === 2) {
                        ++removed_white;
                    }
                    this.board[y][x] = 0;
                }
            }
        }

        /* Note: this scoring just ensures our estimator is filled in with at least
         * official territory and stones. Usually however, the estimation will already
         * have all of this stuff marked, it's just to make sure we don't miss some
         * obvious territory.
         */
        if (this.engine.score_stones) {
            const scoring = goscorer.areaScoring(
                this.board,
                this.removal.map((row) => row.map((x) => !!x)),
            );
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (scoring[y][x] === goscorer.BLACK) {
                        if (this.board[y][x] === JGOFNumericPlayerColor.BLACK) {
                            this.black.stones += 1;
                        } else {
                            this.black.territory += 1;
                        }
                        this.black.scoring_positions += encodeMove(x, y);
                    } else if (scoring[y][x] === goscorer.WHITE) {
                        if (this.board[y][x] === JGOFNumericPlayerColor.WHITE) {
                            this.white.stones += 1;
                        } else {
                            this.white.territory += 1;
                        }
                        this.white.scoring_positions += encodeMove(x, y);
                    }
                }
            }
        } else {
            const scoring = goscorer.territoryScoring(
                this.board,
                this.removal.map((row) => row.map((x) => !!x)),
            );
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (scoring[y][x].isUnscorableFalseEye) {
                        this.board[y][x] = 0;
                        this.territory[y][x] = 0;
                        this.ownership[y][x] = 0;
                    } else {
                        if (scoring[y][x].isTerritoryFor === goscorer.BLACK) {
                            this.black.territory += 1;
                            this.black.scoring_positions += encodeMove(x, y);
                        } else if (scoring[y][x].isTerritoryFor === goscorer.WHITE) {
                            this.white.territory += 1;
                            this.white.scoring_positions += encodeMove(x, y);
                        }
                    }
                }
            }
        }

        if (this.engine.score_prisoners) {
            this.black.prisoners = removed_white;
            this.white.prisoners = removed_black;
        }

        this.black.total =
            this.black.stones + this.black.territory + this.black.prisoners + this.black.komi;
        this.white.total =
            this.white.stones + this.white.territory + this.white.prisoners + this.white.komi;
        if (this.engine.score_stones) {
            this.black.total += this.black.handicap;
            this.white.total += this.white.handicap;
        }

        return this;
    }
}

/**
 * Adjust Estimate to account for Ruleset (i.e. territory vs area) and captures
 * @param engine Go engine is required because the ruleset is taken into account
 * @param board the current board state
 * @param area_map Representation of the ownership, 1=Black, -1=White, 0=Undecided
 *                 using Area rules
 * @param score estimated score (not accounting for captures)
 */
export function adjust_estimate(
    engine: GobanEngine,
    board: Array<Array<JGOFNumericPlayerColor>>,
    area_map: number[][],
    score: number,
) {
    let adjusted_score = score - engine.getHandicapPointAdjustmentForWhite();
    const { width, height } = get_dimensions(board);
    const ownership = makeMatrix(width, height, 0);

    // For Japanese rules we use territory counting.  Don't even
    // attempt to handle rules with score_stones and not
    // score_prisoners or vice-versa.
    const territory_counting = !engine.score_stones && engine.score_prisoners;

    for (let y = 0; y < board.length; ++y) {
        for (let x = 0; x < board[y].length; ++x) {
            ownership[y][x] = area_map[y][x];

            if (territory_counting && board[y][x]) {
                // Fix display and count in Japanese rules.

                // Board/ownership being 1/1 or 2/-1 means it's a
                // live stone; clear ownership so the display
                // looks like it is using territory scoring.
                if (
                    (board[y][x] === 1 && area_map[y][x] === 1) ||
                    (board[y][x] === 2 && area_map[y][x] === -1)
                ) {
                    ownership[y][x] = 0;
                }

                // Any stone on the board means one less point for
                // the corresponding player, whether it's a
                // prisoner, a live stone that doesn't count as
                // territory, or (does this even happen?) a stone
                // of unknown status.
                if (board[y][x] === 1) {
                    // black stone gives White a point
                    adjusted_score -= 1;
                } else {
                    // white stone gives Black a point
                    adjusted_score += 1;
                }
            }
        }
    }

    // Account for already-captured prisoners in Japanese rules.
    if (territory_counting) {
        adjusted_score += engine.getBlackPrisoners();
        adjusted_score -= engine.getWhitePrisoners();
    }

    return { score: adjusted_score, ownership };
}

function get_dimensions(board: Array<Array<unknown>>) {
    return { width: board[0].length, height: board.length };
}

function sum_board(board: NumberMatrix) {
    const { width, height } = get_dimensions(board);
    let sum = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            sum += board[y][x];
        }
    }
    return sum;
}
