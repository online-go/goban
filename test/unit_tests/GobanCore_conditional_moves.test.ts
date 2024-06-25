/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
// cspell: disable

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
