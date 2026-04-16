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

describe("estimateSpeed", () => {
    test("classifies blitz (<=5min)", () => {
        expect(estimateSpeed(0)).toBe("blitz");
        expect(estimateSpeed(5 * 60 * 1000)).toBe("blitz");
    });

    test("classifies rapid (5-15min)", () => {
        expect(estimateSpeed(5 * 60 * 1000 + 1)).toBe("rapid");
        expect(estimateSpeed(15 * 60 * 1000)).toBe("rapid");
    });

    test("classifies live (15-60min)", () => {
        expect(estimateSpeed(15 * 60 * 1000 + 1)).toBe("live");
        expect(estimateSpeed(3600 * 1000)).toBe("live");
    });

    test("classifies correspondence (>60min)", () => {
        expect(estimateSpeed(3600 * 1000 + 1)).toBe("correspondence");
        expect(estimateSpeed(86400 * 1000)).toBe("correspondence");
    });
});

describe("computeTimeControlSpeed", () => {
    test("Canadian divides period_time by stones_per_period", () => {
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "blitz",
            main_time: 0,
            stones_per_period: 25,
            period_time: 600 * 1000,
            pause_on_weekends: false,
        };
        // 600s / 25 = 24s per stone → blitz
        expect(computeTimeControlSpeed(tc)).toBe("blitz");
    });

    test("Canadian 3600 main + 15/300 → correspondence", () => {
        const tc: JGOFTimeControl = {
            system: "canadian",
            speed: "blitz",
            main_time: 3600 * 1000,
            stones_per_period: 15,
            period_time: 300 * 1000,
            pause_on_weekends: false,
        };
        // 3600 + 20 = 3620s → correspondence (> 60 min threshold)
        expect(computeTimeControlSpeed(tc)).toBe("correspondence");
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

    test("Fischer uses initial_time + time_increment", () => {
        const tc: JGOFTimeControl = {
            system: "fischer",
            speed: "blitz",
            initial_time: 600 * 1000,
            time_increment: 10 * 1000,
            max_time: 600 * 1000,
            pause_on_weekends: false,
        };
        // 610s → rapid
        expect(computeTimeControlSpeed(tc)).toBe("rapid");
    });

    test("byoyomi uses main + period_time (per-move pressure)", () => {
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "blitz",
            main_time: 1800 * 1000,
            periods: 5,
            period_time: 30 * 1000,
            pause_on_weekends: false,
        };
        // 1800 + 30 = 1830s → live
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("byoyomi with no main time uses period_time only", () => {
        // 5x120s byo-yomi: per-move pressure is 120s, should classify as blitz,
        // not rapid (which 5*120=600s would falsely yield).
        const tc: JGOFTimeControl = {
            system: "byoyomi",
            speed: "rapid",
            main_time: 0,
            periods: 5,
            period_time: 120 * 1000,
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBe("blitz");
    });

    test("simple uses per_move", () => {
        const tc: JGOFTimeControl = {
            system: "simple",
            speed: "blitz",
            per_move: 60 * 1000,
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBe("blitz");
    });

    test("absolute uses total_time", () => {
        const tc: JGOFTimeControl = {
            system: "absolute",
            speed: "blitz",
            total_time: 3600 * 1000,
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBe("live");
    });

    test("none maps to correspondence", () => {
        const tc: JGOFTimeControl = {
            system: "none",
            speed: "correspondence",
            pause_on_weekends: false,
        };
        expect(computeTimeControlSpeed(tc)).toBe("correspondence");
    });
});
