/*
 * Copyright 2012-2020 Online-Go.com
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
import { GoMath, Intersection, Group } from "./GoMath";
import { GobanCore } from "./GobanCore";
import { GoEngine, encodeMove, encodeMoves, Score, PlayerScore, GoEngineRules } from "./GoEngine";
import { JGOFNumericPlayerColor } from "./JGOF";
import { _ } from "./translate";

declare const CLIENT: boolean;
declare const SERVER: boolean;

/* This script is used on both the front end and back end, and the way the
 * OGSScoreEstimator module is loaded is quite differente between the two.
 *
 * On the server, the OGSScoreEsimtator module is loaded by score-estimator.ts
 * and the set_OGSScoreEstimator function is called with the module.
 *
 * On the client, the OGSScoreEstimator script is loaded in an async fashion,
 * so at some point that global variable becomes not null and can be used.
 */

/* In addition to the OGSScoreEstimator method, which is a wasm compiled
 * C program that does simple random playouts, we have a RemoteScoring system
 * which needs to be initialized by either the client or the server if we want
 * remote scoring enabled.
 */

declare var OGSScoreEstimator: any;
let OGSScoreEstimator_initialized: boolean = false;
let OGSScoreEstimatorModule: any;

/* This is used on the server side */
export function set_OGSScoreEstimator(mod: any): void {
    OGSScoreEstimatorModule = mod;
    init_score_estimator()
        .then((tf) => console.info("Score estimator intialized"))
        .catch((err) => console.error(err));
}

export interface ScoreEstimateRequest {
    player_to_move: "black" | "white";
    width: number;
    height: number;
    board_state: Array<Array<number>>;
    rules: GoEngineRules;
    jwt: string;
}

export interface ScoreEstimateResponse {
    ownership: Array<Array<number>>;
    score?: number;
    win_rate?: number;
}

let remote_scorer: ((req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>) | undefined =
    undefined;
/* This is used on both the client and server side */
export function set_remote_scorer(
    scorer: (req: ScoreEstimateRequest) => Promise<ScoreEstimateResponse>,
): void {
    remote_scorer = scorer;
}

let init_promise: Promise<boolean>;

export function init_score_estimator(): Promise<boolean> {
    if (CLIENT) {
        /*
        if (remote_scorer) {
            return Promise.resolve(true);
        }
        */

        if (OGSScoreEstimator_initialized) {
            //console.log("Already initialized");
            return Promise.resolve(true);
        }

        if (init_promise) {
            //console.log("An existing promise");
            return init_promise;
        }

        try {
            if (
                !OGSScoreEstimatorModule &&
                (("OGSScoreEstimator" in window) as any) &&
                ((window as any)["OGSScoreEstimator"] as any)
            ) {
                OGSScoreEstimatorModule = (window as any)["OGSScoreEstimator"] as any;
            }
        } catch (e) {
            console.error(e);
        }

        if (OGSScoreEstimatorModule) {
            //console.log("Already loaded");
            OGSScoreEstimatorModule = OGSScoreEstimatorModule();
            OGSScoreEstimator_initialized = true;
            return Promise.resolve(true);
        }

        //console.log("Sync script");
        let script: HTMLScriptElement = document.getElementById(
            "ogs_score_estimator_script",
        ) as HTMLScriptElement;
        if (script) {
            let resolve: (tf: boolean) => void;
            //let reject;
            init_promise = new Promise<boolean>((_resolve, _reject) => {
                resolve = _resolve;
                //reject  = _reject;
            });

            script.onload = () => {
                OGSScoreEstimatorModule = OGSScoreEstimator;
                OGSScoreEstimatorModule = OGSScoreEstimatorModule();
                OGSScoreEstimator_initialized = true;
                resolve(true);
            };

            return init_promise;
        } else {
            return Promise.reject("score estimator not available");
        }
    }

    if (SERVER) {
        OGSScoreEstimatorModule = OGSScoreEstimatorModule();
        OGSScoreEstimator_initialized = true;
        return Promise.resolve(true);
    }

    // this can't be reached so long as one of CLIENT or SERVER is set, which
    // should always be the case.
    throw new Error("Unreachable code reached");
}

interface SEPoint {
    x: number;
    y: number;
    color?: JGOFNumericPlayerColor;
}

class SEGroup {
    points: Array<SEPoint>;
    neighboring_enemy: Array<SEGroup>;
    neighboring_space: Array<SEGroup>;
    se: ScoreEstimator;
    id: number;
    color: JGOFNumericPlayerColor;
    removed: boolean;
    estimated_score: number;
    estimated_hard_score: number;
    neighbors: Array<SEGroup>;
    neighbor_map: { [group_id: string]: boolean };
    liberties: number = 0;

    constructor(se: ScoreEstimator, color: JGOFNumericPlayerColor, id: number) {
        this.points = [];
        this.se = se;
        this.id = id;
        this.color = color;
        this.neighbors = [];
        this.neighboring_space = [];
        this.neighboring_enemy = [];
        this.neighbor_map = {};
        this.removed = false;
        this.estimated_score = 0.0;
        this.estimated_hard_score = 0.0;

        // this.liberties is set by ScoreEstimator.resetGroups */
    }
    add(i: number, j: number, color: JGOFNumericPlayerColor) {
        this.points.push({ x: i, y: j, color: color });
    }
    foreachPoint(fn: (pt: SEPoint) => void) {
        for (let i = 0; i < this.points.length; ++i) {
            fn(this.points[i]);
        }
    }
    foreachNeighboringPoint(fn: (pt: SEPoint) => void) {
        let self = this;
        let points = this.points;
        let done_array = new Array(this.se.height * this.se.width);
        for (let i = 0; i < points.length; ++i) {
            done_array[points[i].x + points[i].y * this.se.width] = true;
        }

        function checkAndDo(x: number, y: number): void {
            let idx = x + y * self.se.width;
            if (done_array[idx]) {
                return;
            }
            done_array[idx] = true;

            fn({ x: x, y: y });
        }

        for (let i = 0; i < points.length; ++i) {
            let pt = points[i];
            if (pt.x - 1 >= 0) {
                checkAndDo(pt.x - 1, pt.y);
            }
            if (pt.x + 1 !== this.se.width) {
                checkAndDo(pt.x + 1, pt.y);
            }
            if (pt.y - 1 >= 0) {
                checkAndDo(pt.x, pt.y - 1);
            }
            if (pt.y + 1 !== this.se.height) {
                checkAndDo(pt.x, pt.y + 1);
            }
        }
    }
    addNeighbor(group: SEGroup): void {
        if (!(group.id in this.neighbor_map)) {
            this.neighbors.push(group);
            this.neighbor_map[group.id] = true;

            if (group.color === 0) {
                this.neighboring_space.push(group);
            } else {
                this.neighboring_enemy.push(group);
            }
        }
    }
    foreachNeighborGroup(fn: (group: SEGroup) => void): void {
        for (let i = 0; i < this.neighbors.length; ++i) {
            //if (!this.neighbors[i].removed) {
            fn(this.neighbors[i]);
            //}
        }
    }
    foreachNeighborSpaceGroup(fn: (group: SEGroup) => void): void {
        for (let i = 0; i < this.neighboring_space.length; ++i) {
            //if (!this.neighboring_space[i].removed) {
            fn(this.neighboring_space[i]);
            //}
        }
    }
    foreachNeighborEnemyGroup(fn: (group: SEGroup) => void): void {
        for (let i = 0; i < this.neighboring_enemy.length; ++i) {
            //if (!this.neighboring_enemy[i].removed) {
            fn(this.neighboring_enemy[i]);
            //}
        }
    }
    setRemoved(removed: boolean): void {
        this.removed = removed;
        for (let i = 0; i < this.points.length; ++i) {
            let pt = this.points[i];
            this.se.setRemoved(pt.x, pt.y, removed ? 1 : 0);
        }
    }
}

export class ScoreEstimator {
    width: number;
    height: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
    white_prisoners: number = 0;
    black_prisoners: number = 0;
    //score_stones:boolean;
    //score_prisoners:boolean;
    //score_territory:boolean;
    //score_territory_in_seki:boolean;
    removed: Array<Array<number>>;
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
    groups: Array<Array<SEGroup>>;
    currentMarker: number;
    removal: Array<Array<number>>; // TODO: This is defined to be a dup of this.removed, can we remove that?
    goban_callback?: GobanCore;
    tolerance: number;
    group_list: Array<SEGroup>;
    marks: Array<Array<number>>;
    amount: number = NaN;
    amount_fractional: string = "[unset]";
    ownership: Array<Array<number>>;
    area: Array<Array<number>>; // hard numeric values
    territory: Array<Array<number>>;
    trials: number;
    estimated_area: Array<Array<number>>;
    winner: string = "";
    heat: Array<Array<number>>;
    color_to_move: "black" | "white";
    estimated_score: number;
    estimated_hard_score: number;
    when_ready: Promise<void>;
    prefer_remote: boolean;

    constructor(
        goban_callback: GobanCore | undefined,
        engine: GoEngine,
        trials: number,
        tolerance: number,
        prefer_remote: boolean = false,
    ) {
        this.goban_callback = goban_callback;

        this.currentMarker = 1;
        this.engine = engine;
        this.width = engine.width;
        this.height = engine.height;
        this.color_to_move = engine.colorToMove();
        this.board = dup(engine.board);
        this.removal = this.removed = GoMath.makeMatrix(this.width, this.height, 0);
        this.marks = GoMath.makeMatrix(this.width, this.height, 0);
        this.area = GoMath.makeMatrix(this.width, this.height, 0);
        this.ownership = GoMath.makeMatrix(this.width, this.height, 0);
        this.heat = GoMath.makeMatrix(this.width, this.height, 0.0);
        this.estimated_area = GoMath.makeMatrix(this.width, this.height, 0.0);
        this.groups = GoMath.makeEmptyObjectMatrix(this.width, this.height);
        this.territory = GoMath.makeMatrix(this.width, this.height, 0);
        this.estimated_score = 0.0;
        this.estimated_hard_score = 0.0;
        this.group_list = [];
        this.trials = trials;
        this.tolerance = tolerance;
        this.prefer_remote = prefer_remote;

        this.resetGroups();
        this.when_ready = this.estimateScore(this.trials, this.tolerance);
        //this.sealDame();
    }

    public estimateScore(trials: number, tolerance: number): Promise<void> {
        if (!this.prefer_remote || this.height > 19 || this.width > 19) {
            return this.estimateScoreWASM(trials, tolerance);
        }

        if (remote_scorer) {
            return this.estimateScoreRemote(tolerance);
        } else {
            return this.estimateScoreWASM(trials, tolerance);
        }
    }

    private estimateScoreRemote(tolerance: number = 0.25): Promise<void> {
        let komi = this.engine.komi;
        let captures_delta = this.engine.score_prisoners
            ? this.engine.getBlackPrisoners() - this.engine.getWhitePrisoners()
            : 0;

        return new Promise<void>((resolve, reject) => {
            if (!remote_scorer) {
                throw new Error("Remote scoring not setup");
            }

            let board_state: Array<Array<number>> = [];
            for (let y = 0; y < this.height; ++y) {
                let row: Array<number> = [];
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

                    this.updateEstimate(score_estimate, res.ownership, res.score);
                    resolve();
                })
                .catch((err: any) => {
                    reject(err);
                });
        });
    }

    /* Somewhat deprecated in-browser score estimator that utilizes our WASM compiled
     * OGSScoreEstimatorModule */
    private estimateScoreWASM(trials: number, tolerance: number): Promise<void> {
        if (!OGSScoreEstimator_initialized) {
            throw new Error("Score estimator not intialized yet");
        }

        if (!trials) {
            trials = 1000;
        }
        if (!tolerance) {
            tolerance = 0.25;
        }

        /* Call our score estimator code to do the estimation. We do this assignment here
         * because it's likely that the module isn't done loading on the client
         * when the top of this script (where score estimator is first assigned) is
         * executing. (it's loaded async)
         */
        let nbytes = 4 * this.engine.width * this.engine.height;
        let ptr = OGSScoreEstimatorModule._malloc(nbytes);
        let ints = new Int32Array(OGSScoreEstimatorModule.HEAP32.buffer, ptr, nbytes);
        let i = 0;
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                ints[i] = this.board[y][x] === 2 ? -1 : this.board[y][x];
                if (this.removal[y][x]) {
                    ints[i] = 0;
                }
                ++i;
            }
        }
        let _estimate = OGSScoreEstimatorModule.cwrap("estimate", "number", [
            "number",
            "number",
            "number",
            "number",
            "number",
            "number",
        ]);
        let estimate = _estimate as (
            w: number,
            h: number,
            p: number,
            c: number,
            tr: number,
            to: number,
        ) => number;
        let estimated_score = estimate(
            this.width,
            this.height,
            ptr,
            this.engine.colorToMove() === "black" ? 1 : -1,
            trials,
            tolerance,
        );
        estimated_score -= this.engine.getHandicapPointAdjustmentForWhite();
        let ownership = GoMath.makeMatrix(this.width, this.height, 0);
        i = 0;
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                //ownership[y][x] = ints[i] < 0 ? 2 : ints[i];
                ownership[y][x] = ints[i];
                ++i;
            }
        }
        OGSScoreEstimatorModule._free(ptr);
        this.updateEstimate(estimated_score, ownership);
        return Promise.resolve();
    }

    updateEstimate(estimated_score: number, ownership: Array<Array<number>>, score?: number) {
        /* Build up our heat map and ownership */
        /* negative for black, 0 for neutral, positive for white */
        //this.heat = GoMath.makeMatrix(this.width, this.height, 0.0);
        this.ownership = ownership;
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                this.heat[y][x] = ownership[y][x];
                this.area[y][x] = ownership[y][x] < 0 ? 2 : ownership[y][x];
                //this.area[y][x] = ownership[y][x];
                this.estimated_area[y][x] = this.area[y][x];
            }
        }
        this.estimated_score = estimated_score - this.engine.komi;
        this.estimated_hard_score = estimated_score - this.engine.komi;

        if (typeof score === "undefined") {
            this.winner = this.estimated_hard_score > 0 ? _("Black") : _("White");
            this.amount = Math.abs(this.estimated_hard_score);
            this.amount_fractional = Math.abs(this.estimated_score).toFixed(1);
        } else {
            this.winner = score > 0 ? _("Black") : _("White");
            this.amount = Math.abs(score);
            this.amount_fractional = Math.abs(score).toFixed(1);
        }

        /*
        if (this.goban_callback && this.goban_callback.heatmapUpdated) {
            this.goban_callback.heatmapUpdated();
        }
        */
        if (this.goban_callback && this.goban_callback.updateScoreEstimation) {
            this.goban_callback.updateScoreEstimation();
        }
    }

    getProbablyDead(): string {
        let ret = "";
        let arr = [];

        if (remote_scorer) {
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
        } else {
            // Old WASM
            for (let y = 0; y < this.height; ++y) {
                for (let x = 0; x < this.width; ++x) {
                    if (
                        //(this.board[y][x] === 0 && this.area[y][x] === 0) /* dame */
                        //||
                        //(this.board[y][x] !== 0 && this.area[y][x] !== this.board[y][x]) /* captured */
                        this.area[y][x] === 0 ||
                        (this.board[y][x] !== 0 && this.area[y][x] !== this.board[y][x])
                    ) {
                        arr.push(encodeMove(x, y));
                    }
                }
            }
        }

        arr.sort();
        for (let i = 0; i < arr.length; ++i) {
            ret += arr[i];
        }
        return ret;
    }
    resetGroups(): void {
        this.territory = GoMath.makeMatrix(this.width, this.height, 0);
        this.groups = GoMath.makeEmptyObjectMatrix(this.width, this.height);
        this.group_list = [];
        let stack = null;

        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (!this.groups[y][x]) {
                    this.incrementCurrentMarker(); /* clear marks */
                    let color = this.board[y][x];
                    let g = new SEGroup(this, color, this.currentMarker);
                    this.group_list.push(g);
                    stack = [x, y];
                    while (stack.length) {
                        let yy = stack.pop();
                        let xx = stack.pop();
                        if (xx === undefined || yy === undefined) {
                            throw new Error(`Invalid stack state`);
                        }

                        if (this.marks[yy][xx] === this.currentMarker) {
                            continue;
                        }
                        this.marks[yy][xx] = this.currentMarker;
                        if (this.board[yy][xx] === color || (color === 0 && this.removed[yy][xx])) {
                            this.groups[yy][xx] = g;
                            g.add(xx, yy, color);
                            //this.foreachNeighbor({"x": xx, "y": yy}, function(x,y) { stack.push(x); stack.push(y); });
                            this.foreachNeighbor({ x: xx, y: yy }, push_on_stack);
                        }
                    }
                }
            }
        }

        function push_on_stack(x: number, y: number) {
            stack.push(x);
            stack.push(y);
        }

        /* compute group neighborhoodship */
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                this.foreachNeighbor({ x: x, y: y }, (xx, yy) => {
                    if (this.groups[y][x].id !== this.groups[yy][xx].id) {
                        this.groups[y][x].addNeighbor(this.groups[yy][xx]);
                        this.groups[yy][xx].addNeighbor(this.groups[y][x]);
                    }
                });
            }
        }

        /* compute liberties */
        this.foreachGroup((g: SEGroup) => {
            if (g.color) {
                let liberties = 0;
                g.foreachNeighboringPoint((pt) => {
                    if (this.board[pt.y][pt.x] === 0 || this.removed[pt.y][pt.x]) {
                        ++liberties;
                    }
                });
                g.liberties = liberties;
            }
        });
    }
    foreachGroup(fn: (group: SEGroup) => void): void {
        for (let i = 0; i < this.group_list.length; ++i) {
            fn(this.group_list[i]);
        }
    }
    handleClick(i: number, j: number, modkey: boolean) {
        if (modkey) {
            this.setRemoved(i, j, !this.removal[j][i] ? 1 : 0);
        } else {
            this.toggleMetaGroupRemoval(i, j);
        }

        this.estimateScore(this.trials, this.tolerance);
        //this.resetGroups();
    }
    toggleMetaGroupRemoval(x: number, y: number): void {
        let already_done: { [k: string]: boolean } = {};
        let space_groups: Array<SEGroup> = [];
        let group_color: JGOFNumericPlayerColor;

        try {
            if (x >= 0 && y >= 0) {
                let removing = !this.removal[y][x];
                let group = this.getGroup(x, y);
                group.setRemoved(removing);

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
                        let cur_space_group = space_groups.pop();
                        cur_space_group?.foreachNeighborEnemyGroup((g) => {
                            if (!already_done[g.id]) {
                                already_done[g.id] = true;
                                if (g.color === group_color) {
                                    g.setRemoved(removing);
                                    g.foreachNeighborSpaceGroup((gspace) => {
                                        if (!already_done[gspace.id]) {
                                            space_groups.push(gspace);
                                            already_done[gspace.id] = true;
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
        this.removal[y][x] = removed;
        if (this.goban_callback) {
            this.goban_callback.setForRemoval(x, y, this.removal[y][x]);
        }
    }
    clearRemoved(): void {
        for (let y = 0; y < this.height; ++y) {
            for (let x = 0; x < this.width; ++x) {
                if (this.removal[y][x]) {
                    this.setRemoved(x, y, 0);
                }
            }
        }
    }
    getStoneRemovalString(): string {
        let ret = "";
        let arr = [];
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
    getGroup(x: number, y: number): SEGroup {
        return this.groups[y][x];
    }
    incrementCurrentMarker(): void {
        ++this.currentMarker;
    }

    /**
     * This gets run after we've instructed the estimator how/when to fill dame,
     * manually mark removed/dame, etc..  it does an official scoring from the
     * remaining territory.
     */
    score(): Score {
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
                if (this.removed[y][x]) {
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

        //if (this.phase !== "play") {
        if (this.engine.score_territory) {
            let gm = new GoMath(this);
            //console.log(gm);

            gm.foreachGroup((gr) => {
                if (gr.is_territory) {
                    //console.log(gr);
                    if (!this.engine.score_territory_in_seki && gr.is_territory_in_seki) {
                        return;
                    }
                    if (gr.territory_color === 1) {
                        this.black.scoring_positions += encodeMoves(gr.points);
                    } else {
                        this.white.scoring_positions += encodeMoves(gr.points);
                    }

                    console.warn(
                        "What should be unreached code is running, should probably be running " +
                            "this[color].territory += markScored(gr.points, false);",
                    );
                    //this[color].territory += markScored(gr.points, false);
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
        //}

        if (this.engine.score_prisoners) {
            this.black.prisoners = this.black_prisoners + removed_white;
            this.white.prisoners = this.white_prisoners + removed_black;
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
    public foreachNeighbor(
        pt_or_group: Intersection | Group,
        fn_of_neighbor_pt: (x: number, y: number) => void,
    ): void {
        let self = this;
        let group: Group;
        let done_array: Array<boolean>;

        if (pt_or_group instanceof Array) {
            group = pt_or_group as Group;
            done_array = new Array(this.height * this.width);
            for (let i = 0; i < group.length; ++i) {
                done_array[group[i].x + group[i].y * this.width] = true;
            }
            for (let i = 0; i < group.length; ++i) {
                let pt = group[i];
                if (pt.x - 1 >= 0) {
                    checkAndDo(pt.x - 1, pt.y);
                }
                if (pt.x + 1 !== this.width) {
                    checkAndDo(pt.x + 1, pt.y);
                }
                if (pt.y - 1 >= 0) {
                    checkAndDo(pt.x, pt.y - 1);
                }
                if (pt.y + 1 !== this.height) {
                    checkAndDo(pt.x, pt.y + 1);
                }
            }
        } else {
            let pt = pt_or_group;
            if (pt.x - 1 >= 0) {
                fn_of_neighbor_pt(pt.x - 1, pt.y);
            }
            if (pt.x + 1 !== this.width) {
                fn_of_neighbor_pt(pt.x + 1, pt.y);
            }
            if (pt.y - 1 >= 0) {
                fn_of_neighbor_pt(pt.x, pt.y - 1);
            }
            if (pt.y + 1 !== this.height) {
                fn_of_neighbor_pt(pt.x, pt.y + 1);
            }
        }

        function checkAndDo(x: number, y: number): void {
            let idx = x + y * self.width;
            if (done_array[idx]) {
                return;
            }
            done_array[idx] = true;

            fn_of_neighbor_pt(x, y);
        }
    }
}
