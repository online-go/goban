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

import { Color } from "three";
import { THEMES } from "../themes";
import type { GobanSelectedThemes } from "../Goban";

export function inkColor(color: string): string {
    const { r, g, b } = new Color(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.19 ? "#171512" : "#fff9ef";
}

const finishes: Record<string, number> = {
    "Slate": 0.46,
    "Shell": 0.36,
    "Glass": 0.23,
    "Worn Glass": 0.59,
    "Night": 0.51,
    "Plain": 0.73,
    "Anime": 0.42,
    "BadukTV": 0.32,
    "Custom": 0.43,
};

export function resolveAppearance(selection: GobanSelectedThemes) {
    const board = new (THEMES.board[selection.board] ?? THEMES.board.Kaya)();
    const css = board.getBackgroundCSS();
    const background = css["background-color"] || "#b99468";
    const url = css["background-image"]?.match(/^url\((['"]?)(.*?)\1\)$/)?.[2] || "";
    const stones = (["black", "white"] as const).map((side) => {
        const name = selection[side];
        const theme = new (THEMES[side][name] ?? THEMES[side].Plain)(board);
        const base = side === "black" ? theme.getBlackStoneColor() : theme.getWhiteStoneColor();
        const color =
            name === "Shell"
                ? "#e4dbc7"
                : name === "Slate"
                  ? "#25282a"
                  : name === "Glass"
                    ? side === "black"
                        ? "#22272d"
                        : "#eceef0"
                    : name === "Worn Glass"
                      ? side === "black"
                          ? "#343535"
                          : "#d9d7ce"
                      : name === "Anime"
                        ? side === "black"
                            ? "#29202a"
                            : "#fff1da"
                        : name === "BadukTV"
                          ? side === "black"
                              ? "#242421"
                              : "#eee8dc"
                          : name === "Plain" && side === "black"
                            ? "#181818"
                            : base;
        return { color, roughness: finishes[name] ?? 0.55, text: inkColor(color) };
    });
    return {
        board: {
            color: background,
            url,
            line: board.getLineColor(),
            faded: board.getFadedLineColor(),
            star: board.getStarColor(),
            text: board.getBlankTextColor(),
            shadow: board.getShadowColor(),
            roughness: selection.board === "Granite" ? 0.47 : 0.72,
        },
        stones,
        // Keep adjacent stones apart in the 3D scene.
        scale: Math.min(1.05, Math.max(0.55, selection["stone-scale"])),
        shadow: selection["stone-shadows"] ?? "default",
    };
}
export type Appearance = ReturnType<typeof resolveAppearance>;
