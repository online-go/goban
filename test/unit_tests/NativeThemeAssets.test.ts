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
    resolveThemes,
    renderStoneAssets,
    buildNativeTheme,
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
});
