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

import { GoTheme, GoThemeBackgroundCSS } from "../GoTheme";
import { GoThemesInterface } from "../GoThemes";
import { _ } from "../translate";
import { GobanCore } from "../GobanCore";

function getCDNReleaseBase() {
    if (GobanCore.hooks.getCDNReleaseBase) {
        return GobanCore.hooks.getCDNReleaseBase();
    }
    return "";
}

export default function (GoThemes: GoThemesInterface) {
    class Kaya extends GoTheme {
        sort(): number {
            return 10;
        }
        get theme_name(): string {
            return "Kaya";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/kaya.jpg')",
            };
        }
        getLineColor(): string {
            return "#000000";
        }
        getFadedLineColor(): string {
            return "#888888";
        }
        getStarColor(): string {
            return "#000000";
        }
        getFadedStarColor(): string {
            return "#888888";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#444444";
        }
    }

    _("Kaya"); // ensure translation
    GoThemes["board"]["Kaya"] = Kaya;

    class RedOak extends GoTheme {
        sort(): number {
            return 20;
        }
        get theme_name(): string {
            return "Red Oak";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/oak.jpg')",
            };
        }
        getLineColor(): string {
            return "#000000";
        }
        getFadedLineColor(): string {
            return "#888888";
        }
        getStarColor(): string {
            return "#000000";
        }
        getFadedStarColor(): string {
            return "#888888";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#000000";
        }
    }

    _("Red Oak"); // ensure translation
    GoThemes["board"]["Red Oak"] = RedOak;

    class Persimmon extends GoTheme {
        sort(): number {
            return 30;
        }
        get theme_name(): string {
            return "Persimmon";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/persimmon.jpg')",
            };
        }
        getLineColor(): string {
            return "#000000";
        }
        getFadedLineColor(): string {
            return "#888888";
        }
        getStarColor(): string {
            return "#000000";
        }
        getFadedStarColor(): string {
            return "#888888";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#000000";
        }
    }

    _("Persimmon"); // ensure translation
    GoThemes["board"]["Persimmon"] = Persimmon;

    class BlackWalnut extends GoTheme {
        sort(): number {
            return 40;
        }
        get theme_name(): string {
            return "Black Walnut";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/black_walnut.jpg')",
            };
        }
        getLineColor(): string {
            return "#000000";
        }
        getFadedLineColor(): string {
            return "#4A2F24";
        }
        getStarColor(): string {
            return "#000000";
        }
        getFadedStarColor(): string {
            return "#4A2F24";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#000000";
        }
    }

    _("Black Walnut"); // ensure translation
    GoThemes["board"]["Black Walnut"] = BlackWalnut;

    class Granite extends GoTheme {
        sort(): number {
            return 40;
        }
        get theme_name(): string {
            return "Granite";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/granite.jpg')",
            };
        }
        getLineColor(): string {
            return "#cccccc";
        }
        getFadedLineColor(): string {
            return "#888888";
        }
        getStarColor(): string {
            return "#cccccc";
        }
        getFadedStarColor(): string {
            return "#888888";
        }
        getBlankTextColor(): string {
            return "#ffffff";
        }
        getLabelTextColor(): string {
            return "#cccccc";
        }
    }

    _("Granite"); // ensure translation
    GoThemes["board"]["Granite"] = Granite;

    class Anime extends GoTheme {
        sort(): number {
            return 10;
        }
        get theme_name(): string {
            return "Anime";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "url('" + getCDNReleaseBase() + "/img/anime_board.svg')",
                "background-size": "cover",
            };
        }
        getLineColor(): string {
            return "#000000";
        }
        getFadedLineColor(): string {
            return "#888888";
        }
        getStarColor(): string {
            return "#000000";
        }
        getFadedStarColor(): string {
            return "#888888";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#444444";
        }
    }

    _("Anime"); // ensure translation
    GoThemes["board"]["Anime"] = Anime;

    class BrightKaya extends GoTheme {
        sort(): number {
            return 15;
        }
        get theme_name(): string {
            return "Bright Kaya";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#DBB25B",
                "background-image": "url('" + getCDNReleaseBase() + "/img/kaya.jpg')",
            };
        }
        getLineColor(): string {
            return "#FFFFFF";
        }
        getFadedLineColor(): string {
            return "#FFFFFF";
        }
        getStarColor(): string {
            return "#FFFFFF";
        }
        getFadedStarColor(): string {
            return "#999999";
        }
        getBlankTextColor(): string {
            return "#FFFFFF";
        }
        getLabelTextColor(): string {
            return "#FFFFFF";
        }
    }

    _("Bright Kaya"); // ensure translation
    GoThemes["board"]["Bright Kaya"] = BrightKaya;
}
