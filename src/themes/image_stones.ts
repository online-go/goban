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
import { renderShadow } from "./rendered_stones";
const anime_black_imagedata = makeSvgImageData(require("../../assets/img/anime_black.svg"));
const anime_white_imagedata = makeSvgImageData(require("../../assets/img/anime_white.svg"));

import { GobanCore } from "../GobanCore";
function getCDNReleaseBase() {
    if (GobanCore.hooks.getCDNReleaseBase) {
        return GobanCore.hooks.getCDNReleaseBase();
    }
    return "";
}

function makeSvgImageData(svg: string): string {
    return "data:image/svg+xml," + svg.replace(/#/g, "%23");
}

type StoneType = { stone: HTMLCanvasElement; shadow: HTMLCanvasElement };
type StoneTypeArray = Array<StoneType>;

function square_size(radius: number, scaled: boolean): number {
    return 2 * Math.floor(radius) + (scaled ? 0 : 1);
}
function stone_center_in_square(radius: number, scaled: boolean): number {
    return Math.floor(radius) + (scaled ? 0 : 0.5);
}

export function preRenderImageStone(
    radius: number,
    urls: string | string[],
    deferredRenderCallback: () => void,
): StoneTypeArray {
    const dcsr = deviceCanvasScalingRatio();
    radius *= dcsr;

    const ss = square_size(radius, dcsr !== 1.0);
    const sss = Math.round(radius * 2.5); /* Shadow square size */
    const center = stone_center_in_square(radius, dcsr !== 1.0);

    if (typeof urls === "string") {
        urls = [urls];
    }

    const ret: StoneTypeArray = [];
    const promises: Promise<any>[] = [];

    for (const url of urls) {
        const stone_image = new Image(ss, ss);
        stone_image.loading = "eager";
        stone_image.width = ss;
        stone_image.height = ss;

        stone_image.src = url;

        const stone = document.createElement("canvas");
        stone.setAttribute("width", ss + "px");
        stone.setAttribute("height", ss + "px");

        const shadow = document.createElement("canvas");
        shadow.setAttribute("width", sss + "px");
        shadow.setAttribute("height", sss + "px");

        const stone_load_promise = new Promise((resolve, reject) => {
            stone_image.onerror = reject;
            stone_image.onload = resolve;
        });
        promises.push(stone_load_promise);

        const shadow_ctx = shadow.getContext("2d");
        if (!shadow_ctx) {
            throw new Error("Error getting shadow context 2d");
        }
        renderShadow(shadow_ctx, center, radius * 1.05, sss, 0.0, "rgba(60,60,40,0.4)");

        stone_load_promise
            .then(() => {
                const stone_ctx = stone.getContext("2d");

                if (!stone_ctx) {
                    throw new Error("Error getting stone context 2d");
                }

                stone_ctx.drawImage(stone_image, 0, 0, ss, ss);
                //deferredRenderCallback();
            })
            .catch((err) => console.error(err));

        ret.push({ stone, shadow });
    }

    Promise.all(promises)
        .then(deferredRenderCallback)
        .catch((err) => console.error(err));

    return ret;
}

export function placeRenderedImageStone(
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
    /* Firefox doesn't support drawing inlined SVGs into canvases. One can
     * attach them to the dom just fine, but not draw them into a canvas for
     * whatever reason. So, for firefox we have to load the exact same SVG off
     * the network it seems. */
    const firefox = navigator.userAgent.toLocaleLowerCase().indexOf("firefox") > -1;

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
            placeRenderedImageStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
        placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            placeRenderedImageStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
    }

    class AnimeBlack extends Common {
        sort() {
            return 30;
        }
        get theme_name(): string {
            return "Anime";
        }

        preRenderBlack(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray {
            return preRenderImageStone(
                radius,
                firefox ? getCDNReleaseBase() + "/img/anime_black.svg" : anime_black_imagedata,
                deferredRenderCallback,
            );
            //return preRenderImageStone(radius, anime_black_imagedata);
        }
        getBlackTextColor(_color: string): string {
            return "#ffffff";
        }
    }

    GoThemes["black"]["Anime"] = AnimeBlack;

    class AnimeWhite extends Common {
        sort() {
            return 30;
        }
        get theme_name(): string {
            return "Anime";
        }

        preRenderWhite(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray {
            return preRenderImageStone(
                radius,
                firefox ? getCDNReleaseBase() + "/img/anime_white.svg" : anime_white_imagedata,
                deferredRenderCallback,
            );
            //return preRenderImageStone(radius, anime_white_imagedata);
        }

        getWhiteTextColor(_color: string): string {
            return "#000000";
        }
    }
    GoThemes["white"]["Anime"] = AnimeWhite;
}
