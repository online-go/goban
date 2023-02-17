/**
 * @jest-environment jsdom
 */

// ^^ jsdom environment is because getLocation() returns window.location.pathname
// Same about CLIENT.
//
// TODO: move this into a setup-jest.ts file

(global as any).CLIENT = true;

import { GoEngine } from "../GoEngine";

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
