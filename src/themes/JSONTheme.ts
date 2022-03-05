// looping through fields in a record is too ridiculous with ts so:

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

import {GoTheme, GoThemeBackgroundReactStyles, GoThemeBackgroundCSS} from "../GoTheme"
import { GoThemesInterface } from "../GoThemes";
import { _ } from "../translate";
//import { deviceCanvasScalingRatio } from "../GoUtil";

/* 
This class makes it easy to design a custom OGS theme using
json and share it on the interent. It also helps artists
design image-based themes that need no code, by supplying a JSON url

Eventually (one hopes) users can supply their own JSON themes & share them

*/

// static settings for any image-based theme.
export class JSONThemeStyle {
    "name": string = "JSON Theme";
    "fuzzyPlacement"?: number = 0.01; // jostle the stones by this factor of radius, e.g. 0.01

    "whiteStones": string[] = []; // list of stone image urls to select randomly & draw
    "blackStones": string[] = [];

    "whiteShadows"?: string[] = []; // shadows that match the above stones. Can be a single url.
    "blackShadows"?: string[] = [];

    "whiteStoneColor"?: string = "#ffffff"; // perceived color of the stone image, eg #000000
    "blackStoneColor"?: string = "#000000";
    
    "whiteTextColor"?: string = "#000000"; // color to use for labels
    "blackTextColor"?: string = "#ffffff";
    
    "backgroundColor"?: string = "#DCB35C"; // color of the board beneath the stone
    "backgroundImage"?: string = "" // image of the board, URL
    "lineColor"?: string = "#000000" 
    "fadedLineColor"?: string = "#888888";  // line color when board is "faded out"
    "starColor"?: string = "#000000";
    "fadedStarColor"?: string = "#888888";
    "blankTextColor"?: string = "#000000";  // color for text on empty intersections
    "labelColor"?: string = "#000000" // dunno? seems to be covered by TextColor

    "priority": number = 100; // number used for sorting on screen, greater == later, 100 is typical

    // offsets & scales if needed; the defaults are 0,0 and 1.0
    "whiteStoneOffsets"?: Array<[number, number]> = [[0,0]];
    "blackStoneOffsets"?: Array<[number, number]>  = [[0,0]];
    "whiteStoneSizes"?: Array<[number, number] | number> = [[1,1]]; // allow x/y scaling or just uniform scale
    "blackStoneSizes"?: Array<[number, number] | number> = [[1,1]];

    "whiteShadowOffsets"?: Array<[number, number]> = [[0,0]];
    "blackShadowOffsets"?: Array<[number, number]> = [[0,0]];
    "whiteShadowSizes"?: Array<[number, number] | number> = [[1,1]]; // allow x/y scaling or just uniform scale
    "blackShadowSizes"?: Array<[number, number] | number> = [[1,1]];
}


export class JSONTheme extends GoTheme {
    public name: string;
    public styles: { [style_name: string]: string } = {};
    public themeStyle: JSONThemeStyle = new JSONThemeStyle;
    public readonly isJSONTheme: boolean = true;
    protected parent?: GoTheme; // An optional parent theme

    protected whiteImages: CanvasImageSource[];
    protected blackImages: CanvasImageSource[];
    protected whiteShadowImages: CanvasImageSource[];
    protected blackShadowImages: CanvasImageSource[];

    constructor(parent?: GoTheme) {
        super()
        this.name = "JSON Theme" ; //this.themeStyle.themeName
        this.parent = parent
        /*
        if (themeStyle)
            this.setStyle(themeStyle)
        else
            this.setStyle(DEFAULT_JSON_THEME_STYLES)
        */

        this.whiteImages = [];
        this.blackImages = [];
        this.whiteShadowImages = [];
        this.blackShadowImages = [];
    }

    public rebuildImages(){
        this.whiteImages = [];
        this.blackImages = [];
        this.whiteShadowImages = [];
        this.blackShadowImages = [];
        
        if (this.themeStyle.whiteStones && this.themeStyle.whiteStones.length > 0) {
            for (let src of this.themeStyle.whiteStones){
                let img = new Image();
                img.src = src
                this.whiteImages.push(img)
            }
        }

        if (this.themeStyle.blackStones && this.themeStyle.blackStones.length > 0) {
            for (let src of this.themeStyle.blackStones){
                let img = new Image();
                img.src = src
                this.blackImages.push(img)
            }
        }

        if (this.themeStyle.whiteShadows && this.themeStyle.whiteShadows.length > 0) {
            for (let src of this.themeStyle.whiteShadows){
                let img = new Image();
                img.src = src
                this.whiteShadowImages.push(img)
            }
        }

        if (this.themeStyle.blackShadows && this.themeStyle.blackShadows.length > 0) {
            for (let src of this.themeStyle.blackShadows){
                let img = new Image();
                img.src = src
                this.blackShadowImages.push(img)
            }
        }

    }

    public setStyle(theStyle: JSONThemeStyle) {
        // use default settings
        // and then override with passed style
        let s: JSONThemeStyle = new JSONThemeStyle;
        for (const k in theStyle){
            //@ts-ignore
            if (theStyle[k] != undefined){
                //@ts-ignore
               s[k] = theStyle[k];
            }
        }
        this.themeStyle = s;
        this.rebuildImages();
    }

    public loadFromURL(url: string){

    }

    public loadFromText(text: string){
        try {
            let j = JSON.parse(text)
            let s = new JSONThemeStyle; // construct default item to check the keys & type values
            for (let k in j) {
                //@ts-ignore
                if (j[k] != undefined && typeof s[k] == typeof j[k]) {
                    //@ts-ignore
                    this.themeStyle[k] = j[k];
                }
            }
            this.rebuildImages()

        } catch (err){
            console.log(err); // FIXME: parse error is not sever enough to crash OGS, but should tell user
            return;
        }


    }

    get theme_name(): string {
        return this.themeStyle.name;
    }
    public sort(): number {
        return this.themeStyle.priority;
    }

    public getStyles(): JSONThemeStyle {
        return this.themeStyle;
    }

    /* Returns an array of black stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeBlackStone method */
    public preRenderBlack(radius: number, seed: number): any {
        return true; // { black: "stone" };
    }

    /* Returns an array of white stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeWhiteStone method */
    public preRenderWhite(radius: number, seed: number): any {
        return { white: "stone" };
    }

    public calcBox(offsets: any, sizes: any, rando: number) {
        let offset = [0, 0];
        if (offsets && offsets.length > 0){
            offset = offsets[rando%offsets.length]
        }

        let scale = [1, 1];
        if (sizes && sizes.length > 0){
            let s = sizes[rando%sizes.length]
            if (typeof s === "number"){
                //@ts-ignore
                scale = [s, s];
            }
            else{
                //@ts-ignore
                scale = s as Array<[number, number]>;
            }
        }

        let box = [
            -scale[0] + offset[0], -scale[1] + offset[1], 
            scale[0] + offset[0],   scale[1] + offset[1]
        ]

        return box;
    }

    /* Places a pre rendered stone onto the canvas, centered at cx, cy */
    public placeWhiteStone(
        ctx: CanvasRenderingContext2D,
        shadow_ctx: CanvasRenderingContext2D | null,
        stone: any,
        cx: number,
        cy: number,
        radius: number,
    ) {
        if (this.whiteImages.length > 0){

            //random by position
            let rando = Math.floor(cx*31 + cy*29)

            if (shadow_ctx != undefined && this.whiteShadowImages.length > 0){
                let img = this.whiteShadowImages[rando % this.whiteShadowImages.length]
                let box = this.calcBox(this.themeStyle.whiteShadowOffsets, this.themeStyle.whiteShadowSizes, rando);
                     
                ctx.drawImage(img, cx + radius * box[0], cy + radius * box[1],  radius * (box[2]-box[0]), radius * (box[3]-box[1]))

            }

            let img = this.whiteImages[rando % this.whiteImages.length]
            let box = this.calcBox(this.themeStyle.whiteStoneOffsets, this.themeStyle.whiteStoneSizes, rando);


            ctx.drawImage(img, cx + radius * box[0], cy + radius * box[1],  radius * (box[2]-box[0]), radius * (box[3]-box[1]))            
        }
        else {
            //if (shadow_ctx) do something
            ctx.save()
            ctx.fillStyle = this.getWhiteStoneColor();
            ctx.strokeStyle = this.getWhiteTextColor();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
            ctx.fill();
            ctx.restore()
        }
    }

    public placeBlackStone(
        ctx: CanvasRenderingContext2D,
        shadow_ctx: CanvasRenderingContext2D | null,
        stone: any,
        cx: number,
        cy: number,
        radius: number,
    ) {
        if (this.blackImages.length > 0) {

            //random by position
            let rando = Math.floor(cx * 31 + cy * 29)

            if (shadow_ctx != undefined && this.blackShadowImages.length > 0) {
                let img = this.blackShadowImages[rando % this.blackShadowImages.length]
                let box = this.calcBox(this.themeStyle.blackShadowOffsets, this.themeStyle.blackShadowSizes, rando);

                ctx.drawImage(img, cx + radius * box[0], cy + radius * box[1], radius * (box[2] - box[0]), radius * (box[3] - box[1]))

            }

            let img = this.blackImages[rando % this.blackImages.length]
            let box = this.calcBox(this.themeStyle.blackStoneOffsets, this.themeStyle.blackStoneSizes, rando);


            ctx.drawImage(img, cx + radius * box[0], cy + radius * box[1], radius * (box[2] - box[0]), radius * (box[3] - box[1]))
        }
        else {

            //if (shadow_ctx) do something
            ctx.save()
            ctx.fillStyle = this.getBlackStoneColor();
            ctx.strokeStyle = this.getBlackTextColor();
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
            ctx.fill();
            ctx.restore()
        }

    }

    /* Should return true if you would like the shadow layer to be present. False
     * speeds up rendering typically */
    public stoneCastsShadow(radius: number): boolean {
        return true;
        /*
        if (this.themeStyle.useShadow)
            return this.themeStyle.useShadow;
        else 
            return false
            */
    }

    /* Returns the color that should be used for white stones */
    public getWhiteStoneColor(): string {
        if (this.themeStyle.whiteStoneColor)
            return this.themeStyle.whiteStoneColor
        else
            return "#ffffff"
    }

    /* Returns the color that should be used for black stones */
    public getBlackStoneColor(): string {
        if (this.themeStyle.blackStoneColor) 
            return this.themeStyle.blackStoneColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for text over white stones */
    public getWhiteTextColor(color?: string): string {
        if (this.themeStyle.whiteTextColor)
            return this.themeStyle.whiteTextColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for text over black stones */
    public getBlackTextColor(color?: string): string {
        if (this.themeStyle.blackTextColor)
            return this.themeStyle.blackTextColor;
        else
            return "#ffffff"
    }

    /* Returns a set of CSS styles that should be applied to the background layer (ie the board) */
    public getBackgroundCSS(): GoThemeBackgroundCSS {
        return {
            "background-image": `url("${this.themeStyle.backgroundImage}")`,
            "background-color": "#000",
            "background-size": "cover"
        }
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
        if (this.themeStyle.lineColor)
            return this.themeStyle.lineColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for lines * when there is text over the square */
    public getFadedLineColor(): string {
        if (this.themeStyle.fadedLineColor)
            return this.themeStyle.fadedLineColor;
        else
            return "#888888"
    }

    /* Returns the color that should be used for star points */
    public getStarColor(): string {
        if (this.themeStyle.starColor) 
            return this.themeStyle.starColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for star points
     * when there is text over the square */
    public getFadedStarColor(): string {
        if (this.themeStyle.fadedStarColor)
            return this.themeStyle.fadedStarColor;
        else
            return "#888888"
    }

    /* Returns the color that text should be over empty intersections */
    public getBlankTextColor(): string {
        if (this.themeStyle.blankTextColor)
            return this.themeStyle.blankTextColor;
        else
            return "#000000"
    }

    /** Returns the color that should be used for labels */
    public getLabelTextColor(): string {
        if (this.themeStyle.labelColor)
            return this.themeStyle.labelColor;
        else
            return "#000000"
    }
}


export default function (GoThemes: GoThemesInterface) {
    GoThemes["black"]["JSON Theme"] = JSONTheme;
    GoThemes["white"]["JSON Theme"] = JSONTheme;
    GoThemes["board"]["JSON Theme"] = JSONTheme;

}

/*
class BasicImgTheme extends JSONTheme {
    public themeStyle: JSONThemeStyle = 
    {
        "themeName":   "basic image theme",
        "whiteStones": [],
        "blackStones": []
    }
}
*/