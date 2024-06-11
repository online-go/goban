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

export * from "./GobanCore";
export * from "./GobanCanvas";
export * from "./GobanSVG";
export * from "./GoConditionalMove";
export * from "./GoEngine";
export * from "./GobanError";
export * from "./GoStoneGroup";
export * from "./GoStoneGroups";
export * from "./GoTheme";
export * from "./GoThemes";
export * from "./util";
export * from "./canvas_utils";
export * from "./MoveTree";
export * from "./ScoreEstimator";
export * from "./translate";
export * from "./JGOF";
export * from "./AIReview";
export * from "./AdHocFormat";
export * from "./TestGoban";
export * from "./test_utils";
export * from "./GobanSocket";
export * from "./util";
export * from "./autoscore";

export * as GoMath from "./GoMath";
export * as protocol from "./protocol";
export { placeRenderedImageStone, preRenderImageStone } from "./themes/image_stones";
//export { GobanCanvas as Goban, GobanCanvasConfig as GobanConfig } from "./GobanCanvas";
//export { GobanSVG as Goban, GobanSVGConfig as GobanConfig } from "./GobanSVG";

import { GobanCanvas, GobanCanvasConfig } from "./GobanCanvas";
import { GobanSVG, GobanSVGConfig } from "./GobanSVG";

export type GobanRenderer = GobanCanvas | GobanSVG;
export type GobanRendererConfig = GobanCanvasConfig | GobanSVGConfig;

(window as any)["goban"] = module.exports;

let renderer: "svg" | "canvas" = "canvas";

export function setGobanRenderer(_renderer: "svg" | "canvas") {
    renderer = _renderer;
}

import { AdHocFormat } from "./AdHocFormat";
import { JGOF } from "./JGOF";

export function createGoban(
    config: GobanRendererConfig,
    preloaded_data?: AdHocFormat | JGOF,
): GobanRenderer {
    if (renderer === "svg") {
        return new GobanSVG(config, preloaded_data);
    } else {
        return new GobanCanvas(config, preloaded_data);
    }
}
