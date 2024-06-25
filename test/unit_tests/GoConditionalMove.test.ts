/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
import { ConditionalMoveTree } from "engine";

/**
 * ```
 * aa bb
 * ├── cc
 * ├── dd ee
 * │   └── ff gg
 * └── hh ii
 * jj kk
 * ```
 */
function makeLargeTree() {
    return ConditionalMoveTree.decode([
        null,
        {
            aa: ["bb", { cc: [null, {}], dd: ["ee", { ff: ["gg", {}] }], hh: ["ii", {}] }],
            jj: ["kk", {}],
        },
    ]);
}

describe("constructor", () => {
    test("null", () => {
        const m = new ConditionalMoveTree(null);

        expect(m.children).toEqual({});
        expect(m.move).toBeNull();
        expect(m.parent).toBeUndefined();
    });

    test("with move string", () => {
        const m = new ConditionalMoveTree("aa");

        expect(m.children).toEqual({});
        expect(m.move).toBe("aa");
        expect(m.parent).toBeUndefined();
    });

    test("with move string and parent", () => {
        const p = new ConditionalMoveTree("aa");
        const m = new ConditionalMoveTree("bb", p);

        expect(m.children).toEqual({});
        expect(m.move).toBe("bb");
        expect(m.parent).toBe(p);

        // Should this linkage be set up automatically? Logically, p.children
        // would include an entry for m...
        expect(p.children).toEqual({});
    });
});

describe("encode/decode", () => {
    test("null", () => {
        const m = new ConditionalMoveTree(null);

        expect(m.encode()).toEqual([null, {}]);
    });

    test("with move string", () => {
        const m = new ConditionalMoveTree("aa");

        expect(m.encode()).toEqual(["aa", {}]);
    });

    test("large tree", () => {
        const m = makeLargeTree();

        expect(Object.keys(m.children)).toHaveLength(2);
        expect(m.parent).toBeUndefined();
        expect(m.move).toBeNull();

        const aa = m.getChild("aa");
        expect(Object.keys(aa.children)).toHaveLength(3);
        expect(aa.parent).toBe(m);
        expect(aa.move).toBe("bb");

        expect(m.encode()).toEqual([
            null,
            {
                aa: ["bb", { cc: [null, {}], dd: ["ee", { ff: ["gg", {}] }], hh: ["ii", {}] }],
                jj: ["kk", {}],
            },
        ]);
    });
});

describe("duplicate", () => {
    test("null", () => {
        const m = new ConditionalMoveTree(null);

        expect(m.duplicate()).toEqual(m);
        expect(m.duplicate()).not.toBe(m);
    });

    test("with move string", () => {
        const m = new ConditionalMoveTree("aa");

        expect(m.duplicate()).toEqual(m);
        expect(m.duplicate()).not.toBe(m);
    });

    test("large tree", () => {
        const m = makeLargeTree();
        const dup = m.duplicate();

        expect(dup).toEqual(m);
        expect(dup).not.toBe(m);

        for (const child of Object.entries(dup.children)) {
            expect(child[1]).toEqual(m.getChild(child[0]));
            expect(child[1]).not.toBe(m.getChild(child[0]));
        }
    });
});

test("getChild returns GoConditionalMove if doesn't exist", () => {
    const m = new ConditionalMoveTree(null);
    expect(m.getChild("aa")).toEqual(new ConditionalMoveTree(null, m));
});
