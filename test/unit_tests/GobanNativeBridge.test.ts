/*
 * Copyright (C)  Online-Go.com
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

import { GobanNativeBridge, NativeBridgeGobanConfig } from "../../src/Goban/GobanNativeBridge";
import {
    GobanNativeBridgeTransport,
    NativeBridgeAttachOptions,
    NativeBridgeIntentPlaceEvent,
    NativeBridgeRect,
    NativeBridgeTheme,
    NativeBridgeUpdateOptions,
} from "../../src/Goban/NativeBridgeTransport";
import { callbacks } from "../../src/Goban/callbacks";
import { GobanSocket } from "engine";
import WS from "jest-websocket-mock";

const test_port = 48890;
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

class RecordingTransport implements GobanNativeBridgeTransport {
    public calls: RecordedCall[] = [];
    public reject_attach = false;
    /** One-shot rejections (consumed on use): a transient failure of the
     *  next update/move call. */
    public reject_next_update = false;
    public reject_next_move = false;
    /** When set, the next attach/detach call resolves only after the gate
     *  promise does (consumed on use); lets tests hold the bridge's serial
     *  op queue open to provoke races. */
    public next_attach_gate?: Promise<void>;
    public next_detach_gate?: Promise<void>;
    public next_resume_gate?: Promise<void>;
    private listeners: Array<(event: NativeBridgeIntentPlaceEvent) => void> = [];

    attach(opts: NativeBridgeAttachOptions): Promise<void> {
        this.calls.push({ method: "attach", opts });
        if (this.reject_attach) {
            return Promise.reject(new Error("unsupported"));
        }
        const gate = this.next_attach_gate;
        this.next_attach_gate = undefined;
        return gate ?? Promise.resolve();
    }
    update(opts: NativeBridgeUpdateOptions): Promise<void> {
        this.calls.push({ method: "update", opts });
        if (this.reject_next_update) {
            this.reject_next_update = false;
            return Promise.reject(new Error("update failed"));
        }
        return Promise.resolve();
    }
    move(opts: { id: string; rect: NativeBridgeRect }): Promise<void> {
        this.calls.push({ method: "move", opts });
        if (this.reject_next_move) {
            this.reject_next_move = false;
            return Promise.reject(new Error("move failed"));
        }
        return Promise.resolve();
    }
    setTheme(opts: { id: string; theme: NativeBridgeTheme }): Promise<void> {
        this.calls.push({ method: "setTheme", opts });
        return Promise.resolve();
    }
    suspend(opts: { id: string }): Promise<{ snapshot: string }> {
        this.calls.push({ method: "suspend", opts });
        return Promise.resolve({ snapshot: "data:image/png;base64,SNAPSHOT" });
    }
    resume(opts: { id: string }): Promise<void> {
        this.calls.push({ method: "resume", opts });
        const gate = this.next_resume_gate;
        this.next_resume_gate = undefined;
        return gate ?? Promise.resolve();
    }
    detach(opts: { id: string }): Promise<void> {
        this.calls.push({ method: "detach", opts });
        const gate = this.next_detach_gate;
        this.next_detach_gate = undefined;
        return gate ?? Promise.resolve();
    }
    onIntentPlace(cb: (event: NativeBridgeIntentPlaceEvent) => void): () => void {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== cb);
        };
    }

    emitIntentPlace(event: NativeBridgeIntentPlaceEvent): void {
        for (const cb of this.listeners) {
            cb(event);
        }
    }
    callsOf(method: string): RecordedCall[] {
        return this.calls.filter((c) => c.method === method);
    }
    get listener_count(): number {
        return this.listeners.length;
    }
}

/** Let the bridge's microtask-coalesced sync and serial op queue drain. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; ++i) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

/** A manually-opened gate for the RecordingTransport's `next_*_gate`s. */
function gate(): { promise: Promise<void>; open: () => void } {
    let open: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
}

let board_div: HTMLDivElement;

function config(
    transport: RecordingTransport | undefined,
    overrides?: Partial<NativeBridgeGobanConfig>,
): NativeBridgeGobanConfig {
    return {
        square_size: 10,
        board_div: board_div,
        interactive: true,
        server_socket: mock_socket,
        width: 3,
        height: 3,
        native_transport: transport,
        ...(overrides ?? {}),
    };
}

/* The first goban built in a worker pays one-time costs that dwarf anything
 * any test here does: the theme cache starts cold, and node-canvas enumerates
 * the system fonts the first time the board draws its coordinate labels.
 * Locally that is ~50ms against ~6ms for every construction after it; on a CI
 * runner it is enough on its own to blow the project's 1000ms per-test budget.
 * Pay it once up front so it lands on a hook rather than on whichever test
 * happens to run first. */
beforeAll(async () => {
    const warmup_div = document.createElement("div");
    document.body.appendChild(warmup_div);
    const goban = new GobanNativeBridge(
        config(new RecordingTransport(), { board_div: warmup_div }),
    );
    await flush();
    goban.destroy();
    warmup_div.remove();
}, 30000);

beforeEach(() => {
    board_div = document.createElement("div");
    document.body.appendChild(board_div);
});

afterEach(() => {
    board_div.remove();
});

describe("attach", () => {
    test("attaches with flat board, colorToMove, theme and interactive flag", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        expect(goban.nativeBridgeState).toBe("active");
        const attaches = transport.callsOf("attach");
        expect(attaches).toHaveLength(1);
        const opts = attaches[0].opts as NativeBridgeAttachOptions;
        expect(opts.id).toBe(`goban-${goban.goban_id}`);
        expect(opts.size).toBe(3);
        expect(opts.board).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(opts.colorToMove).toBe(1);
        expect(opts.interactive).toBe(true);
        for (const key of [
            "boardColor",
            "lineColor",
            "blackStoneColor",
            "whiteStoneColor",
            "backgroundColor",
        ] as const) {
            expect(typeof opts.theme[key]).toBe("string");
            expect(opts.theme[key].length).toBeGreaterThan(0);
        }
        goban.destroy();
    });

    test("hides the web canvas while the native view is active", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("without a transport the bridge is a plain canvas renderer", async () => {
        const goban = new GobanNativeBridge(config(undefined));
        await flush();

        expect(goban.nativeBridgeState).toBe("fallback");
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");
        goban.destroy();
    });

    test("attach rejection falls back to the canvas permanently", async () => {
        const transport = new RecordingTransport();
        transport.reject_attach = true;
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        expect(goban.nativeBridgeState).toBe("fallback");
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        /* and stays fallen back across later state changes */
        goban.redraw(true);
        await flush();
        expect(transport.callsOf("attach")).toHaveLength(1);
        goban.destroy();
    });

    test("non-square boards never attach", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport, { width: 4, height: 2 }));
        await flush();

        expect(transport.callsOf("attach")).toHaveLength(0);
        expect(goban.nativeBridgeState).toBe("pending");
        goban.destroy();
    });

    test("analyze mode at construction never attaches", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport, { mode: "analyze" }));
        await flush();

        expect(transport.callsOf("attach")).toHaveLength(0);
        goban.destroy();
    });
});

describe("intentPlace", () => {
    test("routes through the same path as a canvas tap", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: `goban-${goban.goban_id}`, x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        goban.destroy();
    });

    test("ignores events for other board ids", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: "goban-some-other-board", x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        goban.destroy();
    });

    test("placement flows back out as an update with lastMove", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: `goban-${goban.goban_id}`, x: 1, y: 2 });
        await flush();

        const updates = transport.callsOf("update");
        expect(updates.length).toBeGreaterThan(0);
        const last = updates[updates.length - 1].opts as NativeBridgeUpdateOptions;
        expect(last.board).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0]);
        expect(last.lastMove).toEqual({ x: 1, y: 2 });
        expect(last.colorToMove).toBe(2);
        goban.destroy();
    });

    test("identical state does not produce duplicate updates", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        const updates_before = transport.callsOf("update").length;
        goban.redraw(true);
        await flush();
        goban.redraw(true);
        await flush();

        /* the first sync after attach establishes the baseline; repeated
         * identical redraws must not keep sending updates */
        expect(transport.callsOf("update").length).toBeLessThanOrEqual(updates_before + 1);
        goban.destroy();
    });
});

describe("capability fallback and re-engagement", () => {
    test("entering analyze mode bails to the canvas, returning to play re-engages", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        goban.setMode("analyze");
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        expect(transport.callsOf("suspend")).toHaveLength(1);
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        goban.setMode("play");
        await flush();

        expect(goban.nativeBridgeState).toBe("active");
        expect(transport.callsOf("resume")).toHaveLength(1);
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("marks on the current move bail to the canvas", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        goban.getMarks(1, 1).triangle = true;
        goban.redraw(true);
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        goban.destroy();
    });
});

describe("overlay suspend/resume", () => {
    test("suspendNativeView returns the snapshot and resumeNativeView resumes", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        const snapshot = await goban.suspendNativeView();
        expect(snapshot).toBe("data:image/png;base64,SNAPSHOT");
        expect(transport.callsOf("suspend")).toHaveLength(1);

        goban.resumeNativeView();
        await flush();
        expect(transport.callsOf("resume")).toHaveLength(1);
        goban.destroy();
    });

    test("suspendNativeView is null when the native view is not active", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport, { mode: "analyze" }));
        await flush();

        const snapshot = await goban.suspendNativeView();
        expect(snapshot).toBeNull();
        expect(transport.callsOf("suspend")).toHaveLength(0);
        goban.destroy();
    });

    test("second suspend without resume is a no-op", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        await goban.suspendNativeView();
        const second = await goban.suspendNativeView();
        expect(second).toBeNull();
        expect(transport.callsOf("suspend")).toHaveLength(1);
        goban.destroy();
    });
});

describe("lifecycle races", () => {
    test("destroy during an in-flight attach leaves a clean fallback", async () => {
        const transport = new RecordingTransport();
        const attach_gate = gate();
        transport.next_attach_gate = attach_gate.promise;
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("attaching");

        goban.destroy();
        attach_gate.open();
        await flush();

        /* the attach continuation must not resurrect any state */
        expect(goban.nativeBridgeState).toBe("fallback");
        expect(transport.callsOf("detach")).toHaveLength(1);
        expect(transport.listener_count).toBe(0);
    });

    test("overlay suspend during attach keeps the canvas visible until resume", async () => {
        const transport = new RecordingTransport();
        const attach_gate = gate();
        transport.next_attach_gate = attach_gate.promise;
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("attaching");

        /* the coordinator suspends pre-active and gets no snapshot ... */
        await expect(goban.suspendNativeView()).resolves.toBeNull();
        attach_gate.open();
        await flush();

        /* ... so the fresh native view is hidden but the canvas stays up */
        expect(goban.nativeBridgeState).toBe("active");
        expect(transport.callsOf("suspend")).toHaveLength(1);
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        goban.resumeNativeView();
        await flush();
        expect(transport.callsOf("resume")).toHaveLength(1);
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("re-engaging while overlay-suspended keeps the canvas until resume", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        const snapshot = await goban.suspendNativeView();
        expect(snapshot).toBe("data:image/png;base64,SNAPSHOT");
        goban.setMode("analyze");
        await flush();
        expect(goban.nativeBridgeState).toBe("bailed");

        goban.setMode("play");
        await flush();

        /* re-engaged, but the overlay is still open: no resume, canvas up */
        expect(goban.nativeBridgeState).toBe("active");
        expect(transport.callsOf("resume")).toHaveLength(0);
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        goban.resumeNativeView();
        await flush();
        expect(transport.callsOf("resume")).toHaveLength(1);
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("board size change detaches and re-attaches with the new size", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport, { width: 19, height: 19 }));
        await flush();
        expect((transport.callsOf("attach")[0].opts as NativeBridgeAttachOptions).size).toBe(19);

        goban.load(config(transport, { width: 9, height: 9 }));
        await flush();

        expect(transport.callsOf("detach")).toHaveLength(1);
        const attaches = transport.callsOf("attach");
        expect(attaches).toHaveLength(2);
        const reattach = attaches[1].opts as NativeBridgeAttachOptions;
        expect(reattach.size).toBe(9);
        expect(reattach.board).toHaveLength(81);
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });

    test("engine resize while a re-attach is queued sends a payload built at execution", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport, { width: 19, height: 19 }));
        await flush();

        /* hold the queue open on the reattach's detach so the follow-up
         * attach op is still queued when the engine changes size again */
        const detach_gate = gate();
        transport.next_detach_gate = detach_gate.promise;
        goban.load(config(transport, { width: 9, height: 9 }));
        await flush();
        goban.load(config(transport, { width: 13, height: 13 }));
        await flush();
        detach_gate.open();
        await flush();

        const attaches = transport.callsOf("attach");
        const last = attaches[attaches.length - 1].opts as NativeBridgeAttachOptions;
        /* size and board must agree with each other and with the engine
         * as of op execution, never with values captured at schedule */
        expect(last.size).toBe(13);
        expect(last.board).toHaveLength(169);
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });

    test("attach carries the state baseline; no redundant first update", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");
        expect(transport.callsOf("update")).toHaveLength(0);

        goban.redraw(true);
        await flush();
        expect(transport.callsOf("update")).toHaveLength(0);

        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: `goban-${goban.goban_id}`, x: 0, y: 0 });
        await flush();
        expect(transport.callsOf("update")).toHaveLength(1);
        goban.destroy();
    });
});

describe("transport failure recovery while active", () => {
    test("update rejection while active shows the canvas and re-probes with attach", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        transport.reject_next_update = true;
        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: `goban-${goban.goban_id}`, x: 0, y: 0 });
        await flush();

        /* never silently frozen: detach + fresh attach carrying the move */
        expect(transport.callsOf("detach")).toHaveLength(1);
        const attaches = transport.callsOf("attach");
        expect(attaches).toHaveLength(2);
        expect((attaches[1].opts as NativeBridgeAttachOptions).board).toContain(1);
        expect(goban.nativeBridgeState).toBe("active");
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("move rejection while active recovers through a re-attach", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        transport.reject_next_move = true;
        /* bail + re-engage forces a move push, which now rejects */
        goban.setMode("analyze");
        await flush();
        goban.setMode("play");
        await flush();

        expect(transport.callsOf("attach")).toHaveLength(2);
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });

    test("persistently failing transport converges to permanent canvas fallback", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        transport.reject_next_update = true;
        transport.reject_attach = true;
        goban.enableStonePlacement();
        transport.emitIntentPlace({ id: `goban-${goban.goban_id}`, x: 0, y: 0 });
        await flush();

        /* update failed -> re-probe attach failed -> permanent fallback */
        expect(goban.nativeBridgeState).toBe("fallback");
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");
        goban.destroy();
    });
});

describe("sync plumbing", () => {
    test("window resize triggers a geometry-only sync (no board update)", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        const updates_before = transport.callsOf("update").length;

        window.dispatchEvent(new Event("resize"));
        await flush();

        expect(transport.callsOf("update")).toHaveLength(updates_before);
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });

    test("engine cur_move events reach the goban emitter (listener is live)", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        /* GobanEngine forwards its emits to the owning goban via
         * parentEventEmitter; the bridge's goban-level "cur_move"
         * listener relies on that. */
        let fired = 0;
        goban.on("cur_move", () => fired++);
        goban.engine.place(0, 0);
        expect(fired).toBe(1);
        goban.destroy();
    });
});

describe("destroy", () => {
    test("detaches the native view and unsubscribes", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(transport.listener_count).toBe(1);

        goban.destroy();
        await flush();

        expect(transport.callsOf("detach")).toHaveLength(1);
        expect(transport.listener_count).toBe(0);
    });
});

describe("web board layers", () => {
    const crosshair = () => ({ enabled: true, color: "#ff0000", thickness: 1 });

    afterEach(() => {
        delete callbacks.getLastMoveCrosshair;
    });

    /** Every DOM layer the canvas renderer paints the board on. The board
     *  is not one canvas: shadows, the themed grid background and the
     *  last-move crosshair each get their own layer, attached lazily. */
    function boardLayers(): HTMLElement[] {
        return Array.from(
            board_div.querySelectorAll<HTMLElement>(
                ".StoneLayer, .ShadowLayer, .GridLayer, .GridBackgroundLayer, .CrosshairLayer, .PenLayer",
            ),
        );
    }

    test("hides the whole layer stack while the native view is active", async () => {
        const transport = new RecordingTransport();
        callbacks.getLastMoveCrosshair = crosshair;
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.engine.place(0, 0);
        goban.redraw(true);
        await flush();

        const layers = boardLayers();
        /* More than the stone canvas: hiding only that one would leave a
         * full board painting underneath the native view. */
        expect(layers.length).toBeGreaterThan(1);
        for (const layer of layers) {
            expect(layer.style.visibility).toBe("hidden");
        }
        goban.destroy();
    });

    test("hides a layer that attaches after the native view went active", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(board_div.querySelector(".CrosshairLayer")).toBeNull();

        /* The crosshair layer is attached lazily, on the first draw that
         * actually shows a crosshair -- long after we hid the layers that
         * existed at attach time. */
        callbacks.getLastMoveCrosshair = crosshair;
        goban.engine.place(0, 0);
        goban.redraw(true);
        await flush();

        const crosshair_layer = board_div.querySelector<HTMLElement>(".CrosshairLayer");
        expect(crosshair_layer).not.toBeNull();
        expect(crosshair_layer!.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("restores the whole layer stack when bailing to the canvas", async () => {
        const transport = new RecordingTransport();
        callbacks.getLastMoveCrosshair = crosshair;
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.engine.place(0, 0);
        goban.redraw(true);
        await flush();
        expect(goban.nativeBridgeState).toBe("active");
        expect(boardLayers().length).toBeGreaterThan(1);

        goban.setMode("analyze");
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        for (const layer of boardLayers()) {
            expect(layer.style.visibility).not.toBe("hidden");
        }
        goban.destroy();
    });
});

/* The native view is hidden from the moment it is suspended until a resume
 * actually resolves. Hiding the canvas any earlier than that leaves neither
 * board on screen for the width of a bridge round-trip. */
describe("no blank board while a resume is in flight", () => {
    test("re-engaging keeps the canvas visible until resume resolves", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.setMode("analyze");
        await flush();
        expect(goban.nativeBridgeState).toBe("bailed");

        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        const resume_gate = gate();
        transport.next_resume_gate = resume_gate.promise;
        goban.setMode("play");
        await flush();

        /* resume is in flight: the native view is still suspended, so the
         * canvas is the only board on screen. */
        expect(transport.callsOf("resume")).toHaveLength(1);
        expect(canvas.style.visibility).not.toBe("hidden");

        resume_gate.open();
        await flush();
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("resumeNativeView keeps the canvas visible until resume resolves", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        /* Suspend, then bail and re-engage, so the canvas is left up as the
         * board with no snapshot covering it (the coordinator's suspend
         * resolved before we were bailed). */
        await goban.suspendNativeView();
        goban.setMode("analyze");
        await flush();
        goban.setMode("play");
        await flush();
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        const resume_gate = gate();
        transport.next_resume_gate = resume_gate.promise;
        goban.resumeNativeView();
        await flush();

        expect(transport.callsOf("resume")).toHaveLength(1);
        expect(canvas.style.visibility).not.toBe("hidden");

        resume_gate.open();
        await flush();
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("a theme change while a resume is in flight does not hide the canvas", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.setMode("analyze");
        await flush();

        const resume_gate = gate();
        transport.next_resume_gate = resume_gate.promise;
        goban.setMode("play");
        await flush();
        expect(transport.callsOf("resume")).toHaveLength(1);

        /* "active" no longer implies "the native view is on screen": a
         * theme change landing in the resume window must leave the canvas
         * up as the board. */
        goban.setTheme(
            {
                "board": "Kaya",
                "black": "Glass",
                "white": "Glass",
                "removal-graphic": "x",
                "removal-scale": 1.0,
                "stone-scale": 1.0,
            },
            false,
        );
        await flush();
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        resume_gate.open();
        await flush();
        expect(canvas.style.visibility).toBe("hidden");
        goban.destroy();
    });

    test("bailing while a resume is in flight leaves the canvas visible", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.setMode("analyze");
        await flush();

        const resume_gate = gate();
        transport.next_resume_gate = resume_gate.promise;
        goban.setMode("play");
        await flush();
        expect(transport.callsOf("resume")).toHaveLength(1);

        /* Back out of play before the resume lands: its continuation must
         * not hide the canvas over a native view we are re-suspending. */
        goban.setMode("analyze");
        await flush();
        expect(goban.nativeBridgeState).toBe("bailed");

        resume_gate.open();
        await flush();
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");
        goban.destroy();
    });
});

/* Board state added for the reworked AI review display. None of it is
 * expressible in contract v1 (which carries only stones, colorToMove and a
 * last-move ring), so all of it has to reach the web canvas. */
describe("AI review board state", () => {
    test("an ai_quality badge bails to the canvas", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        goban.setAIQualityMark(1, 1, "blunder");
        goban.redraw(true);
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        goban.destroy();
    });

    test("a subscript2 annotation bails to the canvas", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        goban.setSubscript2Mark(1, 1, "1.2k");
        goban.redraw(true);
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        goban.destroy();
    });

    test("colored circles bail, and clearing them re-engages on its own", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();

        goban.setColoredCircles([{ move: { x: 1, y: 1 }, color: "#ff0000" }]);
        await flush();
        expect(goban.nativeBridgeState).toBe("bailed");

        /* setColoredCircles repaints when clearing, which is what schedules
         * the sync that re-engages us. */
        goban.setColoredCircles([]);
        await flush();
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });
});

/* Board decorations that predate the AI review work but are equally
 * outside contract v1: the native side has no way to draw them, so a board
 * showing them has to be the web canvas. */
describe("other unrenderable board decorations", () => {
    test("an outstanding undo request bails, and cancelling it re-engages", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        goban.engine.place(0, 0);
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        /* The live game socket sets this and repaints so the "?" appears on
         * the move the request covers. */
        goban.engine.undo_requested = goban.engine.cur_move.move_number;
        goban.redraw(true);
        await flush();
        expect(goban.nativeBridgeState).toBe("bailed");

        goban.engine.undo_requested = undefined;
        goban.redraw(true);
        await flush();
        expect(goban.nativeBridgeState).toBe("active");
        goban.destroy();
    });

    test("move tree move highlighting bails", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        await flush();
        expect(goban.nativeBridgeState).toBe("active");

        /* Set by puzzle configs, which highlight the moves the tree knows. */
        (goban as any).highlight_movetree_moves = true;
        goban.redraw(true);
        await flush();

        expect(goban.nativeBridgeState).toBe("bailed");
        goban.destroy();
    });
});

describe("attach payload construction", () => {
    test("a throw while building the payload falls back instead of stranding the bridge", async () => {
        const transport = new RecordingTransport();
        const goban = new GobanNativeBridge(config(transport));
        /* The attach op runs off a microtask, so patch before it does. The
         * engine can be mid-swap when a queued attach finally executes;
         * a blowing-up board flatten stands in for that. */
        (goban as any).flattenBoard = () => {
            throw new Error("engine torn");
        };
        await flush();

        expect(transport.callsOf("attach")).toHaveLength(0);
        /* "attaching" would be terminal: syncNative() reads it as "an
         * attach is in flight" and returns, so nothing would ever attach
         * or fall back again. */
        expect(goban.nativeBridgeState).toBe("fallback");
        const canvas = board_div.querySelector("#board-canvas") as HTMLCanvasElement;
        expect(canvas.style.visibility).not.toBe("hidden");

        goban.redraw(true);
        await flush();
        expect(goban.nativeBridgeState).toBe("fallback");
        expect(transport.callsOf("attach")).toHaveLength(0);
        goban.destroy();
    });
});
