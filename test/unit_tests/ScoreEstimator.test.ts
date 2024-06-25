/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
//cspell: disable

import { GobanEngine } from "engine";
import { makeMatrix } from "engine";
import { ScoreEstimator, adjust_estimate, set_local_ownership_estimator } from "engine";
import {
    init_remote_ownership_estimator,
    voronoi_estimate_ownership,
} from "engine/ownership_estimators";

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
        const engine = new GobanEngine({ komi: KOMI, rules: "chinese" });
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
        const engine = new GobanEngine({ komi: KOMI, rules: "japanese" });
        expect(adjust_estimate(engine, BOARD, OWNERSHIP, SCORE)).toEqual({
            score: -0.5,
            ownership: ADJUSTED_OWNERSHIP,
        });
    });
});

describe("ScoreEstimator", () => {
    const OWNERSHIP = [
        [1, 1, -1, -1],
        [1, 1, -1, -1],
    ];
    const KOMI = 0.5;
    const engine = new GobanEngine({ komi: KOMI, width: 4, height: 2 });
    engine.place(1, 0);
    engine.place(2, 0);
    engine.place(1, 1);
    engine.place(2, 1);

    const trials = 10;
    const tolerance = 0.25;

    beforeEach(() => {
        init_remote_ownership_estimator(async () => {
            return {
                ownership: OWNERSHIP,
                score: -7.5,
                autoscored_board_state: OWNERSHIP,
                autoscored_removed: [],
                autoscored_needs_sealing: [],
            };
        });

        set_local_ownership_estimator(voronoi_estimate_ownership);
    });

    afterEach(() => {
        init_remote_ownership_estimator(undefined as any);
    });

    test("amount and winner", async () => {
        const se = new ScoreEstimator(engine, undefined, trials, tolerance, false);

        await se.when_ready;

        // Though these properties are not used within Goban,
        // They are used in the UI as of this writing.
        expect(se.winner).toBe("White");
        expect(se.amount).toBe(0.5);
    });

    test("local", async () => {
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);

        await se.when_ready;

        expect(se.ownership).toEqual([
            [1, 0, 0, -1],
            [1, 0, 0, -1],
        ]);
    });

    test("local 9x9 unfinished", async () => {
        const moves = [
            [4, 4],
            [2, 4],
            [6, 4],
            [3, 6],
            [2, 2],
            [3, 3],
            [5, 2],
            [3, 2],
            [4, 1],
            [3, 1],
        ];
        const engine = new GobanEngine({ komi: KOMI, width: 9, height: 9, rules: "chinese" });
        for (const [x, y] of moves) {
            engine.place(x, y);
        }
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);

        expect(se.ownership).toEqual([
            [1, 0, -1, -1, 1, 1, 1, 1, 1],
            [1, 1, 0, -1, 1, 1, 1, 1, 1],
            [1, 1, 1, -1, 0, 1, 1, 1, 1],
            [0, 0, 0, -1, 0, 1, 1, 1, 1],
            [-1, -1, -1, 0, 1, 1, 1, 1, 1],
            [-1, -1, -1, -1, 1, 1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
        ]);
    });

    test("score() territory", async () => {
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.score();

        // no score because all territory is in seki
        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 0,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 0.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 0,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 0,
        });
    });

    test("score() chinese", async () => {
        const engine = new GobanEngine({ komi: KOMI, width: 4, height: 2, rules: "chinese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(2, 1);

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.score();

        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 0,
            scoring_positions: "cadacbdb",
            stones: 2,
            territory: 2,
            total: 4.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 0,
            scoring_positions: "aabaabbb",
            stones: 2,
            territory: 2,
            total: 4,
        });
    });

    test("don't score territory in seki (japanese)", async () => {
        // . x o .
        // x x . o

        const engine = new GobanEngine({ komi: KOMI, width: 4, height: 2, rules: "japanese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(3, 1);
        engine.place(0, 1);

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.score();

        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 0,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 0.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 0,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 0,
        });
    });

    test("score() with removed stones", async () => {
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        se.toggleSingleGroupRemoval(1, 0);
        se.toggleSingleGroupRemoval(2, 0);
        await se.when_ready;

        se.score();

        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 2,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 2.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 2,
            scoring_positions: "",
            stones: 0,
            territory: 0,
            total: 2,
        });
    });

    test("getStoneRemovalString()", async () => {
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        se.toggleSingleGroupRemoval(1, 0);
        se.toggleSingleGroupRemoval(2, 0);
        await se.when_ready;

        expect(se.getStoneRemovalString()).toBe("babbcacb");

        se.clearRemoved();

        expect(se.getStoneRemovalString()).toBe("");
    });

    test("goban callback", async () => {
        const fake_goban = {
            updateScoreEstimation: jest.fn(),
            setForRemoval: jest.fn(),
        };

        const se = new ScoreEstimator(engine, fake_goban as any, 10, 0.5, false);
        await se.when_ready;

        expect(fake_goban.updateScoreEstimation).toBeCalled();

        se.setRemoved(1, 0, true);
        expect(fake_goban.setForRemoval).toBeCalledWith(1, 0, true, true);
    });

    test("getProbablyDead", async () => {
        const markBoardAllBlack = () => [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ];
        set_local_ownership_estimator(markBoardAllBlack);

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        // Note (bpj): I think this might be a bug
        // This is marking all stones dead, but the black stones should still be alive.
        expect(se.getProbablyDead()).toBe("babbcacb");
        // expect(se.getProbablyDead()).toBe("cacb");
    });

    test("Falls back to local scorer if remote scorer is not set", async () => {
        init_remote_ownership_estimator(undefined as any);
        const mock_local_scorer = jest.fn();
        mock_local_scorer.mockReturnValue([
            [1, 1, -1, -1],
            [1, 1, -1, -1],
        ]);
        set_local_ownership_estimator(mock_local_scorer);

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, true);
        await se.when_ready;

        expect(mock_local_scorer).toBeCalled();
        expect(se.ownership).toEqual([
            [1, 0, 0, -1],
            [1, 0, 0, -1],
        ]);
    });

    test("remote scorers do not need to set score", async () => {
        const engine = new GobanEngine({ komi: 3.5, width: 4, height: 2, rules: "chinese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(2, 1);

        init_remote_ownership_estimator(async () => ({
            ownership: OWNERSHIP,
            autoscored_board_state: OWNERSHIP,
            autoscored_removed: [],
            autoscored_needs_sealing: [],
        }));

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, true);
        await se.when_ready;

        expect(se.ownership).toEqual(OWNERSHIP);
        expect(se.winner).toBe("Black");
        // I'm not actually sure this is the "right" behavior when the
        // remote scorer doesn't return a score.  I would think it would
        // derive the score from the ownership map.  Instead, it assumes
        // missing score means zero, and compensates for a komi of 7.5..
        //   - bpj
        expect(se.amount).toBe(4);
    });

    test("local scorer with stones removed", async () => {
        set_local_ownership_estimator(voronoi_estimate_ownership);
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.handleClick(1, 0, false, 0);
        se.handleClick(2, 0, false, 0);
        expect(se.removal).toEqual([
            [false, true, true, false],
            [false, true, true, false],
        ]);

        expect(se.ownership).toEqual(makeMatrix(4, 2, 0));
    });

    test("modkey", async () => {
        set_local_ownership_estimator(voronoi_estimate_ownership);
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.handleClick(1, 0, true, 0);
        expect(se.removal).toEqual([
            [false, true, false, false],
            [false, true, false, false],
        ]);
    });

    test("long press", async () => {
        set_local_ownership_estimator(voronoi_estimate_ownership);
        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.handleClick(1, 0, false, 1000);
        expect(se.removal).toEqual([
            [false, true, false, false],
            [false, true, false, false],
        ]);
    });

    test("score() with captures", async () => {
        // A board that is split down the middle between black and white
        const engine = new GobanEngine({
            width: 8,
            height: 8,
            initial_state: { black: "dadbdcdddedfdgdh", white: "eaebecedeeefegeh" },
            komi: 0,
        });

        // Capture a stone in the corner
        engine.place(7, 0);
        engine.place(7, 1);
        engine.place(-1, -1);
        engine.place(6, 0);

        //   A B C D E F G H
        // 8 . . . X O . O{.}
        // 7 . . . X O . . O
        // 6 . . . X O . . .
        // 5 . . . X O . . .
        // 4 . . . X O . . .
        // 3 . . . X O . . .
        // 2 . . . X O . . .
        // 1 . . . X O . . .

        const se = new ScoreEstimator(engine, undefined, 10, 0.5, false);
        await se.when_ready;

        se.score();

        expect(se.amount).toBe(1);
        expect(se.winner).toBe("Black");
    });
});
