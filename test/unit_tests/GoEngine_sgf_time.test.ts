/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 */
// cspell: disable

(global as any).CLIENT = true;

import { TestGoban } from "../../src/Goban/TestGoban";
import { MoveTree } from "engine";

function nth(mt: MoveTree, n: number): MoveTree {
    let cur: MoveTree = mt;
    for (let i = 0; i < n; i++) {
        if (!cur.trunk_next) {
            throw new Error(`move ${n} not found (stopped at ${i})`);
        }
        cur = cur.trunk_next;
    }
    return cur;
}

function loadSGF(sgf: string): TestGoban {
    return new TestGoban({ original_sgf: sgf, removed: "" });
}

describe("GobanEngine SGF time parsing", () => {
    test("TM alone produces absolute sgf_time_settings", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "absolute",
            total_time: 1800 * 1000,
        });
    });

    test("TM + OT Canadian produces canadian settings with main_time", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[3600]OT[15/300 Canadian])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "canadian",
            main_time: 3600 * 1000,
            stones_per_period: 15,
            period_time: 300 * 1000,
        });
    });

    test("OT before TM still yields correct main_time", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]OT[15/300 Canadian]TM[3600])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "canadian",
            main_time: 3600 * 1000,
            stones_per_period: 15,
            period_time: 300 * 1000,
        });
    });

    test("TM + OT byo-yomi produces byoyomi settings", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "byoyomi",
            main_time: 1800 * 1000,
            periods: 5,
            period_time: 30 * 1000,
        });
    });

    test("TM + OT Fischer produces fischer settings with initial_time", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[600]OT[10 Fischer])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "fischer",
            initial_time: 600 * 1000,
            time_increment: 10 * 1000,
        });
    });

    test("OT before TM for Fischer recomputes max_time", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]OT[10 Fischer]TM[600])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "fischer",
            initial_time: 600 * 1000,
            time_increment: 10 * 1000,
            // max = max(600*2, 10*20) = 1200
            max_time: 1200 * 1000,
        });
    });

    test("BL attaches per-move remaining time to black_clock", () => {
        const goban = loadSGF(
            "(;GM[1]FF[4]SZ[19]TM[3600]OT[15/300 Canadian];B[pd]BL[3590];W[dp]WL[3595])",
        );
        const root = goban.engine.move_tree;
        const move1 = nth(root, 1);
        const move2 = nth(root, 2);

        expect(move1.black_clock).toMatchObject({ main_time: 3590 * 1000 });
        expect(move2.white_clock).toMatchObject({ main_time: 3595 * 1000 });
    });

    test("BL and WL on same move populate separate clock fields", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[3600];B[pd]BL[3590]WL[3600])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toMatchObject({ main_time: 3590 * 1000 });
        expect(move1.white_clock).toMatchObject({ main_time: 3600 * 1000 });
    });

    test("OB in byoyomi populates periods_left", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd]BL[30]OB[3])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toMatchObject({
            main_time: 30 * 1000,
            periods_left: 3,
        });
        expect(move1.black_clock?.moves_left).toBeUndefined();
    });

    test("OB in Canadian populates moves_left", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[3600]OT[15/300 Canadian];B[pd]BL[300]OB[10])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toMatchObject({
            main_time: 300 * 1000,
            moves_left: 10,
        });
        expect(move1.black_clock?.periods_left).toBeUndefined();
    });

    test("OB in absolute system is ignored", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800];B[pd]BL[1790]OB[3])");
        const move1 = nth(goban.engine.move_tree, 1);
        // main_time is populated by BL, but OB should not write periods_left
        expect(move1.black_clock?.main_time).toBe(1790 * 1000);
        expect(move1.black_clock?.periods_left).toBeUndefined();
        expect(move1.black_clock?.moves_left).toBeUndefined();
    });

    test("OW in Fischer is ignored", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[600]OT[10 Fischer];W[pd]WL[590]OW[1])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.white_clock?.main_time).toBe(590 * 1000);
        expect(move1.white_clock?.periods_left).toBeUndefined();
        expect(move1.white_clock?.moves_left).toBeUndefined();
    });

    test("SGF with no time properties leaves sgf_time_settings undefined", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19];B[pd];W[dp])");
        expect(goban.engine.sgf_time_settings).toBeUndefined();
    });

    test("Unrecognized OT format leaves sgf_time_settings absolute (from TM)", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[Mysterious])");
        expect(goban.engine.sgf_time_settings).toMatchObject({
            system: "absolute",
            total_time: 1800 * 1000,
        });
    });

    test("TM with negative value is ignored", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[-100])");
        expect(goban.engine.sgf_time_settings).toBeUndefined();
    });

    test("BL with negative value does not create black_clock", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800];B[pd]BL[-50])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toBeUndefined();
    });

    test("OB without BL on same node inherits parent's main_time", () => {
        // Some SGF writers stop emitting BL once the main clock expires and
        // only track byo-yomi periods. Verify main_time is inherited rather
        // than fabricated as 0.
        const goban = loadSGF(
            "(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd]BL[30]OB[5];W[dp];B[pp]OB[4])",
        );
        const move3 = nth(goban.engine.move_tree, 3);
        expect(move3.black_clock).toMatchObject({
            main_time: 30 * 1000,
            periods_left: 4,
        });
    });

    test("OB without BL and no parent clock is skipped", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd]OB[5])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toBeUndefined();
    });

    test("OB before BL on same node still records periods_left", () => {
        // SGF property order within a node is not significant per spec.
        // OB must see the clock BL populates even when OB appears first.
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd]OB[3]BL[30])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock).toMatchObject({
            main_time: 30 * 1000,
            periods_left: 3,
        });
    });

    test("OW before WL on same node still records periods_left", () => {
        const goban = loadSGF(
            "(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd];W[dp]OW[2]WL[30])",
        );
        const move2 = nth(goban.engine.move_tree, 2);
        expect(move2.white_clock).toMatchObject({
            main_time: 30 * 1000,
            periods_left: 2,
        });
    });

    test("OT speed uses board dimensions, not default 90 moves", () => {
        // 900s main + 1s byo-yomi on 19x19:
        //   per-move = 900000/126.5 + 1000 ≈ 8.1s → blitz
        // With the default 90-moves fallback this would be 11s → live.
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[900]OT[5x1 byo-yomi])");
        expect(goban.engine.sgf_time_settings?.speed).toBe("blitz");
    });

    test("OB with negative value is ignored", () => {
        const goban = loadSGF("(;GM[1]FF[4]SZ[19]TM[1800]OT[5x30 byo-yomi];B[pd]BL[30]OB[-1])");
        const move1 = nth(goban.engine.move_tree, 1);
        expect(move1.black_clock?.main_time).toBe(30 * 1000);
        expect(move1.black_clock?.periods_left).toBeUndefined();
    });
});
