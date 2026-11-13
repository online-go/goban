/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 */

import { GobanEngine, AdHocPackedMove, decodeMoves, encodeMoveToArray } from "engine";

describe("per-move clocks", () => {
    test("encodeMoveToArray keeps the mover's clock", () => {
        const packed = encodeMoveToArray({
            x: 3,
            y: 3,
            timedelta: 1200,
            black_clock: { main_time: 29500 },
        });

        expect(packed).toEqual([3, 3, 1200, undefined, { black_clock: { main_time: 29500 } }]);
        expect(decodeMoves(packed, 19, 19)[0].black_clock).toEqual({ main_time: 29500 });
    });

    test("constructor puts move clocks on nodes", () => {
        const byoyomi_clock = { main_time: 0, periods_left: 4, period_time_left: 30000 };
        const moves: AdHocPackedMove[] = [
            [3, 3, 1000, undefined, { black_clock: { main_time: 590000 } }],
            [15, 15, 2000, undefined, { white_clock: byoyomi_clock }],
        ];
        const engine = new GobanEngine({ width: 19, height: 19, moves });

        const first = engine.move_tree.trunk_next!;
        expect(first.black_clock).toEqual({ main_time: 590000 });
        expect(first.white_clock).toBeUndefined();

        const second = first.trunk_next!;
        expect(second.white_clock).toEqual(byoyomi_clock);
        expect(second.black_clock).toBeUndefined();
    });
});
