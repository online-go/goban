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

let catalog: any = {};
let debug_mode = false;
const debug_wrap = debug_mode ? (s: string) => `[${s}]` : (s: string) => s;

export interface GobanStrings {
    "Your move": string;
    "White": string;
    "Black": string;
    "Illegal Ko Move": string;
    "Move is suicidal": string;
    "Loading...": string;
    "Processing...": string;
    "Submitting...": string;
    "A stone has already been placed here": string;
    "Illegal board repetition": string;
    "Error submitting move": string;
    "Game Finished": string;
    "Black to move": string;
    "White to move": string;
    "Your move - opponent passed": string;
    "Review": string;
    "Control passed to %s": string;
    "Synchronization error, reloading": string;
    "Stone Removal": string;
    "Stone Removal Phase": string;
    "Enter the label you want to add to the board": string;
    "Error": string;
    "Self-capture is not allowed": string;
    "The game would be repeating with that move, please play somewhere else first": string;

    "Black Walnut": string;
    "Book": string;
    "Glass": string;
    "Granite": string;
    "HNG Night": string;
    "HNG": string;
    "Kaya": string;
    "Bright Kaya": string;
    "Night Play": string;
    "Night": string;
    "Persimmon": string;
    "Plain": string;
    "Custom": string;
    "Red Oak": string;
    "Shell": string;
    "Slate": string;
    "Worn Glass": string;
    "Anime": string;

    "%swk": string /* short time week */;
    "%sd": string /* short time day */;
    "%sh": string /* short time hour */;
    "%sm": string /* short time minute */;
    "%ss": string /* short time second */;
}

export function setGobanTranslations(_catalog: GobanStrings, _debug_mode: boolean = false): void {
    catalog = _catalog;
    debug_mode = _debug_mode;
}

export function interpolate(str: string, params: any): string {
    if (Array.isArray(params)) {
        let idx = 0;
        return str.replace(/%[sd]/g, (_, __, position) => {
            if (idx >= params.length) {
                throw new Error(`Missing array index ${idx} for string: ${str}`);
            }
            return params[idx++];
        });
    }
    if (typeof params === "object") {
        return str.replace(/{{([^}]+)}}/g, (_, key, position) => {
            if (!(key in params)) {
                throw new Error(`Missing interpolation key: ${key} for string: ${str}`);
            }
            return params[key];
        });
    }
    return str.replace(/%[sd]/g, (_, __, position) => params);
}

export function _(msgid: keyof GobanStrings): string {
    if (msgid in catalog) {
        return catalog[msgid];
    }
    return debug_wrap(msgid);
}
