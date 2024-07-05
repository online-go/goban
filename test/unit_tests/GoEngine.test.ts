/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
//cspell: disable

import {
    GobanEngine,
    GobanMoveError,
    JGOFIntersection,
    makeMatrix,
    matricesAreEqual,
} from "engine";
import { movesFromBoardState } from "./test_utils";

test("boardMatricesAreTheSame", () => {
    const a = [
        [1, 2],
        [3, 4],
    ];
    const b = [
        [1, 2],
        [3, 4],
    ];
    const c = [
        [1, 1],
        [1, 1],
    ];
    const d = [
        [1, 2, 5],
        [3, 4, 6],
    ];
    expect(matricesAreEqual(a, b)).toBe(true);
    expect(matricesAreEqual(a, c)).toBe(false);
    expect(matricesAreEqual(a, d)).toBe(false);
});

describe("computeScore", () => {
    test("GobanEngine defaults", () => {
        const engine = new GobanEngine({});
        expect(engine.computeScore()).toEqual({
            black: {
                handicap: 0,
                komi: 0,
                prisoners: 0,
                scoring_positions: "",
                stones: 0,
                territory: 0,
                total: 0,
            },
            white: {
                handicap: 0,
                komi: 6.5,
                prisoners: 0,
                scoring_positions: "",
                stones: 0,
                territory: 0,
                total: 6.5,
            },
        });
    });

    test("GobanEngine defaults", () => {
        const engine = new GobanEngine({});
        expect(engine.computeScore()).toEqual({
            black: {
                handicap: 0,
                komi: 0,
                prisoners: 0,
                scoring_positions: "",
                stones: 0,
                territory: 0,
                total: 0,
            },
            white: {
                handicap: 0,
                komi: 6.5,
                prisoners: 0,
                scoring_positions: "",
                stones: 0,
                territory: 0,
                total: 6.5,
            },
        });
    });

    test("Japanese handicap", () => {
        const engine = new GobanEngine({ rules: "japanese", handicap: 4 });
        expect(engine.computeScore()).toEqual({
            black: expect.objectContaining({
                handicap: 0,
                komi: 0,
                territory: 357,
                total: 357,
            }),
            white: expect.objectContaining({
                handicap: 0,
                komi: 0.5,
                territory: 0,
                total: 0.5,
            }),
        });
    });

    test("AGA handicap - white is given compensation ", () => {
        const engine = new GobanEngine({ rules: "aga", handicap: 4 });

        // From the AGA Concise rules of Go:
        //
        // If the players have agreed to use area counting to score the game,
        // White receives an additional point of compensation for each Black
        // handicap stone after the first.
        expect(engine.computeScore().white).toEqual(
            expect.objectContaining({
                komi: 0.5,
                handicap: 3,
                total: 3.5,
            }),
        );
    });

    test("Both sides have territory", () => {
        const board = [
            [0, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ];
        const engine = new GobanEngine({ width: 4, height: 4, moves: movesFromBoardState(board) });

        expect(engine.computeScore()).toEqual({
            black: expect.objectContaining({
                scoring_positions: "aaabacad",
                stones: 0,
                territory: 4,
                total: 4,
            }),
            white: expect.objectContaining({
                komi: 6.5,
                scoring_positions: "dadbdcdd",
                stones: 0,
                territory: 4,
                total: 10.5,
            }),
        });
    });

    test("Both sides have territory (Chinese)", () => {
        const board = [
            [0, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 0],
        ];
        const engine = new GobanEngine({
            width: 4,
            height: 4,
            moves: movesFromBoardState(board),
            rules: "chinese",
        });

        expect(engine.computeScore()).toEqual({
            black: expect.objectContaining({
                scoring_positions: "aabaabbbacbcadbd",
                stones: 4,
                territory: 4,
                total: 8,
            }),
            white: expect.objectContaining({
                komi: 7.5,
                scoring_positions: "cadacbdbccdccddd",
                stones: 4,
                territory: 4,
                total: 15.5,
            }),
        });
    });

    test("Removed stones", () => {
        const board = [
            [2, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 0],
            [0, 1, 2, 1],
        ];
        const engine = new GobanEngine({
            width: 4,
            height: 4,
            moves: movesFromBoardState(board),
            rules: "chinese",
            removed: "aadd",
        });

        expect(engine.computeScore()).toEqual({
            black: expect.objectContaining({
                prisoners: 0,
                scoring_positions: "aabaabbbacbcadbd",
                stones: 4,
                territory: 4,
                total: 8,
            }),
            white: expect.objectContaining({
                prisoners: 0,
                komi: 7.5,
                scoring_positions: "cadacbdbccdccddd",
                stones: 4,
                territory: 4,
                total: 15.5,
            }),
        });
    });
});

describe("rules", () => {
    test("Korean is almost the same as Japanese", () => {
        // https://forums.online-go.com/t/just-a-brief-question/3564/10
        const korean_config = new GobanEngine({ rules: "korean" }).config;
        const japanese_config = new GobanEngine({ rules: "japanese" }).config;

        delete korean_config.rules;
        delete japanese_config.rules;

        expect(korean_config).toEqual(japanese_config);
    });
});

describe("GobanEngine.place()", () => {
    test("Basic test to make sure it's working", () => {
        const engine = new GobanEngine({});

        engine.place(16, 3);
        engine.place(3, 2);
        engine.place(15, 16);
        engine.place(14, 2);
        engine.place(2, 15);
        engine.place(16, 14);
        engine.place(15, 4);

        expect(engine.board).toEqual([
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
            [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]);
    });

    test("stone on top of stone", () => {
        const engine = new GobanEngine({ width: 3, height: 3 });

        engine.place(1, 1);

        expect(() => engine.place(1, 1)).toThrow(
            new GobanMoveError(0, 1, "B2", "stone_already_placed_here"),
        );
    });

    test("capture", () => {
        const engine = new GobanEngine({ width: 2, height: 2 });

        engine.place(0, 1);
        engine.place(0, 0);

        expect(engine.place(1, 0)).toBe(1);
        expect(engine.board).toEqual([
            [0, 1],
            [1, 0],
        ]);
    });

    test("ko", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 3,
            initial_state: {
                black: "baabbc",
                white: "cadbcc",
            },
        });

        /*   A B C D
         * 3 . X O .
         * 2 X . . O
         * 1 . X O .
         */

        engine.place(2, 1);
        engine.place(1, 1);

        expect(() => engine.place(2, 1, true)).toThrow(
            new GobanMoveError(0, 2, "C2", "illegal_ko_move"),
        );
    });

    test("superko", () => {
        const engine = new GobanEngine({
            rules: "chinese",
            initial_state: {
                black: "dabbcbdbccadbdcd",
                white: "baeaabebacdcecddaebecede",
            },
        });

        /*     A B C D E F
         *  19 . O . X O .
         *  18 O X X X O .
         *  17 O . X O O .
         *  16 X X X O . .
         *  15 O O O O . .
         *  14 . . . . . .
         */

        engine.place(-1, -1);
        engine.place(2, 0);
        engine.place(0, 0);
        engine.place(1, 0);
        engine.place(-1, -1);
        expect(() => engine.place(2, 0, true, true)).toThrow(
            new GobanMoveError(0, 5, "C19", "illegal_board_repetition"),
        );
    });

    test("self capture", () => {
        const engine = new GobanEngine({
            width: 2,
            height: 2,
            initial_state: {
                black: "",
                white: "abba",
            },
        });

        /*    A B
         *  2 . O
         *  1 O .
         */

        expect(() => engine.place(0, 0)).toThrow(
            new GobanMoveError(0, 0, "A2", "illegal_self_capture"),
        );
    });

    test("Self capture allowed (ing)", () => {
        const goban_callback = {
            set: jest.fn(),
        };

        const engine = new GobanEngine(
            {
                width: 2,
                height: 2,
                initial_state: {
                    black: "",
                    white: "abba",
                },
                rules: "ing",
            },
            goban_callback as any,
        );

        /*    A B
         *  2 . O
         *  1 O .
         */
        goban_callback.set.mockClear();
        expect(engine.place(0, 0)).toBe(1);
        expect(goban_callback.set).toBeCalledWith(0, 0, 0);
    });

    test("removed_stones parameter", () => {
        const engine = new GobanEngine({ width: 2, height: 2 });

        engine.place(0, 1);
        engine.place(0, 0);

        const removed_stones: JGOFIntersection[] = [];
        expect(engine.place(1, 0, false, false, false, false, false, removed_stones)).toBe(1);
        expect(removed_stones).toEqual([{ x: 0, y: 0 }]);
    });
});

describe("moves", () => {
    test("cur_review_move", () => {
        const engine = new GobanEngine({});
        const on_cur_review_move = jest.fn();
        engine.addListener("cur_review_move", on_cur_review_move);

        expect(engine.cur_review_move).toBeUndefined();

        engine.place(0, 0);

        expect(engine.cur_review_move).not.toBe(engine.cur_move);

        engine.setAsCurrentReviewMove();

        expect(engine.cur_review_move).toBe(engine.cur_move);
        expect(on_cur_review_move).toBeCalledTimes(1);

        on_cur_review_move.mockClear();
        engine.setAsCurrentReviewMove();

        // the signal shouldn't be emitted if the value doesn't actually change
        expect(on_cur_review_move).not.toBeCalled();
    });

    test("cur_move", () => {
        const engine = new GobanEngine({});
        const on_cur_move = jest.fn();
        engine.addListener("cur_move", on_cur_move);

        expect(engine.cur_move.x).toBe(-1);
        expect(engine.cur_move.y).toBe(-1);

        engine.place(2, 3);

        expect(engine.cur_move.x).toBe(2);
        expect(engine.cur_move.y).toBe(3);
        expect(on_cur_move).toBeCalledTimes(1);
    });

    describe("setLastOfficialMove", () => {
        test("cur_move on trunk", () => {
            const engine = new GobanEngine({});
            const on_last_official_move = jest.fn();
            engine.addListener("last_official_move", on_last_official_move);

            expect(engine.last_official_move).toBe(engine.cur_move);

            engine.place(10, 10, false, false, false, false, true /* isTrunkMove */);

            expect(on_last_official_move).not.toBeCalled();
            expect(engine.last_official_move).not.toBe(engine.cur_move);

            engine.setLastOfficialMove();

            expect(engine.last_official_move).toBe(engine.cur_move);
            expect(on_last_official_move).toBeCalledTimes(1);

            on_last_official_move.mockClear();

            engine.setLastOfficialMove();
            // nothing changed, so no message is emitted
            expect(on_last_official_move).toBeCalledTimes(0);
        });

        test("cur_move not on trunk is an error", () => {
            const engine = new GobanEngine({});

            // isTrunkMove is false by default
            engine.place(10, 10);
            expect(() => engine.setLastOfficialMove()).toThrow("non-trunk move");
        });
    });

    describe("config.moves", () => {
        test("two good moves", () => {
            const moves = [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ];
            const engine = new GobanEngine({ width: 2, height: 2, moves: moves });

            expect(engine.board).toEqual([
                [1, 0],
                [0, 2],
            ]);
        });

        test("one illegal move", () => {
            const moves = [
                { x: 0, y: 0 },
                { x: 0, y: 0 },
            ];
            // Placement errors are logged, not thrown
            const log_spy = jest.spyOn(console, "log").mockImplementation(() => {});
            const engine = new GobanEngine({ width: 2, height: 2, moves: moves });

            expect(engine.board).toEqual([
                [0, 0],
                [0, 0],
            ]);
            expect(log_spy.mock.calls[0][0].error).toBe("Error placing black at A2 (0, 0)");
        });
    });

    describe("config.move_tree", () => {
        test("move_tree but  not starting with pass", () => {
            const move_tree = {
                x: 0,
                y: 0,
                trunk_next: {
                    x: 1,
                    y: 1,
                },
            };

            // Personally I don't think this should throw - it would be nice if we could just pass in
            // a move_tree, but not moves and moves could be inferred by traversing trunk.
            expect(() => new GobanEngine({ width: 2, height: 2, move_tree })).toThrow(
                "Node mismatch",
            );
        });

        test("move_tree with two trunk moves", () => {
            const move_tree = {
                x: -1,
                y: -1,
                trunk_next: {
                    x: 0,
                    y: 0,
                    trunk_next: {
                        x: 1,
                        y: 1,
                    },
                },
            };

            const engine = new GobanEngine({ width: 2, height: 2, move_tree });

            expect(engine.board).toEqual([
                [0, 0],
                [0, 0],
            ]);

            engine.jumpToOfficialMoveNumber(2);

            expect(engine.board).toEqual([
                [1, 0],
                [0, 2],
            ]);
        });

        test("showNext", () => {
            const move_tree = {
                x: -1,
                y: -1,
                trunk_next: {
                    x: 0,
                    y: 0,
                    trunk_next: {
                        x: 1,
                        y: 1,
                    },
                },
            };

            const engine = new GobanEngine({ width: 2, height: 2, move_tree });

            expect(engine.cur_move.move_number).toBe(0);
            expect(engine.showNext()).toBe(true);
            expect(engine.cur_move.move_number).toBe(1);
        });

        test("showNextTrunk", () => {
            const move_tree = {
                x: -1,
                y: -1,
                trunk_next: {
                    x: 0,
                    y: 0,
                    trunk_next: {
                        x: 1,
                        y: 1,
                    },
                },
            };

            const engine = new GobanEngine({ width: 2, height: 2, move_tree });

            expect(engine.cur_move.move_number).toBe(0);
            expect(engine.showNextTrunk()).toBe(true);
            expect(engine.cur_move.move_number).toBe(1);
        });
    });

    test("followPath", () => {
        const engine = new GobanEngine({ width: 4, height: 2 });
        engine.followPath(10, "aabacada");
        expect(engine.board).toEqual([
            [1, 2, 1, 2],
            [0, 0, 0, 0],
        ]);
        expect(engine.cur_move.move_number).toBe(4);
    });

    test("deleteCurMove", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 2,
        });

        engine.followPath(0, "aabacada");

        expect(engine.cur_move.x).toBe(3);
        expect(engine.cur_move.move_number).toBe(4);

        engine.deleteCurMove();

        expect(engine.cur_move.x).toBe(2);
        expect(engine.cur_move.move_number).toBe(3);
    });
});

describe("groups", () => {
    test("toggleSingleGroupRemoval", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 4,
            initial_state: { black: "aabbdd", white: "cacbcccd" },
        });

        /*   A B C D
         * 4 x . o .
         * 3 . x o .
         * 2 . . o .
         * 1 . . o x
         */

        const on_removal_updated = jest.fn();
        engine.addListener("stone-removal.updated", on_removal_updated);

        engine.toggleSingleGroupRemoval(0, 0);

        expect(on_removal_updated).toBeCalledTimes(1);

        expect(engine.removal).toEqual([
            [true, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
        ]);

        engine.toggleSingleGroupRemoval(0, 0);

        expect(engine.removal).toEqual(makeMatrix(4, 4, false));
    });

    test("toggleSingleGroupRemoval out-of-bounds", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 4,
            initial_state: { black: "aabbdd", white: "cacbcccd" },
        });

        /*   A B C D
         * 4 x . o .
         * 3 . x o .
         * 2 . . o .
         * 1 . . o x
         */

        const on_removal_updated = jest.fn();
        engine.addListener("stone-removal.updated", on_removal_updated);

        expect(engine.toggleSingleGroupRemoval(0, 4)).toEqual({ removed: false, group: [] });
        expect(on_removal_updated).toBeCalledTimes(0);
    });

    test("toggleSingleGroupRemoval empty area doesn't do anything", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 2,
            initial_state: { black: "aabb", white: "cacb" },
        });

        /*   A B C D
         * 2 x . o .
         * 1 . x o .
         */

        const on_removal_updated = jest.fn();
        engine.addListener("stone-removal.updated", on_removal_updated);

        expect(engine.toggleSingleGroupRemoval(0, 1)).toEqual({ removed: false, group: [] });
        expect(on_removal_updated).toBeCalledTimes(0);
    });

    test("clearRemoved", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 2,
            initial_state: { black: "aabb", white: "cacb" },
            removed: "aabb",
        });

        /*   A B C D
         * 2 x . o .
         * 1 . x o .
         */

        const on_removal_updated = jest.fn();
        engine.addListener("stone-removal.updated", on_removal_updated);
        engine.clearRemoved();

        expect(on_removal_updated).toBeCalledTimes(1);
        expect(engine.removal).toEqual(makeMatrix(4, 2, false));
    });

    test("clearRemoved", () => {
        const engine = new GobanEngine({
            width: 4,
            height: 2,
            initial_state: { black: "aabb", white: "cacb" },
            removed: "aabb",
        });

        /*   A B C D
         * 2 x . o .
         * 1 . x o .
         */

        expect(engine.getStoneRemovalString()).toBe("aabb");
    });
});

describe("state", () => {
    const engine = new GobanEngine({});

    engine.place(0, 0);
    const move1 = engine.cur_move;
    engine.place(1, 1);
    const move2 = engine.cur_move;

    expect(engine.board[0][0]).toBe(1);
    expect(engine.board[1][1]).toBe(2);
    expect(engine.removal[1][1]).toBe(false);
    expect(engine.cur_move.state.removal[1][1]).toBe(false);

    engine.setRemoved(1, 1, true);
    expect(engine.removal[1][1]).toBe(true);
    expect(engine.cur_move.state.removal[1][1]).toBe(true);
    expect(engine.getStoneRemovalString()).toBe("bb");

    engine.jumpTo(move1);
    expect(engine.removal[1][1]).toBe(false);
    expect(engine.getStoneRemovalString()).toBe("");

    engine.jumpTo(move2);
    expect(engine.removal[1][1]).toBe(true);
    expect(engine.getStoneRemovalString()).toBe("bb");
});
