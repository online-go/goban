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
import { GobanSocket } from "engine";
import WS from "jest-websocket-mock";

const test_port = 48891;
const socket_server = new WS(`ws://localhost:${test_port}`, { jsonProtocol: true });
const mock_socket = new GobanSocket(`ws://localhost:${test_port}`, {
    dont_ping: true,
    quiet: true,
});
void socket_server;

interface RecordedCall {
    method: string;
    opts: any;
}

export class RecordingTransport implements GobanNativeTransport {
    public calls: RecordedCall[] = [];
    public reject_attach_once = false;
    private place_listeners: Array<(e: NativeIntentPlaceEvent) => void> = [];
    private pen_listeners: Array<(e: NativeIntentPenEvent) => void> = [];

    attach(opts: NativeAttachOptions): Promise<void> {
        this.calls.push({ method: "attach", opts });
        if (this.reject_attach_once) {
            this.reject_attach_once = false;
            return Promise.reject(new Error("rim busy"));
        }
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
    emitPlace(e: NativeIntentPlaceEvent): void {
        this.place_listeners.forEach((l) => l(e));
    }
    emitPen(e: NativeIntentPenEvent): void {
        this.pen_listeners.forEach((l) => l(e));
    }
    callsOf(method: string): RecordedCall[] {
        return this.calls.filter((c) => c.method === method);
    }
    lastUpdate(): NativeUpdateOptions {
        const u = this.callsOf("update");
        return u[u.length - 1].opts;
    }
}

async function flush(): Promise<void> {
    for (let i = 0; i < 6; ++i) {
        await new Promise((r) => setTimeout(r, 0));
    }
}

let board_div: HTMLDivElement;

function config(
    transport: RecordingTransport,
    overrides?: Partial<NativeRendererGobanConfig>,
): NativeRendererGobanConfig {
    return {
        square_size: 10,
        board_div,
        interactive: true,
        server_socket: mock_socket,
        width: 3,
        height: 3,
        draw_top_labels: false,
        draw_bottom_labels: false,
        draw_left_labels: false,
        draw_right_labels: false,
        native_transport: transport,
        ...(overrides ?? {}),
    };
}

beforeEach(() => {
    board_div = document.createElement("div");
    document.body.appendChild(board_div);
});
afterEach(() => board_div.remove());

describe("lifecycle", () => {
    test("attaches once with the full spec and theme", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        expect(goban.nativeState).toBe("active");
        const attaches = t.callsOf("attach");
        expect(attaches).toHaveLength(1);
        const opts: NativeAttachOptions = attaches[0].opts;
        expect(opts.id).toBe(`goban-${goban.goban_id}`);
        expect(opts.width).toBe(3);
        expect(opts.height).toBe(3);
        expect(opts.board).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(opts.labels).toEqual({ top: false, bottom: false, left: false, right: false });
        expect(opts.bounds).toBeNull();
        expect(opts.inputMode).toBe("place");
        expect(opts.theme.blackStones.length).toBeGreaterThan(0);
        expect(opts.theme.cellPx).toBe(10);
        goban.destroy();
    });

    test("sizes the board div like the canvas renderer would", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(
            config(t, { draw_top_labels: true, draw_left_labels: true }),
        );
        await flush();
        expect(board_div.style.width).toBe("40px");
        expect(board_div.style.height).toBe("40px");
        expect(board_div.querySelector("canvas")).toBeNull();
        goban.destroy();
    });

    test("a rejected attach is retried on the next sync, never a fallback", async () => {
        const t = new RecordingTransport();
        t.reject_attach_once = true;
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        expect(goban.nativeState).toBe("pending");
        goban.redraw(true);
        await flush();
        expect(goban.nativeState).toBe("active");
        expect(t.callsOf("attach")).toHaveLength(2);
        goban.destroy();
    });

    test("destroy detaches", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.destroy();
        await flush();
        expect(t.callsOf("detach")).toHaveLength(1);
        expect(goban.nativeState).toBe("destroyed");
    });
});

describe("updates", () => {
    /* one_click_submit so the tap commits the move instead of leaving
     * `submit_move` pending, which the canvas (and therefore buildLastMove)
     * renders as the "plus" crosshair rather than the last-move circle. */
    test("intentPlace places a stone and the update carries only changed fields", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t, { one_click_submit: true }));
        await flush();
        goban.enableStonePlacement();
        t.emitPlace({ id: `goban-${goban.goban_id}`, x: 1, y: 2 });
        await flush();
        const u = t.lastUpdate();
        expect(u.board).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0]);
        expect(u.colorToMove).toBe(2);
        expect(u.lastMove).toMatchObject({ x: 1, y: 2, style: "circle" });
        expect(u.width).toBeUndefined();
        expect(u.labels).toBeUndefined();
        goban.destroy();
    });

    test("identical state sends no update", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        const before = t.callsOf("update").length;
        goban.redraw(true);
        await flush();
        goban.redraw(true);
        await flush();
        expect(t.callsOf("update").length).toBe(before);
        goban.destroy();
    });

    test("marks flow into overlays", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.setMark(0, 0, "triangle");
        await flush();
        const u = t.lastUpdate();
        expect(u.overlays![0]).toMatchObject({ x: 0, y: 0 });
        expect(u.overlays![0].shapes![0].kind).toBe("triangle");
        goban.destroy();
    });

    test("board size change re-attaches", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.load({ width: 9, height: 9 });
        await flush();
        expect(t.callsOf("detach")).toHaveLength(1);
        expect(t.callsOf("attach")).toHaveLength(2);
        expect(t.callsOf("attach")[1].opts.width).toBe(9);
        goban.destroy();
    });

    test("ignores intents for other ids", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.enableStonePlacement();
        t.emitPlace({ id: "goban-other", x: 0, y: 0 });
        expect(goban.engine.board[0][0]).toBe(0);
        goban.destroy();
    });
});

describe("pen", () => {
    test("draw tool switches to pen input and strokes land in pen_marks", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t, { mode: "analyze" }));
        await flush();
        goban.setAnalyzeTool("draw", "#ff0000" as any);
        await flush();
        let u = t.lastUpdate();
        expect(u.inputMode).toBe("pen");
        expect(u.penColor).toBe("#ff0000");
        t.emitPen({
            id: `goban-${goban.goban_id}`,
            color: "#ff0000",
            points: [0, 0, 1, 1, 2, 1],
        });
        await flush();
        expect(goban.pen_marks).toHaveLength(1);
        expect(goban.pen_marks[0].points).toEqual([96, 96, 64, 64, 64, 0]);
        u = t.lastUpdate();
        expect(u.penMarks![0].points).toEqual([0, 0, 1, 1, 2, 1]);
        goban.destroy();
    });
});

describe("messages and overlays", () => {
    test("showMessage goes to the rim as plain text", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.showMessage("processing", undefined, -1);
        await flush();
        expect(t.callsOf("setMessage")[0].opts.text.length).toBeGreaterThan(0);
        goban.clearMessage();
        await flush();
        expect(t.callsOf("setMessage")[1].opts.text).toBeNull();
        goban.destroy();
    });

    test("suspend places the snapshot image, resume removes it", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        const snap = await goban.suspendNativeView();
        expect(snap).toBe("data:image/png;base64,SNAP");
        expect(board_div.querySelector("img")?.getAttribute("src")).toBe(snap);
        goban.resumeNativeView();
        await flush();
        expect(t.callsOf("resume")).toHaveLength(1);
        expect(board_div.querySelector("img")).toBeNull();
        goban.destroy();
    });

    test("theme change pushes new assets", async () => {
        const t = new RecordingTransport();
        const goban = new GobanNativeRenderer(config(t));
        await flush();
        goban.setSquareSize(20);
        await flush();
        const themes = t.callsOf("setTheme");
        expect(themes.length).toBeGreaterThan(0);
        expect(themes[themes.length - 1].opts.theme.cellPx).toBe(20);
        goban.destroy();
    });
});
