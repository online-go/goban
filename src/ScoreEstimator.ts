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

import { dup } from "./GoUtil";
import { encodeMove, encodeMoves } from "./GoMath";
import * as GoMath from "./GoMath";
import { GoStoneGroup } from "./GoStoneGroup";
import { GoStoneGroups } from "./GoStoneGroups";
import { GobanCore } from "./GobanCore";
import { GoEngine, PlayerScore, GoEngineRules } from "./GoEngine";
import { JGOFNumericPlayerColor } from "./JGOF";
import { _ } from "./translate";
import { estimateScoreWasm } from "./local_estimators/wasm_estimator";

export { init_score_estimator, estimateScoreWasm } from "./local_estimators/wasm_estimator";
export { estimateScoreVoronoi } from "./local_estimators/voronoi";

/* In addition to the local estimators, we have a RemoteScoring system
 * which needs to be initialized by either the client or the server if we want
 * remote scoring enabled.
 */

export interface ScoreEstimateRequest {
    player_to_move: "black" | "white";
    width: number;
    height: number;
    board_state: JGOFNumericPlayerColor[][];
    rules: GoEngineRules;
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
    autoscored_removed?: string;
}

let remote_scorer: ((req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>) | undefined;
/* This is used on both the client and server side */
export function set_remote_scorer(
    scorer: (req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>,
): void {
    remote_scorer = scorer;
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
) => GoMath.NumberMatrix;
let local_scorer = estimateScoreWasm;
export function set_local_scorer(scorer: LocalEstimator) {
    local_scorer = scorer;
}

export class ScoreEstimator {
    width: number;
    height: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
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

    engine: GoEngine;
    private groups: GoStoneGroups;
    removal: Array<Array<number>>;
    goban_callback?: GobanCore;
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
    autoscored_removed?: string;

    constructor(
        goban_callback: GobanCore | undefined,
        engine: GoEngine,
        trials: number,
        tolerance: number,
        prefer_remote: boolean = false,
    ) {
        this.goban_callback = goban_callback;

        this.engine = engine;
        this.width = engine.width;
        this.height = engine.height;
        this.color_to_move = engine.colorToMove();
        this.board = dup(engine.board);
        this.removal = GoMath.makeMatrix(this.width, this.height, 0);
        this.ownership = GoMath.makeMatrix(this.width, this.height, 0);
        this.territory = GoMath.makeMatrix(this.width, this.height, 0);
        this.estimated_hard_score = 0.0;
        this.trials = trials;
        this.tolerance = tolerance;
        this.prefer_remote = prefer_remote;

        this.territory = GoMath.makeMatrix(this.width, this.height, 0);
        this.groups = new GoStoneGroups(this);

        this.when_ready = this.estimateScore(this.trials, this.tolerance);
    }

    public estimateScore(trials: number, tolerance: number): Promise<void> {
        if (!this.prefer_remote || this.height > 19 || this.width > 19) {
            return this.estimateScoreLocal(trials, tolerance);
        }

        if (remote_scorer) {
            return this.estimateScoreRemote();
        } else {
            return this.estimateScoreLocal(trials, tolerance);
        }
    }

    private estimateScoreRemote(): Promise<void> {
        const komi = this.engine.komi;
        const captures_delta = this.engine.score_prisoners
            ? this.engine.getBlackPrisoners() - this.engine.getWhitePrisoners()
            : 0;

        return new Promise<void>((resolve, reject) => {
            if (!remote_scorer) {
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

            remote_scorer({
                player_to_move: this.engine.colorToMove(),
                width: this.engine.width,
                height: this.engine.height,
                rules: this.engine.rules,
                board_state: board_state,
                autoscore: true,
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

        const board = GoMath.makeMatrix(this.width, this.height);
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                board[y][x] = this.board[y][x] === 2 ? -1 : this.board[y][x];
                if (this.removal[y][x]) {
                    board[y][x] = 0;
                }
            }
        }

        const ownership = local_scorer(board, this.engine.colorToMove(), trials, tolerance);

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
            return this.autoscored_removed;
        } else {
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
    handleClick(i: number, j: number, mod_key: boolean) {
        if (mod_key) {
            this.setRemoved(i, j, !this.removal[j][i] ? 1 : 0);
        } else {
            this.toggleMetaGroupRemoval(i, j);
        }

        this.estimateScore(this.trials, this.tolerance).catch(() => {
            /* empty */
        });
    }

    private removeGroup(g: GoStoneGroup, removing: boolean) {
        g.foreachStone(({ x, y }) => this.setRemoved(x, y, removing ? 1 : 0));
    }

    toggleMetaGroupRemoval(x: number, y: number): void {
        const already_done: { [k: string]: boolean } = {};
        const space_groups: Array<GoStoneGroup> = [];
        let group_color: JGOFNumericPlayerColor;

        try {
            if (x >= 0 && y >= 0) {
                const removing = !this.removal[y][x];
                const group = this.getGroup(x, y);
                this.removeGroup(group, removing);

                group_color = this.board[y][x];
                if (group_color === 0) {
                    /* just toggle open area */
                } else {
                    /* for stones though, toggle the selected stone group any any stone
                     * groups which are adjacent to it through open area */

                    group.foreachNeighborSpaceGroup((g) => {
                        if (!already_done[g.id]) {
                            space_groups.push(g);
                            already_done[g.id] = true;
                        }
                    });

                    while (space_groups.length) {
                        const cur_space_group = space_groups.pop();
                        cur_space_group?.foreachNeighborEnemyGroup((g) => {
                            if (!already_done[g.id]) {
                                already_done[g.id] = true;
                                if (g.color === group_color) {
                                    this.removeGroup(g, removing);
                                    g.foreachNeighborSpaceGroup((g_space) => {
                                        if (!already_done[g_space.id]) {
                                            space_groups.push(g_space);
                                            already_done[g_space.id] = true;
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.log(e.stack);
        }
    }
    setRemoved(x: number, y: number, removed: number): void {
        this.clearAutoScore();

        this.removal[y][x] = removed;
        if (this.goban_callback) {
            this.goban_callback.setForRemoval(x, y, this.removal[y][x]);
        }
    }
    clearRemoved(): void {
        this.clearAutoScore();
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    this.setRemoved(x, y, 0);
                }
            }
        }
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
            return this.autoscored_removed;
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
    getGroup(x: number, y: number): GoStoneGroup {
        return this.groups.groups[this.groups.group_id_map[y][x]];
    }

    /**
     * This gets run after we've instructed the estimator how/when to fill dame,
     * manually mark removed/dame, etc..  it does an official scoring from the
     * remaining territory.
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

        /* clear removed */
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

        if (this.engine.score_territory) {
            const groups = new GoStoneGroups(this);

            groups.foreachGroup((gr) => {
                if (gr.is_territory) {
                    if (!this.engine.score_territory_in_seki && gr.is_territory_in_seki) {
                        return;
                    }
                    if (gr.territory_color === 1) {
                        this.black.scoring_positions += encodeMoves(gr.points);
                    } else {
                        this.white.scoring_positions += encodeMoves(gr.points);
                    }
                }
            });
        }

        if (this.engine.score_stones) {
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (this.board[y][x]) {
                        if (this.board[y][x] === 1) {
                            ++this.black.stones;
                            this.black.scoring_positions += encodeMove(x, y);
                        } else {
                            ++this.white.stones;
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
    engine: GoEngine,
    board: Array<Array<JGOFNumericPlayerColor>>,
    area_map: number[][],
    score: number,
) {
    let adjusted_score = score - engine.getHandicapPointAdjustmentForWhite();
    const { width, height } = get_dimensions(board);
    const ownership = GoMath.makeMatrix(width, height);

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

function sum_board(board: GoMath.NumberMatrix) {
    const { width, height } = get_dimensions(board);
    let sum = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            sum += board[y][x];
        }
    }
    return sum;
}
