/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
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

import { GobanConfig } from "../GobanBase";
import { GobanEngine } from "../engine/GobanEngine";
import { MessageID } from "../engine/messages";
import { MoveTreePenMarks } from "../engine/MoveTree";
import { Goban, GobanSelectedThemes } from "./Goban";

/**
 * This is a minimal implementation of Goban, primarily used for unit tests.
 */
export class TestGoban extends Goban {
    public engine: GobanEngine;

    constructor(config: GobanConfig) {
        super(config);

        this.engine = new GobanEngine(config);
    }

    public enablePen(): void {}
    public disablePen(): void {}
    public clearAnalysisDrawing(): void {}
    public drawPenMarks(pen_marks: MoveTreePenMarks): void {}
    public showMessage(
        msg_id: MessageID,
        parameters?: { [key: string]: any } | undefined,
        timeout?: number | undefined,
    ): void {}
    public clearMessage(): void {}
    protected setTheme(themes: GobanSelectedThemes, dont_redraw: boolean): void {}
    public drawSquare(i: number, j: number): void {}
    public redraw(force_clear?: boolean | undefined): void {}
    public move_tree_redraw(no_warp?: boolean | undefined): void {}
    public setMoveTreeContainer(container: HTMLElement): void {}
    protected setTitle(title: string): void {}
    protected enableDrawing(): void {}
    protected disableDrawing(): void {}
}
