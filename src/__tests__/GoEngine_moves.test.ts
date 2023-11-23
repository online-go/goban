import { GoEngine } from "../GoEngine";

test("cur_review_move", () => {
    const engine = new GoEngine({});
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
    const engine = new GoEngine({});
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
        const engine = new GoEngine({});
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
        const engine = new GoEngine({});

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
        const engine = new GoEngine({ width: 2, height: 2, moves: moves });

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
        const engine = new GoEngine({ width: 2, height: 2, moves: moves });

        expect(engine.board).toEqual([
            [0, 0],
            [0, 0],
        ]);
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
        expect(() => new GoEngine({ width: 2, height: 2, move_tree })).toThrow("Node mismatch");
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

        const engine = new GoEngine({ width: 2, height: 2, move_tree });

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
});

test("followPath", () => {
    const engine = new GoEngine({ width: 4, height: 2 });
    engine.followPath(10, "aabacada");
    expect(engine.board).toEqual([
        [1, 2, 1, 2],
        [0, 0, 0, 0],
    ]);
    expect(engine.cur_move.move_number).toBe(4);
});

test("deleteCurMove", () => {
    const engine = new GoEngine({
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
