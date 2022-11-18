/**
 * @jest-environment jsdom
 */

(global as any).CLIENT = true;

import { GobanCanvas } from "../GobanCanvas";

describe("onTap", () => {
    test("clicking the top left intersection places a stone", () => {
        const board_div = document.createElement("div");
        document.body.appendChild(board_div);
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
});
