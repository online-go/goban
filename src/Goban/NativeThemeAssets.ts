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

import { GobanTheme, THEMES } from "./themes";
import { GobanSelectedThemes } from "./Goban";
import { createDeviceScaledCanvas } from "./canvas_utils";
import { NativeTheme } from "./NativeTransport";

export interface ResolvedThemes {
    board: GobanTheme;
    black: GobanTheme;
    white: GobanTheme;
    themes: GobanSelectedThemes;
}

export function resolveThemes(themes: GobanSelectedThemes): ResolvedThemes {
    const BoardTheme = THEMES["board"]?.[themes.board] || THEMES["board"]["Plain"];
    const WhiteTheme = THEMES["white"]?.[themes.white] || THEMES["white"]["Plain"];
    const BlackTheme = THEMES["black"]?.[themes.black] || THEMES["black"]["Plain"];
    const board = new BoardTheme();
    return { board, white: new WhiteTheme(board), black: new BlackTheme(board), themes };
}

/* Stone objects are cached per theme+radius exactly as the canvas renderer
 * does, so the deferred (image-loading) themes reuse their in-flight loads. */
const stone_cache: { [key: string]: any } = {};

function preRendered(
    theme: GobanTheme,
    color: "black" | "white",
    radius: number,
    seed: number,
    on_deferred: () => void,
): any {
    const key = `${color}-${theme.theme_name}-${radius}`;
    if (!(key in stone_cache)) {
        stone_cache[key] =
            color === "black"
                ? theme.preRenderBlack(radius, seed, on_deferred)
                : theme.preRenderWhite(radius, seed, on_deferred);
    }
    return stone_cache[key];
}

/**
 * Renders every variant of the selected stone themes into a square canvas
 * of 3 radii (stone centered, shadow baked in when the theme casts one at
 * this radius) and returns PNG data URLs. The canvas is device scaled, so
 * the PNG carries devicePixelRatio resolution.
 */
export function renderStoneAssets(
    resolved: ResolvedThemes,
    radius: number,
    cell_px: number,
    on_deferred: () => void,
): { blackStones: string[]; whiteStones: string[]; stoneImageSize: number } {
    void cell_px;
    const side = Math.ceil(radius * 3);
    const render = (theme: GobanTheme, color: "black" | "white"): string[] => {
        const stones = preRendered(
            theme,
            color,
            radius,
            color === "black" ? 2081 : 23434,
            on_deferred,
        );
        const list = Array.isArray(stones) ? stones : [stones];
        const casts_shadow = theme.stoneCastsShadow(radius);
        return list.map((stone: any) => {
            const canvas = createDeviceScaledCanvas(side, side);
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) {
                throw new Error("no 2d context for stone asset");
            }
            const c = side / 2;
            if (color === "black") {
                theme.placeBlackStone(ctx, casts_shadow ? ctx : null, stone, c, c, radius);
            } else {
                theme.placeWhiteStone(ctx, casts_shadow ? ctx : null, stone, c, c, radius);
            }
            return canvas.toDataURL("image/png");
        });
    };
    return {
        blackStones: render(resolved.black, "black"),
        whiteStones: render(resolved.white, "white"),
        stoneImageSize: side,
    };
}

function textureUrl(board: GobanTheme): string | null {
    const image = board.getBackgroundCSS()["background-image"] || "";
    const m = image.match(/url\(['"]?([^'")]+)['"]?\)/);
    return m ? m[1] : null;
}

export function buildNativeTheme(
    resolved: ResolvedThemes,
    radius: number,
    cell_px: number,
    surround: string,
    on_deferred: () => void,
): NativeTheme {
    const assets = renderStoneAssets(resolved, radius, cell_px, on_deferred);
    const board = resolved.board;
    return {
        boardColor: board.getBackgroundCSS()["background-color"] || "#DCB35C",
        boardImageUrl: textureUrl(board),
        lineColor: board.getLineColor(),
        fadedLineColor: board.getFadedLineColor(),
        starColor: board.getStarColor(),
        fadedStarColor: board.getFadedStarColor(),
        labelColor: board.getLabelTextColor(),
        backgroundColor: surround,
        blackStones: assets.blackStones,
        whiteStones: assets.whiteStones,
        stoneImageSize: assets.stoneImageSize,
        cellPx: cell_px,
    };
}
