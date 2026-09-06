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

(global as any).CLIENT = true;

import { GobanCanvas, CanvasRendererGobanConfig } from "../../src/Goban/CanvasRenderer";
import { GobanNativeRenderer, NativeRendererGobanConfig } from "../../src/Goban/NativeRenderer";
import {
    GobanNativeTransport,
    NativeAttachOptions,
    NativeIntentPenEvent,
    NativeIntentPlaceEvent,
    NativeRect,
    NativeTheme,
    NativeUpdateOptions,
} from "../../src/Goban/NativeTransport";
import { GobanBase } from "../../src/GobanBase";
import type { GobanSelectedThemes } from "../../src/Goban/Goban";
import { callbacks } from "../../src/Goban/callbacks";
import { THEMES } from "../../src/Goban/themes";
import { forgetPreRenderedStones } from "../../src/Goban/NativeThemeAssets";
import { MoveTree } from "../../src/engine/MoveTree";
import { GobanSocket } from "engine";
import WS from "jest-websocket-mock";

const test_port = 48893;
const socket_server = new WS(`ws://localhost:${test_port}`, { jsonProtocol: true });
const mock_socket = new GobanSocket(`ws://localhost:${test_port}`, {
    dont_ping: true,
    quiet: true,
});
void socket_server;

/** The minimum a GobanNativeRenderer needs to come up; it records nothing we
 *  assert on here, the move tree is a plain DOM widget beside the rim. */
class RecordingTransport implements GobanNativeTransport {
    public calls: Array<{ method: string; opts: any }> = [];
    private place_listeners: Array<(e: NativeIntentPlaceEvent) => void> = [];
    private pen_listeners: Array<(e: NativeIntentPenEvent) => void> = [];

    attach(opts: NativeAttachOptions): Promise<void> {
        this.calls.push({ method: "attach", opts });
        return Promise.resolve();
    }
    update(opts: NativeUpdateOptions): Promise<void> {
        this.calls.push({ method: "update", opts });
        return Promise.resolve();
    }
    move(opts: { id: string; rect: NativeRect }): Promise<void> {
        this.calls.push({ method: "move", opts });
        return Promise.resolve();
    }
    setTheme(opts: { id: string; theme: NativeTheme }): Promise<void> {
        this.calls.push({ method: "setTheme", opts });
        return Promise.resolve();
    }
    setMessage(opts: { id: string; text: string | null }): Promise<void> {
        this.calls.push({ method: "setMessage", opts });
        return Promise.resolve();
    }
    suspend(opts: { id: string }): Promise<{ snapshot: string }> {
        this.calls.push({ method: "suspend", opts });
        return Promise.resolve({ snapshot: "data:image/png;base64,SNAP" });
    }
    resume(opts: { id: string }): Promise<void> {
        this.calls.push({ method: "resume", opts });
        return Promise.resolve();
    }
    detach(opts: { id: string }): Promise<void> {
        this.calls.push({ method: "detach", opts });
        return Promise.resolve();
    }
    onIntentPlace(cb: (e: NativeIntentPlaceEvent) => void): () => void {
        this.place_listeners.push(cb);
        return () => (this.place_listeners = this.place_listeners.filter((l) => l !== cb));
    }
    onIntentPen(cb: (e: NativeIntentPenEvent) => void): () => void {
        this.pen_listeners.push(cb);
        return () => (this.pen_listeners = this.pen_listeners.filter((l) => l !== cb));
    }
}

const TREE_WIDTH = 200;
const TREE_HEIGHT = 100;

let board_div: HTMLDivElement;
let move_tree_container: HTMLDivElement;

/** jsdom lays nothing out, so the widget would size its canvas to 0x0. */
function makeMoveTreeContainer(): HTMLDivElement {
    const div = document.createElement("div");
    Object.defineProperty(div, "clientWidth", { value: TREE_WIDTH });
    Object.defineProperty(div, "clientHeight", { value: TREE_HEIGHT });
    document.body.appendChild(div);
    return div;
}

/** Two trunk moves plus a variation branching off the first. */
function playTwoMovesAndAVariation(goban: GobanBase): void {
    const engine = goban.engine;
    engine.place(0, 0);
    engine.place(1, 0);
    const parent = engine.cur_move.parent!;
    engine.jumpTo(parent);
    engine.place(2, 2);
}

function expectRenderedTree(container: HTMLElement): void {
    const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBeGreaterThan(0);
    expect(canvas!.height).toBeGreaterThan(0);
}

beforeEach(() => {
    board_div = document.createElement("div");
    document.body.appendChild(board_div);
    move_tree_container = makeMoveTreeContainer();
});

afterEach(() => {
    board_div.remove();
    move_tree_container.remove();
});

describe("move tree widget", () => {
    test("GobanCanvas draws the tree into the container it was given", () => {
        const config: CanvasRendererGobanConfig = {
            square_size: 10,
            board_div,
            interactive: true,
            server_socket: mock_socket,
            width: 3,
            height: 3,
            move_tree_container,
        };
        const goban = new GobanCanvas(config);

        expect(goban.move_tree_container).toBe(move_tree_container);

        playTwoMovesAndAVariation(goban);
        goban.move_tree_redraw();

        expectRenderedTree(move_tree_container);
        goban.destroy();
        expect(move_tree_container.querySelector("canvas")).toBeNull();
    });

    test("GobanNativeRenderer draws the same tree", async () => {
        const config: NativeRendererGobanConfig = {
            square_size: 10,
            board_div,
            interactive: true,
            server_socket: mock_socket,
            width: 3,
            height: 3,
            native_transport: new RecordingTransport(),
            move_tree_container,
        };
        const goban = new GobanNativeRenderer(config);
        for (let i = 0; i < 6; ++i) {
            await new Promise((r) => setTimeout(r, 0));
        }

        playTwoMovesAndAVariation(goban);
        goban.move_tree_redraw();

        expectRenderedTree(move_tree_container);
        goban.destroy();
        expect(move_tree_container.querySelector("canvas")).toBeNull();
    });
});

describe("move tree stone cache", () => {
    /** How many times the theme pre-rendered stones at the move tree's radius.
     *  The board's own stones use a different (square-size derived) radius, so
     *  filtering on the radius isolates the tree's renders. */
    function treeRenders(spy: jest.SpyInstance): number {
        return spy.mock.calls.filter((call) => call[0] === MoveTree.stone_radius).length;
    }

    function themesWithBlack(black: string): GobanSelectedThemes {
        return {
            "white": "Shell",
            "black": black,
            "board": "Kaya",
            "removal-graphic": "square",
            "removal-scale": 1.0,
            "stone-scale": 1.0,
            "stone-shadows": "none",
        };
    }

    afterEach(() => {
        delete callbacks.getSelectedThemes;
        jest.restoreAllMocks();
    });

    test("a board resize does not re-render the tree's stones, a new theme does", () => {
        callbacks.getSelectedThemes = () => themesWithBlack("Slate");
        const goban = new GobanCanvas({
            square_size: 10,
            board_div,
            interactive: true,
            server_socket: mock_socket,
            width: 3,
            height: 3,
            move_tree_container,
        });
        playTwoMovesAndAVariation(goban);
        goban.move_tree_redraw();
        expectRenderedTree(move_tree_container);

        const slate = jest.spyOn(THEMES["black"]["Slate"].prototype, "preRenderBlack");

        goban.setSquareSize(20);
        goban.move_tree_redraw();
        expect(treeRenders(slate)).toBe(0);

        const night = jest.spyOn(THEMES["black"]["Night"].prototype, "preRenderBlack");
        goban.setTheme(themesWithBlack("Night"), true);
        goban.move_tree_redraw();
        expect(treeRenders(night)).toBe(1);

        goban.destroy();
    });

    test("forgetPreRenderedStones makes the tree re-render a busted theme", () => {
        callbacks.getSelectedThemes = () => themesWithBlack("Glass");
        const goban = new GobanCanvas({
            square_size: 10,
            board_div,
            interactive: true,
            server_socket: mock_socket,
            width: 3,
            height: 3,
            move_tree_container,
        });
        playTwoMovesAndAVariation(goban);
        goban.move_tree_redraw();

        const glass = jest.spyOn(THEMES["black"]["Glass"].prototype, "preRenderBlack");
        goban.move_tree_redraw();
        expect(treeRenders(glass)).toBe(0);

        forgetPreRenderedStones("Glass");
        goban.move_tree_redraw();
        expect(treeRenders(glass)).toBe(1);

        goban.destroy();
    });
});
