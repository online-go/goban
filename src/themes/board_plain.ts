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
import { GobanCore } from "../GobanCore";
import { _ } from "../translate";

// Converts a six-digit hex string to rgba() notation
function hexToRgba(raw: string, alpha: number = 1): string {
    const hex = raw.replace("#", "");
    if (hex.length !== 6) {
        return raw;
    }
    const r = parseInt(`0x${hex.substr(0, 2)}`);
    const g = parseInt(`0x${hex.substr(2, 2)}`);
    const b = parseInt(`0x${hex.substr(4, 2)}`);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function (GoThemes: GoThemesInterface) {
    class Plain extends GoTheme {
        sort(): number {
            return 0;
        }
        get theme_name(): string {
            return "Plain";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": GobanCore.hooks.plainBoardColor
                    ? GobanCore.hooks.plainBoardColor()
                    : "#DCB35C",
                "background-image": GobanCore.hooks.plainBoardUrl
                    ? "url('" + GobanCore.hooks.plainBoardUrl() + "')"
                    : "",
                "background-size": "cover",
            };
        }
        getLineColor(): string {
            return GobanCore.hooks.plainBoardLineColor
                ? GobanCore.hooks.plainBoardLineColor()
                : "#000000";
        }
        getFadedLineColor(): string {
            return hexToRgba(
                GobanCore.hooks.plainBoardLineColor
                    ? GobanCore.hooks.plainBoardLineColor()
                    : "#000000",
                0.5,
            );
        }
        getStarColor(): string {
            return GobanCore.hooks.plainBoardLineColor
                ? GobanCore.hooks.plainBoardLineColor()
                : "#000000";
        }
        getFadedStarColor(): string {
            return hexToRgba(
                GobanCore.hooks.plainBoardLineColor
                    ? GobanCore.hooks.plainBoardLineColor()
                    : "#000000",
                0.5,
            );
        }
        getBlankTextColor(): string {
            return GobanCore.hooks.plainBoardLineColor
                ? GobanCore.hooks.plainBoardLineColor()
                : "#000000";
        }
        getLabelTextColor(): string {
            return hexToRgba(
                GobanCore.hooks.plainBoardLineColor
                    ? GobanCore.hooks.plainBoardLineColor()
                    : "#000000",
                0.75,
            );
        }
    }

    _("Plain"); // ensure translation exists
    GoThemes["board"]["Plain"] = Plain;

    class Night extends GoTheme {
        sort(): number {
            return 100;
        }
        get theme_name(): string {
            return "Night Play";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#444444",
                "background-image": "",
            };
        }
        getLineColor(): string {
            return "#555555";
        }
        getFadedLineColor(): string {
            return "#333333";
        }
        getStarColor(): string {
            return "#555555";
        }
        getFadedStarColor(): string {
            return "#333333";
        }
        getBlankTextColor(): string {
            return "#ffffff";
        }
        getLabelTextColor(): string {
            return "#555555";
        }
    }

    _("Night Play"); // ensure translation exists
    GoThemes["board"]["Night Play"] = Night;

    class HNG extends GoTheme {
        static C = "#00193E";
        static C2 = "#004C75";
        sort(): number {
            return 105;
        }
        get theme_name(): string {
            return "HNG";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#00e7fc",
                "background-image": "",
            };
        }
        getLineColor(): string {
            return HNG.C;
        }
        getFadedLineColor(): string {
            return "#00AFBF";
        }
        getStarColor(): string {
            return HNG.C;
        }
        getFadedStarColor(): string {
            return "#00AFBF";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return HNG.C2;
        }
    }

    _("HNG"); // ensure translation exists
    GoThemes["board"]["HNG"] = HNG;

    class HNGNight extends GoTheme {
        static C = "#007591";
        sort(): number {
            return 105;
        }
        get theme_name(): string {
            return "HNG Night";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#090C1F",
                "background-image": "",
            };
        }
        getLineColor(): string {
            return HNGNight.C;
        }
        getFadedLineColor(): string {
            return "#4481B5";
        }
        getStarColor(): string {
            return HNGNight.C;
        }
        getFadedStarColor(): string {
            return "#4481B5";
        }
        getBlankTextColor(): string {
            return "#ffffff";
        }
        getLabelTextColor(): string {
            return "#4481B5";
        }
    }

    _("HNG Night"); // ensure translation exists
    GoThemes["board"]["HNG Night"] = HNGNight;

    class Book extends GoTheme {
        sort(): number {
            return 110;
        }
        get theme_name(): string {
            return "Book";
        }
        getBackgroundCSS(): GoThemeBackgroundCSS {
            return {
                "background-color": "#ffffff",
                "background-image": "",
            };
        }
        getLineColor(): string {
            return "#555555";
        }
        getFadedLineColor(): string {
            return "#999999";
        }
        getStarColor(): string {
            return "#555555";
        }
        getFadedStarColor(): string {
            return "#999999";
        }
        getBlankTextColor(): string {
            return "#000000";
        }
        getLabelTextColor(): string {
            return "#555555";
        }
    }

    _("Book"); // ensure translation exists
    GoThemes["board"]["Book"] = Book;
}
