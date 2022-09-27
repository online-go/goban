/*
 * Copyright 2012-2020 Online-Go.com
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

import { GoTheme } from "../GoTheme";
import { GoThemesInterface } from "../GoThemes";
import { _ } from "../translate";
import { deviceCanvasScalingRatio } from "../GoUtil";

type StoneType = { stone: HTMLCanvasElement; shadow: HTMLCanvasElement };
type StoneTypeArray = Array<StoneType>;
interface RenderOptions {
    base_color: string;
    light: vec3;
    ambient: number;
    shell_lines?: boolean;
    specular_hardness: number;
    diffuse_light_distance: number;
    specular_light_distance: number;
}

/**
 * Converts an RGB color value to HSL. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 *
 * @param   Number  r       The red color value
 * @param   Number  g       The green color value
 * @param   Number  b       The blue color value
 * @return  Array           The HSL representation
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = NaN;
    let s = NaN;
    const l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }

    return [h, s, l];
}

/**
 * Converts an HSL color value to RGB. Conversion formula
 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
 * Assumes h, s, and l are contained in the set [0, 1] and
 * returns r, g, and b in the set [0, 255].
 *
 * @param   Number  h       The hue
 * @param   Number  s       The saturation
 * @param   Number  l       The lightness
 * @return  Array           The RGB representation
 */

function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) {
        t += 1;
    }
    if (t > 1) {
        t -= 1;
    }
    if (t < 1 / 6) {
        return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
        return q;
    }
    if (t < 2 / 3) {
        return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r;
    let g;
    let b;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.min(255, r * 255), Math.min(255, g * 255), Math.min(255, b * 255)];
}

type vec3 = [number, number, number];
function add(A: vec3, B: vec3): vec3 {
    return [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
}
function dot(A: vec3, B: vec3): number {
    return A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
}
function scale(A: vec3, x: number): vec3 {
    return [A[0] * x, A[1] * x, A[2] * x];
}
function length(A: vec3): number {
    return Math.sqrt(dot(A, A));
}
function normalized(A: vec3): vec3 {
    return scale(A, 1 / length(A));
}
function stone_normal(x: number, y: number, radius: number): vec3 {
    let z = Math.sqrt(Math.max(0, radius * radius - x * x - y * y));

    const ret = normalized([x, y, z]);
    z = ret[2];
    ret[2] = z * z * (3 - 2 * z); /* scurve3 */
    //ret[2] = z*z*z*(z*(z*6-15)+10); /* scurve5 */

    return ret;
}
function square_size(radius: number, scaled: boolean): number {
    return 2 * Math.ceil(radius) + (scaled ? 0 : 1);
}
function stone_center_in_square(radius: number, scaled: boolean): number {
    return Math.ceil(radius) + (scaled ? 0 : 0.5);
}
function copyAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): Array<number> {
    if (width <= 0 || height <= 0) {
        throw "Invalid width/height given: " + (width + "x" + height);
    }

    const image = ctx.getImageData(0, 0, width, height);
    const ret = new Array(width * height);
    let idx = 0;
    let i = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            ret[i] = image.data[idx + 3];
            idx += 4;
            ++i;
        }
    }
    return ret;
}
function pasteAlpha(
    ctx: CanvasRenderingContext2D,
    alpha: Array<number>,
    width: number,
    height: number,
): void {
    const image = ctx.getImageData(0, 0, width, height);
    let idx = 0;
    let i = 0;

    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            image.data[idx + 3] = alpha[i];
            idx += 4;
            ++i;
        }
    }
    ctx.putImageData(image, 0, 0);
}
function applyPhongShading(
    ctx: CanvasRenderingContext2D,
    ss: number,
    center: number,
    radius: number,
    ambient: number,
    specular_hardness: number,
    diffuse_light_distance: number,
    specular_light_distance: number,
    light: vec3,
) {
    const image = ctx.getImageData(0, 0, ss, ss);

    const r2 = (radius + 1) * (radius + 1); /* alpha will save us from overrunning the image*/
    const look: vec3 = [0, 0, 1];

    let idx = 0;
    for (let y = -center; y < ss - center; ++y) {
        for (let x = -center; x < ss - center; ++x) {
            const xxyy = x * x + y * y;
            if (xxyy < r2) {
                const r = image.data[idx];
                const g = image.data[idx + 1];
                const b = image.data[idx + 2];

                const N = stone_normal(x, y, radius);
                const diffuse_intensity = dot(N, light) / diffuse_light_distance;
                const H = normalized(add(light, look));
                const specular_intensity =
                    Math.pow(dot(N, H), specular_hardness) / specular_light_distance;

                const hsl = rgbToHsl(r, g, b);
                hsl[2] = Math.min(
                    1,
                    hsl[2] * (ambient + diffuse_intensity) +
                        diffuse_intensity * 0.5 +
                        specular_intensity,
                );
                const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);

                image.data[idx] = rgb[0];
                image.data[idx + 1] = rgb[1];
                image.data[idx + 2] = rgb[2];
            }

            idx += 4;
        }
    }

    ctx.putImageData(image, 0, 0);
}
export function clearAboveColor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
): void {
    const image = ctx.getImageData(0, 0, width, height);

    let idx = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            if (image.data[idx + 0] > r && image.data[idx + 1] > g && image.data[idx + 2] > b) {
                image.data[idx + 0] = 0;
                image.data[idx + 1] = 0;
                image.data[idx + 2] = 0;
                image.data[idx + 3] = 0;
            }

            idx += 4;
        }
    }

    ctx.putImageData(image, 0, 0);
}

export function renderShadow(
    shadow_ctx: CanvasRenderingContext2D,
    center: number,
    radius: number,
    sss: number,
    blur: number = 0.15,
    shadowColor: string = "rgba(60,60,60,0.7)",
): void {
    shadow_ctx.beginPath();
    shadow_ctx.shadowColor = shadowColor;
    shadow_ctx.shadowBlur = radius * blur;
    shadow_ctx.shadowOffsetX = radius * 0.2;
    shadow_ctx.shadowOffsetY = radius * 0.2;
    shadow_ctx.fillStyle = "rgba(255,255,255,1.0)";
    /* here we draw the circle a little up and to the left so we don't have any
     * funky problems when we mask out the shadow and apply it underneath the
     * stone. (Without this we tend to see some funny artifacts) */
    //shadow_ctx.arc(radius*0.97, radius*0.97, radius*0.97, 0, 2*Math.PI, false);
    shadow_ctx.arc(center, center, Math.max(radius * 0.9, 0.1), 0, 2 * Math.PI, false);
    shadow_ctx.fill();
    clearAboveColor(shadow_ctx, sss, sss, 150, 150, 150);
}

function preRenderStone(radius: number, seed: number, options: RenderOptions): StoneTypeArray {
    const dcsr = deviceCanvasScalingRatio();
    radius *= dcsr;
    radius = Math.max(0.1, radius);

    const ss = square_size(radius, dcsr !== 1.0);
    const center = stone_center_in_square(radius, dcsr !== 1.0);
    const sss = radius * 2.5; /* Shadow square size */

    let stone: HTMLCanvasElement;
    let shadow: HTMLCanvasElement;
    let ctx;
    let shadow_ctx;
    if (typeof document !== "undefined") {
        stone = document.createElement("canvas");
        stone.setAttribute("width", ss + "px");
        stone.setAttribute("height", ss + "px");
        shadow = document.createElement("canvas");
        shadow.setAttribute("width", sss + "px");
        shadow.setAttribute("height", sss + "px");
        //stone = createDeviceScaledCanvas(ss, ss);
        //shadow = createDeviceScaledCanvas(sss, sss);
        ctx = stone.getContext("2d");
        shadow_ctx = shadow.getContext("2d");

        if (!ctx) {
            throw new Error("Error getting stone context 2d");
        }
        if (!shadow_ctx) {
            throw new Error("Error getting shadow context 2d");
        }
    } else {
        throw new Error(
            "Backend server rendering has been removed, should be easy to re-enable if we still need it though (code is here, just needs wiring up again)",
        );
    }

    /*
    } else {
        var Canvas = require('canvas');
        stone = new Canvas(ss,ss);
        shadow = new Canvas(sss,sss);
        ctx = stone.getContext('2d');
        shadow_ctx = shadow.getContext('2d');
    }
    */
    ctx.clearRect(0, 0, ss, ss);
    shadow_ctx.clearRect(0, 0, sss, sss);

    //var fillColor = color === 'white' ? 'rgba(207,205,206,1.0)' : 'rgba(25,25,27,1.0)';
    const fillColor = options.base_color;

    ctx.beginPath();
    ctx.fillStyle = fillColor;
    ctx.arc(center, center, radius, 0, 2 * Math.PI, false);
    ctx.fill();
    /* draw clamshell lines */
    if (options.shell_lines) {
        try {
            const alphas = copyAlpha(ctx, ss, ss);
            const nlines = 5 + (seed % 5);
            let angle = ((seed % 160) + 10) * 0.0174532925; /* -> radians */
            if (seed & 0x100) {
                angle = -angle;
            }

            const sep = radius / (nlines * 2);
            const rise = Math.cos(angle);
            const run = Math.sin(angle);
            const m = rise / run;
            const minv = run / rise;

            let minv2_1 = minv * minv - 1;
            minv2_1 = Math.abs(minv2_1);

            let s = seed;
            const rstep = Math.round(radius * 0.1);

            ctx.save();

            let r = -radius;
            const base_line_width = radius * 0.07;
            for (let i = 0; i < nlines * 4; ++i) {
                for (let neg = 0; neg < 2; ++neg) {
                    r += sep + (s % rstep);

                    const xp = Math.sqrt((r * r) / minv2_1);
                    const yp = minv * xp;
                    const b = (neg ? -1 : 1) * yp - m * xp;

                    const sx = 0;
                    const ex = radius * 2;
                    const sy = m * sx + b;
                    const ey = m * ex + b;
                    s = (s * 97) >> 3;

                    ctx.beginPath();
                    const clr = "rgba(194,191,198," + (s % 10) / 10.0 + ")";
                    //var clr = 'rgba(185,181,188,' + ((s%10)/10.0) + ')';
                    //ctx.strokeStyle = 'rgba(209,204,208,1.0)';
                    ctx.strokeStyle = clr;
                    //ctx.shadowColor='rgba(176,172,175,' + ((s%10)/10.0) + ')';
                    ctx.shadowColor = clr;
                    ctx.shadowBlur = ((s % 3) + 1) * base_line_width;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                    s = (s * 51) >> 3;
                    ctx.lineWidth = base_line_width * 0.5;
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                }
            }

            ctx.restore();
            pasteAlpha(ctx, alphas, ss, ss); /* this fixes any line overruns */
        } catch (e) {
            console.log(e);
        }
    }

    applyPhongShading(
        ctx,
        ss,
        center,
        radius,
        options.ambient,
        options.specular_hardness,
        options.diffuse_light_distance,
        options.specular_light_distance,
        options.light,
    );

    if (!stoneCastsShadow(radius)) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(100,100,100,0.3)";
        ctx.lineWidth = radius * 0.15;
        ctx.arc(center, center, radius, (Math.PI / 2) * 0.25, (Math.PI / 2) * 0.75, false);
        ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = "rgba(100,100,100,0.5)";
        ctx.arc(center, center, radius, 0, Math.PI / 2, false);
        ctx.stroke();
    }

    renderShadow(shadow_ctx, center, radius, sss);

    return [{ stone: stone, shadow: shadow }];
}
function placeRenderedStone(
    ctx: CanvasRenderingContext2D,
    shadow_ctx: CanvasRenderingContext2D | null,
    stone: StoneType,
    cx: number,
    cy: number,
    radius: number,
): void {
    const dcsr = deviceCanvasScalingRatio();
    if (dcsr !== 1.0) {
        const center = stone_center_in_square(radius * dcsr, true) / dcsr;
        const ss = square_size(radius * dcsr, true) / dcsr;

        const sx = cx - center;
        const sy = cy - center;

        if (shadow_ctx) {
            shadow_ctx.drawImage(stone.shadow, sx, sy, radius * 2.5, radius * 2.5);
        }
        ctx.drawImage(stone.stone, sx, sy, ss, ss);
    } else {
        const center = stone_center_in_square(radius, false);

        const sx = cx - center;
        const sy = cy - center;

        if (shadow_ctx) {
            shadow_ctx.drawImage(stone.shadow, sx, sy);
        }
        ctx.drawImage(stone.stone, sx, sy);
    }
}
function stoneCastsShadow(radius: number): boolean {
    return radius >= 10;
}

export default function (GoThemes: GoThemesInterface) {
    class Common extends GoTheme {
        stoneCastsShadow(radius: number): boolean {
            return stoneCastsShadow(radius * deviceCanvasScalingRatio());
        }
        placeBlackStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            placeRenderedStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
        placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            placeRenderedStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
    }

    /* Slate & Shell { */
    class Slate extends Common {
        sort() {
            return 30;
        }
        get theme_name(): string {
            return "Slate";
        }

        preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(30,30,35,1.0)",
                light: normalized([-4, -4, 5]),
                ambient: 0.85,
                specular_hardness: 17,
                diffuse_light_distance: 10,
                specular_light_distance: 8,
            });
        }
        getBlackTextColor(color: string): string {
            return "#ffffff";
        }
    }

    _("Slate"); // ensure translation
    GoThemes["black"]["Slate"] = Slate;

    class Shell extends Common {
        sort() {
            return 30;
        }
        get theme_name(): string {
            return "Shell";
        }

        preRenderWhite(radius: number, seed: number): StoneTypeArray {
            let ret: StoneTypeArray = [];
            for (let i = 0; i < 10; ++i) {
                ret = ret.concat(
                    preRenderStone(radius, (seed *= 13), {
                        base_color: "rgba(207,205,206,1.0)",
                        light: normalized([-4, -4, 2]),
                        shell_lines: true,
                        ambient: 1.0,
                        specular_hardness: 24,
                        diffuse_light_distance: 7,
                        specular_light_distance: 100,
                    }),
                );
            }
            return ret;
        }

        getWhiteTextColor(color: string): string {
            return "#000000";
        }
    }
    _("Shell"); // ensure translation
    GoThemes["white"]["Shell"] = Shell;

    /* Glass { */

    class GlassBlack extends Common {
        sort() {
            return 20;
        }
        get theme_name(): string {
            return "Glass";
        }

        preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 30,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        getBlackTextColor(color: string): string {
            return "#ffffff";
        }
    }

    _("Glass"); // ensure translation
    GoThemes["black"]["Glass"] = GlassBlack;

    class GlassWhite extends Common {
        sort() {
            return 20;
        }
        get theme_name(): string {
            return "Glass";
        }

        preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(207,205,206,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 80,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        getWhiteTextColor(color: string): string {
            return "#000000";
        }
    }

    GoThemes["white"]["Glass"] = GlassWhite;

    /* Worn Glass { */

    class WornGlassBlack extends Common {
        sort() {
            return 21;
        }
        get theme_name(): string {
            return "Worn Glass";
        }

        preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 20,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        getBlackTextColor(color: string): string {
            return "#ffffff";
        }
    }

    _("Worn Glass"); // ensure translation
    GoThemes["black"]["Worn Glass"] = WornGlassBlack;

    class WornGlassWhite extends Common {
        sort() {
            return 21;
        }
        get theme_name(): string {
            return "Worn Glass";
        }

        preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(189,189,194,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 35,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        getWhiteTextColor(color: string): string {
            return "#000000";
        }
    }
    GoThemes["white"]["Worn Glass"] = WornGlassWhite;

    /* Night { */
    class NightBlack extends Common {
        sort() {
            return 100;
        }
        get theme_name(): string {
            return "Night";
        }

        preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 5,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        getBlackTextColor(color: string): string {
            return "#888888";
        }
    }

    _("Night"); // ensure translation
    GoThemes["black"]["Night"] = NightBlack;

    class NightWhite extends Common {
        sort() {
            return 100;
        }
        get theme_name(): string {
            return "Night";
        }

        preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(100,100,100,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 13,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        getWhiteTextColor(color: string): string {
            return "#000000";
        }
    }
    GoThemes["white"]["Night"] = NightWhite;
}
