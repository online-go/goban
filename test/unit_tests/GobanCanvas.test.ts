/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
// cspell: disable

(global as any).CLIENT = true;

import { GobanCanvas, CanvasRendererGobanConfig } from "../../src/Goban/CanvasRenderer";
import {
    SCORE_ESTIMATION_TOLERANCE,
    SCORE_ESTIMATION_TRIALS,
} from "../../src/Goban/InteractiveBase";
import { GobanSocket, makeMatrix } from "engine";
import { GobanBase } from "../../src/GobanBase";
import WS from "jest-websocket-mock";

let board_div: HTMLDivElement;

const last_port = 48880;
const socket_server = new WS(`ws://localhost:${last_port}`, { jsonProtocol: true });
const mock_socket = new GobanSocket(`ws://localhost:${last_port}`, {
    dont_ping: true,
    quiet: true,
});

// Nothing special about this square size, just easy to do mental math with
const TEST_SQUARE_SIZE = 10;
function simulateMouseClick(canvas: HTMLCanvasElement, { x, y }: { x: number; y: number }) {
    const eventInitDict = {
        // 1.5 assumes axis labels, which take up exactly one stone width
        clientX: (x + 1.5) * TEST_SQUARE_SIZE,
        clientY: (y + 1.5) * TEST_SQUARE_SIZE,
    } as const;

    // Some actions are triggered on 'mousedown', others on 'click'
    // As far as the onTap tests are concerned, it doesn't matter which, so we
    // trigger all three mouse events when simulating the mouse click.
    canvas.dispatchEvent(new MouseEvent("mousedown", eventInitDict));
    canvas.dispatchEvent(new MouseEvent("mouseup", eventInitDict));
    canvas.dispatchEvent(new MouseEvent("click", eventInitDict));
}

function commonConfig(): CanvasRendererGobanConfig {
    return { square_size: 10, board_div: board_div, interactive: true, server_socket: mock_socket };
}

function basic3x3Config(additionalOptions?: CanvasRendererGobanConfig): CanvasRendererGobanConfig {
    return {
        ...commonConfig(),
        width: 3,
        height: 3,
        ...(additionalOptions ?? {}),
    };
}

function basicScorableBoardConfig(
    additionalOptions?: CanvasRendererGobanConfig,
): CanvasRendererGobanConfig {
    return {
        ...commonConfig(),
        width: 4,
        height: 2,
        // Scoring checks isActivePlayer
        player_id: 123,
        players: {
            black: { id: 123, username: "p1" },
            white: { id: 456, username: "p2" },
        },
        // Creates a tiny wall in the center of the board
        moves: [
            [1, 0],
            [2, 0],
            [1, 1],
            [2, 1],
        ],
        ...(additionalOptions ?? {}),
    };
}

describe("onTap", () => {
    beforeEach(async () => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);

        /*
        ++last_port;
        socket_server = new WS(`ws://localhost:${last_port}`, { jsonProtocol: true });
        mock_socket = new GobanSocket(`ws://localhost:${last_port}`, {
            dont_ping: true,
            quiet: true,
        });
        socket_server.server.on("message", (foo) => {
            console.log(foo);
        });
        */
    });

    afterEach(() => {
        board_div.remove();
        /*
        mock_socket?.disconnect();
        socket_server?.close();
        */
    });

    test("clicking without enabling stone placement has no effect", () => {
        const goban = new GobanCanvas(basic3x3Config());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("clicking the top left intersection places a stone", () => {
        const goban = new GobanCanvas(basic3x3Config());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("clicking the midpoint of two intersections has no effect", () => {
        const goban = new GobanCanvas(basic3x3Config());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0.5, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("shift clicking in analyze mode jumps to move", () => {
        const goban = new GobanCanvas(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                mode: "analyze",
            }),
        );
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;
        const mouse_event = new MouseEvent("click", {
            clientX: 25,
            clientY: 15,
            shiftKey: true,
        });

        expect(goban.engine.board).toEqual([
            [1, 2, 1],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(goban.engine.cur_move.move_number).toBe(3);

        canvas.dispatchEvent(mouse_event);

        // These are the important expectations
        expect(goban.engine.board).toEqual([
            [1, 2, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(goban.engine.cur_move.move_number).toBe(2);
    });

    test("Clicking with the triangle subtool places a triangle", () => {
        const goban = new GobanCanvas(basic3x3Config({ mode: "analyze" }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        goban.setAnalyzeTool("label", "triangle");
        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.getMarks(0, 0)).toEqual({ triangle: true });
        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("Clicking submits a move in one-click-submit mode", async () => {
        const goban = new GobanCanvas(basic3x3Config({ one_click_submit: true }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);

        await expect(socket_server).toReceiveMessage(
            expect.arrayContaining(["game/move", expect.objectContaining({ move: "aa" })]),
        );
    });

    test("Calling the submit_move() too quickly results in no submission", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        const goban = new GobanCanvas(basic3x3Config());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        const log_spy = jest.spyOn(console, "info").mockImplementation(() => {});

        await socket_server.connected;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        // If we click before 50ms, assume it was a mistake.
        jest.setSystemTime(40);

        expect(goban.submit_move).toBeDefined();
        goban.submit_move?.();

        // TODO: How can we test that we *didn't* send a message ?

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(log_spy).toBeCalledWith(
            "Submit button pressed only ",
            40,
            "ms after stone was placed, presuming bad click",
        );

        jest.useRealTimers();
    });

    test("Calling submit_move() submits a move", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);

        const goban = new GobanCanvas(basic3x3Config({ server_socket: mock_socket }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        await socket_server.connected;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        // Need to delay, or else we assume it was a misclick
        jest.setSystemTime(1000);

        expect(goban.submit_move).toBeDefined();
        goban.submit_move?.();

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);

        /*
        await expect(socket_server).toReceiveMessage(
            expect.arrayContaining(["game/move", expect.objectContaining({ move: "aa" })]),
        );
        */
        expect(socket_server).toHaveReceivedMessages([
            expect.arrayContaining(["game/move", expect.objectContaining({ move: "aa" })]),
        ]);

        jest.useRealTimers();
    }, 500);

    test("Right clicking in play mode should have no effect.", () => {
        const goban = new GobanCanvas(basic3x3Config());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        canvas.dispatchEvent(
            new MouseEvent("click", {
                clientX: 15,
                clientY: 15,
                button: 2,
            }),
        );

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("Clicking during stone removal sends remove stones message", async () => {
        const goban = new GobanCanvas(basicScorableBoardConfig({ phase: "stone removal" }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        simulateMouseClick(canvas, { x: 1, y: 0 });

        await expect(socket_server).toReceiveMessage(
            expect.arrayContaining([
                "game/removed_stones/set",
                expect.objectContaining({
                    removed: true,
                    stones: "babb",
                }),
            ]),
        );
    });

    test("Shift-Clicking during stone removal toggles the group", async () => {
        const goban = new GobanCanvas(basicScorableBoardConfig({ phase: "stone removal" }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        canvas.dispatchEvent(
            new MouseEvent("click", {
                clientX: 15 + TEST_SQUARE_SIZE,
                clientY: 15,
                shiftKey: true,
            }),
        );

        await expect(socket_server).toReceiveMessage(
            expect.arrayContaining([
                "game/removed_stones/set",
                expect.objectContaining({
                    removed: true,
                    stones: "babb",
                }),
            ]),
        );
    });

    // This is not unique to stone-removal, but since stone removal also has
    // some logic for modifier keys (e.g. shift-click => remove one intersection)
    // this is good to test for.
    test("Ctrl-Clicking during stone removal adds coordinates to chat", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        new GobanCanvas(basicScorableBoardConfig({ phase: "stone removal" }));

        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        const addCoordinatesToChatInput = jest.fn();
        GobanBase.setCallbacks({ addCoordinatesToChatInput });

        canvas.dispatchEvent(
            new MouseEvent("click", {
                clientX: 15,
                clientY: 15,
                ctrlKey: true,
            }),
        );

        // Unmodified clicks in stone removal send a "game/removed_stones/set" message
        jest.setSystemTime(50);
        expect(addCoordinatesToChatInput).toBeCalledTimes(1);
        // Note: "A2" is the correct pretty coordinate for (0,0) on a 2x4 board
        // because the y coordinate is flipped
        expect(addCoordinatesToChatInput).toBeCalledWith("A2");
        jest.useRealTimers();
    });

    test("Clicking on stones during stone removal sends a socket message", async () => {
        new GobanCanvas(basicScorableBoardConfig({ phase: "stone removal" }));
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        simulateMouseClick(canvas, { x: 1, y: 0 });

        //   0 1 2 3
        // 0 .(x)o .
        // 1 . x o .

        await expect(socket_server).toReceiveMessage(
            expect.arrayContaining([
                "game/removed_stones/set",
                expect.objectContaining({
                    removed: true,
                    stones: "babb",
                }),
            ]),
        );
    });

    test("Clicking while in scoring mode triggers score_estimate.handleClick()", () => {
        const goban = new GobanCanvas(basicScorableBoardConfig());
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // The scoring API is a real pain to work with, mainly due to dependence
        // on the wasm module.  Therefore, we just mock estimateScore() and
        // check that it was called.
        const mock_score_estimate = {
            handleClick: jest.fn(),
            when_ready: Promise.resolve(),
            board: makeMatrix(4, 2, 0),
            removal: makeMatrix(4, 2, false),
            territory: makeMatrix(4, 2, 0),
            ownership: makeMatrix(4, 2, 0),
        };
        goban.engine.estimateScore = jest.fn().mockReturnValue(mock_score_estimate);

        goban.setScoringMode(true);

        expect(goban.engine.estimateScore).toBeCalledTimes(1);
        expect(goban.engine.estimateScore).toBeCalledWith(
            SCORE_ESTIMATION_TRIALS,
            SCORE_ESTIMATION_TOLERANCE,
            false,
            false,
        );
        (goban.engine.estimateScore as jest.Mock).mockClear();

        simulateMouseClick(canvas, { x: 1, y: 0 });

        // estimateScore is NOT called on tap
        expect(goban.engine.estimateScore).toBeCalledTimes(0);
        expect(mock_score_estimate.handleClick).toBeCalledTimes(1);
    });

    test("puzzle mode", () => {
        const goban = new GobanCanvas(
            basic3x3Config({
                mode: "puzzle",
                getPuzzlePlacementSetting: () => ({ mode: "setup", color: 1 }),
            }),
        );
        goban.enableStonePlacement();
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });
});
