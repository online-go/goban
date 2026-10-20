/*
 * Copyright (C)  Online-Go.com
 */

import { GobanEngine, MarkInterface, MoveTree, MoveTreeJson, encodeCoordinate } from "engine";

/*
 * The MoveTree traversals walk the tree with an explicit stack, because a
 * variation of a few thousand moves (for example a demo board with a long run
 * of passes) overflowed the call stack when they were recursive. The
 * reference functions below are the earlier recursive versions. The tests
 * check that the iterative versions give exactly the same results.
 */

function refLayout(
    engine: GobanEngine,
    node: MoveTree,
    x: number,
    min_y: number,
    layout_hash: { [coords: string]: MoveTree },
    line_color: number,
): number {
    if (!engine.move_tree_layout_vector[x]) {
        engine.move_tree_layout_vector[x] = 0;
    }

    if (x === 0 && min_y === 0) {
        MoveTree.current_line_color = 0;
    }

    min_y = Math.max(engine.move_tree_layout_vector[x] + 1, min_y);

    if (node.trunk_next) {
        refLayout(
            engine,
            node.trunk_next,
            x + 1,
            0,
            layout_hash,
            (node.move_number + 1) % MoveTree.line_colors.length,
        );
    }

    if (node.line_color === -1) {
        node.line_color = line_color;
    }

    let next_line_color = node.line_color + node.move_number;
    for (let i = 0; i < node.branches.length; ++i) {
        next_line_color %= MoveTree.line_colors.length;
        if (i && next_line_color === node.line_color) {
            next_line_color += 2;
            next_line_color %= MoveTree.line_colors.length;
        }

        const by = refLayout(
            engine,
            node.branches[i],
            x + 1,
            min_y,
            layout_hash,
            i === 0 ? node.line_color : next_line_color++,
        );
        if (i === 0) {
            min_y = Math.max(min_y, by - 1);
        }

        next_line_color++;
    }

    if (node.trunk) {
        min_y = 0;
    }

    node.layout_x = x;
    node.layout_y = min_y;
    layout_hash[x + "," + min_y] = node;

    node.layout_cx = Math.floor((node.layout_x + 0.5) * MoveTree.stone_square_size) + 0.5;
    node.layout_cy = Math.floor((node.layout_y + 0.5) * MoveTree.stone_square_size) + 0.5;

    engine.move_tree_layout_vector[x] = Math.max(min_y, engine.move_tree_layout_vector[x]);
    if (x) {
        engine.move_tree_layout_vector[x - 1] = Math.max(
            min_y - 1,
            engine.move_tree_layout_vector[x - 1],
        );
    }

    return min_y;
}

/** Returns the isobranch ids of every node, keyed by node id. */
function refIsobranches(root: MoveTree): Map<number, number[]> {
    const state_hash: { [hash: string]: MoveTree[] } = {};
    const node_hash = new Map<number, string>();
    const ret = new Map<number, number[]>();

    const buildHashes = (node: MoveTree): void => {
        const hash = node.state.isobranch_hash
            ? node.state.isobranch_hash
            : (node.state.isobranch_hash =
                  node.state.board.map((arr) => arr.join("")).join("") + node.player);
        node_hash.set(node.id, hash);
        if (!(hash in state_hash)) {
            state_hash[hash] = [];
        }
        state_hash[hash].push(node);
        if (node.trunk_next) {
            buildHashes(node.trunk_next);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            buildHashes(node.branches[i]);
        }
    };

    const recompute = (node: MoveTree): void => {
        const isobranches: number[] = [];
        if (node.x !== -1) {
            for (const n of state_hash[node_hash.get(node.id) as string]) {
                if (node.id !== n.id) {
                    if (node.isAncestorOf(n) || n.isAncestorOf(node)) {
                        continue;
                    }
                    isobranches.push(n.id);
                }
            }
        }
        ret.set(node.id, isobranches);
        if (node.trunk_next) {
            recompute(node.trunk_next);
        }
        for (let i = 0; i < node.branches.length; ++i) {
            recompute(node.branches[i]);
        }
    };

    buildHashes(root);
    recompute(root);
    return ret;
}

function refPreOrder(node: MoveTree, out: number[]): void {
    out.push(node.id);
    if (node.trunk_next) {
        refPreOrder(node.trunk_next, out);
    }
    for (let i = 0; i < node.branches.length; ++i) {
        refPreOrder(node.branches[i], out);
    }
}

function refPostOrder(node: MoveTree, out: number[]): void {
    if (node.trunk_next) {
        refPostOrder(node.trunk_next, out);
    }
    for (let i = 0; i < node.branches.length; ++i) {
        refPostOrder(node.branches[i], out);
    }
    out.push(node.id);
}

function refToJson(node: MoveTree): MoveTreeJson {
    const ret: MoveTreeJson = {
        x: node.x,
        y: node.y,
    };
    if (node.pen_marks && node.pen_marks.length) {
        ret.pen_marks = node.pen_marks;
    }
    if (node.hasMarks()) {
        ret.marks = [];
        node.foreachMarkedPosition((x, y) => {
            ret.marks?.push({ x: x, y: y, marks: node.getMarks(x, y) });
        });
    }
    if (node.text) {
        ret.text = node.text;
    }
    if (node.trunk_next) {
        ret.trunk_next = refToJson(node.trunk_next);
    }
    if (node.branches.length) {
        ret.branches = [];
        for (let i = 0; i < node.branches.length; ++i) {
            ret.branches.push(refToJson(node.branches[i]));
        }
    }
    if (node.correct_answer) {
        ret.correct_answer = node.correct_answer;
    }
    if (node.wrong_answer) {
        ret.wrong_answer = node.wrong_answer;
    }
    return ret;
}

/** The earlier recursive toSGF, for trees without chat logs or letter marks. */
function refToSGF(node: MoveTree): string {
    const ret: string[] = [];
    if (node.parent != null) {
        ret.push(";");
        if (node.edited) {
            ret.push("A");
        }
        ret.push(node.player === 1 ? "B" : node.player === 2 ? "W" : "E");
        ret.push("[");
        if (node.x !== -1) {
            ret.push(encodeCoordinate(node.x));
            ret.push(encodeCoordinate(node.y));
        }
        ret.push("]");
    }
    if (node.hasMarks()) {
        const marks = node.getAllMarks();
        for (let y = 0; y < marks.length; ++y) {
            for (let x = 0; x < marks[0].length; ++x) {
                const m = marks[y][x];
                const pos = encodeCoordinate(x) + encodeCoordinate(y);
                if (m.triangle) {
                    ret.push("TR[" + pos + "]");
                }
                if (m.square) {
                    ret.push("SQ[" + pos + "]");
                }
                if (m.cross) {
                    ret.push("MA[" + pos + "]");
                }
                if (m.circle) {
                    ret.push("CR[" + pos + "]");
                }
            }
        }
    }
    if (node.parent != null && node.text !== "") {
        ret.push("C[" + node.text + "]");
    }
    ret.push("\n");

    const branch_ct = (node.trunk_next != null ? 1 : 0) + node.branches.length;
    const A = branch_ct > 1 ? "(" : "";
    const B = branch_ct > 1 ? ")" : "";
    if (node.trunk_next) {
        ret.push(A);
        ret.push(refToSGF(node.trunk_next));
        ret.push(B);
    }
    for (let i = 0; i < node.branches.length; ++i) {
        ret.push(A);
        ret.push(refToSGF(node.branches[i]));
        ret.push(B);
    }
    return ret.join("");
}

interface LayoutSnapshot {
    nodes: Array<[number, number, number, number, number, number, number]>;
    vector: number[];
    hash: { [coords: string]: number };
    ret: number;
}

function resetLayout(engine: GobanEngine): void {
    engine.move_tree.traverse((node) => {
        node.line_color = -1;
        node.layout_x = 0;
        node.layout_y = 0;
        node.layout_cx = 0;
        node.layout_cy = 0;
    });
    engine.move_tree_layout_vector = [];
}

function snapshotLayout(engine: GobanEngine, ret: number, layout_hash: { [k: string]: MoveTree }) {
    const nodes: LayoutSnapshot["nodes"] = [];
    engine.move_tree.traverse((node) => {
        nodes.push([
            node.id,
            node.layout_x,
            node.layout_y,
            node.layout_cx,
            node.layout_cy,
            node.line_color,
            node.active_path_number,
        ]);
    });
    const hash: { [coords: string]: number } = {};
    for (const k in layout_hash) {
        hash[k] = layout_hash[k].id;
    }
    return { nodes, vector: [...engine.move_tree_layout_vector], hash, ret };
}

function layoutWith(
    engine: GobanEngine,
    fn: (layout_hash: { [coords: string]: MoveTree }) => number,
): LayoutSnapshot {
    resetLayout(engine);
    const layout_hash: { [coords: string]: MoveTree } = {};
    const ret = fn(layout_hash);
    return snapshotLayout(engine, ret, layout_hash);
}

function expectSameResultsAsRecursive(engine: GobanEngine): void {
    const root = engine.move_tree;

    const iterative = layoutWith(engine, (h) => root.layout(0, 0, h, 0));
    const recursive = layoutWith(engine, (h) => refLayout(engine, root, 0, 0, h, 0));
    expect(iterative).toEqual(recursive);

    /* Layout of a subtree, as the layout is not only ever called on the root */
    const sub = root.trunk_next as MoveTree;
    const sub_iterative = layoutWith(engine, (h) => sub.layout(3, 2, h, 4));
    const sub_recursive = layoutWith(engine, (h) => refLayout(engine, sub, 3, 2, h, 4));
    expect(sub_iterative).toEqual(sub_recursive);

    const expected_isobranches = refIsobranches(root);
    root.recomputeIsobranches();
    const isobranches = new Map<number, number[]>();
    root.traverse((node) => {
        isobranches.set(
            node.id,
            (node.isobranches as MoveTree[]).map((n) => n.id),
        );
    });
    expect(isobranches).toEqual(expected_isobranches);

    const pre: number[] = [];
    refPreOrder(root, pre);
    const traversed: number[] = [];
    root.traverse((node) => traversed.push(node.id));
    expect(traversed).toEqual(pre);
    expect(root.fold<number[]>([], (acc, node) => [...acc, node.id])).toEqual(pre);
    expect(root.size()).toBe(pre.length);

    const post: number[] = [];
    refPostOrder(root, post);
    const post_traversed: number[] = [];
    root.traversePostOrder((node) => post_traversed.push(node.id));
    expect(post_traversed).toEqual(post);

    /* Key order matters to JSON.stringify, so compare the strings */
    expect(JSON.stringify(root.toJson())).toBe(JSON.stringify(refToJson(root)));
    expect(root.toSGF()).toBe(refToSGF(root));
}

function place(engine: GobanEngine, x: number, y: number, trunk: boolean = false): MoveTree {
    engine.place(x, y, false, false, true, true, trunk);
    return engine.cur_move;
}

function mark(node: MoveTree, x: number, y: number, marks: MarkInterface): void {
    Object.assign(node.getMarks(x, y), marks);
}

/**
 * A small tree with trunk moves, nested variations, more sibling variations
 * than there are line colors, passes, marks, comments and transpositions
 * (which give isobranches).
 */
function buildBranchyTree(): GobanEngine {
    const engine = new GobanEngine({ width: 9, height: 9 });
    const root = engine.move_tree;

    const t1 = place(engine, 2, 2, true);
    const t2 = place(engine, 6, 6, true);
    const t3 = place(engine, 2, 6, true);
    place(engine, 6, 2, true);
    place(engine, -1, -1, true);
    t3.text = "trunk comment";
    mark(t2, 4, 4, { triangle: true });

    /* Transposition of the first three trunk moves */
    engine.jumpTo(root);
    place(engine, 2, 6);
    place(engine, 6, 6);
    const tr3 = place(engine, 2, 2);
    place(engine, 4, 4);
    tr3.correct_answer = true;

    /* Many sibling variations off one trunk node */
    for (let i = 0; i < MoveTree.line_colors.length + 3; ++i) {
        engine.jumpTo(t2);
        place(engine, i % 9, 8);
        if (i % 3 === 0) {
            place(engine, i % 9, 7);
            place(engine, -1, -1);
        }
    }

    /* Nested variations */
    engine.jumpTo(t1);
    const v1 = place(engine, 4, 4);
    const v2 = place(engine, 5, 5);
    place(engine, 3, 3);
    engine.jumpTo(v1);
    place(engine, 3, 5);
    place(engine, 5, 3);
    engine.jumpTo(v2);
    const v3 = place(engine, 1, 1);
    v3.wrong_answer = true;
    v3.text = "variation comment";
    mark(v3, 0, 0, { square: true, circle: true });
    engine.jumpTo(v2);
    place(engine, 7, 7);
    place(engine, -1, -1);
    place(engine, -1, -1);

    return engine;
}

/** Deterministic pseudo random numbers so that failures can be reproduced */
function makeRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/**
 * A random tree on a 5x5 board. The moves are on the center 3x3 points, so
 * that there are transpositions, which give isobranches.
 */
function buildRandomTree(seed: number): GobanEngine {
    const rand = makeRandom(seed);
    const coordinate = () => 1 + Math.floor(rand() * 3);
    const engine = new GobanEngine({ width: 5, height: 5 });
    const nodes: MoveTree[] = [engine.move_tree];

    for (let i = 0; i < 4; ++i) {
        try {
            nodes.push(place(engine, coordinate(), coordinate(), true));
        } catch {
            /* occupied or illegal point, try another */
        }
    }

    for (let i = 0; i < 150; ++i) {
        engine.jumpTo(nodes[Math.floor(rand() * nodes.length)]);
        const pass = rand() < 0.15;
        try {
            nodes.push(place(engine, pass ? -1 : coordinate(), pass ? -1 : coordinate()));
        } catch {
            /* occupied or illegal point, try another */
        }
    }
    return engine;
}

describe("MoveTree traversals match the recursive implementation", () => {
    test("branchy tree", () => {
        const engine = buildBranchyTree();
        engine.jumpTo(engine.move_tree.trunk_next?.trunk_next as MoveTree);
        engine.cur_move.setActivePath(++MoveTree.active_path_number);
        expectSameResultsAsRecursive(engine);
    });

    test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("random tree %i", (seed) => {
        const engine = buildRandomTree(seed);
        expect(engine.move_tree.size()).toBeGreaterThan(40);
        expectSameResultsAsRecursive(engine);
    });

    test("branchy tree SGF", () => {
        const engine = buildBranchyTree();
        const sgf = engine.move_tree.toSGF();
        expect(sgf).toBe(refToSGF(engine.move_tree));
        expect(sgf.startsWith("\n(;B[cc]\n(;W[gg]TR[ee]\n(;B[cg]C[trunk comment]")).toBe(true);
    });
});

describe("Deep move trees", () => {
    const DEPTH = 20000;

    /**
     * A trunk with a long run of passes, a variation off the trunk with a
     * long run of passes, and short variations off that variation.
     */
    function buildDeepTree(): GobanEngine {
        const engine = new GobanEngine({ width: 9, height: 9 });
        place(engine, 2, 2, true);
        place(engine, 6, 6, true);
        const branch_point = engine.cur_move;
        for (let i = 0; i < DEPTH; ++i) {
            place(engine, -1, -1, true);
        }

        engine.jumpTo(branch_point);
        place(engine, 4, 4);
        let side_branch_point: MoveTree | undefined;
        for (let i = 0; i < DEPTH; ++i) {
            place(engine, -1, -1);
            if (i === DEPTH / 2) {
                side_branch_point = engine.cur_move;
            }
        }

        engine.jumpTo(side_branch_point);
        place(engine, 5, 5);
        place(engine, 6, 5);
        engine.jumpTo(side_branch_point);
        place(engine, 3, 3);

        return engine;
    }

    test("traversals do not overflow the call stack", () => {
        const engine = buildDeepTree();
        const root = engine.move_tree;
        const total = 3 + DEPTH + 1 + DEPTH + 3;

        expect(root.size()).toBe(total);

        let count = 0;
        root.traverse(() => ++count);
        expect(count).toBe(total);

        count = 0;
        root.traversePostOrder(() => ++count);
        expect(count).toBe(total);

        expect(() => root.recomputeIsobranches()).not.toThrow();
        expect(() => engine.cur_move.findStrongIsobranches()).not.toThrow();

        engine.move_tree_layout_vector = [];
        const layout_hash: { [coords: string]: MoveTree } = {};
        expect(root.layout(0, 0, layout_hash, 0)).toBe(0);
        expect(engine.move_tree_layout_vector.length).toBe(DEPTH + 4);

        const json = root.toJson();
        let depth = 0;
        let cur: MoveTreeJson | undefined = json;
        while (cur) {
            ++depth;
            cur = cur.trunk_next;
        }
        expect(depth).toBe(DEPTH + 3);

        const sgf = root.toSGF();
        expect(sgf.split(";").length - 1).toBe(total - 1);
    });

    test("hoistFirstBranchToTrunk on a long variation", () => {
        const engine = new GobanEngine({ width: 9, height: 9 });
        for (let i = 0; i < DEPTH; ++i) {
            place(engine, -1, -1);
        }
        const last = engine.cur_move;
        expect(last.trunk).toBe(false);

        engine.move_tree.hoistFirstBranchToTrunk();

        let cur: MoveTree | undefined = engine.move_tree;
        let trunk_length = 0;
        while (cur) {
            expect(cur.trunk).toBe(true);
            expect(cur.branches.length).toBe(0);
            ++trunk_length;
            cur = cur.trunk_next;
        }
        expect(trunk_length).toBe(DEPTH + 1);
        expect(last.trunk).toBe(true);
    });
});
