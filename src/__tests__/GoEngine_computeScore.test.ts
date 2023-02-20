/**
 * @jest-environment jsdom
 */

// ^^ jsdom environment is because getLocation() returns window.location.pathname
// Same about CLIENT.
//
// TODO: move this into a setup-jest.ts file

(global as any).CLIENT = true;

import { GoEngine } from "../GoEngine";
import { movesFromBoardState } from "../test_utils";

test("GoEngine defaults", () => {
    const engine = new GoEngine({});
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

test("GoEngine defaults", () => {
    const engine = new GoEngine({});
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
    const engine = new GoEngine({ rules: "japanese", handicap: 4 });
    expect(engine.computeScore()).toEqual({
        black: expect.objectContaining({
            handicap: 0,
            komi: 0,
            territory: 357,
            total: 357,
        }),
        white: expect.objectContaining({
            handicap: 4,
            komi: 0.5,
            territory: 0,
            total: 0.5,
        }),
    });
});

test("AGA handicap - white is given compensation ", () => {
    const engine = new GoEngine({ rules: "aga", handicap: 4 });

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
    const engine = new GoEngine({ width: 4, height: 4, moves: movesFromBoardState(board) });

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
    const engine = new GoEngine({
        width: 4,
        height: 4,
        moves: movesFromBoardState(board),
        rules: "chinese",
    });

    expect(engine.computeScore()).toEqual({
        black: expect.objectContaining({
            scoring_positions: "aaabacadbabbbcbd",
            stones: 4,
            territory: 4,
            total: 8,
        }),
        white: expect.objectContaining({
            komi: 7.5,
            scoring_positions: "dadbdcddcacbcccd",
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
    const engine = new GoEngine({
        width: 4,
        height: 4,
        moves: movesFromBoardState(board),
        rules: "chinese",
        removed: "aadd",
    });

    expect(engine.computeScore()).toEqual({
        black: expect.objectContaining({
            prisoners: 0,
            scoring_positions: "aaabacadbabbbcbd",
            stones: 4,
            territory: 4,
            total: 8,
        }),
        white: expect.objectContaining({
            prisoners: 0,
            komi: 7.5,
            scoring_positions: "dadbdcddcacbcccd",
            stones: 4,
            territory: 4,
            total: 15.5,
        }),
    });
});
