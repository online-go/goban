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

import { GobanBase } from "../../GobanBase";

let last_def_uid = 0;

export interface GobanThemeBackgroundCSS {
    "background-color"?: string;
    "background-image"?: string;
    "background-size"?: string;
}

export interface GobanThemeBackgroundReactStyles {
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundSize?: string;
}

export interface SVGStop {
    offset: number;
    color: string;
}

export interface SVGStoneParameters {
    id: string;
    fill?: string;
    stroke?: string;
    stroke_scale?: number; // scale the radius by this amount
    gradient?: {
        stops: SVGStop[];
        type?: "radial" | "linear"; // default radial
        x1?: number;
        x2?: number;
        y1?: number;
        y2?: number;
        cx?: number;
        cy?: number;
        r?: number;
        fx?: number;
        fy?: number;
    };
    url?: string;
}

export class GobanTheme {
    public name: string;
    public styles: { [style_name: string]: string } = {};
    protected parent?: GobanTheme; // An optional parent theme

    constructor(parent?: GobanTheme) {
        this.name = `[ERROR theme missing name]`;
        this.parent = parent;
    }

    get theme_name(): string {
        return "ERROR missing theme_name";
    }
    public sort(): number {
        return 0;
    }

    /* Returns an array of black stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeBlackStone method */
    public preRenderBlack(
        _radius: number,
        _seed: number,
        _deferredRenderCallback: () => void,
    ): any {
        return { black: "stone" };
    }

    /* Returns an array of white stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeWhiteStone method */
    public preRenderWhite(
        _radius: number,
        _seed: number,
        _deferredRenderCallback: () => void,
    ): any {
        return { white: "stone" };
    }

    /* Returns an array of black stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeBlackStone method */
    public preRenderBlackSVG(
        defs: SVGDefsElement,
        radius: number,
        _seed: number,
        _deferredRenderCallback: () => void,
    ): string[] {
        const ret = [];
        const key = this.def_uid(`black-${radius}`);
        ret.push(key);

        defs.appendChild(
            this.renderSVG(
                {
                    id: key,
                    //fill: "hsl(8, 7%, 10%)",
                    //stroke: "hsl(8, 7%, 10%)",
                    fill: this.getBlackStoneColor(),
                    stroke: this.getBlackStoneColor(),
                },
                radius,
            ),
        );
        return ret;
    }

    /* Returns an array of white stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeWhiteStone method */
    public preRenderWhiteSVG(
        defs: SVGDefsElement,
        radius: number,
        _seed: number,
        _deferredRenderCallback: () => void,
    ): string[] {
        const ret = [];
        const key = this.def_uid(`white-${radius}`);
        ret.push(key);
        defs.appendChild(
            this.renderSVG(
                {
                    id: key,
                    //fill: "hsl(8, 7%, 90%)",
                    //stroke: "hsl(8, 7%, 30%)",
                    fill: this.getWhiteStoneColor(),
                    stroke: this.getBlackStoneColor(),
                },
                radius,
            ),
        );

        return ret;
    }

    public preRenderShadowSVG(defs: SVGDefsElement, color: string): void {
        /* Radial gradient for shadow */
        const radial_gradient = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "radialGradient",
        );
        radial_gradient.setAttribute("id", "shadow-" + color);
        radial_gradient.setAttribute("r", "1.0");

        // solid stone color
        const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stop1.setAttribute("offset", "0");
        stop1.setAttribute("stop-color", color);
        stop1.setAttribute("stop-opacity", "1.0");
        radial_gradient.appendChild(stop1);
        const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        stop2.setAttribute("offset", "30%");
        stop2.setAttribute("stop-color", color);
        stop2.setAttribute("stop-opacity", "1.0");
        radial_gradient.appendChild(stop2);

        const shadow_color = "#333333";

        {
            const shadow_stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
            shadow_stop.setAttribute("offset", "31%");
            shadow_stop.setAttribute("stop-color", shadow_color);
            shadow_stop.setAttribute("stop-opacity", "0.6");
            radial_gradient.appendChild(shadow_stop);
        }

        {
            const shadow_stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
            shadow_stop.setAttribute("offset", "34%");
            shadow_stop.setAttribute("stop-color", shadow_color);
            shadow_stop.setAttribute("stop-opacity", "0.50");
            radial_gradient.appendChild(shadow_stop);
        }
        {
            const shadow_stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
            shadow_stop.setAttribute("offset", "40%");
            shadow_stop.setAttribute("stop-color", shadow_color);
            shadow_stop.setAttribute("stop-opacity", "0.5");
            radial_gradient.appendChild(shadow_stop);
        }
        {
            const shadow_stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
            shadow_stop.setAttribute("offset", "50%");
            shadow_stop.setAttribute("stop-color", shadow_color);
            shadow_stop.setAttribute("stop-opacity", "0.0");
            radial_gradient.appendChild(shadow_stop);
        }

        defs.appendChild(radial_gradient);
    }

    /* Places a pre rendered stone onto the canvas, centered at cx, cy */
    public placeWhiteStone(
        ctx: CanvasRenderingContext2D,
        _shadow_ctx: CanvasRenderingContext2D | null,
        _stone: any,
        cx: number,
        cy: number,
        radius: number,
    ) {
        //if (shadow_ctx) do something
        ctx.fillStyle = this.getWhiteStoneColor();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.1, radius), 0, 2 * Math.PI, true);
        ctx.fill();
    }

    public placeBlackStone(
        ctx: CanvasRenderingContext2D,
        _shadow_ctx: CanvasRenderingContext2D | null,
        _stone: any,
        cx: number,
        cy: number,
        radius: number,
    ) {
        //if (shadow_ctx) do something
        ctx.fillStyle = this.getBlackStoneColor();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.1, radius), 0, 2 * Math.PI, true);
        ctx.fill();
    }

    public placeStoneShadowSVG(
        shadow_cell: SVGGraphicsElement | undefined,
        cx: number,
        cy: number,
        radius: number,
        color: string,
    ): SVGElement | undefined {
        if (!shadow_cell) {
            return;
        }

        const circle_to_cast_shadow = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
        );
        circle_to_cast_shadow.setAttribute("fill", `url(#shadow-${color})`);
        circle_to_cast_shadow.setAttribute("cx", (cx * 1.2).toString());
        circle_to_cast_shadow.setAttribute("cy", (cy * 1.2).toString());
        circle_to_cast_shadow.setAttribute("r", (radius * 0.95).toString());
        shadow_cell.appendChild(circle_to_cast_shadow);
        return circle_to_cast_shadow;
    }

    private placeStoneSVG(
        cell: SVGGraphicsElement,
        shadow_cell: SVGGraphicsElement | undefined,
        stone: string,
        cx: number,
        cy: number,
        radius: number,
        shadow_circle_color: string,
    ): [SVGElement, SVGElement | undefined] {
        const shadow = this.placeStoneShadowSVG(shadow_cell, cx, cy, radius, shadow_circle_color);

        const ref = document.createElementNS("http://www.w3.org/2000/svg", "use");
        ref.setAttribute("href", `#${stone}`);
        ref.setAttribute("x", `${cx - radius}`);
        ref.setAttribute("y", `${cy - radius}`);
        cell.appendChild(ref);

        return [ref, shadow];
    }

    public placeWhiteStoneSVG(
        cell: SVGGraphicsElement,
        shadow_cell: SVGGraphicsElement | undefined,
        stone: string,
        cx: number,
        cy: number,
        radius: number,
    ): [SVGElement, SVGElement | undefined] {
        return this.placeStoneSVG(cell, shadow_cell, stone, cx, cy, radius, "white");
    }

    public placeBlackStoneSVG(
        cell: SVGGraphicsElement,
        shadow_cell: SVGGraphicsElement | undefined,
        stone: string,
        cx: number,
        cy: number,
        radius: number,
    ): [SVGElement, SVGElement | undefined] {
        return this.placeStoneSVG(cell, shadow_cell, stone, cx, cy, radius, "black");
    }

    /* Resolve which stone graphic we should use. By default we just pick a
     * random one, if there are multiple images, otherwise whatever was
     * returned by the pre-render method */
    public getStone(x: number, y: number, stones: any, _goban: GobanBase): any {
        const ret = Array.isArray(stones)
            ? stones[((x + 1) * 53 * ((y + 1) * 97)) % stones.length]
            : stones;

        if (!ret) {
            console.error("No stone returned for ", x, y, stones);
            throw new Error("Failed to get stone for " + x + ", " + y);
        }

        return ret;
    }

    /* Resolve which stone graphic we should use. By default we just pick a
     * random one, if there are multiple images, otherwise whatever was
     * returned by the pre-render method */
    public getStoneHash(x: number, y: number, stones: any, _goban: GobanBase): string {
        if (Array.isArray(stones)) {
            return "" + (((x + 1) * 53 * ((y + 1) * 97)) % stones.length);
        }
        return "";
    }

    /* Should return true if you would like the shadow layer to be present. False
     * speeds up rendering typically */
    public stoneCastsShadow(_radius: number): boolean {
        return false;
    }

    /* Returns the color that should be used for white stones */
    public getWhiteStoneColor(): string {
        return "#ffffff";
    }

    /* Returns the color that should be used for black stones */
    public getBlackStoneColor(): string {
        return "#000000";
    }

    /* Returns the color that should be used for text over white stones */
    public getWhiteTextColor(_color?: string): string {
        return "#000000";
    }

    /* Returns the color that should be used for text over black stones */
    public getBlackTextColor(_color?: string): string {
        return "#ffffff";
    }

    /* Returns a set of CSS styles that should be applied to the background layer (ie the board) */
    public getBackgroundCSS(): GobanThemeBackgroundCSS {
        return {
            "background-color": "#DCB35C",
            "background-image": "",
        };
    }

    /* Returns a set of CSS styles (for react) that should be applied to the background layer (ie the board) */
    public getReactStyles(): GobanThemeBackgroundReactStyles {
        const ret: GobanThemeBackgroundReactStyles = {};
        const css: GobanThemeBackgroundCSS = this.getBackgroundCSS();

        ret.backgroundColor = css["background-color"];
        ret.backgroundImage = css["background-image"];

        return ret;
    }

    /* Returns the color that should be used for lines */
    public getLineColor(): string {
        return "#000000";
    }

    /* Returns the color that should be used for lines * when there is text over the square */
    public getFadedLineColor(): string {
        return "#888888";
    }

    /* Returns the color that should be used for star points */
    public getStarColor(): string {
        return "#000000";
    }

    /* Returns the color that should be used for star points
     * when there is text over the square */
    public getFadedStarColor(): string {
        return "#888888";
    }

    /* Returns the color that text should be over empty intersections */
    public getBlankTextColor(): string {
        return "#000000";
    }

    /** Returns the color that should be used for labels */
    public getLabelTextColor(): string {
        return "#000000";
    }

    public renderSVG(params: SVGStoneParameters, radius: number): SVGGraphicsElement {
        const cx = radius;
        const cy = radius;

        const stone = document.createElementNS("http://www.w3.org/2000/svg", "g");
        stone.setAttribute("id", params.id);
        stone.setAttribute("class", "stone");

        if (params.fill || params.stroke || params.gradient) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            stone.appendChild(circle);
            if (params.fill) {
                circle.setAttribute("fill", params.fill);
            }
            let stroke_width = 0.0;
            if (params.stroke) {
                circle.setAttribute("stroke", params.stroke);
                if (params.stroke_scale) {
                    stroke_width = radius * params.stroke_scale;
                } else {
                    stroke_width = radius / 20;
                }
                circle.setAttribute("stroke-width", `${stroke_width.toFixed(1)}px`);
            }
            circle.setAttribute("cx", cx.toString());
            circle.setAttribute("cy", cy.toString());
            circle.setAttribute("r", (radius - stroke_width * 0.5).toString());
            circle.setAttribute("shape-rendering", "geometricPrecision");

            // gradient
            if (params.gradient) {
                const grad = params.gradient;
                const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

                let gradient;

                if (grad.type === "linear") {
                    gradient = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        "linearGradient",
                    );
                    gradient.setAttribute("x1", (grad.x1 ?? 0.0).toFixed(2));
                    gradient.setAttribute("y1", (grad.y1 ?? 0.0).toFixed(2));
                    gradient.setAttribute("x2", (grad.x2 ?? 1.0).toFixed(2));
                    gradient.setAttribute("y2", (grad.y2 ?? 1.0).toFixed(2));
                } else {
                    gradient = document.createElementNS(
                        "http://www.w3.org/2000/svg",
                        params.gradient.type === "linear" ? "linearGradient" : "radialGradient",
                    );
                    gradient.setAttribute("cx", (grad.cx ?? 0.5).toFixed(2));
                    gradient.setAttribute("cy", (grad.cy ?? 0.5).toFixed(2));
                    gradient.setAttribute("r", (grad.r ?? 0.5).toFixed(2));
                    gradient.setAttribute("fx", (grad.fx ?? 0.3).toFixed(2));
                    gradient.setAttribute("fy", (grad.fy ?? 0.2).toFixed(2));
                }
                gradient.setAttribute("id", params.id + "-gradient");

                for (const stop of params.gradient.stops) {
                    const s = document.createElementNS("http://www.w3.org/2000/svg", "stop");
                    s.setAttribute("offset", `${stop.offset}%`);
                    s.setAttribute("stop-color", stop.color);
                    gradient.appendChild(s);
                }
                defs.appendChild(gradient);
                stone.appendChild(defs);
                circle.setAttribute("fill", `url(#${params.id}-gradient)`);
            }
        }

        if (params.url) {
            const stone_image = document.createElementNS("http://www.w3.org/2000/svg", "image");
            stone_image.setAttribute("class", "stone");
            stone_image.setAttribute("x", `${cx - radius}`);
            stone_image.setAttribute("y", `${cy - radius}`);
            stone_image.setAttribute("width", `${radius * 2}`);
            stone_image.setAttribute("height", `${radius * 2}`);
            stone_image.setAttributeNS("http://www.w3.org/1999/xlink", "href", params.url);
            stone.appendChild(stone_image);
        }

        return stone;
    }

    /* Makes a unique id for a def element */
    public def_uid(base: string): string {
        const uid = last_def_uid++;

        return `${base}-${uid}`;
    }
}
