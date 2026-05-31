/*
 * Copyright (C)  Online-Go.com
 *
 * Regression test for issue #3364: `Double-click to move` stopped working when
 * the browser failed to emit a native `dblclick` event (e.g. when the DOM under
 * the cursor was mutated between the two clicks, as happens after an opponent's
 * pass). The renderer now detects the double-tap from the timing of the two
 * pointer releases instead of relying solely on the native `dblclick` event.
 */
// cspell: disable

(global as any).CLIENT = true;

import { SVGRenderer, SVGRendererGobanConfig } from "../../src/Goban/SVGRenderer";
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

/* Simulate two quick clicks on the same square WITHOUT dispatching a native
 * `dblclick` event - this mirrors the browser dropping the synthesized
 * click/dblclick events when the DOM is mutated between the clicks. */
function simulateDoubleClickWithoutNativeDblClick(div: HTMLElement, x: number, y: number) {
    const init = eventInit(x, y);
    for (let i = 0; i < 2; ++i) {
        div.dispatchEvent(new MouseEvent("mousedown", init));
        div.dispatchEvent(new MouseEvent("mouseup", init));
    }
}

function commonConfig(extra?: Partial<SVGRendererGobanConfig>): SVGRendererGobanConfig {
    // No `player_id` (matches the submit tests in GobanSVG.test.ts): with a
    // player id set, sendMove() requires a server clock we don't mock here.
    return {
        square_size: TEST_SQUARE_SIZE,
        board_div,
        interactive: true,
        server_socket: mock_socket,
        width: 9,
        height: 9,
        ...(extra ?? {}),
    };
}

describe("double-click fallback (#3364)", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
        (socket_server as any).messages = [];
    });
    afterEach(() => {
        board_div.remove();
    });

    test("two quick clicks submit a move even without a native dblclick event", async () => {
        const goban = new SVGRenderer(commonConfig({ double_click_submit: true }));
        await socket_server.connected;
        goban.enableStonePlacement();
        // `sendMove` is the submission path; spy on it instead of the socket so
        // the assertion doesn't depend on the mocked clock/transport.
        const sendMove = jest.spyOn(goban as any, "sendMove").mockReturnValue(true);

        simulateDoubleClickWithoutNativeDblClick(goban.parent, 4, 4);

        expect(goban.engine.board[4][4]).toBe(1);
        // The move was submitted (not left pending behind the submit button).
        expect(sendMove).toHaveBeenCalledWith(expect.objectContaining({ move: "ee" }));
    });

    test("two quick clicks do NOT auto-submit when double_click_submit is off", async () => {
        const goban = new SVGRenderer(commonConfig({ double_click_submit: false }));
        // Guard against regressing back to the ignored-argument bug: the config
        // must actually disable double-click submission.
        expect(goban.double_click_submit).toBe(false);
        await socket_server.connected;
        goban.enableStonePlacement();
        const sendMove = jest.spyOn(goban as any, "sendMove").mockReturnValue(true);

        simulateDoubleClickWithoutNativeDblClick(goban.parent, 4, 4);

        // In submit-button mode the second click toggles the provisional stone
        // back off; nothing is placed and nothing is submitted.
        expect(goban.engine.board[4][4]).toBe(0);
        expect(sendMove).not.toHaveBeenCalled();
        expect(goban.submit_move).toBeUndefined();
        expect(goban.engine.last_official_move.move_number).toBe(0);
    });
});
