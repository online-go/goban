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

import { GobanCore } from "./GobanCore";

export interface GoThemeBackgroundCSS {
    "background-color"?: string;
    "background-image"?: string;
    "background-size"?: string;
}

export interface GoThemeBackgroundReactStyles {
    backgroundColor?: string;
    backgroundImage?: string;
    backgroundSize?: string;
}

export class GoTheme {
    public name: string;
    public styles: { [style_name: string]: string } = {};
    protected parent?: GoTheme; // An optional parent theme

    constructor(parent?: GoTheme) {
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

    /* Resolve which stone graphic we should use. By default we just pick a
     * random one, if there are multiple images, otherwise whatever was
     * returned by the pre-render method */
    public getStone(x: number, y: number, stones: any, _goban: GobanCore): any {
        if (Array.isArray(stones)) {
            return stones[((x + 1) * 53 * ((y + 1) * 97)) % stones.length];
        }
        return stones;
    }

    /* Resolve which stone graphic we should use. By default we just pick a
     * random one, if there are multiple images, otherwise whatever was
     * returned by the pre-render method */
    public getStoneHash(x: number, y: number, stones: any, _goban: GobanCore): string {
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
    public getBackgroundCSS(): GoThemeBackgroundCSS {
        return {
            "background-color": "#DCB35C",
            "background-image": "",
        };
    }

    /* Returns a set of CSS styles (for react) that should be applied to the background layer (ie the board) */
    public getReactStyles(): GoThemeBackgroundReactStyles {
        const ret: GoThemeBackgroundReactStyles = {};
        const css: GoThemeBackgroundCSS = this.getBackgroundCSS();

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
}
