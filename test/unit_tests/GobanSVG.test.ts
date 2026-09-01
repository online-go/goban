/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
// cspell: disable

(global as any).CLIENT = true;

import { SVGRenderer, SVGRendererGobanConfig } from "../../src/Goban/SVGRenderer";
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
    div: HTMLElement,
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

    // pointerUp is now handled in mouseup, so we need to dispatch both mousedown and mouseup
    // to properly simulate a click. The click event is also dispatched for compatibility.
    div.dispatchEvent(new MouseEvent("mousedown", eventInitDict));
    div.dispatchEvent(new MouseEvent("mouseup", eventInitDict));
    div.dispatchEvent(new MouseEvent("click", eventInitDict));
}

function commonConfig(): SVGRendererGobanConfig {
    return { square_size: 10, board_div: board_div, interactive: true, server_socket: mock_socket };
}

function basic3x3Config(additionalOptions?: SVGRendererGobanConfig): SVGRendererGobanConfig {
    return {
        ...commonConfig(),
        width: 3,
        height: 3,
        ...(additionalOptions ?? {}),
    };
}

function basicScorableBoardConfig(
    additionalOptions?: SVGRendererGobanConfig,
): SVGRendererGobanConfig {
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

function selectedThemes(stoneScale: number = 1.0): GobanSelectedThemes {
    return {
        "white": "Shell",
        "black": "Slate",
        "board": "Kaya",
        "removal-graphic": "square",
        "removal-scale": 1.0,
        "stone-scale": stoneScale,
        "stone-shadows": "none",
    };
}

function selectedThemesWithoutStoneScale(): GobanSelectedThemes {
    const themes: Partial<GobanSelectedThemes> = selectedThemes();
    delete themes["stone-scale"];
    return themes as GobanSelectedThemes;
}

function customStoneThemes(): GobanSelectedThemes {
    return {
        ...selectedThemes(),
        black: "Custom",
        white: "Custom",
    };
}

describe("theme colors", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);

        callbacks.getSelectedThemes = customStoneThemes;
        callbacks.customBlackStoneColor = () => "#112233";
        callbacks.customBlackTextColor = () => "#aabbcc";
        callbacks.customWhiteStoneColor = () => "#ddeeff";
        callbacks.customWhiteTextColor = () => "#334455";
        callbacks.customBlackStoneUrls = () => [];
        callbacks.customWhiteStoneUrls = () => [];
    });

    afterEach(() => {
        delete callbacks.getSelectedThemes;
        delete callbacks.customBlackStoneColor;
        delete callbacks.customBlackTextColor;
        delete callbacks.customWhiteStoneColor;
        delete callbacks.customWhiteTextColor;
        delete callbacks.customBlackStoneUrls;
        delete callbacks.customWhiteStoneUrls;
        board_div.remove();
    });

    test("uses marker colors for stone symbols and stone colors for ownership", () => {
        const goban = new SVGRenderer(basic3x3Config());
        goban.cell(0, 0).lastMove("o", goban.theme_black_text_color, 1);
        goban.cell(1, 0).scoreEstimate("white", 1);
        const svg = (goban as unknown as { svg: SVGSVGElement }).svg;

        const last_move = svg.querySelector<SVGElement>(".last-move");
        const white_ownership = svg.querySelector<SVGRectElement>('rect[fill="#ddeeff"]');

        expect(last_move?.getAttribute("stroke")).toBe("#aabbcc");
        expect(white_ownership).not.toBeNull();

        goban.destroy();
    });
});

describe("stone scale", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        delete callbacks.getSelectedThemes;
        delete callbacks.getFuzzyPlacementEnabled;
        board_div.remove();
    });

    test("uses half the square size by default", () => {
        callbacks.getSelectedThemes = () => selectedThemes();
        const goban = new SVGRenderer(basic3x3Config());
        const radius = (
            goban as unknown as { computeThemeStoneRadius(): number }
        ).computeThemeStoneRadius();

        expect(radius).toBeCloseTo(5);

        goban.destroy();
    });

    test("defaults missing runtime stone scale to one", () => {
        callbacks.getSelectedThemes = () => selectedThemesWithoutStoneScale();
        const goban = new SVGRenderer(basic3x3Config());
        const radius = (
            goban as unknown as { computeThemeStoneRadius(): number }
        ).computeThemeStoneRadius();

        expect(radius).toBeCloseTo(5);

        goban.destroy();
    });

    test("keeps the fuzzy placement size reduction", () => {
        callbacks.getSelectedThemes = () => selectedThemes();
        callbacks.getFuzzyPlacementEnabled = () => true;
        const goban = new SVGRenderer(basic3x3Config());
        const radius = (
            goban as unknown as { computeThemeStoneRadius(): number }
        ).computeThemeStoneRadius();

        expect(radius).toBeCloseTo(4.9);

        goban.destroy();
    });

    test("allows scale above one", () => {
        callbacks.getSelectedThemes = () => selectedThemes(1.5);
        const goban = new SVGRenderer(basic3x3Config());
        const radius = (
            goban as unknown as { computeThemeStoneRadius(): number }
        ).computeThemeStoneRadius();

        expect(radius).toBeCloseTo(7.5);

        goban.destroy();
    });
});

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
        const goban = new SVGRenderer(basic3x3Config());
        const event_layer = goban.parent;

        simulateMouseClick(event_layer, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("clicking the top left intersection places a stone", () => {
        const goban = new SVGRenderer(basic3x3Config());
        const event_layer = goban.parent;

        goban.enableStonePlacement();
        simulateMouseClick(event_layer, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("clicking the midpoint of two intersections has no effect", () => {
        const goban = new SVGRenderer(basic3x3Config());
        const event_layer = goban.parent;

        goban.enableStonePlacement();
        simulateMouseClick(event_layer, { x: 0.5, y: 0 });

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("shift clicking in analyze mode jumps to move", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                mode: "analyze",
            }),
        );
        const event_layer = goban.parent;

        expect(goban.engine.board).toEqual([
            [1, 2, 1],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(goban.engine.cur_move.move_number).toBe(3);

        // Shift-click on stone at (1, 0) to jump to that move
        simulateMouseClick(event_layer, { x: 1, y: 0, shiftKey: true });

        // These are the important expectations
        expect(goban.engine.board).toEqual([
            [1, 2, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(goban.engine.cur_move.move_number).toBe(2);
    });

    test("Clicking with the triangle subtool places a triangle", () => {
        const goban = new SVGRenderer(basic3x3Config({ mode: "analyze" }));
        const event_layer = goban.parent;

        goban.enableStonePlacement();
        goban.setAnalyzeTool("label", "triangle");
        simulateMouseClick(event_layer, { x: 0, y: 0 });

        expect(goban.getMarks(0, 0)).toEqual({ triangle: true });
        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });

    test("Clicking submits a move in one-click-submit mode", async () => {
        const goban = new SVGRenderer(basic3x3Config({ one_click_submit: true }));
        const event_layer = goban.parent;

        goban.enableStonePlacement();
        simulateMouseClick(event_layer, { x: 0, y: 0 });

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
        const goban = new SVGRenderer(basic3x3Config());
        const event_layer = goban.parent;

        const log_spy = jest.spyOn(console, "info").mockImplementation(() => {});

        await socket_server.connected;

        goban.enableStonePlacement();
        simulateMouseClick(event_layer, { x: 0, y: 0 });

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

        const goban = new SVGRenderer(basic3x3Config({ server_socket: mock_socket }));
        const event_layer = goban.parent;

        await socket_server.connected;

        goban.enableStonePlacement();
        simulateMouseClick(event_layer, { x: 0, y: 0 });

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
        const goban = new SVGRenderer(basic3x3Config());
        const event_layer = goban.parent;

        goban.enableStonePlacement();
        event_layer.dispatchEvent(
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
        const goban = new SVGRenderer(basicScorableBoardConfig({ phase: "stone removal" }));
        const event_layer = goban.parent;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        simulateMouseClick(event_layer, { x: 1, y: 0 });

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

    test("Shift-Clicking during stone removal toggles the group ", async () => {
        const goban = new SVGRenderer(basicScorableBoardConfig({ phase: "stone removal" }));
        const event_layer = goban.parent;

        // Just some checks that our setup is correct
        expect(goban.engine.isActivePlayer(123)).toBe(true);
        expect(goban.engine.board).toEqual([
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ]);

        simulateMouseClick(event_layer, { x: 1, y: 0, shiftKey: true });

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
        const goban = new SVGRenderer(basicScorableBoardConfig({ phase: "stone removal" }));
        const event_layer = goban.parent;

        const addCoordinatesToChatInput = jest.fn();
        GobanBase.setCallbacks({ addCoordinatesToChatInput });

        simulateMouseClick(event_layer, { x: 0, y: 0, ctrlKey: true });

        // Unmodified clicks in stone removal send a "game/removed_stones/set" message
        jest.setSystemTime(50);
        expect(addCoordinatesToChatInput).toHaveBeenCalledTimes(1);
        // Note: "A2" is the correct pretty coordinate for (0,0) on a 2x4 board
        // because the y coordinate is flipped
        expect(addCoordinatesToChatInput).toHaveBeenCalledWith("A2");
        jest.useRealTimers();
    });

    test("Clicking on stones during stone removal sends a socket message", async () => {
        const goban = new SVGRenderer(basicScorableBoardConfig({ phase: "stone removal" }));
        const event_layer = goban.parent;

        simulateMouseClick(event_layer, { x: 1, y: 0 });

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
        const goban = new SVGRenderer(basicScorableBoardConfig());
        const event_layer = goban.parent;

        // The scoring API is a real pain to work with, mainly due to dependence
        // on the wasm module.  Therefore, we just mock estimateScore() and
        // check that it was called.
        const mock_score_estimate = {
            handleClick: jest.fn(),
            when_ready: Promise.resolve(),
            board: makeMatrix(4, 2, 0),
            removal: makeMatrix(4, 2, 0),
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

        simulateMouseClick(event_layer, { x: 1, y: 0 });

        // estimateScore is NOT called on tap
        expect(goban.engine.estimateScore).toHaveBeenCalledTimes(0);
        expect(mock_score_estimate.handleClick).toHaveBeenCalledTimes(1);
    });

    test("puzzle mode", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                mode: "puzzle",
                getPuzzlePlacementSetting: () => ({ mode: "setup", color: 1 }),
            }),
        );
        goban.enableStonePlacement();
        const event_layer = goban.parent;

        simulateMouseClick(event_layer, { x: 0, y: 0 });

        expect(goban.engine.board).toEqual([
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });
});

describe("last-move crosshair (SVG)", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        delete (callbacks as any).getLastMoveCrosshair;
        board_div.remove();
    });

    test("draws two crosshair lines when enabled", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new SVGRenderer(basicScorableBoardConfig());
        goban.redraw(true);
        const layer = (goban as any).crosshair_layer as SVGGraphicsElement;
        expect(layer.querySelectorAll("line").length).toBe(2);
        goban.destroy();
    });

    test("draws no crosshair lines when disabled", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: false,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new SVGRenderer(basicScorableBoardConfig());
        goban.redraw(true);
        const layer = (goban as any).crosshair_layer as SVGGraphicsElement | undefined;
        expect(layer?.querySelectorAll("line").length ?? 0).toBe(0);
        goban.destroy();
    });

    test("draws no crosshair lines when dont_draw_last_move is set", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new SVGRenderer(basicScorableBoardConfig({ dont_draw_last_move: true }));
        goban.redraw(true);
        const layer = (goban as any).crosshair_layer as SVGGraphicsElement | undefined;
        expect(layer?.querySelectorAll("line").length ?? 0).toBe(0);
        goban.destroy();
    });

    test("draws no crosshair lines when dont_draw_last_move_crosshair is set", () => {
        (callbacks as any).getLastMoveCrosshair = () => ({
            enabled: true,
            color: "#1e6bff",
            thickness: 0.1,
        });
        const goban = new SVGRenderer(
            basicScorableBoardConfig({ dont_draw_last_move_crosshair: true }),
        );
        goban.redraw(true);
        const layer = (goban as any).crosshair_layer as SVGGraphicsElement | undefined;
        expect(layer?.querySelectorAll("line").length ?? 0).toBe(0);
        goban.destroy();
    });
});

describe("AI review marks and placement rooting", () => {
    beforeEach(() => {
        board_div = document.createElement("div");
        document.body.appendChild(board_div);
    });

    afterEach(() => {
        board_div.remove();
    });

    function rendererSvg(goban: SVGRenderer): SVGSVGElement {
        return (goban as unknown as { svg: SVGSVGElement }).svg;
    }

    test("setAIQualityMark renders a colored badge with the quality symbol", () => {
        const goban = new SVGRenderer(basic3x3Config({ moves: [[0, 0]], mode: "analyze" }));

        goban.setAIQualityMark(0, 0, "blunder");

        const badge = rendererSvg(goban).querySelector(".ai-quality-badge");
        expect(badge).not.toBeNull();
        expect(badge?.getAttribute("class")).toContain("ai-quality-blunder");
        expect(badge?.querySelector("circle")?.getAttribute("fill")).toBe(
            "var(--move-quality-blunder, #D64545)",
        );
        expect(badge?.querySelector("text")?.textContent).toBe("??");
        goban.destroy();
    });

    test("ai_quality badge replaces the sub_triangle triangle", () => {
        const goban = new SVGRenderer(basic3x3Config({ moves: [[0, 0]], mode: "analyze" }));
        const svg = rendererSvg(goban);

        goban.setMark(0, 0, "sub_triangle", false);
        expect(svg.querySelector(".triangle")).not.toBeNull();

        goban.setAIQualityMark(0, 0, "great");
        expect(svg.querySelector(".triangle")).toBeNull();
        expect(svg.querySelector(".ai-quality-badge text")?.textContent).toBe("!");
        goban.destroy();
    });

    test("clearing marks removes the badge", () => {
        const goban = new SVGRenderer(basic3x3Config({ moves: [[0, 0]], mode: "analyze" }));
        const svg = rendererSvg(goban);

        goban.setAIQualityMark(0, 0, "mistake");
        expect(svg.querySelector(".ai-quality-badge")).not.toBeNull();

        goban.engine.cur_move.clearMarks();
        goban.redraw(true);
        expect(svg.querySelector(".ai-quality-badge")).toBeNull();
        goban.destroy();
    });

    test("hovering a mark stone draws it fully opaque", () => {
        const goban = new SVGRenderer(basic3x3Config({ mode: "analyze" }));
        goban.enableStonePlacement();
        goban.setMark(1, 1, "black", false);

        const svg = rendererSvg(goban);
        const stoneOpacities = () =>
            Array.from(svg.querySelectorAll("[opacity]")).map((e) => e.getAttribute("opacity"));

        expect(stoneOpacities()).toContain("0.6");
        expect(stoneOpacities()).not.toContain("1");

        goban.parent.dispatchEvent(
            new MouseEvent("mousemove", {
                clientX: (1 + 1.5) * TEST_SQUARE_SIZE,
                clientY: (1 + 1.5) * TEST_SQUARE_SIZE,
            }),
        );

        expect(stoneOpacities()).toContain("1");
        goban.destroy();
    });

    test("hover keeps the mark stone below its subscript and quality badge", () => {
        const goban = new SVGRenderer(basic3x3Config({ mode: "analyze" }));
        goban.enableStonePlacement();
        goban.setMark(1, 1, "black", false);
        goban.setSubscriptMark(1, 1, "1.5", true);
        goban.setAIQualityMark(1, 1, "blunder");
        const svg = rendererSvg(goban);

        goban.parent.dispatchEvent(
            new MouseEvent("mousemove", {
                clientX: (1 + 1.5) * TEST_SQUARE_SIZE,
                clientY: (1 + 1.5) * TEST_SQUARE_SIZE,
            }),
        );

        const stone = svg.querySelector('[opacity="1"]')!;
        const subscript = svg.querySelector(".subscript")!;
        const badge = svg.querySelector(".ai-quality-badge")!;
        expect(stone).not.toBeNull();
        expect(
            stone.compareDocumentPosition(subscript) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
            stone.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        goban.destroy();
    });

    test("the presented next move's stone draws less translucently", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                ],
                mode: "analyze",
            }),
        );
        // Sit on move 1; move 2 at (1, 0) is the presented next move
        goban.showPrevious();
        goban.setPresentNextMove(true);
        goban.setMark(1, 0, "white", false);

        const svg = rendererSvg(goban);
        const opacities = Array.from(svg.querySelectorAll("[opacity]"))
            .filter((e) => e.getAttribute("class") !== "last-move")
            .map((e) => e.getAttribute("opacity"));
        expect(opacities).toContain("0.75");
        expect(opacities).not.toContain("0.6");
        goban.destroy();
    });

    test("the last move circle dims while presenting", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                ],
                mode: "analyze",
            }),
        );
        goban.showPrevious();
        const svg = rendererSvg(goban);

        expect(svg.querySelector(".last-move")).not.toBeNull();
        expect(svg.querySelector(".last-move")?.getAttribute("opacity")).toBeNull();

        goban.setPresentNextMove(true);
        expect(svg.querySelector(".last-move")?.getAttribute("opacity")).toBe("0.4");

        goban.setPresentNextMove(false);
        expect(svg.querySelector(".last-move")?.getAttribute("opacity")).toBeNull();
        goban.destroy();
    });

    test("shift clicking a stone in presented move space presents that move", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                mode: "analyze",
            }),
        );
        const event_layer = goban.parent;
        goban.setPresentNextMove(true);

        // Shift-click the stone of move 2 at (1, 0): the engine lands on
        // move 1 so that move 2 is the presented move
        simulateMouseClick(event_layer, { x: 1, y: 0, shiftKey: true });

        expect(goban.engine.cur_move.move_number).toBe(1);
        expect(goban.engine.cur_move.trunk_next?.move_number).toBe(2);
        goban.destroy();
    });

    test("a goban removes its move tree from the container when detached or destroyed", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);

        const goban_a = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                ],
                mode: "analyze",
            }),
        );
        goban_a.setMoveTreeContainer(container);
        expect(container.children.length).toBe(1);

        // Detaching (as GobanController.destroy does) removes the tree
        goban_a.setMoveTreeContainer(null);
        expect(container.children.length).toBe(0);
        goban_a.destroy();

        // A new goban taking over the container is the only tree in it,
        // even when the old goban is destroyed without detaching first
        const goban_b = new SVGRenderer(basic3x3Config({ moves: [[0, 0]], mode: "analyze" }));
        goban_b.setMoveTreeContainer(container);
        expect(container.children.length).toBe(1);
        goban_b.destroy();
        expect(container.children.length).toBe(0);

        container.remove();
    });

    test("clearing colored circles removes them from the board", () => {
        const goban = new SVGRenderer(basic3x3Config({ mode: "analyze" }));
        const svg = rendererSvg(goban);

        goban.setColoredCircles([{ move: { x: 1, y: 1 }, color: "rgba(0, 130, 255, 0.7)" }], false);
        expect(svg.querySelector(".colored-circle")).not.toBeNull();

        goban.setColoredCircles([], false);
        expect(svg.querySelector(".colored-circle")).toBeNull();
        goban.destroy();
    });

    test("subscript2 renders a second line below the subscript", () => {
        const goban = new SVGRenderer(basic3x3Config({ mode: "analyze" }));
        goban.setSubscriptMark(1, 1, "-1.0", true);
        goban.setSubscript2Mark(1, 1, "123", true);

        const svg = rendererSvg(goban);
        const sub = svg.querySelector(".subscript");
        const sub2 = svg.querySelector(".subscript2");
        expect(sub?.textContent).toBe("-1.0");
        expect(sub2?.textContent).toBe("123");
        expect(parseFloat(sub2!.getAttribute("y")!)).toBeGreaterThan(
            parseFloat(sub!.getAttribute("y")!),
        );

        goban.engine.cur_move.clearMarks();
        goban.redraw(true);
        expect(svg.querySelector(".subscript2")).toBeNull();
        goban.destroy();
    });

    test("clickJumpTarget resolves clicks in presented move space", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                mode: "analyze",
            }),
        );
        const move3 = goban.engine.cur_move;
        const move2 = move3.parent!;
        const root = goban.engine.move_tree;

        // Without presentation, clicks jump to the clicked node
        expect(goban.clickJumpTarget(move3).id).toBe(move3.id);

        goban.setPresentNextMove(true);

        // A trunk node click presents that move: jump to its parent
        expect(goban.clickJumpTarget(move3).id).toBe(move2.id);
        // The root has no parent and is jumped to directly
        expect(goban.clickJumpTarget(root).id).toBe(root.id);

        // Variation nodes are jumped to directly
        goban.engine.jumpTo(move2);
        goban.engine.place(1, 1);
        const variation = goban.engine.cur_move;
        expect(variation.trunk).toBe(false);
        expect(goban.clickJumpTarget(variation).id).toBe(variation.id);
        goban.destroy();
    });

    test("clicking the point of the next trunk move follows it instead of branching", () => {
        const goban = new SVGRenderer(
            basic3x3Config({
                moves: [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                mode: "analyze",
            }),
        );
        const event_layer = goban.parent;
        goban.enableStonePlacement();

        // Step back to move 2, then click where trunk move 3 was played
        goban.showPrevious();
        expect(goban.engine.cur_move.move_number).toBe(2);

        simulateMouseClick(event_layer, { x: 2, y: 0 });

        expect(goban.engine.cur_move.move_number).toBe(3);
        expect(goban.engine.cur_move.trunk).toBe(true);
        expect(goban.engine.board).toEqual([
            [1, 2, 1],
            [0, 0, 0],
            [0, 0, 0],
        ]);
        goban.destroy();
    });
});
