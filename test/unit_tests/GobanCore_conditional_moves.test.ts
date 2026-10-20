/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */

(global as any).CLIENT = true;

import { TestGoban } from "../../src/Goban/TestGoban";

test("call FollowConditionalPath", () => {
    const goban = new TestGoban({ moves: [] });
    goban.setMode("conditional");
    goban.followConditionalPath("aabb");

    /*
     * └──aa bb
     *    └──cc dd
     */

    expect(Object.keys(goban.conditional_tree.children)).toEqual(["aa"]);
    expect(goban.conditional_tree.children["aa"].move).toEqual("bb");
});

test("call followConditionalPath twice", () => {
    const goban = new TestGoban({ moves: [] });
    goban.setMode("conditional");
    goban.followConditionalPath("aabb");
    goban.followConditionalPath("ccdd");

    /*
     * └──aa bb
     *    └──cc dd
     */

    expect(Object.keys(goban.conditional_tree.children)).toEqual(["aa"]);
    expect(goban.conditional_tree.children["aa"].move).toEqual("bb");
    expect(Object.keys(goban.conditional_tree.children["aa"].children)).toEqual(["cc"]);
    expect(goban.conditional_tree.children["aa"].children["cc"].move).toEqual("dd");
});

test("call followConditionalPath after moving to root again", () => {
    const goban = new TestGoban({ moves: [] });
    goban.setMode("conditional");
    goban.followConditionalPath("aabb");
    goban.jumpToLastOfficialMove();
    goban.followConditionalPath("ccdd");

    /*
     * ├──aa bb
     * └──cc dd
     */

    expect(Object.keys(goban.conditional_tree.children)).toEqual(["aa", "cc"]);
    expect(goban.conditional_tree.children["aa"].move).toEqual("bb");
    expect(goban.conditional_tree.children["cc"].move).toEqual("dd");
});

test("handle passes in followConditionalPath", () => {
    const goban = new TestGoban({ moves: [] });
    goban.setMode("conditional");
    goban.followConditionalPath("....");

    /*
     * └──.. ..
     */

    expect(Object.keys(goban.conditional_tree.children)).toEqual([".."]);
    expect(goban.conditional_tree.children[".."].move).toEqual("..");
});

test("handle pass() while in 'conditional' mode", () => {
    const goban = new TestGoban({ moves: [] });
    goban.setMode("conditional");
    goban.pass();
    goban.pass();

    /*
     * └──.. ..
     */

    expect(Object.keys(goban.conditional_tree.children)).toEqual([".."]);
    expect(goban.conditional_tree.children[".."].move).toEqual("..");
});

test("a reload in 'conditional' mode starts the path again at the official move", () => {
    const goban = new TestGoban({ width: 9, height: 9, moves: [] });
    goban.setMode("conditional");
    goban.followConditionalPath("aaba");

    goban.load({ width: 9, height: 9, moves: [] });

    expect(goban.getCurrentConditionalPath()).toEqual("");

    goban.followConditionalPath("aaca");

    expect(() => goban.showPrevious()).not.toThrow();
    expect(goban.getCurrentConditionalPath()).toEqual("aa");
    expect(goban.engine.board[0][0]).toEqual(1);
    expect(goban.engine.board[0][2]).toEqual(0);
});

test("showFirst() in 'conditional' mode goes to the official move", () => {
    const goban = new TestGoban({ width: 9, height: 9, moves: [] });
    goban.load({ width: 9, height: 9, moves: [[4, 4]] });
    goban.setMode("conditional");
    goban.followConditionalPath("aaba");

    goban.showFirst();

    expect(goban.engine.cur_move).toBe(goban.engine.last_official_move);
    expect(goban.engine.board[4][4]).toEqual(1);
    expect(goban.getCurrentConditionalPath()).toEqual("");

    goban.followConditionalPath("eaca");

    expect(() => goban.showPrevious()).not.toThrow();
    expect(goban.getCurrentConditionalPath()).toEqual("ea");
});
