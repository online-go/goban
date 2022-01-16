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
import { GobanCore } from "../GobanCore";
import { _ } from "../translate";

export default function (GoThemes: GoThemesInterface) {
    class Stone extends GoTheme {
        sort(): number {
            return 0;
        }

        placePlainStone(
            ctx: CanvasRenderingContext2D,
            cx: number,
            cy: number,
            radius: number,
            color: string,
        ): void {
            let lineWidth = radius * 0.1;
            if (lineWidth < 0.3) {
                lineWidth = 0;
            }
            ctx.fillStyle = color;
            ctx.strokeStyle = this.parent ? this.parent.getLineColor() : this.getLineColor();
            if (lineWidth > 0) {
                ctx.lineWidth = lineWidth;
            }
            ctx.beginPath();
            ctx.arc(
                cx,
                cy,
                radius - lineWidth / 2,
                0.001,
                2 * Math.PI,
                false,
            ); /* 0.001 to workaround fucked up chrome bug */
            if (lineWidth > 0) {
                ctx.stroke();
            }
            ctx.fill();
        }
    }

    class Black extends Stone {
        get theme_name(): string {
            return "Plain";
        }

        preRenderBlack(radius: number, seed: number): boolean {
            return true;
        }

        placeBlackStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D,
            stone: any,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            this.placePlainStone(ctx, cx, cy, radius, this.getBlackStoneColor());
        }

        public getBlackStoneColor(): string {
            return GobanCore.hooks.discBlackStoneColor
                ? GobanCore.hooks.discBlackStoneColor()
                : "#000000";
        }

        public getBlackTextColor(): string {
            return GobanCore.hooks.discBlackTextColor
                ? GobanCore.hooks.discBlackTextColor()
                : "#FFFFFF";
        }
    }

    class White extends Stone {
        get theme_name(): string {
            return "Plain";
        }

        preRenderWhite(radius: number, seed: number): any {
            return true;
        }

        placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D,
            stone: any,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            this.placePlainStone(ctx, cx, cy, radius, this.getWhiteStoneColor());
        }

        public getWhiteStoneColor(): string {
            return GobanCore.hooks.discWhiteStoneColor
                ? GobanCore.hooks.discWhiteStoneColor()
                : "#FFFFFF";
        }

        public getWhiteTextColor(): string {
            return GobanCore.hooks.discWhiteTextColor
                ? GobanCore.hooks.discWhiteTextColor()
                : "#000000";
        }
    }

    GoThemes["black"]["Plain"] = Black;
    GoThemes["white"]["Plain"] = White;
}
