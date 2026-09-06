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
import { createDeviceScaledCanvas, resizeDeviceScaledCanvas } from "./canvas_utils";
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

/**
 * The number of `color-theme-radius` entries each pre-render cache keeps.
 * A board holds two (black and white) per radius it has been shown at, the
 * move tree two more at its fixed radius, so this covers a handful of boards
 * and a run of resizes. Beyond it the least recently used entry goes: a
 * board being dragged through many sizes otherwise pins a full stone set
 * (dozens of canvases, and their encoded PNGs) for every size it passed
 * through, for the life of the page. The canvas renderer bounds its own
 * stone cache for the same reason, and on iOS canvas memory is scarce.
 */
export const PRE_RENDER_CACHE_CAPACITY = 32;

/** Insertion ordered map that drops its least recently used entry past
 *  `capacity`. A hit moves the entry to the back, so a caller that asks for
 *  the same stones on every redraw (the move tree) is never evicted by a
 *  board that keeps changing size. */
class LRUCache<V> {
    private map = new Map<string, V>();
    constructor(private capacity: number) {}

    get(key: string): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: string, value: V): void {
        this.map.delete(key);
        this.map.set(key, value);
        while (this.map.size > this.capacity) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.map.delete(oldest);
        }
    }

    deleteWhere(predicate: (key: string) => boolean): void {
        for (const key of [...this.map.keys()]) {
            if (predicate(key)) {
                this.map.delete(key);
            }
        }
    }
}

/* Stone objects are cached per theme name + radius exactly as the canvas
 * renderer does, so the deferred (image-loading) themes reuse their in-flight
 * loads and a re-themed or resized goban doesn't re-render what it already
 * has. Keyed by name rather than by theme instance because every setTheme
 * call - including the one a board resize triggers - builds fresh instances. */
const stone_cache = new LRUCache<any>(PRE_RENDER_CACHE_CAPACITY);

/* The encoded PNGs, keyed by everything that decides their pixels. Encoding
 * a full stone set is by far the most expensive part of building a native
 * theme, and a board resize that lands back on the same stone radius asks for
 * byte-identical strings. Only settled stones are cached - see below. */
const asset_cache = new LRUCache<string[]>(PRE_RENDER_CACHE_CAPACITY);

/**
 * Pre-renders (and caches) the stone variants of one theme at one radius.
 * Shared by the native theme assets and the move tree widget so a goban only
 * ever pays for a given theme/radius pair once.
 */
export function preRenderedStones(
    theme: GobanTheme,
    color: "black" | "white",
    radius: number,
    seed: number,
    on_deferred: () => void,
): any {
    const key = `${color}-${theme.theme_name}-${radius}`;
    let stones = stone_cache.get(key);
    if (stones === undefined) {
        stones =
            color === "black"
                ? theme.preRenderBlack(radius, seed, on_deferred)
                : theme.preRenderWhite(radius, seed, on_deferred);
        stone_cache.set(key, stones);
    }
    return stones;
}

/**
 * Drops every cached pre-render belonging to a theme name. The "Custom"
 * themes are the reason this exists: their pixels come from user settings
 * rather than from the name, so the name alone stops identifying the stones
 * as soon as the user edits them. Renderers call this from their selected
 * theme watcher.
 */
export function forgetPreRenderedStones(theme_name: string): void {
    const belongs = (key: string) =>
        key.startsWith(`black-${theme_name}-`) || key.startsWith(`white-${theme_name}-`);
    stone_cache.deleteWhere(belongs);
    asset_cache.deleteWhere(belongs);
}

/**
 * An image backed theme returns stone objects whose pixels arrive later and
 * are drawn into the same objects in place, so the pre-render cache stays
 * correct across the load. The PNGs we encode from them do not: caching those
 * before the images land would freeze the placeholder forever.
 */
function stonesAreSettled(stones: any[]): boolean {
    return stones.every((stone) => !(stone && stone.image_loaded === false));
}

/** The scale `resizeDeviceScaledCanvas` bakes into the bitmaps, read live
 *  because that is how it reads it. */
function pixelRatio(): number {
    return (typeof window !== "undefined" && window.devicePixelRatio) || 1;
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
    const dpr = pixelRatio();
    const render = (theme: GobanTheme, color: "black" | "white"): string[] => {
        const cache_key = `${color}-${theme.theme_name}-${radius}-${dpr}`;
        const cached = asset_cache.get(cache_key);
        if (cached) {
            return cached;
        }
        const stones = preRenderedStones(
            theme,
            color,
            radius,
            color === "black" ? 2081 : 23434,
            on_deferred,
        );
        const list = Array.isArray(stones) ? stones : [stones];
        const casts_shadow = theme.stoneCastsShadow(radius);
        const encoded = list.map((stone: any) => {
            const canvas = createDeviceScaledCanvas(side, side);
            resizeDeviceScaledCanvas(canvas, side, side);
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
        if (stonesAreSettled(list)) {
            asset_cache.set(cache_key, encoded);
        }
        return encoded;
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
