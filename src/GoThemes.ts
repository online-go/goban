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

import { GoTheme } from "./GoTheme";

export interface GoThemesInterface {
    white: { [name: string]: typeof GoTheme };
    black: { [name: string]: typeof GoTheme };
    board: { [name: string]: typeof GoTheme };

    // this exists so we can easily do GoThemes[what]
    [_: string]: { [name: string]: typeof GoTheme };
}

import init_board_plain from "./themes/board_plain";
import init_board_woods from "./themes/board_woods";
import init_disc from "./themes/disc";
import init_rendered from "./themes/rendered_stones";
import init_json_theme from "./themes/JSONTheme";
import { JSONTheme } from "./themes/JSONTheme";
import { insertJSONTheme } from "./themes/JSONTheme";

function theme_sort(a: GoTheme, b: GoTheme) {
    return a.sort() - b.sort();
}

export function GetGoThemesSorted(jsonThemes: Array<string> | null = null): {
    [n: string]: Array<GoTheme>;
} {
    const goThemes = GetGoThemes(jsonThemes);
    const goThemesSorted: { [n: string]: Array<GoTheme> } = {
        white: [],
        black: [],
        board: [],
    };

    // map() seemed to mess with the scoping of generated classes
    // so I use for loop
    for (const k of ["white", "black", "board"]) {
        for (const theme_name in goThemes[k]) {
            const b = new goThemes[k][theme_name]();
            if (!(k in goThemesSorted)) {
                goThemesSorted[k] = [];
            }
            goThemesSorted[k].push(b);
        }
        goThemesSorted[k].sort(theme_sort);
    }

    return goThemesSorted;
}

export function GetGoThemes(jsonThemes: Array<string> | null = null): GoThemesInterface {
    // build a list of classes comprised of default themes
    // and all the jsonThemes passed as json text via 'jsonThemes'
    const goThemes: GoThemesInterface = {
        white: {},
        black: {},
        board: {},
    };

    init_board_plain(goThemes);
    init_board_woods(goThemes);
    init_disc(goThemes);
    init_rendered(goThemes);
    init_json_theme(goThemes);

    // insert some stock themes for now just to populate the list
    if (!jsonThemes) {
        jsonThemes = JSONTheme.getStockThemes();
    }
    for (const j of jsonThemes) {
        insertJSONTheme(goThemes, j);
    }
    return goThemes;
}

// this constructs GoTheme & GoThemesSorted module globals which
// needed here for test board and old OGS
export const GoThemes = GetGoThemes();
export const GoThemesSorted = GetGoThemesSorted();
