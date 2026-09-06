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

import { GobanEngine, NumberMatrix, PuzzlePlacementSetting, ScoreEstimator } from "../engine";
import { MoveTree, MoveTreePenMarks, MarkInterface } from "../engine/MoveTree";
import { JGOFNumericPlayerColor } from "../engine/formats/JGOF";
import { color_blend } from "../engine/util/color";
import { AI_QUALITY_BADGES, ColoredCircle } from "./InteractiveBase";
import type { StallingScoreEstimate } from "../engine/protocol";
import type { AnalysisSubTool, AnalysisTool, GobanModes } from "../GobanBase";
import {
    NativeGhost,
    NativeLastMove,
    NativeOverlay,
    NativePenMark,
    NativeShape,
    NativeText,
} from "./NativeTransport";

export const HEATMAP_COLOR = "#00FF00";
export const HINT_COLOR = "#8EFF0A";
export const MOVETREE_HIGHLIGHT_COLOR = "#FF8E0A";
export const CHAT_TRIANGLE_COLOR = "#00aaFF";

/** The slice of renderer state the spec builders read. Kept as a plain
 *  interface so tests can build one without a renderer. Field names match
 *  the renderer's own. */
export interface SpecSource {
    engine: GobanEngine;
    mode: GobanModes;
    analyze_tool: AnalysisTool;
    analyze_subtool: AnalysisSubTool;
    edit_color?: "black" | "white";
    move_selected?: { x: number; y: number };
    player_id: number;
    stone_placement_enabled: boolean;
    scoring_mode: boolean | "stalling-scoring-mode";
    score_estimator: ScoreEstimator | null;
    stalling_score_estimate?: StallingScoreEstimate;
    heatmap?: NumberMatrix;
    colored_circles?: Array<Array<ColoredCircle | undefined>>;
    highlight_movetree_moves: boolean;
    show_variation_move_numbers: boolean;
    show_undo_request_indicator: boolean;
    dont_draw_last_move: boolean;
    last_move_radius: number;
    circle_radius: number;
    last_move_opacity: number;
    submit_move_pending: boolean;
    variation_stone_opacity: number;
    byoyomi_label: string;
    label_character: string;
    getPuzzlePlacementSetting?: () => PuzzlePlacementSetting;
    isInPushedAnalysis?: () => boolean;
    removal_graphic: "x" | "square";
    colors: {
        black_stone: string;
        white_stone: string;
        black_text: string;
        white_text: string;
        blank_text: string;
    };
}

function movetreeContains(src: SpecSource, x: number, y: number): boolean {
    return !!src.engine.cur_move.lookupMove(x, y, src.engine.player, false);
}

/** The variation move number the canvas draws (`alt_marking`). */
function altMarking(src: SpecSource, x: number, y: number): string | undefined {
    if (src.mode === "play" && !src.isInPushedAnalysis?.()) {
        return undefined;
    }
    let cur: MoveTree | null = src.engine.cur_move;
    let ret: string | undefined;
    for (; cur && !cur.trunk; cur = cur.parent) {
        if (cur.x === x && cur.y === y) {
            const move_diff = cur.getMoveNumberDifferenceFromTrunk();
            if (move_diff !== cur.move_number && !cur.edited && src.show_variation_move_numbers) {
                ret = move_diff.toString();
            }
        }
    }
    return ret;
}

function inStoneRemoval(src: SpecSource): boolean {
    return (
        src.engine.phase === "stone removal" &&
        src.engine.last_official_move === src.engine.cur_move
    );
}

function finishedPlay(src: SpecSource): boolean {
    return src.engine.phase === "finished" && src.mode !== "analyze";
}

function text(
    value: string,
    color: string,
    alpha: number,
    dy: number,
    maxWidth: number,
    maxHeight: number,
): NativeText {
    return { value, color, alpha, dy, maxWidth, maxHeight };
}

function shape(
    kind: NativeShape["kind"],
    color: string,
    alpha: number,
    scale = 1,
    dy = 0,
): NativeShape {
    return { kind, color, alpha, scale, dy };
}

interface OverlayResult {
    overlay: NativeOverlay;
    /** Whether the canvas would skip the last-move ring/crosshair here
     *  because something else already drew over the intersection. */
    suppressLastMove: boolean;
}

/** Mirrors CanvasRenderer.__drawSquare for one intersection. Returns null
 *  when nothing beyond the plain stone/grid is drawn there. */
function computeOverlay(src: SpecSource, i: number, j: number): OverlayResult | null {
    const engine = src.engine;
    const pos: MarkInterface = engine.cur_move.getMarks(i, j) ?? {};
    const stone_color = engine.board[j][i];
    const o: NativeOverlay = { x: i, y: j };
    let has_content = false;

    const has_symbol =
        pos.circle ||
        pos.triangle ||
        pos.chat_triangle ||
        pos.sub_triangle ||
        pos.ai_quality ||
        pos.cross ||
        pos.square;
    let faded_grid =
        !!has_symbol ||
        !!pos.letter ||
        !!pos.subscript ||
        !!pos.subscript2 ||
        !!src.colored_circles?.[j][i];
    for (const key in pos) {
        if (key.length <= 3) {
            faded_grid = true;
        }
    }
    if (faded_grid) {
        o.fadedGrid = true;
        has_content = true;
    }

    /* Heatmap + highlights */
    const squares = [];
    if (src.heatmap && src.heatmap[j][i] > 0.001) {
        squares.push({ color: HEATMAP_COLOR, alpha: Math.min(src.heatmap[j][i], 0.5), size: 0.5 });
    }
    if (pos.hint || (src.highlight_movetree_moves && movetreeContains(src, i, j)) || pos.color) {
        const color = pos.color ? pos.color : pos.hint ? HINT_COLOR : MOVETREE_HIGHLIGHT_COLOR;
        squares.push({ color, alpha: 0.6, size: 0.5 });
    }
    if (squares.length) {
        o.squares = squares;
        has_content = true;
    }

    /* Colored circle under the stone */
    const circle = src.colored_circles?.[j][i];
    if (circle) {
        const border_width = circle.border_width || 0.1;
        o.circle = {
            color: circle.color,
            borderColor: circle.border_color || "#000000",
            borderWidth: border_width,
        };
        has_content = true;
    }

    /* Stones: translucency and mark stones */
    const se = src.score_estimator;
    const se_removed = src.scoring_mode === true && !!se && !!se.board[j][i] && !!se.removal[j][i];
    const removal_dead =
        (inStoneRemoval(src) || finishedPlay(src)) &&
        !!engine.board[j][i] &&
        !!engine.removal[j][i];
    let text_color = src.colors.blank_text;
    if (stone_color) {
        text_color = stone_color === 1 ? src.colors.black_text : src.colors.white_text;
        if (se_removed || removal_dead || pos.stone_removed) {
            o.stoneAlpha = 0.6;
            has_content = true;
        }
    } else if (pos.black || pos.white) {
        const color: 1 | 2 = pos.black ? 1 : 2;
        o.stone = { color, alpha: src.variation_stone_opacity };
        text_color = color === 1 ? src.colors.black_text : src.colors.white_text;
        has_content = true;
    }

    /* blue_move ring over the stone */
    if (pos.blue_move && circle) {
        o.ring = {
            borderColor: circle.border_color || "#000000",
            borderWidth: circle.border_width || 0.1,
        };
        has_content = true;
    }

    /* Removal X: only while stone removal is live at the last official move
     * (or scoring's own removed stones) -- unlike stoneAlpha, this does not
     * extend into a finished game (CanvasRenderer.ts:1624-1638). */
    const removal_x_dead = inStoneRemoval(src) && !!engine.board[j][i] && !!engine.removal[j][i];
    const draw_removal_x =
        (removal_x_dead || se_removed || pos.stone_removed) && src.removal_graphic === "x";
    let last_move_suppressed = false;
    if (draw_removal_x) {
        const color = engine.board[j][i] === JGOFNumericPlayerColor.BLACK ? "black" : "white";
        let stroke = "#888888";
        if (pos.score === "black" && color === "white") {
            stroke = src.colors.black_stone;
        } else if (pos.score === "white" && color === "black") {
            stroke = src.colors.white_stone;
        } else if (
            (pos.score === "white" && color === "white") ||
            (pos.score === "black" && color === "black")
        ) {
            stroke = "#ff0000";
        }
        o.xmark = { color: stroke, alpha: engine.board[j][i] ? 1.0 : 0.2 };
        last_move_suppressed = true;
        has_content = true;
    }

    /* Undo indicator */
    const texts: NativeText[] = [];
    const should_draw_undo = src.show_undo_request_indicator && engine.isStoneInUndoRequest(i, j);
    if (should_draw_undo) {
        texts.push(
            text(
                "↶",
                stone_color === 1 ? src.colors.black_text : src.colors.white_text,
                1,
                0,
                0.8,
                0.45,
            ),
        );
        last_move_suppressed = true;
    }

    /* Scores */
    const territory_phase =
        engine.phase === "stone removal" || (engine.phase === "finished" && src.mode === "play");
    if (
        (pos.score &&
            (engine.phase !== "finished" || src.mode === "play" || src.mode === "analyze")) ||
        (src.scoring_mode === true &&
            se &&
            (se.territory[j][i] || (se.removal[j][i] && se.board[j][i] === 0))) ||
        (territory_phase && engine.board[j][i] === 0 && (engine.removal[j][i] || pos.needs_sealing))
    ) {
        let color: string | undefined = pos.score;
        if (
            src.scoring_mode === true &&
            se &&
            (se.territory[j][i] || (se.removal[j][i] && se.board[j][i] === 0))
        ) {
            color = se.territory[j][i] === 1 ? "black" : "white";
            if (se.board[j][i] === 0 && se.removal[j][i]) {
                color = "dame";
            }
        }
        if (territory_phase && engine.board[j][i] === 0 && engine.removal[j][i]) {
            color = "dame";
        }
        if (pos.needs_sealing) {
            color = "seal";
        }
        if (color === "white") {
            o.territory = { fill: src.colors.white_stone, stroke: "#777777" };
        } else if (color === "black") {
            o.territory = { fill: src.colors.black_stone, stroke: "#888888" };
        } else if (color === "dame") {
            o.territory = { stroke: "#365FE6" };
        } else if (color === "seal") {
            o.territory = { fill: "#ff0000", stroke: "#E079CE" };
        } else if (color && color[0] === "#") {
            o.territory = { fill: color, stroke: color_blend("#888888", color) };
        }
        if (o.territory) {
            has_content = true;
        }
    }

    /* Letters and numbers */
    let letter: string | undefined = pos.letter;
    let subscript: string | undefined = pos.subscript;
    const alt = altMarking(src, i, j);
    if (!letter && alt !== "triangle") {
        letter = alt;
    }
    const has_shape_symbol =
        pos.circle ||
        pos.triangle ||
        pos.chat_triangle ||
        pos.sub_triangle ||
        pos.cross ||
        pos.square;
    if (src.show_variation_move_numbers && !letter && !has_shape_symbol) {
        const m = engine.getMoveByLocation(i, j, false);
        if (m && !m.trunk && !m.edited) {
            letter = m.getMoveNumberDifferenceFromTrunk().toString();
        }
    }
    let letter_was_drawn = false;
    if (letter) {
        letter_was_drawn = true;
        texts.push(
            text(letter, text_color, 1, subscript ? -0.15 : 0, 0.8 * (subscript ? 0.9 : 1), 0.4),
        );
        last_move_suppressed = true;
    }
    if (subscript) {
        letter_was_drawn = true;
        if (letter && subscript === "0") {
            subscript = "0.0";
        }
        let dy = letter ? 0.3 : 0;
        if (pos.subscript2) {
            dy -= 0.15;
        }
        texts.push(text(subscript, text_color, 1, dy, 0.8 * (letter ? 0.9 : 1), 0.4));
        last_move_suppressed = true;
    }
    if (pos.subscript2) {
        letter_was_drawn = true;
        texts.push(text(pos.subscript2, text_color, 1, 0.35, 0.7, 0.28));
        last_move_suppressed = true;
    }
    if (texts.length) {
        o.texts = texts;
        has_content = true;
    }

    /* Symbols */
    const shapes: NativeShape[] = [];
    const transparent = letter_was_drawn ? 0.6 : 1;
    const symbol_color =
        stone_color === 1
            ? src.colors.black_text
            : stone_color === 2
              ? src.colors.white_text
              : text_color;
    if (pos.circle) {
        shapes.push(shape("circle", symbol_color, transparent));
        last_move_suppressed = true;
    }
    if (pos.ai_quality) {
        const badge = AI_QUALITY_BADGES[pos.ai_quality];
        if (badge) {
            o.badge = { color: badge.color, text: badge.symbol };
            last_move_suppressed = true;
            has_content = true;
        }
    }
    if (
        !pos.ai_quality &&
        (pos.triangle || pos.chat_triangle || pos.sub_triangle || alt === "triangle")
    ) {
        const sub = !!pos.sub_triangle;
        shapes.push(
            shape(
                "triangle",
                pos.chat_triangle ? CHAT_TRIANGLE_COLOR : symbol_color,
                sub ? 1 : transparent,
                sub ? 0.5 : 1,
                sub ? 0.3 : 0,
            ),
        );
        last_move_suppressed = true;
    }
    if (pos.cross) {
        shapes.push(shape("cross", symbol_color, transparent));
        last_move_suppressed = true;
    }
    if (pos.square) {
        shapes.push(shape("square", symbol_color, transparent));
        last_move_suppressed = true;
    }
    if (shapes.length) {
        o.shapes = shapes;
        has_content = true;
    }

    /* Score estimation ownership */
    const est_source =
        src.scoring_mode === true && se
            ? se
            : src.scoring_mode === "stalling-scoring-mode" &&
                src.stalling_score_estimate &&
                src.mode !== "analyze"
              ? src.stalling_score_estimate
              : null;
    if (est_source) {
        const est = est_source.ownership[j][i];
        const owner: 1 | 2 = est < 0 ? 2 : 1;
        if (owner !== stone_color && Math.abs(est) > 0) {
            o.ownership = { color: owner, size: 0.2 * Math.abs(est) };
            has_content = true;
        }
    }

    return has_content ? { overlay: o, suppressLastMove: last_move_suppressed } : null;
}

export function buildOverlays(src: SpecSource): NativeOverlay[] {
    const ret: NativeOverlay[] = [];
    for (let j = 0; j < src.engine.height; ++j) {
        for (let i = 0; i < src.engine.width; ++i) {
            const result = computeOverlay(src, i, j);
            if (result) {
                ret.push(result.overlay);
            }
        }
    }
    return ret;
}

export function buildLastMove(src: SpecSource): NativeLastMove | null {
    if (src.dont_draw_last_move) {
        return null;
    }
    const engine = src.engine;
    const m = engine.cur_move;
    if (!m || m.x < 0 || m.y < 0 || !engine.board[m.y][m.x]) {
        return null;
    }
    if (!(engine.phase === "play" || engine.phase === "finished")) {
        return null;
    }
    const result = computeOverlay(src, m.x, m.y);
    if (result?.suppressLastMove) {
        return null;
    }
    const stone_color = engine.board[m.y][m.x];
    const color = stone_color === 1 ? src.colors.black_text : src.colors.white_text;
    const alpha = src.last_move_opacity;
    return {
        x: m.x,
        y: m.y,
        style: src.submit_move_pending ? "plus" : "circle",
        color,
        alpha,
        radius: src.last_move_radius,
    };
}

/** The hover preview the canvas draws at `last_hover_square`, expressed as
 *  a spec the rim applies at the finger's snapped point. */
export function buildGhost(src: SpecSource): NativeGhost | null {
    const engine = src.engine;
    if (
        !(
            src.stone_placement_enabled &&
            (src.player_id ||
                !engine.players.black.id ||
                src.mode === "analyze" ||
                src.scoring_mode)
        )
    ) {
        return null;
    }
    const ghost: NativeGhost = {};
    let has_content = false;

    /* Hover stone */
    const shows_stone =
        (src.mode !== "analyze" || src.analyze_tool === "stone") &&
        !src.scoring_mode &&
        (engine.phase === "play" || (engine.phase === "finished" && src.mode === "analyze"));
    if (shows_stone) {
        let color: 1 | 2;
        if (
            src.mode === "analyze" &&
            src.analyze_tool === "stone" &&
            src.analyze_subtool !== "alternate"
        ) {
            color = src.edit_color === "black" ? 1 : 2;
        } else if (src.move_selected) {
            color =
                engine.handicapMovesLeft() <= 0
                    ? (engine.otherPlayer() as 1 | 2)
                    : (engine.player as 1 | 2);
        } else if (src.mode === "puzzle" && src.getPuzzlePlacementSetting) {
            const s = src.getPuzzlePlacementSetting();
            color = s.mode === "setup" ? (s.color as 1 | 2) : (engine.player as 1 | 2);
        } else {
            color = engine.player as 1 | 2;
        }
        ghost.stone = { color, alpha: 0.6 };
        has_content = true;
        if (
            engine.puzzle_player_move_mode === "fixed" &&
            !(src.getPuzzlePlacementSetting && src.getPuzzlePlacementSetting().mode === "play")
        ) {
            const only: Array<{ x: number; y: number }> = [];
            for (let j = 0; j < engine.height; ++j) {
                for (let i = 0; i < engine.width; ++i) {
                    if (movetreeContains(src, i, j)) {
                        only.push({ x: i, y: j });
                    }
                }
            }
            ghost.only = only;
        }
    }

    const ghost_text_color = ghost.stone
        ? ghost.stone.color === 1
            ? src.colors.black_text
            : src.colors.white_text
        : src.colors.blank_text;

    /* Byoyomi label / label tool previews */
    if (src.mode === "play" && src.byoyomi_label) {
        ghost.texts = [text(src.byoyomi_label, ghost_text_color, 1, 0, 0.8, 0.4)];
        has_content = true;
    }
    if (src.mode === "analyze" && src.analyze_tool === "label") {
        if (src.analyze_subtool === "letters" || src.analyze_subtool === "numbers") {
            ghost.texts = [text(src.label_character, src.colors.blank_text, 0.6, 0, 0.8, 0.4)];
            has_content = true;
        } else if (
            src.analyze_subtool === "triangle" ||
            src.analyze_subtool === "square" ||
            src.analyze_subtool === "cross" ||
            src.analyze_subtool === "circle"
        ) {
            ghost.shapes = [shape(src.analyze_subtool, src.colors.blank_text, 0.6)];
            has_content = true;
        }
    }

    /* Removal X preview */
    if (
        (src.mode === "analyze" && src.analyze_tool === "removal") ||
        (engine.phase === "stone removal" &&
            engine.isActivePlayer(src.player_id) &&
            engine.cur_move === engine.last_official_move)
    ) {
        /* The rim raises this to 1.0 where the ghosted point holds a stone,
         * matching the canvas; see NativeGhost.xmark. */
        ghost.xmark = { color: "#888888", alpha: 0.2 };
        has_content = true;
    }

    /* Score tool preview */
    if (src.mode === "analyze" && src.analyze_tool === "score") {
        const color = src.analyze_subtool;
        ghost.territory =
            color === "white"
                ? { fill: src.colors.white_stone, stroke: "#777777" }
                : color === "black"
                  ? { fill: src.colors.black_stone, stroke: "#888888" }
                  : { fill: color, stroke: color_blend("#888888", color) };
        has_content = true;
    }

    return has_content ? ghost : null;
}

/** goban stores pen points in 1/64ths of a cell in a space where the
 *  intersection (i, j) sits at ((i + 1.5) * 64, (j + 1.5) * 64) -- the
 *  canvas's xy2pen with a phantom label column -- first pair absolute, the
 *  rest deltas. */
export function penMarksToBoardUnits(marks: MoveTreePenMarks): NativePenMark[] {
    return marks.map((stroke) => {
        const points: number[] = [];
        let px = stroke.points[0];
        let py = stroke.points[1];
        points.push(px / 64 - 1.5, py / 64 - 1.5);
        for (let k = 2; k < stroke.points.length; k += 2) {
            px += stroke.points[k];
            py += stroke.points[k + 1];
            points.push(px / 64 - 1.5, py / 64 - 1.5);
        }
        return { color: stroke.color, points };
    });
}

export function boardUnitsToPenPoints(points: number[]): number[] {
    const ret: number[] = [];
    let last_x = 0;
    let last_y = 0;
    for (let k = 0; k < points.length; k += 2) {
        const px = Math.round((points[k] + 1.5) * 64);
        const py = Math.round((points[k + 1] + 1.5) * 64);
        if (k === 0) {
            ret.push(px, py);
        } else {
            ret.push(px - last_x, py - last_y);
        }
        last_x = px;
        last_y = py;
    }
    return ret;
}
