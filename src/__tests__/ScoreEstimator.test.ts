import { GoEngine } from "../GoEngine";
import { makeMatrix } from "../GoMath";
import {
    ScoreEstimator,
    adjust_estimate,
    set_local_scorer,
    set_remote_scorer,
} from "../ScoreEstimator";
import { estimateScoreVoronoi } from "../local_estimators/voronoi";

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

describe("ScoreEstimator", () => {
    const OWNERSHIP = [
        [1, 1, -1, -1],
        [1, 1, -1, -1],
    ];
    const KOMI = 0.5;
    const engine = new GoEngine({ komi: KOMI, width: 4, height: 2 });
    engine.place(1, 0);
    engine.place(2, 0);
    engine.place(1, 1);
    engine.place(2, 1);

    // It might seem weird to set prefer_remote = true just to test
    // resetGroups, but is a necessary hack to bypass initialization of
    // the OGSScoreEstimation library
    const prefer_remote = true;
    const trials = 10;
    const tolerance = 0.25;

    beforeEach(() => {
        set_remote_scorer(async () => {
            return { ownership: OWNERSHIP, score: -7.5 };
        });

        set_local_scorer(estimateScoreVoronoi);
    });

    afterEach(() => {
        set_remote_scorer(undefined as any);
    });

    test("resetGroups", async () => {
        const se = new ScoreEstimator(undefined, engine, trials, tolerance, prefer_remote);

        await se.when_ready;

        expect(se.group_list).toHaveLength(4);
        expect(se.group_list.map((group) => group.points)).toEqual([
            [
                { x: 0, y: 0 },
                { x: 0, y: 1 },
            ],
            [
                { x: 1, y: 0 },
                { x: 1, y: 1 },
            ],
            [
                { x: 2, y: 0 },
                { x: 2, y: 1 },
            ],
            [
                { x: 3, y: 0 },
                { x: 3, y: 1 },
            ],
        ]);
        expect(se.group_list.map((group) => group.color)).toEqual([0, 1, 2, 0]);
    });

    test("amount and winner", async () => {
        const se = new ScoreEstimator(undefined, engine, trials, tolerance, false);

        await se.when_ready;

        // Though these properties are not used within Goban,
        // They are used in the UI as of this writing.
        expect(se.winner).toBe("White");
        expect(se.amount).toBe(0.5);
    });

    test("local", async () => {
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);

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
        const engine = new GoEngine({ komi: KOMI, width: 9, height: 9, rules: "chinese" });
        for (const [x, y] of moves) {
            engine.place(x, y);
        }
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);

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

    test("score()", async () => {
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        await se.when_ready;

        se.score();

        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 0,
            scoring_positions: "dadb",
            stones: 0,
            territory: 0,
            total: 0.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 0,
            scoring_positions: "aaab",
            stones: 0,
            territory: 0,
            total: 0,
        });
    });

    test("score() chinese", async () => {
        const engine = new GoEngine({ komi: KOMI, width: 4, height: 2, rules: "chinese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(2, 1);

        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        await se.when_ready;

        se.score();

        expect(se.white).toEqual({
            handicap: 0,
            komi: 0.5,
            prisoners: 0,
            scoring_positions: "dadbcacb",
            stones: 2,
            territory: 0,
            total: 2.5,
        });
        expect(se.black).toEqual({
            handicap: 0,
            komi: 0,
            prisoners: 0,
            scoring_positions: "aaabbabb",
            stones: 2,
            territory: 0,
            total: 2,
        });
    });

    test("don't score territory in seki (japanese)", async () => {
        // . x o .
        // x x . o

        const engine = new GoEngine({ komi: KOMI, width: 4, height: 2, rules: "japanese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(3, 1);
        engine.place(0, 1);

        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
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
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        se.toggleMetaGroupRemoval(1, 0);
        se.toggleMetaGroupRemoval(2, 0);
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
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        se.toggleMetaGroupRemoval(1, 0);
        se.toggleMetaGroupRemoval(2, 0);
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

        const se = new ScoreEstimator(fake_goban as any, engine, 10, 0.5, false);
        await se.when_ready;

        expect(fake_goban.updateScoreEstimation).toBeCalled();

        se.setRemoved(1, 0, 1);
        expect(fake_goban.setForRemoval).toBeCalledWith(1, 0, 1);
    });

    test("getProbablyDead", async () => {
        const markBoardAllBlack = () => [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ];
        set_local_scorer(markBoardAllBlack);

        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        await se.when_ready;

        // Note (bpj): I think this might be a bug
        // This is marking all stones dead, but the black stones should still be alive.
        expect(se.getProbablyDead()).toBe("babbcacb");
        // expect(se.getProbablyDead()).toBe("cacb");
    });

    test("Falls back to local scorer if remote scorer is not set", async () => {
        set_remote_scorer(undefined as any);
        const mock_local_scorer = jest.fn();
        mock_local_scorer.mockReturnValue([
            [1, 1, -1, -1],
            [1, 1, -1, -1],
        ]);
        set_local_scorer(mock_local_scorer);

        const se = new ScoreEstimator(undefined, engine, 10, 0.5, true);
        await se.when_ready;

        expect(mock_local_scorer).toBeCalled();
        expect(se.ownership).toEqual([
            [1, 0, 0, -1],
            [1, 0, 0, -1],
        ]);
    });

    test("remote scorers do not need to set score", async () => {
        const engine = new GoEngine({ komi: 3.5, width: 4, height: 2, rules: "chinese" });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(2, 1);

        set_remote_scorer(async () => ({
            ownership: OWNERSHIP,
        }));

        const se = new ScoreEstimator(undefined, engine, 10, 0.5, true);
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
        set_local_scorer(estimateScoreVoronoi);
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        await se.when_ready;

        se.handleClick(1, 0, false);
        se.handleClick(2, 0, false);
        expect(se.removal).toEqual([
            [0, 1, 1, 0],
            [0, 1, 1, 0],
        ]);

        expect(se.ownership).toEqual(makeMatrix(4, 2));
    });

    test("modkey", async () => {
        set_local_scorer(estimateScoreVoronoi);
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, false);
        await se.when_ready;

        se.handleClick(1, 0, true);
        expect(se.removal).toEqual([
            [0, 1, 0, 0],
            [0, 0, 0, 0],
        ]);
    });
});
