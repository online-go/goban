/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
import { StoneStringBuilder, BoardState, makeMatrix } from "engine";

// Here is a board displaying many of the features GoStoneGroup cares about.

//   A B C D E
// 5 . . O X .
// 4 O O O X X
// 3 X . O X .
// 2 . X O X X
// 1 X X O X .

// A2: Eye, but not a "strong" eye
// E1, E3, E5: Strong eyes
// D1-E5 stones: Strong string
// all empty space except B3: Territory
// A5-B5, A2: Territory in seki

const FEATURE_BOARD = [
    [0, 0, 1, 2, 0],
    [1, 1, 1, 2, 2],
    [2, 0, 1, 2, 0],
    [0, 2, 1, 2, 2],
    [2, 2, 1, 2, 0],
];

const REMOVAL = makeMatrix(5, 5, false);

function makeGoMathWithFeatureBoard() {
    return new StoneStringBuilder(
        new BoardState({
            board: FEATURE_BOARD,
            removal: REMOVAL,
        }),
    );
}

test("Group ID Map", () => {
    const gm = makeGoMathWithFeatureBoard();

    expect(gm.stone_string_id_map).toEqual([
        [1, 1, 2, 3, 4],
        [2, 2, 2, 3, 3],
        [5, 6, 2, 3, 7],
        [8, 9, 2, 3, 3],
        [9, 9, 2, 3, 10],
    ]);
});

test("Territory", () => {
    const gm = makeGoMathWithFeatureBoard();

    const territory = gm.stone_strings.filter((g) => g.is_territory).map((g) => g.id);

    expect(territory).toEqual([1, 4, 7, 8, 10]);
});
