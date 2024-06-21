/*
 * Copyright (C)  Online-Go.com
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

/** Simple 50% blend of two colors in hex format */
export function color_blend(c1: string, c2: string): string {
    const c1_rgb = hexToRgb(c1);
    const c2_rgb = hexToRgb(c2);
    const blend = (a: number, b: number) => Math.round((a + b) / 2);
    return rgbToHex(
        blend(c1_rgb.r, c2_rgb.r),
        blend(c1_rgb.g, c2_rgb.g),
        blend(c1_rgb.b, c2_rgb.b),
    );
}

/** Convert hex color to RGB */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        throw new Error("invalid hex color");
    }
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
    };
}

/** Convert RGB color to hex */
function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
