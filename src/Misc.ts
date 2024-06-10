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

/*
 * SPEC: https://www.red-bean.com/sgf/sgf4.html#text
 *
 * in sgf (as per spec):
 * - slash is an escape char
 * - closing bracket is a special symbol
 * - whitespaces other than space & newline should be converted to space
 * - in compose data type, we should also escape ':'
 *   (but that is only used in special SGF properties)
 *
 * so we gotta:
 * - escape (double) all slashes in the text (so that they do not have the special meaning)
 * - escape any closing brackets ] (as it closes e.g. the comment section)
 * - replace whitespace
 * - [opt] handle colon
 */
export function escapeSGFText(txt: string, escapeColon: boolean = false): string {
    // escape slashes first
    // 'blah\blah' -> 'blah\\blah'
    txt = txt.replace(/\\/g, "\\\\");

    // escape closing square bracket ]
    // 'blah[9dan]' -> 'blah[9dan\]'
    txt = txt.replace(/]/g, "\\]");

    // no need to escape opening bracket, SGF grammar handles that
    // 'C[[[[[[blah blah]'
    //   ^ after it finds the first [, it is only looking for the closing bracket
    // parsing SGF properties, so the remaining [ are safely treated as text
    //txt = txt.replace(/[/g, "\\[");

    // sub whitespace except newline & carriage return by space
    txt = txt.replace(/[^\S\r\n]/g, " ");

    if (escapeColon) {
        txt = txt.replace(/:/g, "\\:");
    }
    return txt;
}

// in SGF simple text, we also need to get rid of the newlines
export function newline2space(txt: string): string {
    return txt.replace(/[\r\n]/g, " ");
}

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

function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
