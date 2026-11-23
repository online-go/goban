/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import { SVGRenderer } from "../../src/Goban/SVGRenderer";
import { Goban } from "../../src/Goban/Goban";

const DISPLAY_WIDTH = 400;

function makeGoban(evaluation_bar?: boolean): { goban: SVGRenderer; board_div: HTMLDivElement } {
    const board_div = document.createElement("div");
    document.body.appendChild(board_div);
    const goban = new SVGRenderer({
        board_div,
        width: 9,
        height: 9,
        square_size: "auto",
        display_width: DISPLAY_WIDTH,
        evaluation_bar,
    });
    return { goban, board_div };
}

afterEach(() => {
    document.body.innerHTML = "";
});

test("the bar can be shown and hidden after construction", () => {
    const { goban, board_div } = makeGoban();
    const square_size = goban.square_size;
    const updated = jest.fn();
    goban.on("evaluation-bar.updated", updated);
    expect(goban.evaluation_bar_container).toBeUndefined();

    goban.setEvaluationBar(true);
    const bar = goban.evaluation_bar_container!;
    expect(bar.parentNode).toBe(board_div.shadowRoot ?? board_div);
    expect(goban.square_size).toBeLessThan(square_size);
    expect(updated).toHaveBeenLastCalledWith(true);

    goban.setEvaluationBar(false);
    expect(goban.evaluation_bar_container).toBeUndefined();
    expect(bar.isConnected).toBe(false);
    expect(goban.square_size).toBe(square_size);
    expect(updated).toHaveBeenLastCalledWith(false);

    goban.setEvaluationBar(false);
    expect(updated).toHaveBeenCalledTimes(2);
    goban.destroy();
});

test("a centered board leaves room for the bar and its gap inside the display width", () => {
    const { goban } = makeGoban(true);
    const metrics = goban.computeMetrics();
    const bar = goban.evaluation_bar_container!;
    const offset = -parseInt(bar.style.left);
    expect(offset).toBe(goban.evaluation_bar_width + Goban.EVALUATION_BAR_GAP);
    expect((DISPLAY_WIDTH - metrics.width) / 2).toBeGreaterThanOrEqual(offset);
    goban.destroy();
});

test("the evaluation is stored and clamped", () => {
    const { goban } = makeGoban(true);
    expect(goban.evaluation).toBe(0.5);
    goban.evaluation = 0.8;
    expect(goban.evaluation).toBe(0.8);
    expect(goban.evaluation_bar_div!.style.height).toBe("80%");
    goban.evaluation = 1.7;
    expect(goban.evaluation).toBe(1);
    goban.destroy();
});
