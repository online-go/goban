import { GoEngine } from "../GoEngine";
import { makeMatrix } from "../GoMath";

test("toggleMetagroupRemoval", () => {
    const engine = new GoEngine({
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

    engine.toggleMetaGroupRemoval(0, 0);

    expect(on_removal_updated).toBeCalledTimes(1);

    expect(engine.removal).toEqual([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ]);

    engine.toggleMetaGroupRemoval(0, 0);

    expect(engine.removal).toEqual(makeMatrix(4, 4));
});

test("toggleMetagroupRemoval out-of-bounds", () => {
    const engine = new GoEngine({
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

    expect(engine.toggleMetaGroupRemoval(0, 4)).toEqual([[0, []]]);
    expect(on_removal_updated).toBeCalledTimes(0);
});

test("toggleMetagroupRemoval empty area", () => {
    const engine = new GoEngine({
        width: 4,
        height: 2,
        initial_state: { black: "aabb", white: "cacb" },
    });

    /*   A B C D
     * 4 x . o .
     * 3 . x o .
     * 2 . . o .
     * 1 . . o x
     */

    const on_removal_updated = jest.fn();
    engine.addListener("stone-removal.updated", on_removal_updated);

    expect(engine.toggleMetaGroupRemoval(0, 1)).toEqual([
        [1, [{ x: 0, y: 1 }]],
        [0, []],
    ]);
    expect(on_removal_updated).toBeCalledTimes(1);
});
