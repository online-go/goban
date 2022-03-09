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

// import { createContext } from "react";
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

/*  A NOTE
    So, it's complicated.
    1. A GoTheme is created as one thing (via "class"), but
    2. GoThemes are then separated by board & stone rendering, and
    3. GoThemes are never treated like objects, but passed around as classes that components can instantiate
    4. Every GoTheme (class) must be hardcoded into GoThemes.ts, and is immutable throughout the duration of app run.

    This causes problems, especially with a theme that needs to change on demand (i.e. it's not possible)

    So my solution is to use static variables. This allows mutability without introducing a "preference object" and whatnot.

    Since GoThemes are treated like singleton globals anyway, this works out pretty well.

*/

// static settings for any image-based theme.
// these settings should always be dumb-easy for anyone to understand or guess
// and should be flexible enough so artists do not need to type too many values in

export class JSONThemeStyle {
    "name": string = "JSON Theme";
    "fuzzyPlacement"?: number = 0.01; // jostle the stones by this factor of radius, e.g. 0.01 (unimplemented)

    "boardColor"?: string = "#DCB35C"; // color of the board beneath the stone
    "boardImage"?: string = ""; // image of the board, URL

    "whiteStones": string[] = []; // list of stone image urls to select randomly & draw
    "blackStones": string[] = [];
    
    "shadows": string[] = []; // shadow images to be used unless whiteShadows/blackShadows specified
    "whiteShadows"?: string[] = []; // shadows that match the above stones. Can be a single url.
    "blackShadows"?: string[] = [];

    "whiteStoneColor"?: string = "#ffffff"; // perceived color of the stone image, eg #000000
    "blackStoneColor"?: string = "#000000";
    
    "whiteTextColor"?: string = "#000000"; // color to use for labels above white stone
    "blackTextColor"?: string = "#ffffff";
    
    "boardInkColor"?: string = "#000000"; // a general color for markings on the board when specific colors (below) aren't set
    "boardFadedInkColor"?: string = "#888888" // a general color for markings when faded

    "lineColor"?: string = "";
    "fadedLineColor"?: string = "";  // line color when board is "faded out"
    "starColor"?: string = "";
    "fadedStarColor"?: string = "";
    "blankTextColor"?: string = "";  // color for text on empty intersections
    "coordinateColor"?: string = ""; // for coordinates

    // these fields are required for JSONTheme, but
    // are optional for the artist to input
    "rotations": Array<number> = [0];  // general rotation for shadow & either stone
    "sizes": Array<[number, number] | number> = [1]; // general scaling for shadows & either stone
    "offsets": Array<[number, number]> = [[0, 0]]; // general offsets for shadows & either stone

    // offsets & scales if needed; the defaults are 0,0 and 1.0
    "stoneOffsets": Array<[number, number]> = [[0, 0]]; // general offset for both stones, added to the below values if provided
    "whiteStoneOffsets": Array<[number, number]> = [[0, 0]];
    "blackStoneOffsets": Array<[number, number]> = [[0, 0]];
    
    "stoneSizes": Array<[number, number] | number> = [1]; // general scale of both stones, multipled to below values if provided
    "whiteStoneSizes": Array<[number, number] | number> = [1,1]; // allow x/y scaling or just uniform scale
    "blackStoneSizes": Array<[number, number] | number> = [1,1];

    "stoneRotations": Array<number> = [0, 0]; // general rotations for both stones, added to below values if provided
    "whiteStoneRotations": Array<number> = [0, 0];
    "blackStoneRotations": Array<number> = [0, 0];

    "shadowOffsets": Array<[number, number]> = [[0, 0]]; // general shadow offset for both stones, added to the below values
    "whiteShadowOffsets": Array<[number, number]> = [[0, 0]];
    "blackShadowOffsets": Array<[number, number]> = [[0, 0]];

    "shadowSizes": Array<[number, number] | number> = [1]; // general shadow scale for both stones, multiplied with below values
    "whiteShadowSizes": Array<[number, number] | number> = [1,1]; // allow x/y scaling or just uniform scale
    "blackShadowSizes": Array<[number, number] | number> = [1,1];
    
    "shadowRotations": Array<number> = [0]; // general rotations for both stones, added to the below values
    "blackShadowRotations": Array<number> = [0, 0];
    "whiteShadowRotations": Array<number> = [0, 0];

    "priority": number = 4; // number used for sorting on screen, greater == later, 100 is typical -- FIXME shouldn't really be user-assignable

}


export class JSONTheme extends GoTheme {
    static json: string = "{}"; // globally available in class so that all the parts can see it without a "preference object"
    static styles: JSONThemeStyle; // constructed from json

    public name: string;
    public styles: { [style_name: string]: string } = {};
    public themeStyle: JSONThemeStyle = new JSONThemeStyle;
    public readonly isJSONTheme: boolean = true;
    protected parent?: GoTheme; // An optional parent theme

    protected whiteImages: CanvasImageSource[] = [];
    protected blackImages: CanvasImageSource[] = [];
    protected whiteShadowImages: CanvasImageSource[] = [];
    protected blackShadowImages: CanvasImageSource[] = [];

    constructor(parent?: GoTheme) {
        super()
        this.name = "JSONTheme" ; //JSONTheme.styles.themeName
        this.parent = parent

        if (!JSONTheme.styles) {
            JSONTheme.styles = new JSONThemeStyle;
        }

        if (JSONTheme.json && JSONTheme.json.length > 4) {
            this.loadFromText(JSONTheme.json)
        }
        else {
            this.loadFromText(JSONTheme.getDefaultJSON())
        }

    }

    public rebuildImages(){
        this.whiteImages = [];
        this.blackImages = [];
        this.whiteShadowImages = [];
        this.blackShadowImages = [];
        
        if (JSONTheme.styles.whiteStones && JSONTheme.styles.whiteStones.length > 0) {
            for (let src of JSONTheme.styles.whiteStones){
                let img = new Image();
                img.src = src
                this.whiteImages.push(img)
            }
        }

        if (JSONTheme.styles.blackStones && JSONTheme.styles.blackStones.length > 0) {
            for (let src of JSONTheme.styles.blackStones){
                let img = new Image();
                img.src = src
                this.blackImages.push(img)
            }
        }

        if (JSONTheme.styles.whiteShadows && JSONTheme.styles.whiteShadows.length > 0) {
            for (let src of JSONTheme.styles.whiteShadows){
                let img = new Image();
                img.src = src
                this.whiteShadowImages.push(img)
            }
        }

        if (JSONTheme.styles.blackShadows && JSONTheme.styles.blackShadows.length > 0) {
            for (let src of JSONTheme.styles.blackShadows){
                let img = new Image();
                img.src = src
                this.blackShadowImages.push(img)
            }
        }

        // created default shadows if needed
        if (JSONTheme.styles.shadows && JSONTheme.styles.shadows.length > 0 ){
            if(this.whiteShadowImages.length == 0 ){
                for (let src of JSONTheme.styles.shadows){
                    let img = new Image();
                    img.src = src
                    this.whiteShadowImages.push(img)
                }
            }
            if(this.blackShadowImages.length == 0 ){
                for (let src of JSONTheme.styles.shadows){
                    let img = new Image();
                    img.src = src
                    this.blackShadowImages.push(img)
                }
            }
        }
    }
    

    public loadFromURL(url: string){

    }

    protected static loadFromText(text: string): boolean{
        try {
            let j = JSON.parse(text)
            let s = new JSONThemeStyle; // construct default item to check the keys & type values

            JSONTheme.styles = new JSONThemeStyle;
            for (let k in j) {
                //@ts-ignore
                if (j[k] != undefined && typeof s[k] == typeof j[k]) {
                    //@ts-ignore
                    JSONTheme.styles[k] = j[k];
                }
            }
            return true;

        } catch (err){
            console.log(err); // FIXME: parse error is not severe enough to crash OGS, but should tell user
            return false;
        }

    }

    public static parseJSON(): boolean {
        try {
            let j = JSON.parse(JSONTheme.json)
            let s = new JSONThemeStyle; // construct default item to check the keys & type values

            JSONTheme.styles = new JSONThemeStyle;
            for (let k in j) {
                //@ts-ignore
                if (j[k] != undefined && typeof s[k] == typeof j[k]) {
                    //@ts-ignore
                    JSONTheme.styles[k] = j[k];
                }
            }
            return true;

        } catch (err) {
            console.log(err); // FIXME: parse error is not severe enough to crash OGS, but should tell user
            return false;
        }

    }
    
    public static setJSON(text: string) {
        JSONTheme.json = text;
        JSONTheme.parseJSON();
        //console.log(JSONTheme.json)
        //console.log(JSONTheme.styles)
    }


    public loadFromText(text: string){
    
        if(JSONTheme.loadFromText(text)){
            this.rebuildImages();
        }
    }


    get theme_name(): string {
        return "JSONTheme";
        //return JSONTheme.styles.name;
    }
    public sort(): number {
        return JSONTheme.styles.priority;
    }

    public getStyles(): JSONThemeStyle {
        return JSONTheme.styles;
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



    public multiRotate(ctx: CanvasRenderingContext2D, rotations: Array<Array<number>>, rando: number){
        let tot = 0;
        for (const r of rotations) {
            if (r.length > 0) {
                tot += r[rando % r.length];
            }
        }
        ctx.rotate(tot*Math.PI/180.0);
    }

    public multiTranslate(ctx: CanvasRenderingContext2D, translations: Array<Array<[number, number]>>, rando: number, inverse: boolean = false) {
        let x = 0;
        let y = 0;

        for (const t of translations) {
            if (t.length > 0){
                x += t[rando % t.length][0];
                y += t[rando % t.length][1];
            }
        }
        if (inverse) {
            ctx.translate(-x, -y)
        } else {
            ctx.translate(x, y)
        }
    }

    public multiScale(ctx: CanvasRenderingContext2D, scales: Array<Array<[number, number] | number>>, rando: number) {
        for (const s of scales) {
            if (s.length > 0) {
                if (typeof s[rando % s.length] === "number") {
                    const thescale = s[rando % s.length] as number;
                    ctx.scale(thescale, thescale);
                }
                else {
                    const thescale = s[rando % s.length] as [number, number];
                    if (thescale)
                        ctx.scale(thescale[0], thescale[1]);
                }
            }
        }
    }

    public activateMatrixFor(ctx:CanvasRenderingContext2D, kind: string, rando: number) {
        const rots = JSONTheme.styles.rotations;
        const offs = JSONTheme.styles.offsets;
        const sizes = JSONTheme.styles.sizes;

        const stoneRots = JSONTheme.styles.stoneRotations;
        const stoneOffs = JSONTheme.styles.stoneOffsets;
        const stoneSizes = JSONTheme.styles.stoneSizes;
        
        const shadRots = JSONTheme.styles.shadowRotations;
        const shadOffs = JSONTheme.styles.shadowOffsets;
        const shadSizes = JSONTheme.styles.shadowSizes;

        switch (kind) {
            case "white":
                this.multiTranslate(ctx, [
                    offs,
                    stoneOffs,
                    JSONTheme.styles.whiteStoneOffsets,
                    ],
                    rando,
                    false
                )            
                this.multiScale(ctx, [
                    sizes,
                    stoneSizes,
                    JSONTheme.styles.whiteStoneSizes
                    ], 
                    rando
                );
                this.multiRotate(ctx, [
                    rots,
                    stoneRots,
                    JSONTheme.styles.whiteStoneRotations
                    ], 
                    rando
                );
            break;
            case "black":
                this.multiTranslate(ctx, [
                    offs,
                    stoneOffs,
                    JSONTheme.styles.blackStoneOffsets,
                    ],
                    rando,
                    false
                )            
                this.multiScale(ctx, [
                    sizes,
                    stoneSizes,
                    JSONTheme.styles.blackStoneSizes
                    ], 
                    rando
                );
                this.multiRotate(ctx, [
                    rots,
                    stoneRots,
                    JSONTheme.styles.blackStoneRotations
                    ], 
                    rando
                );
            break;
            case "blackShadow":
                this.multiTranslate(ctx, [
                    offs,
                    shadOffs,
                    JSONTheme.styles.blackShadowOffsets,
                    ],
                    rando,
                    false
                )            
                this.multiScale(ctx, [
                    sizes,
                    shadSizes,
                    JSONTheme.styles.blackShadowSizes
                    ], 
                    rando
                );
                this.multiRotate(ctx, [
                    rots,
                    shadRots,
                    JSONTheme.styles.blackShadowRotations
                    ], 
                    rando
                );
            break;
            case "whiteShadow":
                this.multiTranslate(ctx, [
                    offs,
                    shadOffs,
                    JSONTheme.styles.whiteShadowOffsets,
                    ],
                    rando,
                    false
                )            
                this.multiScale(ctx, [
                    sizes,
                    shadSizes,
                    JSONTheme.styles.whiteShadowSizes
                    ], 
                    rando
                );
                this.multiRotate(ctx, [
                    rots,
                    shadRots,
                    JSONTheme.styles.whiteShadowRotations
                    ], 
                    rando
                );                                            
        }
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
                
                let t = shadow_ctx.getTransform();

                shadow_ctx.translate(cx,cy);
                shadow_ctx.scale(radius*2.0, radius*2.0);
                this.activateMatrixFor(shadow_ctx, "whiteShadow", rando);

                shadow_ctx.drawImage(img, -0.5, -0.5, 1.0, 1.0); // unit box centered around cx, cy

                shadow_ctx.setTransform(t);

            }
            let img = this.whiteImages[rando % this.whiteImages.length]

            let t = ctx.getTransform();
 
            ctx.translate(cx,cy);
            ctx.scale(radius*2.0, radius*2.0);
            this.activateMatrixFor(ctx, "white", rando);

            ctx.drawImage(img, -0.5, -0.5, 1.0, 1.0); // unit box centered around cx, cy

            ctx.setTransform(t)
        }
        else {
            let rando = Math.floor(cx*31 + cy*29);

            //if (shadow_ctx) do something
            let t = ctx.getTransform();
            ctx.save()
            ctx.translate(cx,cy);
            ctx.scale(radius*2, radius*2);
            this.activateMatrixFor(ctx, "white", rando);

            ctx.fillStyle = this.getWhiteStoneColor();
            ctx.strokeStyle = this.getWhiteTextColor();
            ctx.lineWidth = 1/20;
            ctx.beginPath();
            //ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
            ctx.arc(0,0, 0.5, 0, 2*Math.PI, true)
            ctx.fill();
            ctx.stroke();
            ctx.restore()
            ctx.setTransform(t);
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
                
                let t = shadow_ctx.getTransform();
                shadow_ctx.translate(cx,cy);
                shadow_ctx.scale(radius*2.0, radius*2.0);
                this.activateMatrixFor(shadow_ctx, "blackShadow", rando);
                shadow_ctx.drawImage(img, -0.5, -0.5, 1.0, 1.0); // unit box centered around cx, cy

                shadow_ctx.setTransform(t);

            }

            let img = this.blackImages[rando % this.blackImages.length]
            
            let t = ctx.getTransform();
            ctx.translate(cx,cy);
            ctx.scale(radius*2.0, radius*2.0);
            this.activateMatrixFor(ctx, "black", rando);
            ctx.drawImage(img, -0.5, -0.5, 1.0, 1.0); // unit box centered around cx, cy

            ctx.setTransform(t);

        }
        else {

            //if (shadow_ctx) do something
            let t = ctx.getTransform();
            let rando = Math.floor(cx*31 + cy*29);
            ctx.save()
            ctx.translate(cx,cy);
            ctx.scale(radius*2, radius*2);
            this.activateMatrixFor(ctx, "black", rando);

            ctx.fillStyle = this.getBlackStoneColor();
            ctx.strokeStyle = this.getBlackTextColor();
            ctx.lineWidth = 1/20;
            ctx.beginPath();
            ctx.arc(0,0, 0.5, 0, 2*Math.PI, true);
            ctx.fill();
            // ctx.stroke(); // black stones don't need a stroke if they're dark (and they prob will be)
            ctx.restore();
            ctx.setTransform(t);
        }

    }

    /* Should return true if you would like the shadow layer to be present. False
     * speeds up rendering typically */
    public stoneCastsShadow(radius: number): boolean {
        return true; // themes will always be given a shadow layer
    }

    /* Returns the color that should be used for white stones */
    public getWhiteStoneColor(): string {
        if (JSONTheme.styles.whiteStoneColor)
            return JSONTheme.styles.whiteStoneColor
        else
            return "#ffffff"
    }

    /* Returns the color that should be used for black stones */
    public getBlackStoneColor(): string {
        if (JSONTheme.styles.blackStoneColor) 
            return JSONTheme.styles.blackStoneColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for text over white stones */
    public getWhiteTextColor(color?: string): string {
        if (JSONTheme.styles.whiteTextColor)
            return JSONTheme.styles.whiteTextColor;
        else
            return "#000000"
    }

    /* Returns the color that should be used for text over black stones */
    public getBlackTextColor(color?: string): string {
        if (JSONTheme.styles.blackTextColor)
            return JSONTheme.styles.blackTextColor;
        else
            return "#ffffff"
    }

    /* Returns a set of CSS styles that should be applied to the background layer (ie the board) */
    public getBackgroundCSS(): GoThemeBackgroundCSS {
        if (JSONTheme.styles.boardImage) {
            return {
                "background-image": `url("${JSONTheme.styles.boardImage}")`,
                "background-color": JSONTheme.styles.boardColor, 
                "background-size": "cover"
            };
        } else {
            return {
                "background-color": JSONTheme.styles.boardColor, 
                "background-image": "",
            };
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
        if (JSONTheme.styles.lineColor)
            return JSONTheme.styles.lineColor;
        else if (JSONTheme.styles.boardInkColor)
            return JSONTheme.styles.boardInkColor
        else
            return "#000000"
    }

    /* Returns the color that should be used for lines * when there is text over the square */
    public getFadedLineColor(): string {
        if (JSONTheme.styles.fadedLineColor)
            return JSONTheme.styles.fadedLineColor;
        else if (JSONTheme.styles.boardFadedInkColor)
            return JSONTheme.styles.boardFadedInkColor
        else
            return "#888888"
    }

    /* Returns the color that should be used for star points */
    public getStarColor(): string {
        if (JSONTheme.styles.starColor) 
            return JSONTheme.styles.starColor;
        else if (JSONTheme.styles.boardInkColor)
            return JSONTheme.styles.boardInkColor
        else
            return "#000000"
    }

    /* Returns the color that should be used for star points
     * when there is text over the square */
    public getFadedStarColor(): string {
        if (JSONTheme.styles.fadedStarColor)
            return JSONTheme.styles.fadedStarColor;
        else if (JSONTheme.styles.boardFadedInkColor)
            return JSONTheme.styles.boardFadedInkColor
        else
            return "#888888"
    }

    /* Returns the color that text should be over empty intersections */
    public getBlankTextColor(): string {
        if (JSONTheme.styles.blankTextColor)
            return JSONTheme.styles.blankTextColor;
        else if (JSONTheme.styles.boardInkColor)
            return JSONTheme.styles.boardInkColor;
        else
            return "#000000"
    }

    /** Returns the color that should be used for labels */
    public getLabelTextColor(): string {
        if (JSONTheme.styles.coordinateColor)
            return JSONTheme.styles.coordinateColor;
        else if (JSONTheme.styles.boardInkColor)
            return JSONTheme.styles.boardInkColor
        else
            return "#000000"
    }


    public static getDefaultJSON(): string {
        // an example until I figure out how to integrate JSONThemes in OGS
        // these examples are guaranteed to parse
        let json = `
        {
            "name": "BadukBroadcast",
            "boardImage": "https://github.com/upsided/Upsided-Sabaki-Themes/raw/main/baduktv/goban_texture_smooth.png",
            "whiteStones": [
                "https://dl.dropboxusercontent.com/s/l9sglf5m9fdrktq/white1_raw.png?dl=1",
                "https://dl.dropboxusercontent.com/s/bxmlts3ag4h0zgm/white2_raw.png?dl=1",
                "https://dl.dropboxusercontent.com/s/wag83qram5caqpb/white3_raw.png?dl=1"
            ],
            "blackStones": [
                "https://dl.dropboxusercontent.com/s/0viuf2iw33m5i1b/black2_raw.png?dl=1",
                "https://dl.dropboxusercontent.com/s/0viuf2iw33m5i1b/black2_raw.png?dl=1"
            ],
            "whiteShadows": [
                "https://dl.dropboxusercontent.com/s/s079o0tm7ddmzr7/black_shade.png?dl=1"
            ],
            "blackShadows": [
                "https://dl.dropboxusercontent.com/s/s079o0tm7ddmzr7/black_shade.png?dl=1"
            ],
            "sizes": [0.9],
            "shadowSizes": [1.1]
        }
        `
    
        json = `
        {
            "name": "just-colors",
            "boardColor": "#CBA170",
            "boardInkColor": "#382933",
            "whiteStoneColor": "#FAF1E8",
            "blackStoneColor": "#2B2825",
            "blackTextColor": "#FAF1E8",
            "whiteTextColor": "#2B2825",
            "blankTextColor": "#FAF1E8"
        }
        `
        
        json = ` 
        {
            "name": "shuffled-stones",
            "boardColor": "#CBA170",
            "boardInkColor": "#382933",
            "whiteStoneColor": "#FAF1E8",
            "blackStoneColor": "#2B2825",
            "blackTextColor": "#FAF1E8",
            "whiteTextColor": "#2B2825",
            "blankTextColor": "#FAF1E8",
            "sizes": [0.98],
            "offsets": [[0.02, 0.01], [0.05, -0.02], [-0.01, 0.05]]
        }        
        `
        
        json = `
        {
            "name": "Happy Stones",
            "boardImage": "https://raw.githubusercontent.com/upsided/Upsided-Sabaki-Themes/main/happy-stones/goban_texture_fancy_orange.png",
            "whiteStones": [
                "https://raw.githubusercontent.com/upsided/Upsided-Sabaki-Themes/main/happy-stones/glass_white.png"
            ],
            "blackStones": [
                "https://raw.githubusercontent.com/upsided/Upsided-Sabaki-Themes/main/happy-stones/glass_black.png"
            ],
            "sizes": [2],
            "offsets": [[0.45,0.45]]
        }
        `
        json = `
        {
            "name": "hikaru",
            "boardImage": "https://raw.githubusercontent.com/upsided/Upsided-Sabaki-Themes/main/hikaru/board.svg",
            "boardInkColor": "rgb(76, 47, 0, 0.8)",
            "whiteStones": [
                "https://raw.githubusercontent.com/upsided/Upsided-OGS-Themes/main/ogs-hikaru/hikaru_white_stone_raw.svg"
            ],
            "blackStones": [
                "https://raw.githubusercontent.com/upsided/Upsided-OGS-Themes/main/ogs-hikaru/hikaru_black_stone_raw.svg"
            ],
            "shadows": [
                "https://raw.githubusercontent.com/upsided/Upsided-OGS-Themes/main/ogs-hikaru/hikaru_stone_shadow.svg"
            ],
            "shadowOffsets": [[0.02, 0.1]],
            "shadowSizes": [1.1]
        }
        `

        return json
    }
    
}

export default function (GoThemes: GoThemesInterface) {
    JSONTheme.setJSON(JSONTheme.getDefaultJSON());
    GoThemes["black"]["JSONTheme"] = JSONTheme;
    GoThemes["white"]["JSONTheme"] = JSONTheme;
    GoThemes["board"]["JSONTheme"] = JSONTheme;
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