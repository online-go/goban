/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
// cspell: disable

(global as any).CLIENT = true;

import { GobanCanvas, CanvasRendererGobanConfig } from "../../src/Goban/CanvasRenderer";
import type { GobanSelectedThemes } from "../../src/Goban/Goban";
import {
    SCORE_ESTIMATION_TOLERANCE,
    SCORE_ESTIMATION_TRIALS,
} from "../../src/Goban/InteractiveBase";
import { GobanSocket, makeMatrix } from "engine";
import { GobanBase } from "../../src/GobanBase";
import { callbacks } from "../../src/Goban/callbacks";
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
interface MouseClickOptions {
    x: number;
    y: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
}

function simulateMouseClick(
    canvas: HTMLCanvasElement,
    { x, y, shiftKey, ctrlKey, altKey, metaKey }: MouseClickOptions,
) {
    const eventInitDict = {
        // 1.5 assumes axis labels, which take up exactly one stone width
        clientX: (x + 1.5) * TEST_SQUARE_SIZE,
        clientY: (y + 1.5) * TEST_SQUARE_SIZE,
        shiftKey: shiftKey ?? false,
        ctrlKey: ctrlKey ?? false,
        altKey: altKey ?? false,
        metaKey: metaKey ?? false,
    } as const;

    // Stone placement is handled on 'mouseup' (see CanvasRenderer); 'click' is a
    // no-op. We dispatch all three to mirror a real click.
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

function selectedThemes(board: "Custom" | "Kaya", grid9Url: string = ""): GobanSelectedThemes {
    return {
        "white": "Shell",
        "black": "Slate",
        "board": board,
        "removal-graphic": "square",
        "removal-scale": 1.0,
        "stone-shadows": "none",
        "custom-board-grid-backgrounds": {
            "9": grid9Url,
            "13": "",
            "19": "",
        },
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

        expect(goban.engine.board).toEqual([
            [1, 2, 1],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(goban.engine.cur_move.move_number).toBe(3);

        simulateMouseClick(canvas, { x: 1, y: 0, shiftKey: true });

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
        expect(log_spy).toHaveBeenCalledWith(
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

        simulateMouseClick(canvas, { x: 1, y: 0, shiftKey: true });

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

        simulateMouseClick(canvas, { x: 0, y: 0, ctrlKey: true });

        // Unmodified clicks in stone removal send a "game/removed_stones/set" message
        jest.setSystemTime(50);
        expect(addCoordinatesToChatInput).toHaveBeenCalledTimes(1);
        // Note: "A2" is the correct pretty coordinate for (0,0) on a 2x4 board
        // because the y coordinate is flipped
        expect(addCoordinatesToChatInput).toHaveBeenCalledWith("A2");
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

        expect(goban.engine.estimateScore).toHaveBeenCalledTimes(1);
        expect(goban.engine.estimateScore).toHaveBeenCalledWith(
            SCORE_ESTIMATION_TRIALS,
            SCORE_ESTIMATION_TOLERANCE,
            false,
            false,
        );
        (goban.engine.estimateScore as jest.Mock).mockClear();

        simulateMouseClick(canvas, { x: 1, y: 0 });

        // estimateScore is NOT called on tap
        expect(goban.engine.estimateScore).toHaveBeenCalledTimes(0);
        expect(mock_score_estimate.handleClick).toHaveBeenCalledTimes(1);
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

describe("last-move crosshair callback", () => {
    afterEach(() => {
        delete (callbacks as any).getLastMoveCrosshair;
    });

    test("getLastMoveCrosshair falls back to disabled when no callback is set", () => {
        const goban = new GobanCanvas(basic3x3Config());
        expect((goban as any).getLastMoveCrosshair()).toEqual({
            enabled: false,
            color: "#1e6bff",
            thickness: 0.1,
        });
        goban.destroy();
    });

    test("getLastMoveCrosshair returns the callback value", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#00ff00",
            thickness: 0.2,
        });
        const goban = new GobanCanvas(basic3x3Config());
        expect((goban as any).getLastMoveCrosshair()).toEqual({
            enabled: true,
            color: "#00ff00",
            thickness: 0.2,
        });
        goban.destroy();
    });
});

describe("last-move crosshair (canvas layer)", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        delete (callbacks as any).getLastMoveCrosshair;
        board_div.remove();
    });

    test("attaches a dedicated crosshair canvas under the stones when enabled", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new GobanCanvas(basicScorableBoardConfig());
        goban.redraw(true);
        const layer = (goban as any).crosshair_layer as HTMLCanvasElement | undefined;
        expect(layer).toBeDefined();
        // It must sit before the stone canvas so it renders under the stones.
        expect(layer?.className).toBe("CrosshairLayer");
        const board = (goban as any).board as HTMLCanvasElement;
        const children = Array.from(board.parentNode!.childNodes);
        expect(children.indexOf(layer as any)).toBeLessThan(children.indexOf(board));
        goban.destroy();
    });

    test("does not attach the crosshair canvas when disabled", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: false,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new GobanCanvas(basicScorableBoardConfig());
        goban.redraw(true);
        expect((goban as any).crosshair_layer).toBeUndefined();
        goban.destroy();
    });

    test("does not attach the crosshair canvas when dont_draw_last_move is set", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new GobanCanvas(basicScorableBoardConfig({ dont_draw_last_move: true }));
        goban.redraw(true);
        expect((goban as any).crosshair_layer).toBeUndefined();
        goban.destroy();
    });

    test("does not attach the crosshair canvas when dont_draw_last_move_crosshair is set", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new GobanCanvas(
            basicScorableBoardConfig({ dont_draw_last_move_crosshair: true }),
        );
        goban.redraw(true);
        expect((goban as any).crosshair_layer).toBeUndefined();
        goban.destroy();
    });
});

describe("custom board grid background (canvas layers)", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        delete callbacks.getSelectedThemes;
        board_div.remove();
    });

    test("does not attach optional grid background layers for default themes", () => {
        callbacks.getSelectedThemes = () => selectedThemes("Kaya");
        const goban = new GobanCanvas(basic3x3Config());

        expect(board_div.querySelector("#grid-canvas")).toBeNull();
        expect(board_div.querySelector(".GridBackgroundLayer")).toBeNull();
        expect(board_div.querySelector("#board-canvas")).not.toBeNull();

        goban.destroy();
    });

    test("attaches optional grid background layers for a configured custom grid background", () => {
        callbacks.getSelectedThemes = () =>
            selectedThemes("Custom", "https://cdn.example.test/grid-9.png");
        const goban = new GobanCanvas(basic3x3Config({ width: 9, height: 9 }));

        const grid_layer = board_div.querySelector<HTMLCanvasElement>("#grid-canvas");
        const grid_background_layer =
            board_div.querySelector<HTMLDivElement>(".GridBackgroundLayer");
        const board = board_div.querySelector<HTMLCanvasElement>("#board-canvas");

        if (!grid_layer || !grid_background_layer || !board) {
            throw new Error("Expected grid background layers and board canvas to exist");
        }

        const children = Array.from(board.parentNode?.childNodes ?? []);
        expect(grid_layer.className).toBe("GridLayer");
        expect(grid_background_layer.className).toBe("GridBackgroundLayer");
        expect(children.indexOf(grid_layer)).toBeLessThan(children.indexOf(grid_background_layer));
        expect(children.indexOf(grid_background_layer)).toBeLessThan(children.indexOf(board));
        expect(grid_background_layer.style.backgroundImage).toContain("grid-9.png");

        goban.destroy();
    });

    test("detaches optional grid background layers when switching away from custom grid backgrounds", () => {
        let themes = selectedThemes("Custom", "https://cdn.example.test/grid-9.png");
        callbacks.getSelectedThemes = () => themes;
        const goban = new GobanCanvas(basic3x3Config({ width: 9, height: 9 }));

        expect(board_div.querySelector("#grid-canvas")).not.toBeNull();
        expect(board_div.querySelector(".GridBackgroundLayer")).not.toBeNull();

        themes = selectedThemes("Kaya");
        goban.setTheme(themes, false);

        expect(board_div.querySelector("#grid-canvas")).toBeNull();
        expect(board_div.querySelector(".GridBackgroundLayer")).toBeNull();
        expect(board_div.querySelector("#board-canvas")).not.toBeNull();

        goban.destroy();
    });
});
