/**
 * @jest-environment jsdom
 */

(global as any).CLIENT = true;

import { GobanCanvas } from "../GobanCanvas";
import { AUTOSCORE_TOLERANCE, AUTOSCORE_TRIALS } from "../GoEngine";
import { GoMath } from "../GoMath";

let board_div: HTMLDivElement;

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

describe("onTap", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        board_div.remove();
    });

    test("clicking without enabling stone placement has no effect", () => {
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("clicking the top left intersection places a stone", () => {
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
        });
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
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
        });
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
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            moves: [
                [0, 0],
                [1, 0],
                [2, 0],
            ],
            mode: "analyze",
        });
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
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            mode: "analyze",
        });
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

    test("Clicking submits a move in one-click-submit mode", () => {
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            one_click_submit: true,
            server_socket: mock_socket,
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(mock_socket.send).toBeCalledWith(
            "game/move",
            expect.objectContaining({
                move: "aa",
            }),
            expect.any(Function),
        );
    });

    test("Calling the submit_move() too quickly results in no submission", () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            server_socket: mock_socket,
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        goban.enableStonePlacement();
        simulateMouseClick(canvas, { x: 0, y: 0 });

        // If we click before 50ms, assume it was a mistake.
        jest.setSystemTime(40);

        expect(goban.submit_move).toBeDefined();
        goban.submit_move?.();

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(mock_socket.send).not.toHaveBeenCalled();

        jest.useRealTimers();
    });

    test("Calling submit_move() submits a move", () => {
        jest.useFakeTimers();
        jest.setSystemTime(0);
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            server_socket: mock_socket,
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

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
        expect(mock_socket.send).toBeCalledWith(
            "game/move",
            expect.objectContaining({
                move: "aa",
            }),
            expect.any(Function),
        );

        jest.useRealTimers();
    });

    test("Right clicking in play mode should have no effect.", () => {
        const goban = new GobanCanvas({
            width: 3,
            height: 3,
            square_size: 10,
            board_div: board_div,
            interactive: true,
        });
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

    test("Clicking during stone removal sends remove stones message", () => {
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };

        const goban = new GobanCanvas({
            width: 4,
            height: 2,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            player_id: 123,
            players: {
                black: { id: 123, username: "p1" },
                white: { id: 456, username: "p2" },
            },
            moves: [
                [1, 0],
                [2, 0],
                [1, 1],
                [2, 1],
            ],
            server_socket: mock_socket,
            phase: "stone removal",
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        simulateMouseClick(canvas, { x: 0, y: 0 });

        expect(mock_socket.send).toBeCalledTimes(1);
        expect(mock_socket.send).toBeCalledWith(
            "game/removed_stones/set",
            expect.objectContaining({
                player_id: 123,
                removed: 1,
                stones: "aaab",
            }),
        );
    });

    test("Shift-Clicking during stone removal toggles one stone", () => {
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };

        const goban = new GobanCanvas({
            width: 4,
            height: 2,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            player_id: 123,
            players: {
                black: { id: 123, username: "p1" },
                white: { id: 456, username: "p2" },
            },
            moves: [
                [1, 0],
                [2, 0],
                [1, 1],
                [2, 1],
            ],
            server_socket: mock_socket,
            phase: "stone removal",
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        canvas.dispatchEvent(
            new MouseEvent("click", {
                clientX: 15,
                clientY: 15,
                shiftKey: true,
            }),
        );

        expect(mock_socket.send).toBeCalledTimes(1);
        expect(mock_socket.send).toBeCalledWith(
            "game/removed_stones/set",
            expect.objectContaining({
                player_id: 123,
                removed: 1,
                stones: "aa",
            }),
        );
    });

    // I'm not sure this behavior is actually desired, but capturing in the tests
    // so that it will be easy to test a change to this behavior if desired
    test("Clicking on stones during stone removal sends two socket messages", () => {
        const mock_socket = {
            send: jest.fn(),
            on: jest.fn(),
            connected: true,
        };

        const goban = new GobanCanvas({
            width: 4,
            height: 2,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            player_id: 123,
            players: {
                black: { id: 123, username: "p1" },
                white: { id: 456, username: "p2" },
            },
            moves: [
                [1, 0],
                [2, 0],
                [1, 1],
                [2, 1],
            ],
            server_socket: mock_socket,
            phase: "stone removal",
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        canvas.dispatchEvent(
            new MouseEvent("click", {
                clientX: 25,
                clientY: 15,
            }),
        );

        expect(mock_socket.send).toBeCalledTimes(2);
        expect(mock_socket.send).toBeCalledWith(
            "game/removed_stones/set",
            expect.objectContaining({
                player_id: 123,
                removed: 1,
                stones: "babbbabbbbba",
            }),
        );
        // It is my understanding that this second call is not necessary -bpj
        expect(mock_socket.send).toBeCalledWith(
            "game/removed_stones/set",
            expect.objectContaining({
                player_id: 123,
                removed: 0,
                stones: "aaab",
            }),
        );
    });

    test("Clicking while in scoring mode triggers score_estimate.handleClick()", () => {
        const goban = new GobanCanvas({
            width: 4,
            height: 2,
            square_size: 10,
            board_div: board_div,
            interactive: true,
            player_id: 123,
            players: {
                black: { id: 123, username: "p1" },
                white: { id: 456, username: "p2" },
            },
            moves: [
                [1, 0],
                [2, 0],
                [1, 1],
                [2, 1],
            ],
        });
        const canvas = document.getElementById("board-canvas") as HTMLCanvasElement;

        // The scoring API is a real pain to work with, mainly due to dependence
        // on the wasm module.  Therefore, we just mock estimateScore() and
        // check that it was called.
        const mock_score_estimate = {
            handleClick: jest.fn(),
            when_ready: Promise.resolve(),
            board: GoMath.makeMatrix(4, 2),
            removal: GoMath.makeMatrix(4, 2),
            territory: GoMath.makeMatrix(4, 2),
            heat: GoMath.makeMatrix(4, 2),
        };
        goban.engine.estimateScore = jest.fn().mockReturnValue(mock_score_estimate);

        goban.setScoringMode(true);

        expect(goban.engine.estimateScore).toBeCalledTimes(1);
        expect(goban.engine.estimateScore).toBeCalledWith(
            AUTOSCORE_TRIALS,
            AUTOSCORE_TOLERANCE,
            false,
        );
        (goban.engine.estimateScore as jest.Mock).mockClear();

        simulateMouseClick(canvas, { x: 1, y: 0 });

        // estimateScore is NOT called on tap
        expect(goban.engine.estimateScore).toBeCalledTimes(0);
        expect(mock_score_estimate.handleClick).toBeCalledTimes(1);
    });
});
