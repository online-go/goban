import * as GoMath from "../GoMath";
import { GoStoneGroups } from "../GoStoneGroups";

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

const REMOVAL = GoMath.makeMatrix(5, 5);

function makeGoMathWithFeatureBoard() {
    return new GoStoneGroups({
        board: FEATURE_BOARD,
        removal: REMOVAL,
        width: 5,
        height: 5,
    });
}

test("Group ID Map", () => {
    const gm = makeGoMathWithFeatureBoard();

    expect(gm.group_id_map).toEqual([
        [1, 1, 2, 3, 4],
        [2, 2, 2, 3, 3],
        [5, 6, 2, 3, 7],
        [8, 9, 2, 3, 3],
        [9, 9, 2, 3, 10],
    ]);
});

test("Eyes", () => {
    const gm = makeGoMathWithFeatureBoard();

    const eyes = gm.groups.filter((g) => g.is_eye).map((g) => g.id);

    expect(eyes).toEqual([4, 7, 8, 10]);
});

test("Strong eyes", () => {
    const gm = makeGoMathWithFeatureBoard();

    const strong_eyes = gm.groups.filter((g) => g.is_strong_eye).map((g) => g.id);

    expect(strong_eyes).toEqual([4, 7, 10]);
});

test("Strong Strings", () => {
    const gm = makeGoMathWithFeatureBoard();

    const strong_strings = gm.groups.filter((g) => g.is_strong_string).map((g) => g.id);

    expect(strong_strings).toEqual([3]);
});

test("Territory", () => {
    const gm = makeGoMathWithFeatureBoard();

    const territory = gm.groups.filter((g) => g.is_territory).map((g) => g.id);

    expect(territory).toEqual([1, 4, 7, 8, 10]);
});

test("Territory in seki", () => {
    const gm = makeGoMathWithFeatureBoard();

    const territory_in_seki = gm.groups.filter((g) => g.is_territory_in_seki).map((g) => g.id);

    expect(territory_in_seki).not.toContain([1, 8]);
});
