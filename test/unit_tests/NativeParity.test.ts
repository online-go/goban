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

import * as fs from "fs";
import * as path from "path";
import { buildOverlays, buildGhost, buildLastMove, SpecSource } from "../../src/Goban/NativeSpec";
import { GobanEngine } from "../../src/engine";
import { makeMatrix } from "../../src/engine/util";

const src_dir = path.join(__dirname, "..", "..", "src", "Goban");
const canvas_src = fs.readFileSync(path.join(src_dir, "CanvasRenderer.ts"), "utf-8");
const spec_src = fs.readFileSync(path.join(src_dir, "NativeSpec.ts"), "utf-8");

/** Every mark field the canvas renderer reads while drawing a square. */
function markFieldsRead(source: string): Set<string> {
    const draw_square = source.slice(
        source.indexOf("private __drawSquare("),
        source.indexOf("private drawingHash("),
    );
    const fields = new Set<string>();
    for (const m of draw_square.matchAll(/\bpos\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
        fields.add(m[1]);
    }
    return fields;
}

/** Renderer state the canvas's __drawSquare branches on, beyond marks. */
const RENDERER_STATE_INPUTS = [
    "heatmap",
    "colored_circles",
    "highlight_movetree_moves",
    "scoring_mode",
    "score_estimator",
    "stalling_score_estimate",
    "show_variation_move_numbers",
    "present_next_move",
    "byoyomi_label",
    "label_character",
    "engine.removal",
    "isStoneInUndoRequest",
    "puzzle_player_move_mode",
    "getPuzzlePlacementSetting",
    "last_move_opacity",
    "submit_move",
    "dont_draw_last_move",
];

describe("native renderer drawing parity", () => {
    test("every mark field the canvas draws is consumed by NativeSpec", () => {
        const missing = [...markFieldsRead(canvas_src)].filter((f) => !spec_src.includes(`.${f}`));
        expect(missing).toEqual([]);
    });

    test("every renderer state input the canvas draws from is consumed by NativeSpec", () => {
        const missing = RENDERER_STATE_INPUTS.filter(
            (name) => !spec_src.includes(name.split(".").pop()!),
        );
        expect(missing).toEqual([]);
    });

    test("each input changes the emitted spec", () => {
        const base = (): SpecSource => {
            const engine = new GobanEngine({ width: 5, height: 5 });
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
                present_next_move: false,
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
            };
        };
        const snapshot = (s: SpecSource) =>
            JSON.stringify([buildOverlays(s), buildGhost(s), buildLastMove(s)]);
        const baseline = snapshot(base());
        const cases: Array<[string, (s: SpecSource) => void]> = [
            ["triangle", (s) => (s.engine.cur_move.getMarks(0, 0).triangle = true)],
            ["square", (s) => (s.engine.cur_move.getMarks(0, 0).square = true)],
            ["circle", (s) => (s.engine.cur_move.getMarks(0, 0).circle = true)],
            ["cross", (s) => (s.engine.cur_move.getMarks(0, 0).cross = true)],
            ["letter", (s) => (s.engine.cur_move.getMarks(0, 0).letter = "A")],
            ["subscript", (s) => (s.engine.cur_move.getMarks(0, 0).subscript = "1")],
            ["subscript2", (s) => (s.engine.cur_move.getMarks(0, 0).subscript2 = "2")],
            ["black", (s) => (s.engine.cur_move.getMarks(0, 0).black = true)],
            ["white", (s) => (s.engine.cur_move.getMarks(0, 0).white = true)],
            ["hint", (s) => (s.engine.cur_move.getMarks(0, 0).hint = true)],
            ["color", (s) => (s.engine.cur_move.getMarks(0, 0).color = "#123456")],
            ["score", (s) => (s.engine.cur_move.getMarks(0, 0).score = "black")],
            [
                "needs_sealing",
                (s) => {
                    s.engine.phase = "stone removal";
                    s.engine.cur_move.getMarks(0, 0).needs_sealing = true;
                },
            ],
            [
                "stone_removed",
                (s) => {
                    s.engine.place(0, 0);
                    s.engine.cur_move.getMarks(0, 0).stone_removed = true;
                },
            ],
            ["chat_triangle", (s) => (s.engine.cur_move.getMarks(0, 0).chat_triangle = true)],
            ["sub_triangle", (s) => (s.engine.cur_move.getMarks(0, 0).sub_triangle = true)],
            ["ai_quality", (s) => (s.engine.cur_move.getMarks(0, 0).ai_quality = "blunder" as any)],
            ["transient_letter", (s) => (s.engine.cur_move.getMarks(0, 0).transient_letter = "7")],
            [
                "blue_move + circle",
                (s) => {
                    s.colored_circles = makeMatrix(5, 5, undefined) as any;
                    s.colored_circles![0][0] = { move: { x: 0, y: 0 }, color: "#f00" };
                    s.engine.cur_move.getMarks(0, 0).blue_move = true;
                },
            ],
            [
                "heatmap",
                (s) => {
                    const h = makeMatrix(5, 5, 0);
                    h[0][0] = 1;
                    s.heatmap = h;
                },
            ],
            [
                "removal",
                (s) => {
                    s.engine.place(0, 0);
                    s.engine.last_official_move = s.engine.cur_move;
                    s.engine.phase = "stone removal";
                    s.engine.removal[0][0] = true;
                },
            ],
            [
                "undo",
                (s) => {
                    s.engine.place(0, 0);
                    s.engine.undo_requested = s.engine.cur_move.move_number;
                },
            ],
            ["byoyomi", (s) => (s.byoyomi_label = "3")],
            [
                "label tool",
                (s) => {
                    s.mode = "analyze";
                    s.analyze_tool = "label";
                    s.analyze_subtool = "letters";
                },
            ],
            [
                "present_next_move",
                (s) => {
                    s.engine.place(0, 0);
                    s.present_next_move = true;
                },
            ],
            [
                "submit pending",
                (s) => {
                    s.engine.place(0, 0);
                    s.submit_move_pending = true;
                },
            ],
            [
                "ownership",
                (s) => {
                    s.scoring_mode = true;
                    s.score_estimator = {
                        board: makeMatrix(5, 5, 0),
                        removal: makeMatrix(5, 5, false),
                        territory: makeMatrix(5, 5, 0),
                        ownership: makeMatrix(5, 5, 0.5),
                    } as any;
                },
            ],
        ];
        const unchanged = cases
            .filter(([, apply]) => {
                const s = base();
                apply(s);
                return snapshot(s) === baseline;
            })
            .map(([name]) => name);
        expect(unchanged).toEqual([]);
    });
});
