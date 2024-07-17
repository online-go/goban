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

export function renderPlainStone(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    color: string,
    strokeStyle: string,
): void {
    let lineWidth = radius * 0.1;
    if (lineWidth < 0.3) {
        lineWidth = 0;
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = strokeStyle;
    if (lineWidth > 0) {
        ctx.lineWidth = lineWidth;
    }
    ctx.beginPath();
    ctx.arc(
        cx,
        cy,
        Math.max(0.1, radius - lineWidth / 2),
        0.001,
        2 * Math.PI,
        false,
    ); /* 0.001 to workaround fucked up chrome bug */
    if (lineWidth > 0) {
        ctx.stroke();
    }
    ctx.fill();
}

export default function (THEMES: ThemesInterface) {
    class Stone extends GobanTheme {
        override sort(): number {
            return 1;
        }
    }

    class Plain extends Stone {
        override get theme_name(): string {
            return "Plain";
        }

        override preRenderBlack(radius: number, seed: number): boolean {
            return true;
        }

        override placeBlackStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D,
            stone: any,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            renderPlainStone(
                ctx,
                cx,
                cy,
                radius,
                this.getBlackStoneColor(),
                this.parent ? this.parent.getLineColor() : this.getLineColor(),
            );
        }

        public override getBlackStoneColor(): string {
            return "#000000";
        }

        public override getBlackTextColor(): string {
            return "#FFFFFF";
        }

        override preRenderWhite(radius: number, seed: number): any {
            return true;
        }

        override placeWhiteStone(
            ctx: CanvasRenderingContext2D,
            shadow_ctx: CanvasRenderingContext2D,
            stone: any,
            cx: number,
            cy: number,
            radius: number,
        ): void {
            renderPlainStone(
                ctx,
                cx,
                cy,
                radius,
                this.getWhiteStoneColor(),
                this.parent ? this.parent.getLineColor() : this.getLineColor(),
            );
        }

        public override getWhiteStoneColor(): string {
            return "#FFFFFF";
        }

        public override getWhiteTextColor(): string {
            return "#000000";
        }

        public override preRenderBlackSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const ret = [];
            const key = this.def_uid(`plain-black-${radius}`);
            ret.push(key);

            let color: string | undefined = this.getBlackStoneColor();
            if (color === "#000000") {
                color = undefined;
            }

            defs.appendChild(
                this.renderSVG(
                    {
                        id: key,
                        //fill: "hsl(8, 7%, 30%)",
                        stroke: color ?? "hsl(8, 7%, 20%)",
                        gradient: {
                            type: "linear",
                            x1: 0.4,
                            y1: 0.1,
                            x2: 0.7,
                            y2: 0.7,
                            stops: [
                                {
                                    offset: 0,
                                    color: color ?? "hsl(8, 7%, 27%)",
                                },
                                {
                                    offset: 100,
                                    color: color ?? "hsl(8, 7%, 12%)",
                                },
                            ],
                        },
                    },
                    radius,
                ),
            );
            return ret;
        }

        public override preRenderWhiteSVG(
            defs: SVGDefsElement,
            radius: number,
            _seed: number,
            _deferredRenderCallback: () => void,
        ): string[] {
            const ret = [];
            const key = this.def_uid(`plain-white-${radius}`);
            ret.push(key);
            defs.appendChild(
                this.renderSVG(
                    {
                        id: key,
                        //fill: "hsl(8, 7%, 30%)",
                        stroke: "hsl(8, 7%, 20%)",
                        gradient: {
                            type: "linear",
                            x1: 0.4,
                            y1: 0.1,
                            x2: 0.9,
                            y2: 0.9,
                            stops: [
                                {
                                    offset: 0,
                                    color: "hsl(8, 7%, 95%)",
                                },
                                {
                                    offset: 90,
                                    color: "hsl(226, 7%, 75%)",
                                },
                            ],
                        },
                    },
                    radius,
                ),
            );
            return ret;
        }
    }

    THEMES["black"]["Plain"] = Plain;
    THEMES["white"]["Plain"] = Plain;
}
