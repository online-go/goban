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
