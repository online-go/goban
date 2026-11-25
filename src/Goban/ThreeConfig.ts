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

import type { GobanConfig } from "../GobanBase";
import type { AdHocFormat, JGOF } from "../engine";
import { SVGRenderer } from "./SVGRenderer";

export type ThreeBoardStyle = "tabletop" | "floor";

export interface ThreeRendererOptions {
    boardStyle?: ThreeBoardStyle;
    /** Include the table, bowls and capture lids in the 3D view. */
    room?: boolean;
    tilt?: 0 | 15 | 25 | 35;
    /** Orbit the camera around the board in quarter turns. */
    rotation?: 0 | 90 | 180 | 270;
    /** Enable holding V and dragging with the primary mouse button to orbit. */
    mouseOrbit?: boolean;
    /** Show the board mirrored left to right; text stays readable (ignored with a room). */
    mirror?: boolean;
    /** Label coordinates by screen position (letters along the bottom, numbers up the
     *  side) and keep all text upright, whatever the camera rotation or mirror. */
    fixedCoordinates?: boolean;
    fieldOfView?: number;
    distanceScale?: number;
    /** Share of the viewport the fitted board may fill (default 0.92). */
    frameLimit?: number;
    lighting?: {
        preset: "studio" | "daylight" | "directional" | "analysis";
        azimuth?: number;
        intensity?: number;
    };
    maxPixelRatio?: number;
    /** Optional detached or hidden SVG artwork sink for diagnostics. */
    annotationInspection?: HTMLDivElement;
    /** Called on failed activation or loss of the active WebGL surface. */
    onFallback?: (error: unknown) => void;
}

export interface ThreeRenderer {
    readonly goban: SVGRenderer;
    readonly active: boolean;
    enable(): boolean;
    disable(): void;
    configure(options: ThreeRendererOptions): void;
}

export interface ThreeGobanConfig extends GobanConfig {
    three?: ThreeRendererOptions;
}

/** Create the game synchronously on SVG, then request the optional WebGL painter. */
export async function createThreeGoban(
    config: ThreeGobanConfig,
    preloaded?: AdHocFormat | JGOF,
): Promise<ThreeRenderer> {
    const goban = new SVGRenderer(config, preloaded);
    return enableThreeGoban(goban, config.three);
}

let threeBackend: Promise<typeof import("./Three/backend")> | undefined;
let threeImportStarted = false;

function loadThreeBackend(): Promise<typeof import("./Three/backend")> {
    if (!threeBackend) {
        if (
            !threeImportStarted &&
            typeof performance !== "undefined" &&
            typeof performance.mark === "function"
        ) {
            performance.mark("goban-three:import-start");
        }
        threeImportStarted = true;
        threeBackend = import(/* webpackChunkName: "goban-three" */ "./Three/backend")
            .then((backend) => {
                if (typeof performance !== "undefined" && typeof performance.mark === "function") {
                    performance.mark("goban-three:import-end");
                }
                return backend;
            })
            .catch((error: unknown) => {
                threeBackend = undefined;
                throw error;
            });
    }
    return threeBackend;
}

/** Start loading the 3D board code. Safe to call many times; the code is loaded once. */
export function preloadThreeGoban(): Promise<void> {
    return loadThreeBackend().then(() => undefined);
}

/** Load browser-only code and attach it to an existing goban without changing its state. */
export async function enableThreeGoban(
    goban: SVGRenderer,
    options: ThreeRendererOptions = {},
): Promise<ThreeRenderer> {
    try {
        const { attachThree } = await loadThreeBackend();
        return attachThree(goban, options);
    } catch (error) {
        options.onFallback?.(error);
        return {
            goban,
            active: false,
            enable: () => false,
            disable: () => undefined,
            configure: () => undefined,
        };
    }
}
