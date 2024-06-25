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

import { GobanTheme, GobanThemeBackgroundCSS } from "./GobanTheme";
import { ThemesInterface } from "./";
import { callbacks } from "../callbacks";
import { _ } from "../../engine/translate";

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

export default function (THEMES: ThemesInterface) {
    class Plain extends GobanTheme {
        override sort(): number {
            return 1;
        }
        override get theme_name(): string {
            return "Plain";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": "#DCB35C",
                "background-image": "",
            };
        }
        override getLineColor(): string {
            return "#000000";
        }
        override getFadedLineColor(): string {
            return hexToRgba("#000000", 0.5);
        }
        override getStarColor(): string {
            return "#000000";
        }
        override getFadedStarColor(): string {
            return hexToRgba("#000000", 0.5);
        }
        override getBlankTextColor(): string {
            return "#000000";
        }
        override getLabelTextColor(): string {
            return hexToRgba("#000000", 0.75);
        }
    }

    _("Plain"); // ensure translation exists
    THEMES["board"]["Plain"] = Plain;

    class Custom extends GobanTheme {
        override sort(): number {
            return 200; //last, because this is the "customisable" one
        }
        override get theme_name(): string {
            return "Custom";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": callbacks.customBoardColor
                    ? callbacks.customBoardColor()
                    : "#DCB35C",
                "background-image":
                    callbacks.customBoardUrl && callbacks.customBoardUrl() !== ""
                        ? "url('" + callbacks.customBoardUrl() + "')"
                        : "",
                "background-size": "cover",
            };
        }
        override getLineColor(): string {
            return callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000";
        }
        override getFadedLineColor(): string {
            return hexToRgba(
                callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000",
                0.5,
            );
        }
        override getStarColor(): string {
            return callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000";
        }
        override getFadedStarColor(): string {
            return hexToRgba(
                callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000",
                0.5,
            );
        }
        override getBlankTextColor(): string {
            return callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000";
        }
        override getLabelTextColor(): string {
            return hexToRgba(
                callbacks.customBoardLineColor ? callbacks.customBoardLineColor() : "#000000",
                0.75,
            );
        }
    }

    _("Custom"); // ensure translation exists
    THEMES["board"]["Custom"] = Custom;

    class Night extends GobanTheme {
        override sort(): number {
            return 100;
        }
        override get theme_name(): string {
            return "Night Play";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": "#444444",
                "background-image": "",
            };
        }
        override getLineColor(): string {
            return "#555555";
        }
        override getFadedLineColor(): string {
            return "#333333";
        }
        override getStarColor(): string {
            return "#555555";
        }
        override getFadedStarColor(): string {
            return "#333333";
        }
        override getBlankTextColor(): string {
            return "#ffffff";
        }
        override getLabelTextColor(): string {
            return "#555555";
        }
    }

    _("Night Play"); // ensure translation exists
    THEMES["board"]["Night Play"] = Night;

    class HNG extends GobanTheme {
        static C = "#00193E";
        static C2 = "#004C75";
        override sort(): number {
            return 105;
        }
        override get theme_name(): string {
            return "HNG";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": "#00e7fc",
                "background-image": "",
            };
        }
        override getLineColor(): string {
            return HNG.C;
        }
        override getFadedLineColor(): string {
            return "#00AFBF";
        }
        override getStarColor(): string {
            return HNG.C;
        }
        override getFadedStarColor(): string {
            return "#00AFBF";
        }
        override getBlankTextColor(): string {
            return "#000000";
        }
        override getLabelTextColor(): string {
            return HNG.C2;
        }
    }

    _("HNG"); // ensure translation exists
    THEMES["board"]["HNG"] = HNG;

    class HNGNight extends GobanTheme {
        static C = "#007591";
        override sort(): number {
            return 105;
        }
        override get theme_name(): string {
            return "HNG Night";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": "#090C1F",
                "background-image": "",
            };
        }
        override getLineColor(): string {
            return HNGNight.C;
        }
        override getFadedLineColor(): string {
            return "#4481B5";
        }
        override getStarColor(): string {
            return HNGNight.C;
        }
        override getFadedStarColor(): string {
            return "#4481B5";
        }
        override getBlankTextColor(): string {
            return "#ffffff";
        }
        override getLabelTextColor(): string {
            return "#4481B5";
        }
    }

    _("HNG Night"); // ensure translation exists
    THEMES["board"]["HNG Night"] = HNGNight;

    class Book extends GobanTheme {
        override sort(): number {
            return 110;
        }
        override get theme_name(): string {
            return "Book";
        }
        override getBackgroundCSS(): GobanThemeBackgroundCSS {
            return {
                "background-color": "#ffffff",
                "background-image": "",
            };
        }
        override getLineColor(): string {
            return "#555555";
        }
        override getFadedLineColor(): string {
            return "#999999";
        }
        override getStarColor(): string {
            return "#555555";
        }
        override getFadedStarColor(): string {
            return "#999999";
        }
        override getBlankTextColor(): string {
            return "#000000";
        }
        override getLabelTextColor(): string {
            return "#555555";
        }
    }

    _("Book"); // ensure translation exists
    THEMES["board"]["Book"] = Book;
}
