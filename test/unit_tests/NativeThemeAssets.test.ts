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

import { loadImage } from "canvas";

import {
    resolveThemes,
    renderStoneAssets,
    buildNativeTheme,
    preRenderedStones,
    PRE_RENDER_CACHE_CAPACITY,
} from "../../src/Goban/NativeThemeAssets";

const themes = {
    "board": "Plain",
    "white": "Shell",
    "black": "Slate",
    "removal-graphic": "x",
    "removal-scale": 1.0,
    "stone-scale": 1.0,
    "stone-shadows": "default",
} as const;

describe("NativeThemeAssets", () => {
    test("renders one PNG per stone variant covering 3 radii", () => {
        const resolved = resolveThemes(themes as any);
        const assets = renderStoneAssets(resolved, 12, 25, () => undefined);
        expect(assets.stoneImageSize).toBe(36);
        expect(assets.blackStones.length).toBeGreaterThan(0);
        expect(assets.whiteStones.length).toBeGreaterThan(0);
        for (const url of [...assets.blackStones, ...assets.whiteStones]) {
            expect(url.startsWith("data:image/png;base64,")).toBe(true);
            expect(url.length).toBeGreaterThan(100);
        }
    });

    test("theme carries the board colors and the surround", () => {
        const resolved = resolveThemes(themes as any);
        const theme = buildNativeTheme(resolved, 12, 25, "#123456", () => undefined);
        expect(theme.boardColor).toBe("#DCB35C");
        expect(theme.boardImageUrl).toBeNull();
        expect(theme.lineColor).toBe("#000000");
        expect(theme.backgroundColor).toBe("#123456");
        expect(theme.cellPx).toBe(25);
    });

    test("image board themes expose their texture url", () => {
        const resolved = resolveThemes({ ...themes, board: "Kaya" } as any);
        const theme = buildNativeTheme(resolved, 12, 25, "#000000", () => undefined);
        expect(theme.boardImageUrl).toMatch(/kaya\.jpg$/);
    });

    test("a second identical render reuses the encoded PNGs", () => {
        const resolved = resolveThemes(themes as any);
        /* Radius 17 is used by no other test in this file, so the first call
         * here is guaranteed to be a cache miss. */
        const first = renderStoneAssets(resolved, 17, 35, () => undefined);

        const proto = (global as any).HTMLCanvasElement.prototype;
        const encode = jest.spyOn(proto, "toDataURL");
        const second = renderStoneAssets(resolveThemes(themes as any), 17, 35, () => undefined);

        expect(encode).not.toHaveBeenCalled();
        expect(second.blackStones).toEqual(first.blackStones);
        expect(second.whiteStones).toEqual(first.whiteStones);
        encode.mockRestore();
    });

    test("the caches are bounded and keep what is used", () => {
        /* Plain stones keep this cheap: one variant per color. Radii from
         * 200 up are used by no other test, so every render below is a miss
         * until the cache says otherwise. */
        const plain = resolveThemes({ ...themes, white: "Plain", black: "Plain" } as any);
        const first = preRenderedStones(plain.black, "black", 200, 2081, () => undefined);
        renderStoneAssets(plain, 200, 400, () => undefined);

        /* Each render inserts a black and a white entry; walk enough other
         * radii to fill the cache while touching radius 200's stones on the
         * way, as the move tree does with its own on every redraw. */
        for (let i = 0; i < PRE_RENDER_CACHE_CAPACITY; i++) {
            renderStoneAssets(plain, 201 + i, 400, () => undefined);
            preRenderedStones(plain.black, "black", 200, 2081, () => undefined);
        }
        expect(preRenderedStones(plain.black, "black", 200, 2081, () => undefined)).toBe(first);

        /* The untouched white entry at radius 200 was evicted and renders anew. */
        const white_before = preRenderedStones(plain.white, "white", 200, 23434, () => undefined);
        expect(preRenderedStones(plain.white, "white", 200, 23434, () => undefined)).toBe(
            white_before,
        );
        const proto = (global as any).HTMLCanvasElement.prototype;
        const encode = jest.spyOn(proto, "toDataURL");
        renderStoneAssets(plain, 200, 400, () => undefined);
        expect(encode).toHaveBeenCalled();
        encode.mockRestore();
    });

    describe("devicePixelRatio scaling", () => {
        afterEach(() => {
            Object.defineProperty(window, "devicePixelRatio", {
                value: 1,
                configurable: true,
            });
        });

        test("bakes stone bitmaps at devicePixelRatio resolution", async () => {
            Object.defineProperty(window, "devicePixelRatio", {
                value: 2,
                configurable: true,
            });

            const resolved = resolveThemes(themes as any);
            const assets = renderStoneAssets(resolved, 12, 25, () => undefined);
            const image = await loadImage(assets.blackStones[0]);
            expect(image.width).toBe(2 * assets.stoneImageSize);
            expect(image.height).toBe(2 * assets.stoneImageSize);
        });
    });
});
