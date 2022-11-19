/**
 * @jest-environment jsdom
 */

(global as any).CLIENT = true;

import { GobanCanvas } from "../GobanCanvas";

let board_div: HTMLDivElement;

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
        const mouse_event = new MouseEvent("click", {
            clientX: 15,
            clientY: 15,
        });

        canvas.dispatchEvent(mouse_event);

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
        const mouse_event = new MouseEvent("click", {
            clientX: 15,
            clientY: 15,
        });

        goban.enableStonePlacement();
        canvas.dispatchEvent(mouse_event);

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
        const mouse_event = new MouseEvent("click", {
            clientX: 20,
            clientY: 15,
        });

        goban.enableStonePlacement();
        canvas.dispatchEvent(mouse_event);

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
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
        const mouse_event = new MouseEvent("click", {
            clientX: 20,
            clientY: 15,
        });

        goban.enableStonePlacement();
        canvas.dispatchEvent(mouse_event);

        expect(goban.engine.board).toEqual([
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ]);
    });
});
