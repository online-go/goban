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

import { THEMES } from "../../src/Goban/themes";
import { clearAboveColor } from "../../src/Goban/themes/rendered_stones";

function makeDefs(): SVGDefsElement {
    return document.createElementNS("http://www.w3.org/2000/svg", "defs");
}

/* WebKit throws this from getImageData when it cannot read back the canvas
 * backing store, for example when the canvas memory limit is exhausted. */
function failGetImageData(name: string = "InvalidStateError"): jest.SpyInstance {
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    return jest.spyOn(Object.getPrototypeOf(ctx), "getImageData").mockImplementation(() => {
        throw new DOMException(`getImageData failed: ${name}`, name);
    });
}

describe("rendered stones", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        ["white", "Shell"],
        ["white", "Glass"],
        ["black", "Slate"],
        ["black", "Glass"],
    ] as const)("%s %s pre-renders when getImageData throws InvalidStateError", (color, name) => {
        failGetImageData();
        const theme = new THEMES[color][name]();
        const defs = makeDefs();
        /* Use a radius no other test uses so the render cache is cold. */
        const radius = 17.25;

        const ids =
            color === "white"
                ? theme.preRenderWhiteSVG(defs, radius, 1, () => undefined)
                : theme.preRenderBlackSVG(defs, radius, 1, () => undefined);

        expect(ids.length).toBeGreaterThan(0);
        expect(defs.querySelectorAll("image")).toHaveLength(ids.length);
    });

    test("clearAboveColor clears the canvas when getImageData throws InvalidStateError", () => {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.fillStyle = "rgba(255,255,255,1.0)";
        ctx.fillRect(0, 0, 4, 4);

        const spy = failGetImageData();
        expect(() => clearAboveColor(ctx, 4, 4, 150, 150, 150)).not.toThrow();
        spy.mockRestore();

        const data = ctx.getImageData(0, 0, 4, 4).data;
        expect(Array.from(data).every((v) => v === 0)).toBe(true);
    });

    test("other getImageData errors still propagate", () => {
        failGetImageData("IndexSizeError");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

        expect(() => clearAboveColor(ctx, 4, 4, 150, 150, 150)).toThrow("IndexSizeError");
    });
});
