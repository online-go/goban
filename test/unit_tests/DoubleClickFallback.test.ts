/*
 * Copyright (C)  Online-Go.com
 *
 * Regression test for issue #3364: `Double-click to move` stopped working when
 * the browser failed to emit a native `dblclick` event (e.g. when the DOM under
 * the cursor was mutated between the two clicks, as happens after an opponent's
 * pass). Each renderer now detects the double-tap from the timing of the two
 * pointer releases (handled on `mouseup`) instead of relying on the native
 * `dblclick` event, via the shared `Goban.resolveDoubleClick` helper.
 *
 * The two clicks are simulated WITHOUT dispatching `click`/`dblclick`, which
 * mirrors the browser dropping those synthesized events when the DOM changes
 * between presses.
 */
// cspell: disable

(global as any).CLIENT = true;

import { SVGRenderer, SVGRendererGobanConfig } from "../../src/Goban/SVGRenderer";
import { GobanCanvas, CanvasRendererGobanConfig } from "../../src/Goban/CanvasRenderer";
import { GobanSocket } from "engine";
import WS from "jest-websocket-mock";

let board_div: HTMLDivElement;

const last_port = 48890;
const socket_server = new WS(`ws://localhost:${last_port}`, { jsonProtocol: true });
const mock_socket = new GobanSocket(`ws://localhost:${last_port}`, {
    dont_ping: true,
    quiet: true,
});

const TEST_SQUARE_SIZE = 10;

function eventInit(x: number, y: number) {
    return {
        clientX: (x + 1.5) * TEST_SQUARE_SIZE,
        clientY: (y + 1.5) * TEST_SQUARE_SIZE,
    } as const;
}

/* Two quick presses on the same square WITHOUT a native `click`/`dblclick` -
 * this is what the browser delivers when it drops the synthesized events
 * because the DOM was mutated between the presses. */
function pressTwiceWithoutNativeDblClick(target: HTMLElement, x: number, y: number) {
    const init = eventInit(x, y);
    for (let i = 0; i < 2; ++i) {
        target.dispatchEvent(new MouseEvent("mousedown", init));
        target.dispatchEvent(new MouseEvent("mouseup", init));
    }
}

function baseConfig(double_click_submit: boolean) {
    return {
        square_size: TEST_SQUARE_SIZE,
        board_div,
        interactive: true,
        server_socket: mock_socket,
        width: 9,
        height: 9,
        double_click_submit,
    };
}

type RendererSetup = { goban: SVGRenderer | GobanCanvas; target: HTMLElement };

const RENDERERS: Array<[string, (double_click_submit: boolean) => RendererSetup]> = [
    [
        "SVGRenderer",
        (dcs) => {
            const goban = new SVGRenderer(baseConfig(dcs) as SVGRendererGobanConfig);
            return { goban, target: goban.parent };
        },
    ],
    [
        "GobanCanvas",
        (dcs) => {
            const goban = new GobanCanvas(baseConfig(dcs) as CanvasRendererGobanConfig);
            return { goban, target: document.getElementById("board-canvas") as HTMLElement };
        },
    ],
];

describe.each(RENDERERS)("double-click fallback on %s (#3364)", (_name, makeRenderer) => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
        (socket_server as any).messages = [];
    });
    afterEach(() => {
        board_div.remove();
    });

    test("two quick presses submit a move even without a native dblclick event", async () => {
        const { goban, target } = makeRenderer(true);
        await socket_server.connected;
        goban.enableStonePlacement();
        // `sendMove` is the submission path; spy on it instead of the socket so
        // the assertion doesn't depend on the mocked clock/transport.
        const sendMove = jest.spyOn(goban as any, "sendMove").mockReturnValue(true);

        pressTwiceWithoutNativeDblClick(target, 4, 4);

        expect(goban.engine.board[4][4]).toBe(1);
        // The move was submitted (not left pending behind the submit button).
        expect(sendMove).toHaveBeenCalledWith(expect.objectContaining({ move: "ee" }));
    });

    test("a right-click does not prime a following left-click into a double-click", async () => {
        const { goban, target } = makeRenderer(true);
        await socket_server.connected;
        goban.enableStonePlacement();
        const sendMove = jest.spyOn(goban as any, "sendMove").mockReturnValue(true);

        const init = eventInit(4, 4);
        // A right-click release on the square, immediately followed by a single
        // left-click on the same square.
        target.dispatchEvent(new MouseEvent("mousedown", { ...init, button: 2 }));
        target.dispatchEvent(new MouseEvent("mouseup", { ...init, button: 2 }));
        target.dispatchEvent(new MouseEvent("mousedown", { ...init, button: 0 }));
        target.dispatchEvent(new MouseEvent("mouseup", { ...init, button: 0 }));

        // The left-click must be treated as an ordinary single click (provisional
        // stone), not as the second half of a double-click, so nothing is submitted.
        expect(sendMove).not.toHaveBeenCalled();
    });

    test("two quick presses do NOT auto-submit when double_click_submit is off", async () => {
        const { goban, target } = makeRenderer(false);
        // Guard against the config being silently ignored: it must really be off.
        expect(goban.double_click_submit).toBe(false);
        await socket_server.connected;
        goban.enableStonePlacement();
        const sendMove = jest.spyOn(goban as any, "sendMove").mockReturnValue(true);

        pressTwiceWithoutNativeDblClick(target, 4, 4);

        // In submit-button mode the second press toggles the provisional stone
        // back off; nothing is placed and nothing is submitted.
        expect(goban.engine.board[4][4]).toBe(0);
        expect(sendMove).not.toHaveBeenCalled();
        expect(goban.submit_move).toBeUndefined();
        expect(goban.engine.last_official_move.move_number).toBe(0);
    });
});
