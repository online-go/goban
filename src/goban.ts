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
export * from "./GoConditionalMove";
export * from "./GoEngine";
export * from "./GobanError";
export * from "./GoStoneGroup";
export * from "./GoStoneGroups";
export * from "./GoTheme";
export * from "./GoThemes";
export * from "./GoUtil";
export * from "./MoveTree";
export * from "./ScoreEstimator";
export * from "./translate";
export * from "./TypedEventEmitter";
export * from "./JGOF";
export * from "./AIReview";
export * from "./AdHocFormat";
export * from "./TestGoban";
export * from "./test_utils";
export * from "./GobanSocket";

export * as GoMath from "./GoMath";
export * as protocol from "./protocol";
export { placeRenderedImageStone, preRenderImageStone } from "./themes/image_stones";
export { GobanCanvas as Goban, GobanCanvasConfig as GobanConfig } from "./GobanCanvas";

(window as any)["goban"] = module.exports;
