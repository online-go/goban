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

/**
 * Contract v2 between GobanNativeRenderer and a native draw layer
 * (apps/baduk.com/docs/GOBAN-NATIVE-CONTRACT.md). The renderer computes
 * everything; the rim draws primitives and reports intents. Colors are CSS
 * strings (six-digit hex or rgba()). Lengths inside an intersection are
 * fractions of one cell unless a name ends in Px.
 */

export type NativeStone = 0 | 1 | 2;
export type NativeShapeKind = "triangle" | "square" | "circle" | "cross";

export interface NativeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface NativeBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface NativeLabels {
    top: boolean;
    bottom: boolean;
    left: boolean;
    right: boolean;
}

/** A full-cell square fill (heatmap, hint/movetree highlight). `size` is
 *  the half-extent as a fraction of the cell (0.5 = whole cell). */
export interface NativeSquareFill {
    color: string;
    alpha: number;
    size: number;
}

export interface NativeCircleFill {
    color: string;
    borderColor: string;
    /** Stroke width as a fraction of the circle radius; 0 = no stroke. */
    borderWidth: number;
}

export interface NativeText {
    value: string;
    color: string;
    alpha: number;
    /** Vertical offset of the text center from the cell center. */
    dy: number;
    /** Fit box, fractions of the cell. */
    maxWidth: number;
    maxHeight: number;
}

export interface NativeShape {
    kind: NativeShapeKind;
    color: string;
    alpha: number;
    /** 1 = normal size (sub-triangles use 0.5). */
    scale: number;
    dy: number;
}

export interface NativeOverlay {
    x: number;
    y: number;
    /** Redraw this cell's grid lines in the faded line color (the canvas
     *  does this under any text or symbol). */
    fadedGrid?: boolean;
    squares?: NativeSquareFill[];
    /** Colored circle under the stone (AI review). */
    circle?: NativeCircleFill;
    /** Mark stone drawn only when `board` is empty here. */
    stone?: { color: 1 | 2; alpha: number };
    /** Alpha applied to the real stone at this point (dead stones). */
    stoneAlpha?: number;
    /** Stroked circle over the stone (blue_move). */
    ring?: { borderColor: string; borderWidth: number };
    /** Removal X: half-extent 0.65 * (cell/2), line width 0.125 cell. */
    xmark?: { color: string; alpha: number };
    /** Score square, half-extent 0.15 cell; no fill for dame. */
    territory?: { fill?: string; stroke: string };
    /** Score-estimate ownership square: half-extent `size` cells. */
    ownership?: { color: 1 | 2; size: number };
    texts?: NativeText[];
    shapes?: NativeShape[];
    /** AI quality badge: the sub_triangle geometry (upward triangle,
     *  circumradius 0.15 cell, centered dy=0.3 below the stone center),
     *  filled with `color` and stroked rgba(0,0,0,0.75) at 0.0375 cell with
     *  round joins. No text: the color alone carries the classification. */
    badge?: { color: string };
}

/** What the rim shows at the snapped finger point while a touch is down. */
export interface NativeGhost {
    stone?: { color: 1 | 2; alpha: number };
    texts?: NativeText[];
    shapes?: NativeShape[];
    /** Removal X preview. The ghost carries no per-point context, so the rim
     *  decides the opacity the way the canvas does: `alpha` applies where the
     *  ghosted point is empty, and a point that already holds a stone draws
     *  the X at full opacity. */
    xmark?: { color: string; alpha: number };
    territory?: { fill?: string; stroke: string };
    /** When present, the ghost only appears at these intersections. */
    only?: Array<{ x: number; y: number }>;
}

export interface NativeLastMove {
    x: number;
    y: number;
    style: "circle" | "plus";
    color: string;
    alpha: number;
    /** Circle radius as a fraction of the cell (plus ignores it). */
    radius: number;
}

/** Absolute polyline in board units: intersection (i, j) is (i, j),
 *  one cell = 1. */
export interface NativePenMark {
    color: string;
    points: number[];
}

export interface NativeBoardSpec {
    width: number;
    height: number;
    bounds: NativeBounds | null;
    labels: NativeLabels;
    labelSystem: "A1" | "1-1";
    board: NativeStone[];
    colorToMove: 1 | 2;
    lastMove: NativeLastMove | null;
    ghost: NativeGhost | null;
    inputMode: "place" | "pen";
    penColor: string | null;
    overlays: NativeOverlay[];
    penMarks: NativePenMark[];
    /** Live pen stroke width as a fraction of the cell. */
    penWidth: number;
}

export interface NativeTheme {
    boardColor: string;
    boardImageUrl: string | null;
    lineColor: string;
    fadedLineColor: string;
    starColor: string;
    fadedStarColor: string;
    labelColor: string;
    backgroundColor: string;
    /** PNG data URLs. Each image covers `stoneImageSize` CSS px square with
     *  the stone centered; shadow (if any) is baked in. */
    blackStones: string[];
    whiteStones: string[];
    stoneImageSize: number;
    /** The CSS cell size the bitmaps were rendered for. */
    cellPx: number;
}

export interface NativeAttachOptions extends NativeBoardSpec {
    id: string;
    rect: NativeRect;
    interactive: boolean;
    theme: NativeTheme;
}

/** Fields omitted are unchanged; lists present are complete. */
export interface NativeUpdateOptions extends Partial<NativeBoardSpec> {
    id: string;
}

export interface NativeIntentPlaceEvent {
    id: string;
    x: number;
    y: number;
    /** How long the finger was down, in milliseconds. During stone removal
     *  a press over 500 ms forces the tapped group's removal state, the way
     *  a shift-click or long press does on the canvas. Omitted means a
     *  plain tap. */
    pressDurationMs?: number;
}

export interface NativeIntentPenEvent {
    id: string;
    color: string;
    /** Absolute [x0, y0, x1, y1, ...] in board units. */
    points: number[];
}

export interface GobanNativeTransport {
    attach(opts: NativeAttachOptions): Promise<void>;
    update(opts: NativeUpdateOptions): Promise<void>;
    move(opts: { id: string; rect: NativeRect }): Promise<void>;
    setTheme(opts: { id: string; theme: NativeTheme }): Promise<void>;
    /** Plain text drawn centered over the board, or null to clear. */
    setMessage(opts: { id: string; text: string | null }): Promise<void>;
    suspend(opts: { id: string }): Promise<{ snapshot: string }>;
    resume(opts: { id: string }): Promise<void>;
    detach(opts: { id: string }): Promise<void>;
    onIntentPlace(cb: (event: NativeIntentPlaceEvent) => void): () => void;
    onIntentPen(cb: (event: NativeIntentPenEvent) => void): () => void;
}
