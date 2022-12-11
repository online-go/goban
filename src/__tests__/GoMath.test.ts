import { GoMath, BoardState } from "../GoMath";
import { JGOFNumericPlayerColor } from "../JGOF";

describe("GoMath constructor", () => {
    test("basic board state", () => {
        const THREExTHREE_board: Array<Array<JGOFNumericPlayerColor>> = [
            [1, 0, 2],
            [2, 1, 1],
            [2, 0, 1],
        ];
        const THREExTHREE_removal: Array<Array<number>> = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        const board_state: BoardState = {
            width: 3,
            height: 3,
            board: THREExTHREE_board,
            removal: THREExTHREE_removal,
        };

        const gomath_obj = new GoMath(board_state);

        // TODO: examine usage in real code and flesh out expectations to reflect that usage
        expect(gomath_obj.groups.length).toBe(7);
        expect(gomath_obj.groups[0]).toBe(undefined); // what does this element represent?
        expect(gomath_obj.groups[1].points).toEqual([{ x: 0, y: 0 }]);
        expect(gomath_obj.groups[2].points).toEqual([{ x: 1, y: 0 }]);
        expect(gomath_obj.groups[3].points).toEqual([{ x: 2, y: 0 }]);
        expect(gomath_obj.groups[4].points).toEqual([
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        expect(gomath_obj.groups[5].points).toEqual([
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(gomath_obj.groups[6].points).toEqual([{ x: 1, y: 2 }]);
    });
});

describe("matrices", () => {
    test("makeMatrix", () => {
        expect(GoMath.makeMatrix(3, 2)).toEqual([
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(GoMath.makeMatrix(3, 2, 1234)).toEqual([
            [1234, 1234, 1234],
            [1234, 1234, 1234],
        ]);
        expect(GoMath.makeMatrix(0, 0)).toEqual([]);
    });

    test("makeStringMatrix", () => {
        expect(GoMath.makeStringMatrix(3, 2)).toEqual([
            ["", "", ""],
            ["", "", ""],
        ]);
        expect(GoMath.makeStringMatrix(3, 2, "asdf")).toEqual([
            ["asdf", "asdf", "asdf"],
            ["asdf", "asdf", "asdf"],
        ]);
        expect(GoMath.makeStringMatrix(0, 0)).toEqual([]);
    });

    test("makeObjectMatrix", () => {
        expect(GoMath.makeObjectMatrix(3, 2)).toEqual([
            [{}, {}, {}],
            [{}, {}, {}],
        ]);
        expect(GoMath.makeObjectMatrix(0, 0)).toEqual([]);
    });

    test("makeEmptyObjectMatrix", () => {
        expect(GoMath.makeEmptyObjectMatrix(3, 2)).toEqual([
            [undefined, undefined, undefined],
            [undefined, undefined, undefined],
        ]);
        expect(GoMath.makeEmptyObjectMatrix(0, 0)).toEqual([]);
    });
});

describe("prettyCoords", () => {
    test("pass", () => {
        expect(GoMath.prettyCoords(-1, -1, 19)).toBe("pass");
    });

    test("out of bounds", () => {
        // I doubt this is actually desired behavior.  Feel free to remove this
        // test after verifying nothing depends on this behavior.
        expect(GoMath.prettyCoords(25, 9, 19)).toBe("undefined10");
        expect(GoMath.prettyCoords(9, 25, 19)).toBe("K-6");
    });

    test("regular moves", () => {
        expect(GoMath.prettyCoords(0, 0, 19)).toBe("A19");
        expect(GoMath.prettyCoords(2, 15, 19)).toBe("C4");
        expect(GoMath.prettyCoords(9, 9, 19)).toBe("K10");
    });
});

describe("decodeGTPCoordinate", () => {
    test("pass", () => {
        expect(GoMath.decodeGTPCoordinate("pass", 19, 19)).toEqual({ x: -1, y: -1 });
        expect(GoMath.decodeGTPCoordinate("..", 19, 19)).toEqual({ x: -1, y: -1 });
    });
    test("nonsense", () => {
        expect(GoMath.decodeGTPCoordinate("&%", 19, 19)).toEqual({ x: -1, y: -1 });
    });
    test("regular moves (lowercase)", () => {
        expect(GoMath.decodeGTPCoordinate("a1", 19, 19)).toEqual({ x: 0, y: 18 });
        expect(GoMath.decodeGTPCoordinate("c4", 19, 19)).toEqual({ x: 2, y: 15 });
        expect(GoMath.decodeGTPCoordinate("k10", 19, 19)).toEqual({ x: 9, y: 9 });
    });

    test("regular moves (lowercase)", () => {
        expect(GoMath.decodeGTPCoordinate("A1", 19, 19)).toEqual({ x: 0, y: 18 });
        expect(GoMath.decodeGTPCoordinate("C4", 19, 19)).toEqual({ x: 2, y: 15 });
        expect(GoMath.decodeGTPCoordinate("K10", 19, 19)).toEqual({ x: 9, y: 9 });
    });
});

describe("decodeMoves", () => {
    test("decodes string", () => {
        expect(GoMath.decodeMoves("aabbcc", 19, 19)).toEqual([
            { x: 0, y: 0, color: 0, edited: false },
            { x: 1, y: 1, color: 0, edited: false },
            { x: 2, y: 2, color: 0, edited: false },
        ]);
    });

    test("decodes string with passes", () => {
        expect(GoMath.decodeMoves("aa..", 19, 19)).toEqual([
            { x: 0, y: 0, color: 0, edited: false },
            { x: -1, y: -1, color: 0, edited: false },
        ]);
    });

    test("converts JGOFMove to Array<JGOFMove>", () => {
        expect(GoMath.decodeMoves({ x: 2, y: 2 }, 19, 19)).toEqual([{ x: 2, y: 2 }]);
    });

    test("throws on random object", () => {
        expect(() => {
            GoMath.decodeMoves(new Object() as any, 19, 19);
        }).toThrow("Invalid move format: {}");
    });

    test("x greater than width returns pass", () => {
        expect(GoMath.decodeMoves("da", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("y greater than height returns pass", () => {
        expect(GoMath.decodeMoves("ad", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("bad data", () => {
        // not really sure when this happens, but there's code to handle it
        expect(GoMath.decodeMoves("!undefined", 19, 19)).toEqual([
            { x: -1, y: -1, color: 0, edited: true },
        ]);
    });

    test("pretty coordinates", () => {
        expect(GoMath.decodeMoves("K10", 19, 19)).toEqual([
            { x: 9, y: 9, color: 0, edited: false },
        ]);
    });

    test("throws on unparsed input", () => {
        expect(() => {
            GoMath.decodeMoves("K10z", 19, 19);
        }).toThrow("Unparsed move input: z");
    });

    test("pretty x greater than width returns pass", () => {
        expect(GoMath.decodeMoves("D1", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("pretty y greater than height returns pass", () => {
        expect(GoMath.decodeMoves("A4", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("throws without height and width", () => {
        // Actually this ts is meant to cover the undefined case..

        expect(() => {
            GoMath.decodeMoves("aabbcc", 0, 0);
        }).toThrow(
            "decodeMoves requires a height and width to be set when decoding a string coordinate",
        );
    });

    test("single packed move", () => {
        expect(GoMath.decodeMoves([1, 2, 2048], 3, 3)).toEqual([
            { x: 1, y: 2, color: 0, timedelta: 2048 },
        ]);
    });

    test("Array<JGOFMove>", () => {
        expect(
            GoMath.decodeMoves(
                [
                    { x: 4, y: 4, color: 1 },
                    { x: 3, y: 3, color: 2 },
                ],
                19,
                19,
            ),
        ).toEqual([
            { x: 4, y: 4, color: 1 },
            { x: 3, y: 3, color: 2 },
        ]);
    });

    test("Array<packed move>", () => {
        expect(
            GoMath.decodeMoves(
                [
                    [1, 2, 2048, 2, { blur: 1234 }],
                    [3, 4, 2048, 1],
                ],
                19,
                19,
            ),
        ).toEqual([
            { x: 1, y: 2, timedelta: 2048, color: 2, blur: 1234 },
            { x: 3, y: 4, timedelta: 2048, color: 1 },
        ]);
    });

    test("throws without height and width", () => {
        expect(() => {
            GoMath.decodeMoves(["asdf" as any, [3, 4, 2048]], 19, 19);
        }).toThrow("Unrecognized move format: asdf");
    });

    test("empty array", () => {
        expect(GoMath.decodeMoves([], 19, 19)).toEqual([]);
    });
});

describe("encodeMove", () => {
    test("corner", () => {
        expect(GoMath.encodeMove(0, 0)).toBe("aa");
    });

    test("tengen", () => {
        expect(GoMath.encodeMove(9, 9)).toBe("jj");
    });

    test("a19", () => {
        expect(GoMath.encodeMove(0, 18)).toBe("as");
    });

    test("t1", () => {
        expect(GoMath.encodeMove(18, 0)).toBe("sa");
    });

    test("Move type", () => {
        expect(GoMath.encodeMove({ x: 3, y: 3 })).toBe("dd");
    });

    test("throws if x is a number but y is missing", () => {
        expect(() => {
            GoMath.encodeMove(3);
        }).toThrow("Invalid y parameter to encodeMove y = undefined");
    });
});

describe("encodePrettyCoord", () => {
    test("tengen", () => {
        expect(GoMath.encodePrettyCoord("k10", 19)).toBe("jj");
    });

    test("a1", () => {
        expect(GoMath.encodePrettyCoord("a1", 3)).toBe("ac");
    });

    test("capital", () => {
        expect(GoMath.encodePrettyCoord("A1", 3)).toBe("ac");
    });

    test("far corner", () => {
        expect(GoMath.encodePrettyCoord("c3", 3)).toBe("ca");
    });

    test("pass", () => {
        // Is this really the pretty representation of pass?
        expect(GoMath.encodePrettyCoord(".4", 3)).toBe("..");
    });
});

describe("encodeMoveToArray", () => {
    test("x, y, timedelta", () => {
        expect(GoMath.encodeMoveToArray({ x: 4, y: 5, timedelta: 678 })).toEqual([4, 5, 678]);
    });

    test("timedelta defaults to -1", () => {
        expect(GoMath.encodeMoveToArray({ x: 1, y: 1 })).toEqual([1, 1, -1]);
    });

    test("if !edited color gets stripped", () => {
        expect(GoMath.encodeMoveToArray({ x: 1, y: 1, timedelta: 1000, color: 2 })).toEqual([
            1, 1, 1000,
        ]);
    });

    test("if edited color is the 4th element", () => {
        expect(
            GoMath.encodeMoveToArray({ x: 1, y: 1, timedelta: 1000, color: 2, edited: true }),
        ).toEqual([1, 1, 1000, 2]);
    });

    test("extra fields are saved", () => {
        expect(
            GoMath.encodeMoveToArray({
                x: 1,
                y: 1,
                timedelta: 1000,
                blur: 100,
                sgf_downloaded_by: [1, 2, 3],
                played_by: 456,
                player_update: {
                    players: { black: 3, white: 4 },
                    rengo_teams: { black: [1, 3, 5], white: [2, 4, 6] },
                },
            }),
        ).toEqual([
            1,
            1,
            1000,
            undefined,
            {
                blur: 100,
                sgf_downloaded_by: [1, 2, 3],
                played_by: 456,
                player_update: {
                    players: { black: 3, white: 4 },
                    rengo_teams: { black: [1, 3, 5], white: [2, 4, 6] },
                },
            },
        ]);
    });
});

test("encodeMovesToArray", () => {
    expect(
        GoMath.encodeMovesToArray([
            { x: 4, y: 4, timedelta: 2048 },
            { x: 3, y: 3, timedelta: 1024 },
        ]),
    ).toEqual([
        [4, 4, 2048],
        [3, 3, 1024],
    ]);
});

describe("stripModeratorOnlyExtraInformation", () => {
    test("does not strip x, y, timedelta", () => {
        expect(GoMath.stripModeratorOnlyExtraInformation([1, 2, 3])).toEqual([1, 2, 3]);
    });

    test("trims blur", () => {
        expect(GoMath.stripModeratorOnlyExtraInformation([1, 2, 3, 1, { blur: 1 }])).toEqual([
            1, 2, 3, 1,
        ]);
    });

    test("trims sgf_downloaded_by", () => {
        expect(
            GoMath.stripModeratorOnlyExtraInformation([1, 2, 3, 1, { sgf_downloaded_by: 1234 }]),
        ).toEqual([1, 2, 3, 1]);
    });

    test("doesn't trim non-mod info in extra", () => {
        expect(
            GoMath.stripModeratorOnlyExtraInformation([1, 2, 3, 1, { misc_extra: "asdf" }]),
        ).toEqual([1, 2, 3, 1, { misc_extra: "asdf" }]);
    });
});

describe("trimJGOFMoves", () => {
    test("empty", () => {
        expect(GoMath.trimJGOFMoves([])).toEqual([]);
    });

    test("does not trim edited=true, color=1 etc.", () => {
        expect(
            GoMath.trimJGOFMoves([
                {
                    x: 1,
                    y: 1,
                    color: 1,
                    timedelta: 32,
                    edited: true,
                },
            ]),
        ).toEqual([
            {
                x: 1,
                y: 1,
                color: 1,
                timedelta: 32,
                edited: true,
            },
        ]);
    });

    test("trims played_by", () => {
        expect(
            GoMath.trimJGOFMoves([
                {
                    x: 1,
                    y: 1,
                    played_by: 12345,
                },
            ]),
        ).toEqual([
            {
                x: 1,
                y: 1,
            },
        ]);
    });

    test("trims edited=false", () => {
        expect(
            GoMath.trimJGOFMoves([
                {
                    x: 1,
                    y: 1,
                    edited: false,
                },
            ]),
        ).toEqual([
            {
                x: 1,
                y: 1,
            },
        ]);
    });

    test("trims color=0", () => {
        expect(
            GoMath.trimJGOFMoves([
                {
                    x: 1,
                    y: 1,
                    color: 0,
                },
            ]),
        ).toEqual([
            {
                x: 1,
                y: 1,
            },
        ]);
    });

    test("does not modify the original array", () => {
        const arr = [
            {
                x: 1,
                y: 1,
                edited: false,
            },
        ];
        GoMath.trimJGOFMoves(arr);
        expect(arr).toEqual([
            {
                x: 1,
                y: 1,
                edited: false,
            },
        ]);
    });
});

describe("sortMoves", () => {
    test("sorted array", () => {
        expect(GoMath.sortMoves("aabbcc", 3, 3)).toBe("aabbcc");
    });

    test("reversed array", () => {
        expect(GoMath.sortMoves("ccbbaa", 3, 3)).toBe("aabbcc");
    });

    test("y takes precedence", () => {
        expect(GoMath.sortMoves("abba", 3, 3)).toBe("baab");
    });

    test("empty array", () => {
        expect(GoMath.sortMoves("", 2, 2)).toBe("");
    });

    test("out of bounds", () => {
        expect(GoMath.sortMoves("cc", 2, 2)).toBe("..");
    });

    test("edited moves pushed to the end", () => {
        expect(GoMath.sortMoves("!1aabb!2ccdd", 4, 4)).toBe("bbdd!1aa!2cc");
    });

    test("repeat elements", () => {
        expect(GoMath.sortMoves("aaaaaa", 2, 2)).toBe("aaaaaa");
    });
});
