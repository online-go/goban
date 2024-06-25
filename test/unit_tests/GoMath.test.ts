/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
//cspell: disable

import {
    StoneStringBuilder,
    JGOFNumericPlayerColor,
    BoardState,
    decodePrettyCoordinates,
    encodeMove,
    decodeGTPCoordinates,
    decodeMoves,
    encodeMovesToArray,
    encodeMoveToArray,
    makeEmptyMatrix,
    makeMatrix,
    makeObjectMatrix,
    ojeSequenceToMoves,
    prettyCoordinates,
    sortMoves,
} from "engine";

describe("GoStoneGroups constructor", () => {
    test("basic board state", () => {
        const THREExTHREE_board: JGOFNumericPlayerColor[][] = [
            [1, 0, 2],
            [2, 1, 1],
            [2, 0, 1],
        ];
        const THREExTHREE_removal: boolean[][] = [
            [false, false, false],
            [false, false, false],
            [false, false, false],
        ];

        const stone_string_builder = new StoneStringBuilder(
            new BoardState({
                board: THREExTHREE_board,
                removal: THREExTHREE_removal,
            }),
        );

        // TODO: examine usage in real code and flesh out expectations to reflect that usage
        expect(stone_string_builder.stone_strings.length).toBe(7);
        expect(stone_string_builder.stone_strings[0]).toBe(undefined); // what does this element represent?
        expect(stone_string_builder.stone_strings[1].intersections).toEqual([{ x: 0, y: 0 }]);
        expect(stone_string_builder.stone_strings[2].intersections).toEqual([{ x: 1, y: 0 }]);
        expect(stone_string_builder.stone_strings[3].intersections).toEqual([{ x: 2, y: 0 }]);
        expect(stone_string_builder.stone_strings[4].intersections).toEqual([
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        expect(stone_string_builder.stone_strings[5].intersections).toEqual([
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 2, y: 2 },
        ]);
        expect(stone_string_builder.stone_strings[6].intersections).toEqual([{ x: 1, y: 2 }]);
    });
});

describe("matrices", () => {
    test("makeMatrix", () => {
        expect(makeMatrix(3, 2, 0)).toEqual([
            [0, 0, 0],
            [0, 0, 0],
        ]);
        expect(makeMatrix(3, 2, 1234)).toEqual([
            [1234, 1234, 1234],
            [1234, 1234, 1234],
        ]);
        expect(makeMatrix(0, 0, 0)).toEqual([]);
    });

    test("makeMatrix<string>", () => {
        expect(makeMatrix(3, 2, "")).toEqual([
            ["", "", ""],
            ["", "", ""],
        ]);
        expect(makeMatrix(3, 2, "asdf")).toEqual([
            ["asdf", "asdf", "asdf"],
            ["asdf", "asdf", "asdf"],
        ]);
        expect(makeMatrix(0, 0, "")).toEqual([]);
    });

    test("makeObjectMatrix", () => {
        expect(makeObjectMatrix(3, 2)).toEqual([
            [{}, {}, {}],
            [{}, {}, {}],
        ]);
        expect(makeObjectMatrix(0, 0)).toEqual([]);
    });

    test("makeEmptyObjectMatrix", () => {
        expect(makeEmptyMatrix(3, 2)).toEqual([
            [undefined, undefined, undefined],
            [undefined, undefined, undefined],
        ]);
        expect(makeEmptyMatrix(0, 0)).toEqual([]);
    });
});

describe("prettyCoords", () => {
    test("pass", () => {
        expect(prettyCoordinates(-1, -1, 19)).toBe("pass");
    });

    test("out of bounds", () => {
        // I doubt this is actually desired behavior.  Feel free to remove this
        // test after verifying nothing depends on this behavior.
        expect(prettyCoordinates(25, 9, 19)).toBe("undefined10");
        expect(prettyCoordinates(9, 25, 19)).toBe("K-6");
    });

    test("regular moves", () => {
        expect(prettyCoordinates(0, 0, 19)).toBe("A19");
        expect(prettyCoordinates(2, 15, 19)).toBe("C4");
        expect(prettyCoordinates(9, 9, 19)).toBe("K10");
    });
});

describe("decodeGTPCoordinate", () => {
    test("pass", () => {
        expect(decodeGTPCoordinates("pass", 19, 19)).toEqual({ x: -1, y: -1 });
        expect(decodeGTPCoordinates("..", 19, 19)).toEqual({ x: -1, y: -1 });
    });
    test("nonsense", () => {
        expect(decodeGTPCoordinates("&%", 19, 19)).toEqual({ x: -1, y: -1 });
    });
    test("regular moves (lowercase)", () => {
        expect(decodeGTPCoordinates("a1", 19, 19)).toEqual({ x: 0, y: 18 });
        expect(decodeGTPCoordinates("c4", 19, 19)).toEqual({ x: 2, y: 15 });
        expect(decodeGTPCoordinates("k10", 19, 19)).toEqual({ x: 9, y: 9 });
    });

    test("regular moves (lowercase)", () => {
        expect(decodeGTPCoordinates("A1", 19, 19)).toEqual({ x: 0, y: 18 });
        expect(decodeGTPCoordinates("C4", 19, 19)).toEqual({ x: 2, y: 15 });
        expect(decodeGTPCoordinates("K10", 19, 19)).toEqual({ x: 9, y: 9 });
    });
});

describe("decodeMoves", () => {
    test("decodes string", () => {
        expect(decodeMoves("aabbcc", 19, 19)).toEqual([
            { x: 0, y: 0, color: 0, edited: false },
            { x: 1, y: 1, color: 0, edited: false },
            { x: 2, y: 2, color: 0, edited: false },
        ]);
    });

    test("decodes string with passes", () => {
        expect(decodeMoves("aa..", 19, 19)).toEqual([
            { x: 0, y: 0, color: 0, edited: false },
            { x: -1, y: -1, color: 0, edited: false },
        ]);
    });

    test("converts JGOFMove to Array<JGOFMove>", () => {
        expect(decodeMoves({ x: 2, y: 2 }, 19, 19)).toEqual([{ x: 2, y: 2 }]);
    });

    test("throws on random object", () => {
        expect(() => {
            decodeMoves(new Object() as any, 19, 19);
        }).toThrow("Invalid move format: {}");
    });

    test("x greater than width returns pass", () => {
        expect(decodeMoves("da", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("y greater than height returns pass", () => {
        expect(decodeMoves("ad", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("bad data", () => {
        // not really sure when this happens, but there's code to handle it
        expect(decodeMoves("!undefined", 19, 19)).toEqual([
            { x: -1, y: -1, color: 0, edited: true },
        ]);
    });

    test("pretty coordinates", () => {
        expect(decodeMoves("K10", 19, 19)).toEqual([{ x: 9, y: 9, color: 0, edited: false }]);
    });

    test("throws on unparsed input", () => {
        expect(() => {
            decodeMoves("K10z", 19, 19);
        }).toThrow("Unparsed move input: z");
    });

    test("pretty x greater than width returns pass", () => {
        expect(decodeMoves("D1", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("pretty y greater than height returns pass", () => {
        expect(decodeMoves("A4", 3, 3)).toEqual([{ x: -1, y: -1, color: 0, edited: false }]);
    });

    test("throws without height and width", () => {
        // Actually this ts is meant to cover the undefined case..

        expect(() => {
            decodeMoves("aabbcc", 0, 0);
        }).toThrow(
            "decodeMoves requires a height and width to be set when decoding a string coordinate",
        );
    });

    test("single packed move", () => {
        expect(decodeMoves([1, 2, 2048], 3, 3)).toEqual([
            { x: 1, y: 2, color: 0, timedelta: 2048 },
        ]);
    });

    test("Array<JGOFMove>", () => {
        expect(
            decodeMoves(
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
            decodeMoves(
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
            decodeMoves(["asdf" as any, [3, 4, 2048]], 19, 19);
        }).toThrow("Unrecognized move format: asdf");
    });

    test("empty array", () => {
        expect(decodeMoves([], 19, 19)).toEqual([]);
    });
});

describe("encodeMove", () => {
    test("corner", () => {
        expect(encodeMove(0, 0)).toBe("aa");
    });

    test("tengen", () => {
        expect(encodeMove(9, 9)).toBe("jj");
    });

    test("a19", () => {
        expect(encodeMove(0, 18)).toBe("as");
    });

    test("t1", () => {
        expect(encodeMove(18, 0)).toBe("sa");
    });

    test("Move type", () => {
        expect(encodeMove({ x: 3, y: 3 })).toBe("dd");
    });

    test("throws if x is a number but y is missing", () => {
        expect(() => {
            encodeMove(3);
        }).toThrow("Invalid y parameter to encodeMove y = undefined");
    });
});

describe("decodePrettyCoord", () => {
    test("tengen", () => {
        expect(encodeMove(decodePrettyCoordinates("k10", 19))).toBe("jj");
    });

    test("a1", () => {
        expect(encodeMove(decodePrettyCoordinates("a1", 3))).toBe("ac");
    });

    test("capital", () => {
        expect(encodeMove(decodePrettyCoordinates("A1", 3))).toBe("ac");
    });

    test("far corner", () => {
        expect(encodeMove(decodePrettyCoordinates("c3", 3))).toBe("ca");
    });

    test("pass", () => {
        // Is this really the pretty representation of pass?
        expect(encodeMove(decodePrettyCoordinates(".4", 3))).toBe("..");
    });
});

describe("encodeMoveToArray", () => {
    test("x, y, timedelta", () => {
        expect(encodeMoveToArray({ x: 4, y: 5, timedelta: 678 })).toEqual([4, 5, 678]);
    });

    test("timedelta defaults to -1", () => {
        expect(encodeMoveToArray({ x: 1, y: 1 })).toEqual([1, 1, -1]);
    });

    test("if !edited color gets stripped", () => {
        expect(encodeMoveToArray({ x: 1, y: 1, timedelta: 1000, color: 2 })).toEqual([1, 1, 1000]);
    });

    test("if edited color is the 4th element", () => {
        expect(encodeMoveToArray({ x: 1, y: 1, timedelta: 1000, color: 2, edited: true })).toEqual([
            1, 1, 1000, 2,
        ]);
    });

    test("extra fields are saved", () => {
        expect(
            encodeMoveToArray({
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
        encodeMovesToArray([
            { x: 4, y: 4, timedelta: 2048 },
            { x: 3, y: 3, timedelta: 1024 },
        ]),
    ).toEqual([
        [4, 4, 2048],
        [3, 3, 1024],
    ]);
});

/*
describe("trimJGOFMoves", () => {
    test("empty", () => {
        expect(trimJGOFMoves([])).toEqual([]);
    });

    test("does not trim edited=true, color=1 etc.", () => {
        expect(
            trimJGOFMoves([
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
            trimJGOFMoves([
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
            trimJGOFMoves([
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
            trimJGOFMoves([
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
        trimJGOFMoves(arr);
        expect(arr).toEqual([
            {
                x: 1,
                y: 1,
                edited: false,
            },
        ]);
    });
});
*/

describe("sortMoves", () => {
    test("sorted array", () => {
        expect(sortMoves("aabbcc", 3, 3)).toBe("aabbcc");
    });

    test("reversed array", () => {
        expect(sortMoves("ccbbaa", 3, 3)).toBe("aabbcc");
    });

    test("y takes precedence", () => {
        expect(sortMoves("abba", 3, 3)).toBe("baab");
    });

    test("empty array", () => {
        expect(sortMoves("", 2, 2)).toBe("");
    });

    test("out of bounds", () => {
        expect(sortMoves("cc", 2, 2)).toBe("..");
    });

    test("edited moves pushed to the end", () => {
        expect(sortMoves("!1aabb!2ccdd", 4, 4)).toBe("bbdd!1aa!2cc");
    });

    test("repeat elements", () => {
        expect(sortMoves("aaaaaa", 2, 2)).toBe("aaaaaa");
    });
});

describe("ojeSequenceToMoves", () => {
    test("bad sequence", () => {
        expect(() => {
            ojeSequenceToMoves("nonsense");
        }).toThrow("root");
    });

    test.each([
        [".root", []],
        [".root.A19", [{ x: 0, y: 0 }]],
        [
            ".root.A19.pass.K10",
            [
                { x: 0, y: 0 },
                { x: -1, y: -1 },
                { x: 9, y: 9 },
            ],
        ],
    ])("id of %s", (sequence, id) => {
        expect(ojeSequenceToMoves(sequence)).toStrictEqual(id);
    });
});
