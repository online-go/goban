import { GoEngine } from "../GoEngine";
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
            [0, 0, 0, -1, 1, 1, 1, 1, 1],
            [0, 0, 0, -1, 1, 1, 1, 1, 1],
            [1, 1, 1, -1, 0, 1, 1, 1, 1],
            [0, 0, 0, -1, 0, 1, 1, 1, 1],
            [-1, -1, -1, 0, 1, 1, 1, 1, 1],
            [-1, -1, -1, -1, 1, 1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
            [-1, -1, -1, -1, -1, -1, 1, 1, 1],
        ]);
    });
});
