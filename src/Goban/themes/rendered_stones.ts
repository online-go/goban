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

import { GobanTheme } from "./GobanTheme";
import { ThemesInterface } from "./";
import { _ } from "../../engine/translate";
import { deviceCanvasScalingRatio, allocateCanvasOrError } from "../canvas_utils";

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

/*
function seedRandomFloat(seed: number, min: number, max: number): number {
    const n = Math.abs(((seed * 9301 + 49297) % 233280) / 233280);
    return min + n * (max - min);
}
*/

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

const render_cache: { [key: string]: StoneTypeArray } = {};

function preRenderStone(radius: number, seed: number, options: RenderOptions): StoneTypeArray {
    const cache_key = `${radius}-${seed}-${options.base_color}-${options.light}-${options.ambient}-${options.specular_hardness}-${options.diffuse_light_distance}-${options.specular_light_distance}`;
    if (render_cache[cache_key]) {
        return render_cache[cache_key];
    }

    // cspell: words dcsr
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
        stone = allocateCanvasOrError(`${ss}px`, `${ss}px`);
        shadow = allocateCanvasOrError(`${sss}px`, `${sss}px`);
        ctx = stone.getContext("2d", { willReadFrequently: true });
        shadow_ctx = shadow.getContext("2d", { willReadFrequently: true });

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
            const n_lines = 5 + (seed % 5);
            let angle = ((seed % 160) + 10) * 0.0174532925; /* -> radians */
            if (seed & 0x100) {
                angle = -angle;
            }

            const sep = radius / (n_lines * 2);
            const rise = Math.cos(angle);
            const run = Math.sin(angle);
            const m = rise / run;
            const min_v = run / rise;

            let min_v2_1 = min_v * min_v - 1;
            min_v2_1 = Math.abs(min_v2_1);

            let s = seed;
            const r_step = Math.round(radius * 0.1);

            ctx.save();

            let r = -radius;
            const base_line_width = radius * 0.07;
            for (let i = 0; i < n_lines * 4; ++i) {
                for (let neg = 0; neg < 2; ++neg) {
                    r += sep + (s % r_step);

                    const xp = Math.sqrt((r * r) / min_v2_1);
                    const yp = min_v * xp;
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

    render_cache[cache_key] = [{ stone: stone, shadow: shadow }];
    return render_cache[cache_key];
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

export default function (THEMES: ThemesInterface) {
    class Common extends GobanTheme {
        override stoneCastsShadow(radius: number): boolean {
            return stoneCastsShadow(radius * deviceCanvasScalingRatio());
        }
        override placeBlackStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            placeRenderedStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
        override placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            placeRenderedStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }

        public preRenderSVG(
            defs: SVGDefsElement,
            radius: number,
            rendered: StoneTypeArray,
            _deferredRenderCallback: () => void,
        ): string[] {
            const ret = [];
            for (let i = 0; i < rendered.length; ++i) {
                const id = this.def_uid(`white-shell-${i}-${radius}`);

                const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
                img.setAttribute("id", id);
                //img.setAttribute("width", rendered[i].stone.width.toString());
                //img.setAttribute("height", rendered[i].stone.height.toString());
                img.setAttribute("width", `${Math.ceil(radius * 2)}`);
                img.setAttribute("height", `${Math.ceil(radius * 2)}`);
                img.setAttribute("x", "0");
                img.setAttribute("y", "0");
                img.setAttributeNS(
                    "http://www.w3.org/1999/xlink",
                    "href",
                    rendered[i].stone.toDataURL(),
                );

                defs.appendChild(img);
                ret.push(id);
            }
            return ret;
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            //radius = Math.ceil(radius * 2) / 2;
            const rendered = this.preRenderWhite(radius, seed, _deferredRenderCallback);
            return this.preRenderSVG(defs, radius, rendered, _deferredRenderCallback);
        }

        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            //radius = Math.ceil(radius * 2) / 2;
            const rendered = this.preRenderBlack(radius, seed, _deferredRenderCallback);
            return this.preRenderSVG(defs, radius, rendered, _deferredRenderCallback);
        }
    }

    /* Slate & Shell { */
    class Slate extends Common {
        override sort() {
            return 30;
        }
        override get theme_name(): string {
            return "Slate";
        }

        override preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(30,30,35,1.0)",
                light: normalized([-4, -4, 5]),
                ambient: 0.85,
                specular_hardness: 17,
                diffuse_light_distance: 10,
                specular_light_distance: 8,
            });
        }
        override getBlackTextColor(color: string): string {
            return "#ffffff";
        }
        /*
        public preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const ret = [];
            const key = this.def_uid(`black-slate-${radius}`);
            ret.push(key);
            defs.appendChild(
                this.renderSVG(
                    {
                        id: key,
                        //fill: "hsl(8, 7%, 10%)",
                        stroke: "hsl(8, 7%, 10%)",
                        gradient: {
                            stops: [
                                {
                                    offset: 0,
                                    color: "hsl(8, 7%, 40%)",
                                },
                                {
                                    offset: 1000,
                                    color: "hsl(8, 7%, 10%)",
                                },
                            ],
                        },
                    },
                    radius,
                ),
            );
            return ret;
        }
        */
    }

    _("Slate"); // ensure translation
    THEMES["black"]["Slate"] = Slate;

    class Shell extends Common {
        override sort() {
            return 30;
        }
        override get theme_name(): string {
            return "Shell";
        }

        override preRenderWhite(radius: number, seed: number): StoneTypeArray {
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

        /*
        public preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const ret = [];
            let s = seed;

            for (let i = 0; i < 20; ++i) {
                const key = this.def_uid(`white-shell-${i}-${radius}`);
                ret.push(key);

                const stone = this.renderSVG(
                    {
                        id: key,
                        //stroke: "hsl(8, 7%, 50%)",
                        //stroke_scale: 0.04,
                        gradient: {
                            type: "radial",
                            stops: [
                                {
                                    offset: 0,
                                    color: "hsl(8, 7%, 100%)",
                                },
                                {
                                    offset: 15,
                                    color: "hsl(8, 7%, 95%)",
                                },
                                {
                                    offset: 20,
                                    color: "hsl(8, 7%, 95%)",
                                },
                                {
                                    offset: 90,
                                    color: "hsl(8, 7%, 90%)",
                                },
                                {
                                    offset: 100,
                                    color: "hsl(8, 7%, 90%)",
                                },
                            ],
                        },
                    },
                    radius,
                );

                // draw clamshell lines
                const n_lines = 8 + (Math.abs(s) % 8);

                const lines_g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                const lines_radius = radius * 0.85;

                const compactness = 1.0;
                const shift = 0;

                let unit_x = shift + 1 / n_lines - 0.5;
                while (unit_x < 0.5 * 0.8) {
                    let path = "";
                    const x_increment =
                        seedRandomFloat(s, 1 / n_lines / 2, 1 / n_lines) * compactness;
                    unit_x += x_increment;
                    const x = shift + unit_x * lines_radius * compactness * 2 + radius;
                    const start_y = Math.sqrt(unit_x * unit_x) * radius;
                    const end_y = radius + lines_radius - start_y;

                    // walk down the line and add a point every 1/N_SEGMENTS of the way with a random x perturbation
                    let last_y = 0;
                    const N_SEGMENTS = 4;
                    for (let j = 0; j <= N_SEGMENTS; j++) {
                        const x_perturb =
                            j === 0 || j === N_SEGMENTS
                                ? 0
                                : seedRandomFloat(s, 0, 0.2) + (0.5 * radius) / n_lines;
                        const y = start_y + (end_y - start_y) * (j / N_SEGMENTS);
                        const y_perturb = 0;

                        if (j) {
                            if (j === N_SEGMENTS) {
                                path += `L ${x + x_perturb} ${end_y}`;
                            } else {
                                path += `Q ${x + x_perturb} ${(y + last_y) / 2} ${x + x_perturb} ${
                                    y + y_perturb
                                }`;
                            }
                        } else {
                            path += `M ${x + x_perturb} ${y + y_perturb}`;
                        }

                        s = (s * 51) >> 3;
                        last_y = y + y_perturb;
                    }

                    s = (s * 7) >> 3;

                    const clamshell_line_color = `hsl(8, 7%, 90%)`;
                    const clamshell_line = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        "path",
                    );
                    clamshell_line.setAttribute("d", path);

                    clamshell_line.setAttribute("fill", "none");
                    clamshell_line.setAttribute("stroke", clamshell_line_color);
                    clamshell_line.setAttribute("stroke-width", `${radius * x_increment * 0.3}`);
                    lines_g.appendChild(clamshell_line);
                }

                const deg = seedRandomFloat(s, 0, 360);
                lines_g.setAttribute("transform", `rotate(${deg}, ${radius}, ${radius})`);
                stone.appendChild(lines_g);

                defs.appendChild(stone);
            }
            return ret;
        }
        */

        override getWhiteTextColor(color: string): string {
            return "#000000";
        }
    }
    _("Shell"); // ensure translation
    THEMES["white"]["Shell"] = Shell;

    /* Glass { */

    class Glass extends Common {
        override sort() {
            return 20;
        }
        override get theme_name(): string {
            return "Glass";
        }

        override preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 30,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        override getBlackTextColor(color: string): string {
            return "#ffffff";
        }

        override preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(207,205,206,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 80,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        override getWhiteTextColor(color: string): string {
            return "#000000";
        }

        /*
        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`black-glass-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    fill: "hsl(8, 7%, 95%)",
                    stroke: "hsl(226, 10%, 10%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(226, 7%, 100%)",
                            },
                            {
                                offset: 20,
                                color: "hsl(226, 7%, 30%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(226, 7%, 10%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`white-glass-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    fill: "hsl(8, 7%, 95%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(8, 7%, 100%)",
                            },
                            {
                                offset: 20,
                                color: "hsl(226, 7%, 100%)",
                            },
                            {
                                offset: 90,
                                color: "hsl(226, 7%, 75%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(226, 7%, 75%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }
        */
    }

    _("Glass"); // ensure translation
    THEMES["black"]["Glass"] = Glass;
    THEMES["white"]["Glass"] = Glass;

    /* Worn Glass { */

    class WornGlass extends Common {
        override sort() {
            return 21;
        }
        override get theme_name(): string {
            return "Worn Glass";
        }

        override preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 20,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        override getBlackTextColor(color: string): string {
            return "#ffffff";
        }

        override preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(189,189,194,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 35,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        override getWhiteTextColor(color: string): string {
            return "#000000";
        }

        /*
        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`black-worn-glass-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    fill: "hsl(8, 7%, 95%)",
                    stroke: "hsl(47, 5%, 10%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(47, 3%, 50%)",
                            },
                            {
                                offset: 30,
                                color: "hsl(47, 3%, 30%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(47, 5%, 10%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`white-worn-glass-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    fill: "hsl(8, 7%, 95%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(8, 7%, 100%)",
                            },
                            {
                                offset: 20,
                                color: "hsl(47, 7%, 100%)",
                            },
                            {
                                offset: 90,
                                color: "hsl(47, 7%, 75%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(47, 7%, 75%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }
        */
    }

    _("Worn Glass"); // ensure translation
    THEMES["black"]["Worn Glass"] = WornGlass;
    THEMES["white"]["Worn Glass"] = WornGlass;

    /* Night { */
    class Night extends Common {
        override sort() {
            return 100;
        }
        override get theme_name(): string {
            return "Night";
        }

        override preRenderBlack(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, seed, {
                base_color: "rgba(15,15,20,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 0.85,
                specular_hardness: 5,
                diffuse_light_distance: 10,
                specular_light_distance: 10,
            });
        }
        override getBlackTextColor(color: string): string {
            return "#888888";
        }

        override preRenderWhite(radius: number, seed: number): StoneTypeArray {
            return preRenderStone(radius, (seed *= 13), {
                base_color: "rgba(100,100,100,1.0)",
                light: normalized([-4, -4, 2]),
                ambient: 1.0,
                specular_hardness: 13,
                diffuse_light_distance: 7,
                specular_light_distance: 100,
            });
        }

        override getWhiteTextColor(color: string): string {
            return "#000000";
        }
        /*
        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`black-night-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    //fill: "hsl(8, 7%, 95%)",
                    stroke: "hsl(47, 5%, 10%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(261, 7%, 30%)",
                            },
                            {
                                offset: 30,
                                color: "hsl(261, 7%, 20%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(261, 7%, 10%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const key = this.def_uid(`white-night-${radius}`);
            const stone = this.renderSVG(
                {
                    id: key,
                    //fill: "hsl(8, 7%, 95%)",
                    gradient: {
                        type: "radial",
                        stops: [
                            {
                                offset: 0,
                                color: "hsl(261, 7%, 60%)",
                            },
                            {
                                offset: 90,
                                color: "hsl(261, 7%, 40%)",
                            },
                            {
                                offset: 100,
                                color: "hsl(261, 7%, 30%)",
                            },
                        ],
                    },
                },
                radius,
            );
            defs.appendChild(stone);
            return [key];
        }
        */
    }

    _("Night"); // ensure translation
    THEMES["black"]["Night"] = Night;
    THEMES["white"]["Night"] = Night;
}
