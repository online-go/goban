/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
// cspell: disable

(global as any).CLIENT = true;

import { TestGoban } from "../../src/Goban/TestGoban";
import { MoveTree } from "engine";

type SGFTestcase = {
    template: string;
    moves: string;
    id: string;
    size: number;
    num_errors?: number;
};

const SGF_TEST_CASES: Array<SGFTestcase> = [
    {
        template:
            "(;GM[1]FF[4]CA[UTF-8]AP[CGoban:3]ST[2] RU[Japanese]SZ[19]KM[0.00]PW[White]PB[Black]_MOVES_)",
        moves: ";W[aa]C[příliš žluťoučký kůň úpěl ďábelské ódy];W[pd]",
        id: "unicode",
        size: 3,
    },
    {
        template:
            "(;FF[4]GM[1]SZ[19]AP[]US[]EV[74th Honinbo challenger decision match]PC[]PB[Shibano Toramaru]BR[7d]PW[Kono Rin]WR[9d]KM[6.5]RE[W+1.5]DT[2019-04-10]TM[0]_MOVES_)",
        moves: ";B[pd];W[dp];B[pq];W[dc];B[ce];W[cg];B[cq];W[cp];B[dq];W[fq]",
        id: "honinbo game",
        size: 11,
    },
    {
        template: "(;GM[1]FF[4]CA[UTF-8]AP[CGoban:3]ST[2]RU[Japanese]SZ[19]KM[0.00]_MOVES_)",
        moves: "(;B[dd];W[dc](;B[ec];W[eb])(;B[ed]))(;B[pd];W[nd];B[nc];W[mc];B[oc])",
        id: "cgoban_tree1",
        size: 11,
    },
    {
        template: "(;GM[1]FF[4]CA[UTF-8]AP[CGoban:3]ST[2]RU[Japanese]SZ[19]KM[0.00]_MOVES_)",
        moves: "(;B[dd];W[dc];B[ec])(;B[pd];W[nd];B[nc])",
        id: "cgoban_tree2",
        size: 7,
    },
    {
        template: "(;GM[1]FF[4]CA[UTF-8]AP[CGoban:3]ST[2]RU[Japanese]SZ[19]KM[0.00]_MOVES_)",
        // just like previous testcase, but
        //                ||  here is a small difference
        moves: "(;B[dd];W[eb];B[ec])(;B[pd];W[nd];B[nc])",
        id: "cgoban_tree3",
        size: 7,
    },
    {
        template: "(;GM[1]FF[4]CA[UTF-8]_MOVES_)",
        moves: ";B[aa];W[aa]",
        id: "invalid move - stone on top of stone",
        size: 3,
        num_errors: 1,
    },
];

function rmNewlines(txt: string): string {
    return txt.replace(/[\n\r]/g, "");
}
/*
 * check that parse -> serialize roundtrip generates the same sgf
 * (at least for the moves so far)
 */
test.each(SGF_TEST_CASES)(
    "sgf -> parseSGF() -> toSGF() roundtrip (moves only)",
    ({ template, moves, size, num_errors }) => {
        const sgf = template.replace(/_MOVES_/, moves);
        // Placement errors are logged, not thrown
        const log_spy = jest.spyOn(console, "log").mockImplementation(() => {});
        const goban = new TestGoban({ original_sgf: sgf, removed: "" });
        // by default, `edited = true` when `original_sgf` is used, which causes
        // the moves to be serialized as setup SGF props `AB` & `AW`.
        // Instead, we need `B` and `W`, thus we set edited to false for each node.
        goban.engine.move_tree.traverse((node) => (node.edited = false));

        const moves_gen = goban.engine.move_tree.toSGF();
        expect(rmNewlines(moves_gen)).toBe(rmNewlines(moves));
        expect(goban.engine.move_tree.size()).toBe(size);
        if (num_errors) {
            expect(log_spy).toBeCalledTimes(num_errors);
        }
    },
);

/*
 * check that tree subset works
 */

function load(tc: SGFTestcase): MoveTree {
    const goban = new TestGoban({
        original_sgf: tc.template.replace(/_MOVES_/, tc.moves),
        removed: "",
    });
    return goban.engine.move_tree;
}

test("containsOtherTreeAsSubset()", () => {
    const cgo1 = load(SGF_TEST_CASES[2]);
    const cgo2 = load(SGF_TEST_CASES[3]);
    const cgo3 = load(SGF_TEST_CASES[4]);

    expect(cgo1.containsOtherTreeAsSubset(cgo2)).toBe(true);
    expect(cgo2.containsOtherTreeAsSubset(cgo1)).toBe(false);

    expect(cgo1.containsOtherTreeAsSubset(cgo3)).toBe(false);
    expect(cgo2.containsOtherTreeAsSubset(cgo3)).toBe(false);
    expect(cgo3.containsOtherTreeAsSubset(cgo1)).toBe(false);
    expect(cgo3.containsOtherTreeAsSubset(cgo2)).toBe(false);
});

/*
 * check that whatever moves we play, we get them back in sgf
 */
function checkPath(path: string): MoveTree {
    const goban = new TestGoban({ moves: [] });
    const moves = goban.engine.decodeMoves(path);
    for (let i = 0; i < moves.length; ++i) {
        goban.engine.place(moves[i].x, moves[i].y);
    }
    const sgf = goban.engine.move_tree.toSGF();

    // if we squash everything but the moves, we should get the moves
    expect(sgf.replace(/[[;BW\n]/g, "").replace(/]/g, "")).toBe(path);
    return goban.engine.move_tree;
}

test("toSGF() simple path && tree subsets", () => {
    const path = "aabbccddee";
    const mt1 = checkPath(path);

    const path2 = "aabbccdd";
    const mt2 = checkPath(path2);

    const path3 = "aabbddcc";
    const mt3 = checkPath(path3);

    expect(mt1.containsOtherTreeAsSubset(mt2)).toBe(true);
    expect(mt2.containsOtherTreeAsSubset(mt1)).toBe(false);

    // path 3 has different order of moves, so it should not be
    // counted as a tree subset
    expect(mt1.containsOtherTreeAsSubset(mt3)).toBe(false);
    expect(mt2.containsOtherTreeAsSubset(mt3)).toBe(false);
    expect(mt3.containsOtherTreeAsSubset(mt1)).toBe(false);
    expect(mt3.containsOtherTreeAsSubset(mt2)).toBe(false);
});
