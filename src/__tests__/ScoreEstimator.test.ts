import { GoEngine } from "../GoEngine";
import { ScoreEstimator, adjust_estimate, set_remote_scorer } from "../ScoreEstimator";

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

    beforeEach(() => {
        set_remote_scorer(async () => {
            return { ownership: OWNERSHIP };
        });
    });

    afterEach(() => {
        set_remote_scorer(undefined as any);
    });

    test("resetGroups", async () => {
        const engine = new GoEngine({ komi: KOMI, width: 4, height: 2 });
        engine.place(1, 0);
        engine.place(2, 0);
        engine.place(1, 1);
        engine.place(2, 1);

        // It might seem weird to set prefer_remote = true just to test
        // resetGroups, but is a necessary hack to bypass initialization of
        // the OGSScoreEstimation library
        const prefer_remote = true;
        const se = new ScoreEstimator(undefined, engine, 10, 0.5, prefer_remote);

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
});
