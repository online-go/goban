import { GoEngine } from "../GoEngine";
import { GobanMoveError } from "../GobanError";
import { JGOFIntersection } from "../JGOF";

describe("GoEngine.place()", () => {
    test("Basic test to make sure it's working", () => {
        const engine = new GoEngine({});

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
        const engine = new GoEngine({ width: 3, height: 3 });

        engine.place(1, 1);

        expect(() => engine.place(1, 1)).toThrow(
            new GobanMoveError(0, 1, "B2", "stone_already_placed_here"),
        );
    });

    test("capture", () => {
        const engine = new GoEngine({ width: 2, height: 2 });

        engine.place(0, 1);
        engine.place(0, 0);

        expect(engine.place(1, 0)).toBe(1);
        expect(engine.board).toEqual([
            [0, 1],
            [1, 0],
        ]);
    });

    test("ko", () => {
        const engine = new GoEngine({
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
        const engine = new GoEngine({
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

    test("suicide", () => {
        const engine = new GoEngine({
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
            new GobanMoveError(0, 0, "A2", "move_is_suicidal"),
        );
    });

    test("Self capture allowed (ing)", () => {
        const goban_callback = {
            set: jest.fn(),
        };

        const engine = new GoEngine(
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
        const engine = new GoEngine({ width: 2, height: 2 });

        engine.place(0, 1);
        engine.place(0, 0);

        const removed_stones: JGOFIntersection[] = [];
        expect(engine.place(1, 0, false, false, false, false, false, removed_stones)).toBe(1);
        expect(removed_stones).toEqual([{ x: 0, y: 0 }]);
    });
});
