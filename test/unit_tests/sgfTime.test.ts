/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 */

import { parseSGFOvertime, estimateSpeed, computeTimeControlSpeed } from "engine";
import type { JGOFTimeControl } from "engine/formats/JGOF";

describe("parseSGFOvertime", () => {
    test("parses Canadian format", () => {
        const result = parseSGFOvertime("15/300 Canadian", 3600 * 1000);
        expect(result).toMatchObject({
            system: "canadian",
            main_time: 3600 * 1000,
            stones_per_period: 15,
            period_time: 300 * 1000,
        });
    });

    test("parses Canadian case-insensitively", () => {
        const result = parseSGFOvertime("10/600 CANADIAN", 0);
        expect(result?.system).toBe("canadian");
    });

    test("parses Canadian with fractional period_time", () => {
        const result = parseSGFOvertime("25/180.5 Canadian", 0);
        expect(result).toMatchObject({
            system: "canadian",
            stones_per_period: 25,
            period_time: 180500,
        });
    });

    test("rejects Canadian with zero stones_per_period", () => {
        expect(parseSGFOvertime("0/300 Canadian", 0)).toBeNull();
    });

    test("parses Fischer format", () => {
        const result = parseSGFOvertime("30 Fischer", 600 * 1000);
        expect(result).toMatchObject({
            system: "fischer",
            initial_time: 600 * 1000,
            time_increment: 30 * 1000,
        });
    });

    test("Fischer max_time uses increment * 20 when main_time is small", () => {
        const result = parseSGFOvertime("60 Fischer", 1000);
        expect(result).toMatchObject({
            system: "fischer",
            max_time: 60 * 1000 * 20,
        });
    });

    test("Fischer max_time uses main_time * 2 when larger", () => {
        const result = parseSGFOvertime("10 Fischer", 600 * 1000);
        expect(result).toMatchObject({
            system: "fischer",
            max_time: 600 * 1000 * 2,
        });
    });

    test("parses byo-yomi format", () => {
        const result = parseSGFOvertime("5x30 byo-yomi", 1800 * 1000);
        expect(result).toMatchObject({
            system: "byoyomi",
            main_time: 1800 * 1000,
            periods: 5,
            period_time: 30 * 1000,
        });
    });

    test("parses byoyomi without hyphen", () => {
        const result = parseSGFOvertime("3x60 byoyomi", 0);
        expect(result?.system).toBe("byoyomi");
    });

    test("rejects byoyomi with zero periods", () => {
        expect(parseSGFOvertime("0x30 byo-yomi", 0)).toBeNull();
    });

    test("rejects byoyomi with zero period_time", () => {
        expect(parseSGFOvertime("5x0 byo-yomi", 0)).toBeNull();
    });

    test("rejects Canadian with zero period_time", () => {
        expect(parseSGFOvertime("15/0 Canadian", 0)).toBeNull();
    });

    test("rejects Fischer with zero increment", () => {
        expect(parseSGFOvertime("0 Fischer", 0)).toBeNull();
    });

    test("rejects Simple with zero per_move", () => {
        expect(parseSGFOvertime("0 simple", 0)).toBeNull();
    });

    test("parses byoyomi with spaces around x", () => {
        const result = parseSGFOvertime("5 x 30 byo-yomi", 0);
        expect(result?.system).toBe("byoyomi");
    });

    test("parses Simple format", () => {
        const result = parseSGFOvertime("60 simple", 0);
        expect(result).toMatchObject({
            system: "simple",
            per_move: 60 * 1000,
        });
    });

    test("trims surrounding whitespace", () => {
        const result = parseSGFOvertime("  15/300 Canadian  ", 0);
        expect(result?.system).toBe("canadian");
    });

    test("returns null for unrecognized format", () => {
        expect(parseSGFOvertime("unknown format", 0)).toBeNull();
    });

    test("returns null for empty string", () => {
        expect(parseSGFOvertime("", 0)).toBeNull();
    });
});

// estimateSpeed and computeTimeControlSpeed classify by expected time-per-move,
// matching the server's `calculate_average_move_time` + `getGameSpeed`:
//   blitz          : 0 < tpm < 10s
//   live           : 10s <= tpm < 3600s
//   correspondence : tpm >= 3600s or tpm == 0
describe("estimateSpeed", () => {
    test("classifies blitz for per-move under 10s", () => {
        expect(estimateSpeed(1)).toBe("blitz");
        expect(estimateSpeed(9999)).toBe("blitz");
    });

    test("classifies live at 10s boundary and below 3600s", () => {
        expect(estimateSpeed(10 * 1000)).toBe("live");
        expect(estimateSpeed(3599 * 1000)).toBe("live");
    });

    test("classifies correspondence at 3600s boundary and above", () => {
        expect(estimateSpeed(3600 * 1000)).toBe("correspondence");
        expect(estimateSpeed(86400 * 1000)).toBe("correspondence");
    });

    test("classifies zero per-move as correspondence", () => {
        expect(estimateSpeed(0)).toBe("correspondence");
    });
});

describe("computeTimeControlSpeed", () => {
    // 19x19 avg moves per side = (0.7 * 19 * 19) / 2 = 126.35
    test("Canadian per-move is period_time / stones_per_period when no main time", () => {
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "blitz",
            main_time: 0,
            stones_per_period: 25,
            period_time: 600 * 1000,
            pause_on_weekends: false,
        };
        // 0 + 600s/25 = 24s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("Canadian 3600 main + 15/300 classifies as live per-move", () => {
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "blitz",
            main_time: 3600 * 1000,
            stones_per_period: 15,
            period_time: 300 * 1000,
            pause_on_weekends: false,
        };
        // 3600/126.35 + 300/15 ≈ 28.5 + 20 = 48.5s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("Canadian handles zero stones_per_period without crashing", () => {
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "blitz",
            main_time: 0,
            stones_per_period: 0,
            period_time: 300 * 1000,
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBeDefined();
    });

    test("Fischer per-move is initial_time/avg + increment", () => {
        const tc: JGOFTimeControl = {
            system: "fischer",
            speed: "blitz",
            initial_time: 600 * 1000,
            time_increment: 10 * 1000,
            max_time: 600 * 1000,
            pause_on_weekends: false,
        };
        // 600/126.35 + 10 ≈ 4.75 + 10 = 14.75s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("Fischer with small initial and small increment classifies as blitz", () => {
        const tc: JGOFTimeControl = {
            system: "fischer",
            speed: "live",
            initial_time: 60 * 1000,
            time_increment: 5 * 1000,
            max_time: 120 * 1000,
            pause_on_weekends: false,
        };
        // 60/126.35 + 5 ≈ 0.47 + 5 = 5.47s per move → blitz
        expect(computeTimeControlSpeed(tc)).toBe("blitz");
    });

    test("byoyomi per-move is main/avg + period_time", () => {
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "blitz",
            main_time: 1800 * 1000,
            periods: 5,
            period_time: 30 * 1000,
            pause_on_weekends: false,
        };
        // 1800/126.35 + 30 ≈ 14.2 + 30 = 44.2s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("byoyomi with small period_time and no main classifies as blitz", () => {
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "live",
            main_time: 0,
            periods: 5,
            period_time: 5 * 1000,
            pause_on_weekends: false,
        };
        // 0 + 5 = 5s per move → blitz
        expect(computeTimeControlSpeed(tc)).toBe("blitz");
    });

    test("simple uses per_move directly", () => {
        const tc: JGOFTimeControl = {
            system: "simple",
            speed: "blitz",
            per_move: 60 * 1000,
            pause_on_weekends: false,
        };
        // 60s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("absolute divides total_time by avg moves per side", () => {
        const tc: JGOFTimeControl = {
            system: "absolute",
            speed: "blitz",
            total_time: 3600 * 1000,
            pause_on_weekends: false,
        };
        // 3600/126.35 ≈ 28.5s per move → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("absolute with large total_time classifies as correspondence", () => {
        const tc: JGOFTimeControl = {
            system: "absolute",
            speed: "blitz",
            total_time: 7 * 86400 * 1000,
            pause_on_weekends: false,
        };
        // 7d / 126.35 ≈ 4800s per move → correspondence
        expect(computeTimeControlSpeed(tc)).toBe("correspondence");
    });

    test("none maps to correspondence", () => {
        const tc: JGOFTimeControl = {
            system: "none",
            speed: "correspondence",
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBe("correspondence");
    });

    test("board size affects classification for main-time-heavy controls", () => {
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "blitz",
            main_time: 1800 * 1000,
            periods: 5,
            period_time: 30 * 1000,
            pause_on_weekends: false,
        };
        // 9x9: avg = 28.35 → 1800/28.35 + 30 ≈ 63.5 + 30 = 93.5s/move → live
        // 19x19: 44.2s/move → live (both live, but smaller board pushes toward slower)
        expect(computeTimeControlSpeed(tc, 9, 9)).toBe("live");
        expect(computeTimeControlSpeed(tc, 19, 19)).toBe("live");
    });
});
