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
