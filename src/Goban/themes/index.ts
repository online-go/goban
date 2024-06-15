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

export { Theme } from "./Theme";

import { Theme } from "./Theme";

export interface ThemesInterface {
    white: { [name: string]: typeof Theme };
    black: { [name: string]: typeof Theme };
    board: { [name: string]: typeof Theme };
}

export const THEMES: ThemesInterface = {
    white: {},
    black: {},
    board: {},
};
export const THEMES_SORTED: {
    white: Theme[];
    black: Theme[];
    board: Theme[];
} = { white: [], black: [], board: [] };

import init_board_plain from "./board_plain";
import init_board_woods from "./board_woods";
import init_plain_stones from "./plain_stones";
import init_rendered from "./rendered_stones";
import init_image_stones from "./image_stones";

init_board_plain(THEMES);
init_board_woods(THEMES);
init_plain_stones(THEMES);
init_rendered(THEMES);
init_image_stones(THEMES);

function theme_sort(a: Theme, b: Theme) {
    return a.sort() - b.sort();
}

for (const k in THEMES) {
    THEMES_SORTED[k as keyof ThemesInterface] = Object.keys(THEMES[k as keyof ThemesInterface]).map(
        (n) => {
            return new THEMES[k as keyof ThemesInterface][n]();
        },
    );
    THEMES_SORTED[k as keyof ThemesInterface].sort(theme_sort);
}
