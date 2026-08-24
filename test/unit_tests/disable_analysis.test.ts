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

import { GobanEngine } from "engine";
import { TestGoban } from "../../src/Goban/TestGoban";
import { callbacks } from "../../src/Goban/callbacks";

const GAME_CONFIG = {
    width: 9,
    height: 9,
    players: {
        black: { id: 111, username: "black-player" },
        white: { id: 222, username: "white-player" },
    },
    disable_analysis: true,
    phase: "play" as const,
};

afterEach(() => {
    delete callbacks.isAnalysisDisabled;
    delete (window as { user?: unknown }).user;
});

describe("GobanEngine disable_analysis", () => {
    test("preserves the per-game setting regardless of window.user", () => {
        (window as { user?: unknown }).user = { id: 999, username: "spectator" };
        const engine = new GobanEngine({ ...GAME_CONFIG });

        expect(engine.disable_analysis).toBe(true);
        expect(engine.config.disable_analysis).toBe(true);
        expect(engine.config.original_disable_analysis).toBe(true);
    });

    test("records original_disable_analysis", () => {
        const engine = new GobanEngine({ ...GAME_CONFIG, disable_analysis: false });

        expect(engine.config.original_disable_analysis).toBe(false);
    });
});

describe("setMode analysis gating", () => {
    test("blocks analyze mode by the per-game setting when no callback is set", () => {
        const goban = new TestGoban({ ...GAME_CONFIG });

        expect(goban.setMode("analyze")).toBe(false);
        expect(goban.mode).toBe("play");
    });

    test("allows analyze mode when the game does not disable analysis", () => {
        const goban = new TestGoban({ ...GAME_CONFIG, disable_analysis: false });

        expect(goban.setMode("analyze")).toBe(true);
    });

    test("allows analyze mode in finished games", () => {
        const goban = new TestGoban({ ...GAME_CONFIG, phase: "finished" });

        expect(goban.setMode("analyze")).toBe(true);
    });

    test("defers to the isAnalysisDisabled callback when set", () => {
        const goban = new TestGoban({ ...GAME_CONFIG });

        callbacks.isAnalysisDisabled = () => false;
        expect(goban.setMode("analyze")).toBe(true);

        goban.setMode("play");
        callbacks.isAnalysisDisabled = () => true;
        expect(goban.setMode("analyze")).toBe(false);
    });
});
