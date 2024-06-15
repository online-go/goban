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

export * from "engine";
export * from "./renderer/callbacks";
export * from "./renderer/canvas_utils";
export * from "./renderer/GobanCanvas";
export * from "./Goban";
export * from "./renderer/GobanSVG";
export * from "./renderer/GoTheme";
export * from "./renderer/GoThemes";
export * from "./renderer/TestGoban";

export * as protocol from "engine/protocol";
export { placeRenderedImageStone, preRenderImageStone } from "./renderer/themes/image_stones";
//export { GobanCanvas as Goban, GobanCanvasConfig as GobanConfig } from "./GobanCanvas";
//export { GobanSVG as Goban, GobanSVGConfig as GobanConfig } from "./GobanSVG";

import { GobanCanvas, GobanCanvasConfig } from "./renderer/GobanCanvas";
import { GobanSVG, GobanSVGConfig } from "./renderer/GobanSVG";

export type GobanRenderer = GobanCanvas | GobanSVG;
export type GobanRendererConfig = GobanCanvasConfig | GobanSVGConfig;

(window as any)["goban"] = module.exports;

let renderer: "svg" | "canvas" = "canvas";

export function setGobanRenderer(_renderer: "svg" | "canvas") {
    renderer = _renderer;
}

import { AdHocFormat, JGOF } from "engine";

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
