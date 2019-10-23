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

let win:any = typeof(window) === "undefined" ? {} : window;

export let current_language:string = win["ogs_current_language"] as any || 'en';
export let languages:{[lang:string]: string} = win["ogs_languages"] as any || {'en': 'English'};
export let countries:{[lang:string]: {[country:string]: string}} = win["ogs_countries"] as any || {'en': {'us': 'United States'}};
export let locales:{[lang:string]: {[msg:string]:string}} = win["ogs_locales"] as any || {'en': {}};

let catalog:{[msg:string]: string};
try {
    catalog = locales[current_language] || {};
} catch (e) {
    catalog = {};
}

const debug_wrap = current_language === "debug" ? (s:string) => `[${s}]` : (s:string) => s;

export function gettext(msgid:string):string {
    if (msgid in catalog) {
        return catalog[msgid][0];
    }
    return debug_wrap(msgid);
}

export function pgettext(context:string, msgid:string):string {
    let key = context + "" + msgid;
    if (key in catalog) {
        return catalog[key][0];
    }
    return debug_wrap(msgid);
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
    if (typeof(params) === "object") {
        return str.replace(/{{([^}]+)}}/g,  (_, key, position) => {
            if (!(key in params)) {
                throw new Error(`Missing interpolation key: ${key} for string: ${str}`);
            }
            return params[key];
        });
    }
    return str.replace(/%[sd]/g, (_, __, position) => params);
}
export function _(str:string): string {
    return gettext(str);
}
