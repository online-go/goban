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

import { callbacks } from "../../src/Goban/callbacks";
import { THEMES } from "../../src/Goban/themes";

function makeDefs(): SVGDefsElement {
    return document.createElementNS("http://www.w3.org/2000/svg", "defs");
}

describe("custom image stones", () => {
    afterEach(() => {
        delete callbacks.customBlackStoneUrls;
        delete callbacks.customWhiteStoneUrls;
        delete callbacks.customBlackStoneColor;
        delete callbacks.customWhiteStoneColor;
        callbacks.customBlackStoneUrls = () => [];
        callbacks.customWhiteStoneUrls = () => [];
        jest.restoreAllMocks();
    });

    test("creates one SVG definition per custom URL", () => {
        callbacks.customBlackStoneUrls = () => ["first.png", "second.png"];
        const theme = new THEMES.black.Custom();
        const defs = makeDefs();

        const stones = theme.preRenderBlackSVG(defs, 10, 1, () => undefined);

        expect(stones).toHaveLength(2);
        expect(
            Array.from(defs.querySelectorAll("image")).map((image) =>
                image.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
            ),
        ).toEqual(["first.png", "second.png"]);
    });

    test("uses the solid SVG fallback for an empty custom URL list", () => {
        callbacks.customBlackStoneUrls = () => [];
        const theme = new THEMES.black.Custom();
        const defs = makeDefs();

        const stones = theme.preRenderBlackSVG(defs, 10, 1, () => undefined);

        expect(stones).toHaveLength(1);
        expect(defs.querySelector("image")).toBeNull();
        expect(defs.querySelector("circle")?.getAttribute("fill")).toBe("#000000");
    });

    test("falls back when no custom URL and the cached stone is missing", () => {
        callbacks.customBlackStoneUrls = () => [];
        const theme = new THEMES.black.Custom();
        const ctx = {
            beginPath: jest.fn(),
            arc: jest.fn(),
            stroke: jest.fn(),
            fill: jest.fn(),
        } as unknown as CanvasRenderingContext2D;

        expect(() => theme.placeBlackStone(ctx, null, undefined as never, 10, 10, 5)).not.toThrow();
        expect(ctx.fill).toHaveBeenCalledTimes(1);
    });

    test("selects custom variants deterministically by board coordinate", () => {
        const theme = new THEMES.black.Custom();
        const stones = ["one", "two", "three", "four"];

        expect(theme.getStone(0, 0, stones, undefined as never)).toBe("two");
        expect(theme.getStone(1, 0, stones, undefined as never)).toBe("three");
        expect(theme.getStone(0, 0, stones, undefined as never)).toBe("two");
        expect(theme.getStoneHash(0, 0, stones, undefined as never)).toBe("1");
        expect(theme.getStoneHash(1, 0, stones, undefined as never)).toBe("2");
    });
});
