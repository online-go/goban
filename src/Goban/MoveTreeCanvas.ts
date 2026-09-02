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

import { GobanEngine } from "../engine";
import { MoveTree } from "../engine/MoveTree";
import { GobanSelectedThemes } from "./Goban";
import { ResolvedThemes } from "./NativeThemeAssets";

/**
 * The slice of a renderer the move tree canvas drives. Kept as an interface
 * so the move tree can be built and tested without a full renderer.
 */
export interface MoveTreeHost {
    engine: GobanEngine;
    destroyed: boolean;
    square_size: number;
    present_next_move: boolean;
    clickJumpTarget(node: MoveTree): void;
    syncReviewMove(): void;
    setLabelCharacterFromMarks(): void;
    updateTitleAndStonePlacement(): void;
    emit(event: "update"): void;
    redraw(force?: boolean): void;
    on(event: "destroy", cb: () => void): void;
}

/**
 * Standalone canvas move tree, extracted from the renderers so
 * GobanNativeRenderer (which owns no pixels of the board itself) can still
 * present one. Filled in by a later task; the surface is stubbed here so the
 * renderer can be written against it.
 */
export class MoveTreeCanvas {
    private _container?: HTMLElement;

    constructor(
        _host: MoveTreeHost,
        _resolved: () => ResolvedThemes,
        _themes: () => GobanSelectedThemes,
    ) {
        /* Stub: see Task 8. */
    }

    public get container(): HTMLElement | undefined {
        return this._container;
    }

    public setContainer(container: HTMLElement | null): void {
        this._container = container ?? undefined;
    }

    public redraw(_no_warp?: boolean): void {
        /* Stub: see Task 8. */
    }

    public destroy(): void {
        /* Stub: see Task 8. */
    }
}
