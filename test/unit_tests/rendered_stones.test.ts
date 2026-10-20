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

    test("an unshaded stone is not cached", () => {
        const theme = new THEMES.white.Glass();
        const radius = 18.25;
        const centerPixel = (canvas: HTMLCanvasElement) => {
            const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
            const c = Math.floor(canvas.width / 2);
            return Array.from(ctx.getImageData(c, c, 1, 1).data);
        };

        const spy = failGetImageData();
        const flat = theme.preRenderWhite(radius, 1, () => undefined)[0].stone;
        spy.mockRestore();
        const shaded = theme.preRenderWhite(radius, 1, () => undefined)[0].stone;

        expect(shaded).not.toBe(flat);
        expect(centerPixel(shaded)).not.toEqual(centerPixel(flat));
    });

    test.each([
        ["white", "Shell"],
        ["white", "Glass"],
        ["black", "Slate"],
        ["black", "Glass"],
    ] as const)("%s %s SVG uses vector stones when toDataURL returns data:,", (color, name) => {
        /* WebKit returns "data:," when it cannot encode the canvas. */
        jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,");
        const theme = new THEMES[color][name]();
        const defs = makeDefs();
        const radius = 19.25;

        const ids =
            color === "white"
                ? theme.preRenderWhiteSVG(defs, radius, 1, () => undefined)
                : theme.preRenderBlackSVG(defs, radius, 1, () => undefined);

        expect(ids.length).toBeGreaterThan(0);
        expect(defs.querySelectorAll("image")).toHaveLength(0);
        for (const id of ids) {
            const circle = defs.querySelector(`[id="${id}"] circle`);
            expect(circle?.getAttribute("r")).toBe(`${radius}`);
            expect(circle?.getAttribute("fill")).toBe(`url(#${id}-gradient)`);
            expect(defs.querySelectorAll(`[id="${id}-gradient"] stop`).length).toBeGreaterThan(2);
        }
    });

    /* The vector stone samples the same lighting model as the canvas stone,
     * so each gradient stop must match the canvas pixel at the same point. */
    test.each([
        ["white", "Glass"],
        ["black", "Glass"],
        ["black", "Slate"],
        ["white", "Night"],
    ] as const)("%s %s vector stone matches the shaded canvas stone", (color, name) => {
        const theme = new THEMES[color][name]();
        const radius = 40;
        const stone =
            color === "white"
                ? theme.preRenderWhite(radius, 1, () => undefined)[0].stone
                : theme.preRenderBlack(radius, 1, () => undefined)[0].stone;
        const pixels = (stone.getContext("2d") as CanvasRenderingContext2D).getImageData(
            0,
            0,
            stone.width,
            stone.height,
        );

        jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,");
        const defs = makeDefs();
        const [id] =
            color === "white"
                ? theme.preRenderWhiteSVG(defs, radius, 1, () => undefined)
                : theme.preRenderBlackSVG(defs, radius, 1, () => undefined);
        const gradient = defs.querySelector(`[id="${id}-gradient"]`) as SVGElement;

        /* Gradient coordinates are fractions of the stone's bounding box. */
        const fx = (Number(gradient.getAttribute("fx")) - 0.5) * 2 * radius;
        const fy = (Number(gradient.getAttribute("fy")) - 0.5) * 2 * radius;
        const len = Math.hypot(fx, fy);
        const ex = (-fx / len) * radius;
        const ey = (-fy / len) * radius;
        const center = Math.ceil(radius) + 0.5;

        const stops = Array.from(gradient.querySelectorAll("stop"));
        expect(stops.length).toBeGreaterThan(2);
        for (const stop of stops.slice(0, -1)) {
            const t = parseFloat(stop.getAttribute("offset") as string) / 100;
            const px = Math.round(center + fx + t * (ex - fx));
            const py = Math.round(center + fy + t * (ey - fy));
            const actual = (stop.getAttribute("stop-color")?.match(/\d+/g) ?? []).map(Number);

            /* The stop is between pixel centers, and the specular highlight is
             * steep, so compare with the closest pixel next to the point. */
            let diff = Infinity;
            for (let dy = -1; dy <= 1; ++dy) {
                for (let dx = -1; dx <= 1; ++dx) {
                    const idx = ((py + dy) * stone.width + px + dx) * 4;
                    diff = Math.min(
                        diff,
                        Math.max(...actual.map((v, i) => Math.abs(v - pixels.data[idx + i]))),
                    );
                }
            }
            expect(diff).toBeLessThanOrEqual(6);
        }
    });
});
