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
import { ShadowTheme } from "../Goban";
import { deviceCanvasScalingRatio, allocateCanvasOrError } from "../canvas_utils";
import { renderShadow } from "./rendered_stones";
import { renderPlainStone } from "./plain_stones";
import { callbacks } from "../callbacks";
import { raw_anime_black_svg, raw_anime_white_svg } from "./raw_image_stone_data";

const anime_black_imagedata = makeSvgImageData(raw_anime_black_svg);
const anime_white_imagedata = makeSvgImageData(raw_anime_white_svg);

function getCDNReleaseBase() {
    if (callbacks.getCDNReleaseBase) {
        return callbacks.getCDNReleaseBase();
    }
    return "";
}

function makeSvgImageData(svg: string): string {
    return "data:image/svg+xml," + svg.replace(/#/g, "%23");
}

/* Canvas-backed custom URL stones can be pending or fail due to CORS/broken URLs.
 * Track image readiness so board and move-tree drawing can use a plain-stone fallback
 * instead of painting a blank pre-rendered canvas. */
type StoneType = {
    stone: HTMLCanvasElement;
    shadow: HTMLCanvasElement;
    image_loaded: boolean;
};
type StoneTypeArray = Array<StoneType>;

function getCustomStoneUrls(callback: (() => string[]) | undefined): string[] {
    return callback?.() ?? [];
}

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
    show_shadow: boolean = true,
): StoneTypeArray {
    // cspell: words dcsr
    const dcsr = deviceCanvasScalingRatio();
    radius *= dcsr;

    const ss = square_size(radius, dcsr !== 1.0);
    const sss = Math.round(radius * 2.5); /* Shadow square size */
    const center = stone_center_in_square(radius, dcsr !== 1.0);

    if (typeof urls === "string") {
        urls = [urls];
    }

    const ret: StoneTypeArray = [];
    const promises: Promise<void>[] = [];

    for (const url of urls) {
        const stone_image = new Image(ss, ss);
        stone_image.crossOrigin = "anonymous";
        stone_image.loading = "eager";
        stone_image.width = ss;
        stone_image.height = ss;

        const stone = allocateCanvasOrError(`${ss}px`, `${ss}px`);
        const shadow = allocateCanvasOrError(`${sss}px`, `${sss}px`);
        const rendered_stone: StoneType = {
            stone,
            shadow,
            image_loaded: false,
        };

        const stone_load_promise = new Promise<void>((resolve) => {
            stone_image.onerror = (err) => {
                console.error(err);
                resolve();
            };
            stone_image.onload = () => {
                const stone_ctx = stone.getContext("2d", { willReadFrequently: true });

                if (!stone_ctx) {
                    console.error(new Error("Error getting stone context 2d"));
                    resolve();
                    return;
                }

                try {
                    stone_ctx.drawImage(stone_image, 0, 0, ss, ss);
                    rendered_stone.image_loaded = true;
                } catch (err) {
                    console.error(err);
                }

                resolve();
            };
        });
        promises.push(stone_load_promise);
        stone_image.src = url;

        const shadow_ctx = shadow.getContext("2d", { willReadFrequently: true });
        if (!shadow_ctx) {
            throw new Error("Error getting shadow context 2d");
        }
        if (show_shadow) {
            renderShadow(shadow_ctx, center, radius * 1.05, sss, 0.0, "rgba(60,60,40,0.4)");
        }

        ret.push(rendered_stone);
    }

    Promise.all(promises)
        .then(deferredRenderCallback)
        .catch((err) => console.error(err));

    return ret;
}

function imageStoneIsReady(stone: StoneType): boolean {
    return stone.image_loaded;
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

export default function (THEMES: ThemesInterface) {
    /* Firefox doesn't support drawing inlined SVGs into canvases. One can
     * attach them to the dom just fine, but not draw them into a canvas for
     * whatever reason. So, for firefox we have to load the exact same SVG off
     * the network it seems. */
    let firefox = false;

    try {
        if (typeof navigator !== "undefined") {
            firefox = navigator?.userAgent?.toLocaleLowerCase()?.indexOf("firefox") > -1;
        }
    } catch (e) {
        // ignore
    }

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
            placeRenderedImageStone(ctx, shadow_ctx, stone, cx, cy, radius);
        }
        override placeWhiteStone(
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

    class Anime extends Common {
        override sort() {
            return 30;
        }
        override get theme_name(): string {
            return "Anime";
        }

        override preRenderBlack(
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

        override preRenderWhite(
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

        override getBlackTextColor(_color: string): string {
            return "#ffffff";
        }

        override getWhiteTextColor(_color: string): string {
            return "#000000";
        }

        override getPreferredShadowTheme(): ShadowTheme {
            return "anime";
        }

        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const id = this.def_uid(`anime-black-${radius}`);
            defs.append(
                this.renderSVG(
                    {
                        id,
                        url: getCDNReleaseBase() + "/img/anime_black.svg",
                    },
                    radius,
                ),
            );

            return [id];
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const id = this.def_uid(`anime-white-${radius}`);
            defs.append(
                this.renderSVG(
                    {
                        id,
                        url: getCDNReleaseBase() + "/img/anime_white.svg",
                    },
                    radius,
                ),
            );

            return [id];
        }
    }

    THEMES["black"]["Anime"] = Anime;
    THEMES["white"]["Anime"] = Anime;

    class Custom extends Common {
        override sort() {
            return 200; // last - in the "url customizable" slot.
        }

        override get theme_name(): string {
            return "Custom";
        }

        override placeBlackStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            if (
                getCustomStoneUrls(callbacks.customBlackStoneUrls).length > 0 &&
                imageStoneIsReady(stone)
            ) {
                placeRenderedImageStone(ctx, shadow_ctx, stone, cx, cy, radius);
            } else {
                renderPlainStone(
                    ctx,
                    cx,
                    cy,
                    radius,
                    this.getBlackStoneColor(),
                    this.parent ? this.parent.getLineColor() : this.getLineColor(),
                );
            }
        }

        override preRenderBlack(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray | true {
            const [url] = getCustomStoneUrls(callbacks.customBlackStoneUrls);
            if (!url) {
                return true;
            }
            return preRenderImageStone(
                radius,
                url,
                deferredRenderCallback,
                false /* show_shadow */,
            );
            //return preRenderImageStone(radius, anime_black_imagedata);
        }

        public override getBlackStoneColor(): string {
            return callbacks.customBlackStoneColor ? callbacks.customBlackStoneColor() : "#000000";
        }

        public override getBlackTextColor(): string {
            return callbacks.customBlackTextColor ? callbacks.customBlackTextColor() : "#FFFFFF";
        }

        override placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D | null,
            stone: StoneType,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            if (
                getCustomStoneUrls(callbacks.customWhiteStoneUrls).length > 0 &&
                imageStoneIsReady(stone)
            ) {
                placeRenderedImageStone(ctx, shadow_ctx, stone, cx, cy, radius);
            } else {
                renderPlainStone(
                    ctx,
                    cx,
                    cy,
                    radius,
                    this.getWhiteStoneColor(),
                    this.parent ? this.parent.getLineColor() : this.getLineColor(),
                );
            }
        }

        override preRenderWhite(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray | true {
            const [url] = getCustomStoneUrls(callbacks.customWhiteStoneUrls);
            if (!url) {
                return true;
            }
            return preRenderImageStone(
                radius,
                url,
                deferredRenderCallback,
                false /* show_shadow */,
            );
            //return preRenderImageStone(radius, anime_white_imagedata);
        }

        public override getWhiteStoneColor(): string {
            return callbacks.customWhiteStoneColor ? callbacks.customWhiteStoneColor() : "#FFFFFF";
        }

        public override getWhiteTextColor(): string {
            return callbacks.customWhiteTextColor ? callbacks.customWhiteTextColor() : "#000000";
        }

        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const urls = getCustomStoneUrls(callbacks.customBlackStoneUrls);
            if (urls.length === 0) {
                return super.preRenderBlackSVG(defs, radius, _seed, deferredRenderCallback);
            }

            return urls.map((url, index) => {
                const id = this.def_uid(`custom-black-${index}-${radius}`);
                defs.append(this.renderSVG({ id, url }, radius));
                return id;
            });
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const urls = getCustomStoneUrls(callbacks.customWhiteStoneUrls);
            if (urls.length === 0) {
                return super.preRenderWhiteSVG(defs, radius, _seed, deferredRenderCallback);
            }

            return urls.map((url, index) => {
                const id = this.def_uid(`custom-white-${index}-${radius}`);
                defs.append(this.renderSVG({ id, url }, radius));
                return id;
            });
        }
    }

    THEMES["black"]["Custom"] = Custom;
    THEMES["white"]["Custom"] = Custom;

    class BadukTV extends Common {
        override sort() {
            return 110;
        }
        override get theme_name(): string {
            return "BadukTV";
        }

        override preRenderBlack(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray {
            return preRenderImageStone(
                radius,
                getCDNReleaseBase() + "/img/baduktv_black.png",
                deferredRenderCallback,
            );
        }

        override preRenderWhite(
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): StoneTypeArray {
            return preRenderImageStone(
                radius,
                getCDNReleaseBase() + "/img/baduktv_white.png",
                deferredRenderCallback,
            );
        }

        override getBlackTextColor(_color: string): string {
            return "#ffffff";
        }

        override getWhiteTextColor(_color: string): string {
            return "#000000";
        }

        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const id = this.def_uid(`baduktv-black-${radius}`);
            defs.append(
                this.renderSVG(
                    {
                        id,
                        url: getCDNReleaseBase() + "/img/baduktv_black.png",
                    },
                    radius,
                ),
            );

            return [id];
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            deferredRenderCallback: () => void,
        ): string[] {
            const id = this.def_uid(`baduktv-white-${radius}`);
            defs.append(
                this.renderSVG(
                    {
                        id,
                        url: getCDNReleaseBase() + "/img/baduktv_white.png",
                    },
                    radius,
                ),
            );

            return [id];
        }
    }

    _("BadukTV"); // ensure translation
    THEMES["black"]["BadukTV"] = BadukTV;
    THEMES["white"]["BadukTV"] = BadukTV;
}
