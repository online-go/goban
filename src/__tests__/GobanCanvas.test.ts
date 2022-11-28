/**
 * @jest-environment jsdom
 */

(global as any).CLIENT = true;

import { GobanCanvas } from "../GobanCanvas";

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
});
