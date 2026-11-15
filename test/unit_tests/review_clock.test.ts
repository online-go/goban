/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import { TestGoban, findClock, startingClock, runClock, clockAfterMove } from "../../src/index";
import type { JGOFPlayerClock, JGOFTimeControl } from "engine";

const fischer = (time_increment: number, max_time: number): JGOFTimeControl => ({
    system: "fischer",
    speed: "live",
    initial_time: 300,
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

/** Clocks in main time, byo-yomi overtime and canadian overtime */
const main = (main_time: number): JGOFPlayerClock => ({ main_time });
const byo = (periods_left: number, period_time_left: number): JGOFPlayerClock => ({
    main_time: 0,
    periods_left,
    period_time_left,
});
const can = (moves_left: number, block_time_left: number): JGOFPlayerClock => ({
    main_time: 0,
    moves_left,
    block_time_left,
});

test.each([
    ["fischer", fischer(10, 600), main(300000)],
    ["byo-yomi", byoyomi(600), main(600000)],
    ["byo-yomi with no main time", byoyomi(0), byo(5, 30000)],
    ["canadian with no main time", canadian(0), can(10, 300000)],
    ["simple", simple, main(30000)],
    ["absolute", absolute, main(900000)],
    ["no time control", none, undefined],
])("startingClock: %s", (_, tc, expected) => {
    expect(startingClock(tc)).toEqual(expected);
});

test.each([
    ["main time runs down", main(10000), 4000, fischer(10, 600), main(6000)],
    ["main time stops at zero", main(10000), 20000, fischer(10, 600), main(0)],
    ["byo-yomi uses up whole periods", main(5000), 40000, byoyomi(600), byo(4, 25000)],
    ["the last byo-yomi period stops at zero", byo(1, 1000), 5000, byoyomi(0), byo(0, 0)],
    ["main time running out starts byo-yomi", main(1000), 1000, byoyomi(600), byo(5, 30000)],
    ["main time running out starts canadian", main(1000), 1000, canadian(600), can(10, 300000)],
    ["canadian overtime runs down the block", can(3, 10000), 4000, canadian(0), can(3, 6000)],
])("runClock: %s", (_, clock, elapsed, tc, expected) => {
    expect(runClock(clock, elapsed, tc)).toEqual(expected);
});

test.each([
    ["fischer adds the increment", main(300000), 2000, fischer(10, 600), main(308000)],
    ["fischer stops at the cap", main(300000), 2000, fischer(10, 305), main(305000)],
    ["byo-yomi starts the period again", byo(4, 12000), 3000, byoyomi(0), byo(4, 30000)],
    ["a byo-yomi move in main time", main(9000), 3000, byoyomi(600), main(6000)],
    ["byo-yomi after the last period", byo(1, 1000), 5000, byoyomi(0), byo(0, 0)],
    ["canadian uses a stone", can(3, 9000), 1000, canadian(0), can(2, 8000)],
    ["the last canadian stone starts a block", can(1, 9000), 1000, canadian(0), can(10, 300000)],
    ["simple starts the time per move again", main(12000), 5000, simple, main(30000)],
])("clockAfterMove: %s", (_, clock, elapsed, tc, expected) => {
    expect(clockAfterMove(clock, elapsed, tc)).toEqual(expected);
});

test("findClock returns the nearest earlier clock for that color only", () => {
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
