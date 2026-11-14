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

import type { GobanBounds } from "../GobanBase";
import type { GobanSelectedThemes } from "./Goban";
import type {
    NativeGhost,
    NativeLabels,
    NativeLastMove,
    NativeOverlay,
    NativePenMark,
} from "./NativeTransport";

export interface BoardPoint {
    x: number;
    y: number;
}

/** A synchronous browser view of Goban's live presentation state. */
export interface BoardViewState {
    width: number;
    height: number;
    bounds: GobanBounds;
    labels: NativeLabels;
    labelSystem: "A1" | "1-1";
    overlays: NativeOverlay[];
    lastMove: NativeLastMove | null;
    ghost: NativeGhost | null;
    hover?: BoardPoint;
    pen: NativePenMark[];
    stoneAt(point: BoardPoint): 0 | 1 | 2;
    prettyCoordinates(x: number, y: number): string;
}

/** Optional board painter. The SVG goban retains input, layout and connectivity ownership. */
export interface BoardView {
    element: HTMLElement;
    invalidate(): void;
    setTheme(themes: GobanSelectedThemes): void;
    pick(point: BoardPoint, antiSlip: boolean): BoardPoint | null;
    unproject(point: BoardPoint): BoardPoint | null;
    dispose(): void;
}
