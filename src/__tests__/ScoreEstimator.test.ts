import { GoEngine } from "../GoEngine";
import { adjust_estimate } from "../ScoreEstimator";

describe("adjust_estimate", () => {
    const BOARD = [
        [0, 1, 2, 0],
        [0, 1, 2, 0],
        [0, 1, 2, 0],
        [0, 1, 2, 0],
    ];
    const OWNERSHIP = [
        [1, 1, -1, -1],
        [1, 1, -1, -1],
        [1, 1, -1, -1],
        [1, 1, -1, -1],
    ];
    const SCORE = -0.5;
    const KOMI = 0.5;

    test("adjust_estimate area", () => {
        const engine = new GoEngine({ komi: KOMI, rules: "chinese" });
        expect(adjust_estimate(engine, BOARD, OWNERSHIP, SCORE)).toEqual({
            score: -0.5,
            ownership: OWNERSHIP,
        });
    });

    test("adjust_estimate area", () => {
        const ADJUSTED_OWNERSHIP = [
            [1, 0, 0, -1],
            [1, 0, 0, -1],
            [1, 0, 0, -1],
            [1, 0, 0, -1],
        ];
        const engine = new GoEngine({ komi: KOMI, rules: "japanese" });
        expect(adjust_estimate(engine, BOARD, OWNERSHIP, SCORE)).toEqual({
            score: -0.5,
            ownership: ADJUSTED_OWNERSHIP,
        });
    });
});
