/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import { TestGoban, findClock, startingClock, runClock, clockAfterMove } from "../../src/index";
import type { JGOFTimeControl } from "engine";

const fischer = (initial_time: number, time_increment = 10, max_time = 600): JGOFTimeControl => ({
    system: "fischer",
    speed: "live",
    initial_time,
    time_increment,
    max_time,
});
const byoyomi = (main_time: number): JGOFTimeControl => ({
    system: "byoyomi",
    speed: "live",
    main_time,
    periods: 5,
    period_time: 30,
});
const canadian = (main_time: number): JGOFTimeControl => ({
    system: "canadian",
    speed: "live",
    main_time,
    stones_per_period: 10,
    period_time: 300,
});
const simple: JGOFTimeControl = { system: "simple", speed: "live", per_move: 30 };
const absolute: JGOFTimeControl = { system: "absolute", speed: "live", total_time: 900 };
const none: JGOFTimeControl = { system: "none", speed: "correspondence" };

describe("startingClock", () => {
    test("each system starts from its time control, in ms", () => {
        expect(startingClock(fischer(300))).toEqual({ main_time: 300000 });
        expect(startingClock(byoyomi(600))).toEqual({ main_time: 600000 });
        expect(startingClock(simple)).toEqual({ main_time: 30000 });
        expect(startingClock(absolute)).toEqual({ main_time: 900000 });
        expect(startingClock(none)).toBeUndefined();
    });

    test("with no main time the clock starts in overtime", () => {
        expect(startingClock(byoyomi(0))).toEqual({
            main_time: 0,
            periods_left: 5,
            period_time_left: 30000,
        });
        expect(startingClock(canadian(0))).toEqual({
            main_time: 0,
            moves_left: 10,
            block_time_left: 300000,
        });
    });
});

describe("runClock", () => {
    test("main time runs down and stops at zero", () => {
        expect(runClock({ main_time: 10000 }, 4000, fischer(300))).toEqual({ main_time: 6000 });
        expect(runClock({ main_time: 10000 }, 20000, fischer(300))).toEqual({ main_time: 0 });
    });

    test("byo-yomi uses up whole periods after main time", () => {
        expect(runClock({ main_time: 5000 }, 40000, byoyomi(600))).toEqual({
            main_time: 0,
            periods_left: 4,
            period_time_left: 25000,
        });
    });

    test("the last byo-yomi period running out stops at zero", () => {
        expect(
            runClock({ main_time: 0, periods_left: 1, period_time_left: 1000 }, 5000, byoyomi(0)),
        ).toEqual({ main_time: 0, periods_left: 0, period_time_left: 0 });
    });

    test("main time running out exactly starts overtime", () => {
        expect(runClock({ main_time: 1000 }, 1000, byoyomi(600))).toEqual({
            main_time: 0,
            periods_left: 5,
            period_time_left: 30000,
        });
        expect(runClock({ main_time: 1000 }, 1000, canadian(600))).toEqual({
            main_time: 0,
            moves_left: 10,
            block_time_left: 300000,
        });
    });

    test("canadian overtime runs down the block", () => {
        expect(
            runClock({ main_time: 0, moves_left: 3, block_time_left: 10000 }, 4000, canadian(0)),
        ).toEqual({ main_time: 0, moves_left: 3, block_time_left: 6000 });
    });
});

describe("clockAfterMove", () => {
    test("fischer adds the increment up to the cap", () => {
        expect(clockAfterMove({ main_time: 300000 }, 2000, fischer(300, 10, 305))).toEqual({
            main_time: 305000,
        });
        expect(clockAfterMove({ main_time: 300000 }, 2000, fischer(300, 10, 600))).toEqual({
            main_time: 308000,
        });
    });

    test("a byo-yomi move in overtime resets the period", () => {
        expect(
            clockAfterMove(
                { main_time: 0, periods_left: 4, period_time_left: 12000 },
                3000,
                byoyomi(0),
            ),
        ).toEqual({ main_time: 0, periods_left: 4, period_time_left: 30000 });
    });

    test("a canadian move counts down the stones and starts a new block after the last", () => {
        expect(
            clockAfterMove(
                { main_time: 0, moves_left: 1, block_time_left: 9000 },
                1000,
                canadian(0),
            ),
        ).toEqual({ main_time: 0, moves_left: 10, block_time_left: 300000 });
        expect(
            clockAfterMove(
                { main_time: 0, moves_left: 3, block_time_left: 9000 },
                1000,
                canadian(0),
            ),
        ).toEqual({ main_time: 0, moves_left: 2, block_time_left: 8000 });
    });

    test("a simple move resets the time per move", () => {
        expect(clockAfterMove({ main_time: 12000 }, 5000, simple)).toEqual({ main_time: 30000 });
    });
});

describe("findClock", () => {
    test("returns the nearest earlier clock for that color only", () => {
        const goban = new TestGoban({ width: 9, height: 9 });
        goban.engine.place(2, 2);
        goban.engine.cur_move.applyClocks({ black_clock: { main_time: 9000 } });
        goban.engine.place(3, 3);
        goban.engine.cur_move.applyClocks({ white_clock: { main_time: 8000 } });
        goban.engine.place(4, 4);

        expect(findClock(goban.engine.cur_move, "black")).toEqual({ main_time: 9000 });
        expect(findClock(goban.engine.cur_move, "white")).toEqual({ main_time: 8000 });
        expect(findClock(goban.engine.cur_move.parent!.parent, "white")).toBeUndefined();
        goban.destroy();
    });
});
