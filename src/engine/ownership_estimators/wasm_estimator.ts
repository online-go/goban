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

import { makeMatrix } from "../util";

/* The OGSScoreEstimator method is a wasm compiled C program that
 * does simple random playouts. On the client, the OGSScoreEstimator script
 * is loaded in an async fashion, so at some point that global variable
 * becomes not null and can be used.
 */

declare const CLIENT: boolean;

declare let OGSScoreEstimator: any;
let OGSScoreEstimator_initialized = false;
let OGSScoreEstimatorModule: any;

let init_promise: Promise<boolean>;

export function init_wasm_ownership_estimator(): Promise<boolean> {
    if (!CLIENT) {
        throw new Error("Only initialize WASM library on the client side");
    }

    if (OGSScoreEstimator_initialized) {
        return Promise.resolve(true);
    }

    if (init_promise) {
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
        OGSScoreEstimatorModule = OGSScoreEstimatorModule();
        OGSScoreEstimator_initialized = true;
        return Promise.resolve(true);
    }

    const script: HTMLScriptElement = document.getElementById(
        "ogs_score_estimator_script",
    ) as HTMLScriptElement;
    if (script) {
        let resolve: (tf: boolean) => void;
        let reject: (err: any) => void;
        init_promise = new Promise<boolean>((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });

        script.onload = () => {
            try {
                OGSScoreEstimatorModule = OGSScoreEstimator;
                OGSScoreEstimatorModule = OGSScoreEstimatorModule();
                OGSScoreEstimator_initialized = true;
            } catch (e) {
                reject(e);
                return;
            }
            resolve(true);
        };

        return init_promise;
    } else {
        return Promise.reject("score estimator not available");
    }
}

export function wasm_estimate_ownership(
    board: number[][],
    color_to_move: "black" | "white",
    trials: number,
    tolerance: number,
) {
    const width = board[0].length;
    const height = board.length;
    const ownership = makeMatrix(width, height, 0);

    if (!OGSScoreEstimator_initialized) {
        console.warn("Score estimator not initialized yet, uptime = " + performance.now());
        return ownership;
    }

    try {
        const n_bytes = 4 * width * height;
        const ptr = OGSScoreEstimatorModule._malloc(n_bytes);
        const ints = new Int32Array(OGSScoreEstimatorModule.HEAP32.buffer, ptr, n_bytes);
        let i = 0;
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                ints[i] = board[y][x];
                ++i;
            }
        }

        const estimate = OGSScoreEstimatorModule.cwrap("estimate", "number", [
            "number",
            "number",
            "number",
            "number",
            "number",
            "number",
        ]) as (
            width: number,
            height: number,
            ptr: number,
            color_to_move: number,
            trials: number,
            tolerance: number,
        ) => number;
        estimate(width, height, ptr, color_to_move === "black" ? 1 : -1, trials, tolerance);

        i = 0;
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                ownership[y][x] = ints[i];
                ++i;
            }
        }

        OGSScoreEstimatorModule._free(ptr);
    } catch (e) {
        console.warn(e);
    }

    return ownership;
}
