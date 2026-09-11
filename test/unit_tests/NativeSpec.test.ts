/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(global as any).CLIENT = true;

import {
    buildOverlays,
    buildGhost,
    buildLastMove,
    boardUnitsToPenPoints,
    penMarksToBoardUnits,
    SpecSource,
} from "../../src/Goban/NativeSpec";
import { GobanEngine } from "../../src/engine";
import { makeMatrix } from "../../src/engine/util";

function source(overrides: Partial<SpecSource> = {}): SpecSource {
    const engine = new GobanEngine({ width: 3, height: 3 });
    return {
        engine,
        mode: "play",
        analyze_tool: "stone",
        analyze_subtool: "alternate",
        edit_color: undefined,
        move_selected: undefined,
        player_id: 0,
        stone_placement_enabled: true,
        scoring_mode: false,
        score_estimator: null,
        stalling_score_estimate: undefined,
        heatmap: undefined,
        colored_circles: undefined,
        highlight_movetree_moves: false,
        show_variation_move_numbers: false,
        show_undo_request_indicator: true,
        dont_draw_last_move: false,
        last_move_radius: 0.25,
        circle_radius: 0.25,
        last_move_opacity: 1,
        submit_move_pending: false,
        variation_stone_opacity: 0.6,
        byoyomi_label: "",
        label_character: "A",
        getPuzzlePlacementSetting: undefined,
        removal_graphic: "x",
        colors: {
            black_stone: "#000000",
            white_stone: "#ffffff",
            black_text: "#ffffff",
            white_text: "#000000",
            blank_text: "#000000",
        },
        ...overrides,
    };
}

function overlayAt(overlays: ReturnType<typeof buildOverlays>, x: number, y: number) {
    return overlays.find((o) => o.x === x && o.y === y);
}

describe("buildOverlays", () => {
    test("empty board has no overlays", () => {
        expect(buildOverlays(source())).toEqual([]);
    });

    test("heatmap becomes a square fill capped at 0.5 alpha", () => {
        const src = source();
        const heat = makeMatrix(3, 3, 0);
        heat[1][2] = 0.9;
        src.heatmap = heat;
        const o = overlayAt(buildOverlays(src), 2, 1)!;
        expect(o.squares).toEqual([{ color: "#00FF00", alpha: 0.5, size: 0.5 }]);
    });

    test("hint mark becomes the hint highlight", () => {
        const src = source();
        src.engine.cur_move.getMarks(0, 0).hint = true;
        const o = overlayAt(buildOverlays(src), 0, 0)!;
        expect(o.squares).toEqual([{ color: "#8EFF0A", alpha: 0.6, size: 0.5 }]);
        expect(o.fadedGrid).toBeUndefined();
    });

    test("short mark keys and symbols fade the grid under them", () => {
        const src = source();
        src.engine.cur_move.getMarks(0, 0).letter = "A";
        src.engine.cur_move.getMarks(1, 1).square = true;
        const overlays = buildOverlays(src);
        expect(overlayAt(overlays, 0, 0)!.fadedGrid).toBe(true);
        expect(overlayAt(overlays, 1, 1)!.fadedGrid).toBe(true);
    });

    test("letter and subscript become stacked texts", () => {
        const src = source();
        const marks = src.engine.cur_move.getMarks(1, 1);
        marks.letter = "A";
        marks.subscript = "12";
        const o = overlayAt(buildOverlays(src), 1, 1)!;
        expect(o.texts).toHaveLength(2);
        expect(o.texts![0]).toMatchObject({ value: "A", dy: -0.15, color: "#000000", alpha: 1 });
        expect(o.texts![1]).toMatchObject({ value: "12", dy: 0.3 });
    });

    test("shape marks use the contrast color of the stone underneath", () => {
        const src = source();
        src.engine.place(0, 0); // black
        src.engine.cur_move.getMarks(0, 0).triangle = true;
        src.engine.cur_move.getMarks(2, 2).square = true;
        const overlays = buildOverlays(src);
        expect(overlayAt(overlays, 0, 0)!.shapes).toEqual([
            { kind: "triangle", color: "#ffffff", alpha: 1, scale: 1, dy: 0 },
        ]);
        expect(overlayAt(overlays, 2, 2)!.shapes).toEqual([
            { kind: "square", color: "#000000", alpha: 1, scale: 1, dy: 0 },
        ]);
    });

    test("variation stones are translucent mark stones", () => {
        const src = source();
        src.engine.cur_move.getMarks(1, 0).white = true;
        const o = overlayAt(buildOverlays(src), 1, 0)!;
        expect(o.stone).toEqual({ color: 2, alpha: 0.6 });
    });

    test("stone removal fades the stone, draws the X and a dame square", () => {
        const src = source();
        src.engine.place(0, 0);
        // The canvas only draws removal state at the last official move.
        src.engine.last_official_move = src.engine.cur_move;
        src.engine.phase = "stone removal";
        src.engine.removal[0][0] = true;
        src.engine.removal[2][2] = true;
        const overlays = buildOverlays(src);
        const dead = overlayAt(overlays, 0, 0)!;
        expect(dead.stoneAlpha).toBe(0.6);
        expect(dead.xmark).toEqual({ color: "#888888", alpha: 1 });
        const dame = overlayAt(overlays, 2, 2)!;
        expect(dame.territory).toEqual({ stroke: "#365FE6" });
    });

    test("finished game fades dead stones but does not draw the removal X", () => {
        const src = source();
        src.engine.place(1, 1);
        src.engine.last_official_move = src.engine.cur_move;
        src.engine.phase = "finished";
        src.engine.removal[1][1] = true;
        const o = overlayAt(buildOverlays(src), 1, 1)!;
        expect(o.stoneAlpha).toBe(0.6);
        expect(o.xmark).toBeUndefined();
        expect(buildLastMove(src)).toMatchObject({ x: 1, y: 1, style: "circle" });
    });

    test("score marks become filled territory squares", () => {
        const src = source();
        src.engine.cur_move.getMarks(1, 1).score = "black";
        const o = overlayAt(buildOverlays(src), 1, 1)!;
        expect(o.territory).toEqual({ fill: "#000000", stroke: "#888888" });
    });

    test("undo request draws the undo glyph and suppresses the last move ring", () => {
        const src = source();
        src.engine.place(1, 1, false, false, true, true, true);
        src.engine.undo_requested = src.engine.cur_move.move_number;
        const o = overlayAt(buildOverlays(src), 1, 1)!;
        expect(o.texts![0]).toMatchObject({ value: "↶", color: "#ffffff" });
        expect(buildLastMove(src)).toBeNull();
    });

    test("colored circles draw under the stone and blue_move rings over it", () => {
        const src = source();
        src.colored_circles = makeMatrix(3, 3, undefined) as any;
        src.colored_circles![0][0] = { move: { x: 0, y: 0 }, color: "#ff0000", border_width: 0.2 };
        src.engine.cur_move.getMarks(0, 0).blue_move = true;
        const o = overlayAt(buildOverlays(src), 0, 0)!;
        expect(o.circle).toEqual({ color: "#ff0000", borderColor: "#000000", borderWidth: 0.2 });
        expect(o.ring).toEqual({ borderColor: "#000000", borderWidth: 0.2 });
    });

    test("ai quality badge", () => {
        const src = source();
        src.engine.cur_move.getMarks(2, 0).ai_quality = "blunder" as any;
        const o = overlayAt(buildOverlays(src), 2, 0)!;
        expect(o.badge).toBeDefined();
        expect(typeof o.badge!.color).toBe("string");
        expect(Object.keys(o.badge!)).toEqual(["color"]);
    });

    test("score estimator ownership squares skip points the owner already holds", () => {
        const src = source();
        src.engine.place(0, 0); // black at 0,0
        src.scoring_mode = true;
        src.score_estimator = {
            board: makeMatrix(3, 3, 0),
            removal: makeMatrix(3, 3, false),
            territory: makeMatrix(3, 3, 0),
            ownership: [
                [1, 0.5, 0],
                [0, 0, 0],
                [0, 0, -1],
            ],
        } as any;
        const overlays = buildOverlays(src);
        expect(overlayAt(overlays, 0, 0)).toBeUndefined();
        expect(overlayAt(overlays, 1, 0)!.ownership).toEqual({ color: 1, size: 0.1 });
        expect(overlayAt(overlays, 2, 2)!.ownership).toEqual({ color: 2, size: 0.2 });
    });

    test("variation move numbers off the trunk", () => {
        const src = source({ mode: "analyze", show_variation_move_numbers: true });
        // Trunk moves come from the config; a move placed after jumping back
        // is a variation whose number differs from its move number.
        src.engine = new GobanEngine({
            width: 3,
            height: 3,
            moves: [
                [0, 0],
                [1, 1],
            ],
        });
        src.engine.jumpTo(src.engine.cur_move.parent!);
        src.engine.place(2, 2);
        const o = overlayAt(buildOverlays(src), 2, 2)!;
        expect(o.texts![0]).toMatchObject({ value: "1" });
    });

    test("variation move numbers in play mode only during pushed analysis", () => {
        const variation = (is_pushed: boolean) => {
            const src = source({
                mode: "play",
                show_variation_move_numbers: true,
                isInPushedAnalysis: () => is_pushed,
            });
            src.engine = new GobanEngine({
                width: 3,
                height: 3,
                moves: [
                    [0, 0],
                    [1, 1],
                ],
            });
            src.engine.jumpTo(src.engine.cur_move.parent!);
            src.engine.place(2, 2);
            return overlayAt(buildOverlays(src), 2, 2);
        };
        expect(variation(true)?.texts?.[0]).toMatchObject({ value: "1" });
        expect(variation(false)?.texts).toBeUndefined();
    });
});

describe("buildLastMove", () => {
    test("circle ring on the current move stone", () => {
        const src = source();
        src.engine.place(1, 2);
        expect(buildLastMove(src)).toEqual({
            x: 1,
            y: 2,
            style: "circle",
            color: "#ffffff",
            alpha: 1,
            radius: 0.25,
        });
    });

    test("plus while a move awaits submission", () => {
        const src = source({ submit_move_pending: true });
        src.engine.place(1, 2);
        expect(buildLastMove(src)).toMatchObject({ style: "plus", alpha: 1 });
    });

    test("suppressed by text at the same point", () => {
        const src = source();
        src.engine.place(1, 2);
        src.engine.cur_move.getMarks(1, 2).letter = "A";
        expect(buildLastMove(src)).toBeNull();
    });
});

describe("buildGhost", () => {
    test("play mode: the color to move", () => {
        expect(buildGhost(source())).toEqual({ stone: { color: 1, alpha: 0.6 } });
    });

    test("label tool: the next label character at 0.6 alpha", () => {
        const g = buildGhost(
            source({ mode: "analyze", analyze_tool: "label", analyze_subtool: "letters" }),
        )!;
        expect(g.stone).toBeUndefined();
        expect(g.texts![0]).toMatchObject({ value: "A", alpha: 0.6 });
    });

    test("byoyomi label rides on the play ghost", () => {
        const g = buildGhost(source({ byoyomi_label: "3" }))!;
        expect(g.stone).toEqual({ color: 1, alpha: 0.6 });
        expect(g.texts![0]).toMatchObject({ value: "3" });
    });

    test("fixed puzzle move mode restricts the ghost to move-tree points", () => {
        const src = source({ mode: "puzzle" });
        src.engine.puzzle_player_move_mode = "fixed";
        const g = buildGhost(src)!;
        expect(g.only).toEqual([]);
    });

    test("stone placement disabled: no ghost", () => {
        expect(buildGhost(source({ stone_placement_enabled: false }))).toBeNull();
    });
});

describe("pen conversions", () => {
    test("round trip through goban's 1/64 encoding", () => {
        const pen = boardUnitsToPenPoints([0, 0, 1, 0.5]);
        expect(pen).toEqual([96, 96, 64, 32]);
        expect(penMarksToBoardUnits([{ color: "#f00", points: pen }])).toEqual([
            { color: "#f00", points: [0, 0, 1, 0.5] },
        ]);
    });
});
