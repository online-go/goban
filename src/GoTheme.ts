/*
 * Copyright 2012-2019 Online-Go.com
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

//import * as PIXI from 'pixi.js-legacy';

export interface GoThemeBackgroundCSS {
    'background-color'?: string;
    'background-image'?: string;
}

export interface GoThemeBackgroundReactStyles {
    'backgroundColor'?: string;
    'backgroundImage'?: string;
}

export class GoTheme {
    public name: string;
    public styles: {[style_name:string]: string} = {};
    protected parent?: GoTheme; // An optional parent theme

    constructor(parent?:GoTheme) {
        this.name = `[ERROR theme missing name]`;
        this.parent = parent;
    }

    get theme_name():string {
        return 'ERROR missing theme_name';
    }
    public sort():number {
        return 0;
    }

    /* Returns an array of black stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeBlackStone method */
    public preRenderBlack(radius:number, seed:number): any {
        return {"black": "stone"};
    }

    /* Returns an array of white stone objects. The structure
     * of the array elements is up to the implementor, as they are passed
     * verbatim to the placeWhiteStone method */
    public preRenderWhite(radius:number, seed:number): any {
        return {"white": "stone"};
    }

    /* Places a pre rendered stone onto the canvas, centered at cx, cy */
    public placeWhiteStone(ctx:CanvasRenderingContext2D, shadow_ctx:CanvasRenderingContext2D | null, stone:any, cx:number, cy:number, radius:number) {
        //if (shadow_ctx) do something
        ctx.fillStyle = this.getWhiteStoneColor();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
        ctx.fill();
    }

    public placeBlackStone(ctx:CanvasRenderingContext2D, shadow_ctx:CanvasRenderingContext2D | null, stone:any, cx:number, cy:number, radius:number) {
        //if (shadow_ctx) do something
        ctx.fillStyle = this.getBlackStoneColor();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
        ctx.fill();
    }

    /** Returns a PIXI sprite for a white stone of the given radius using the given seed */
    /*
    public whiteStoneTexture(application:PIXI.Application, radius:number, seed:number):PIXI.Texture {
        let key = `white-disc-${radius}`;
        if (!(key in PIXI.utils.TextureCache)) {
            let graphics = new PIXI.Graphics();
            graphics
                .lineStyle(1.0, color2number(this.getBlackStoneColor()))
                .beginFill(color2number(this.getWhiteStoneColor()))
                .drawCircle(radius/2, radius/2, radius)
                .endFill();
            let texture = application.renderer.generateTexture(graphics, PIXI.SCALE_MODES.LINEAR, 1);
            PIXI.Texture.addToCache(texture, key);
            graphics.destroy({texture: false, baseTexture:false});
        }

        return PIXI.utils.TextureCache[key];
    }
    */

    /** Returns a PIXI sprite for a white stone of the given radius using the given seed */
    /*
    public blackStoneTexture(application:PIXI.Application, radius:number, seed:number):PIXI.Texture {
        let key = `black-disc-${radius}`;
        if (!(key in PIXI.utils.TextureCache)) {
            let graphics = new PIXI.Graphics();
            graphics
                .lineStyle(1.0, color2number(this.getBlackStoneColor()))
                .beginFill(color2number(this.getBlackStoneColor()))
                .drawCircle(radius/2, radius/2, radius)
                .endFill();
            let texture = application.renderer.generateTexture(graphics, PIXI.SCALE_MODES.LINEAR, 1);
            PIXI.Texture.addToCache(texture, key);
            graphics.destroy({texture: false, baseTexture:false});
        }

        return PIXI.utils.TextureCache[key];
    }
    */

    /* Should return true if you would like the shadow layer to be present. False
     * speeds up rendering typically */
    public stoneCastsShadow(radius:number):boolean {
        return false;
    }

    /* Returns the color that should be used for white stones */
    public getWhiteStoneColor():string {
        return "#ffffff";
    }

    /* Returns the color that should be used for black stones */
    public getBlackStoneColor():string {
        return "#000000";
    }

    /* Returns the color that should be used for text over white stones */
    public getWhiteTextColor(color?:string):string {
        return "#000000";
    }

    /* Returns the color that should be used for text over black stones */
    public getBlackTextColor(color?:string):string {
        return "#ffffff";
    }

    /* Returns a set of CSS styles that should be applied to the background layer (ie the board) */
    public getBackgroundCSS():GoThemeBackgroundCSS {
        return {
            "background-color": "#DCB35C",
            "background-image": ""
        };
    }

    /* Returns a set of CSS styles (for react) that should be applied to the background layer (ie the board) */
    public getReactStyles():GoThemeBackgroundReactStyles {
        let ret:GoThemeBackgroundReactStyles = {};
        let css:GoThemeBackgroundCSS  = this.getBackgroundCSS();

        ret.backgroundColor = css['background-color'];
        ret.backgroundImage = css['background-image'];

        return ret;
    }

    /* Returns the color that should be used for lines */
    public getLineColor():string {
        return "#000000";
    }

    /* Returns the color that should be used for lines * when there is text over the square */
    public getFadedLineColor():string {
        return "#888888";
    }

    /* Returns the color that should be used for star points */
    public getStarColor():string {
        return "#000000";
    }

    /* Returns the color that should be used for star points
     * when there is text over the square */
    public getFadedStarColor():string {
        return "#888888";
    }

    /* Returns the color that text should be over empty intersections */
    public getBlankTextColor():string {
        return "#000000";
    }

    /** Returns the color that should be used for labels */
    public getLabelTextColor():string {
        return "#000000";
    }
}