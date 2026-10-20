/*
 * Copyright (C) Online-Go.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GobanEngine } from "./GobanEngine";
import { BoardState } from "./BoardState";
import {
    decodeMoves,
    encodeCoordinate,
    encodeMove,
    makeObjectMatrix,
    prettyCoordinates,
} from "./util";
import { AdHocPackedMove } from "./formats/AdHocFormat";
import {
    JGOFMove,
    JGOFNumericPlayerColor,
    JGOFPlayerClock,
    JGOFPlayerSummary,
} from "./formats/JGOF";
import { escapeSGFText, newlines_to_spaces } from "./util";

/** AI review quality classification of a played move, shown as a colored badge on the stone. */
export type AIQualityMark = "excellent" | "great" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface MarkInterface {
    triangle?: boolean;
    square?: boolean;
    circle?: boolean;
    cross?: boolean;
    blue_move?: boolean;
    ai_quality?: AIQualityMark;
    letter?: string;
    subscript?: string;
    /** Smaller second line of text below the subscript (e.g. AI visit counts) */
    subscript2?: string;
    transient_letter?: string;
    //score?: string | boolean;
    score?: string;
    chat_triangle?: boolean;
    sub_triangle?: boolean;
    remove?: boolean;
    stone_removed?: boolean;
    mark_x?: boolean;
    hint?: boolean;
    black?: boolean;
    white?: boolean;
    color?: string;
    needs_sealing?: boolean;
    before_ai?: string;
    undo?: boolean;

    [label: string]: string | boolean | undefined;
}

export type MoveTreePenMarks = Array<{
    color: string;
    points: Array<number> /* [x1,y1, x2,y2, ...] */;
}>;

export interface MoveTreeJson {
    x: number;
    y: number;
    pen_marks?: MoveTreePenMarks;
    marks?: Array<{ x: number; y: number; marks: MarkInterface }>;
    text?: string;
    trunk_next?: MoveTreeJson;
    branches?: Array<MoveTreeJson>;
    correct_answer?: boolean;
    wrong_answer?: boolean;
}

export interface MoveTreeChatLineBody {
    type: "analysis";
    name: string;
    from: number;
    moves: AdHocPackedMove | string;
}
export interface MoveTreeChatLine {
    username: string;
    body: MoveTreeChatLineBody;
}

let __move_tree_id = 0;
let __isobranches_state_hash: { [hash: string]: Array<MoveTree> } =
    {}; /* used while finding isobranches */

interface BoardStateWithIsobranchHash extends BoardState {
    /**
     * The isobranch hash is a hash of the board state. This field is used by
     * the move tree to detect isomorphic branches. This field is populated
     * when recomputeIsoBranches is called.
     * */
    isobranch_hash?: string;
}

/** The local state of one step of MoveTree.layout, see there. */
interface LayoutFrame {
    node: MoveTree;
    x: number;
    min_y: number;
    /** The line color passed in for this node */
    line_color: number;
    next_line_color: number;
    /** Index of the branch being laid out */
    branch: number;
    stage: "enter" | "trunk_done" | "next_branch" | "branch_done";
}

function newLayoutFrame(node: MoveTree, x: number, min_y: number, line_color: number): LayoutFrame {
    return { node, x, min_y, line_color, next_line_color: 0, branch: 0, stage: "enter" };
}

/* TODO: If we're on the server side, we shouldn't be doing anything with marks */
export class MoveTree {
    public static readonly stone_radius = 11;
    public static readonly stone_padding = 3;
    public static readonly stone_square_size = (MoveTree.stone_radius + MoveTree.stone_padding) * 2;

    public label: string = "[unset]";

    public move_number: number;
    public readonly pretty_coordinates: string;
    public parent: MoveTree | null;
    public readonly id: number;
    public trunk_next?: MoveTree;
    public branches: Array<MoveTree>;
    public correct_answer: boolean = false;
    public wrong_answer: boolean = false;
    private hint_next?: MoveTree;
    public player: JGOFNumericPlayerColor;
    public line_color: number;
    public trunk: boolean;
    public text: string;
    private readonly engine: GobanEngine;
    public x: number;
    public y: number;
    public edited: boolean;
    public state: BoardStateWithIsobranchHash;
    public pen_marks: MoveTreePenMarks = [];
    public player_update: JGOFPlayerSummary | undefined;
    public played_by: number | undefined;
    public black_clock?: JGOFPlayerClock;
    public white_clock?: JGOFPlayerClock;

    /* public for use by renderers when drawing move trees  */
    public active_path_number: number = 0;
    public layout_cx: number = 0;
    public layout_cy: number = 0;
    public layout_x: number = 0;
    public layout_y: number = 0;
    /* Because this is used on the server side too, we can't have the TextMetrics
     * type here. */
    public label_metrics?: any /* TextMetrics */;

    /* These need to be protected by accessor methods now that we're not
     * initializing them on construction */
    private chat_log?: Array<MoveTreeChatLine>;
    private marks?: MarkInterface[][];
    private stashed_marks: MarkInterface[][][] = [];
    public isobranches: any;
    private isobranch_hash?: string;

    constructor(
        engine: GobanEngine,
        trunk: boolean,
        x: number,
        y: number,
        edited: boolean,
        player: JGOFNumericPlayerColor,
        move_number: number,
        parent: MoveTree | null,
        state: BoardState,
    ) {
        this.id = ++__move_tree_id;
        this.x = x;
        this.y = y;
        this.pretty_coordinates = engine.prettyCoordinates(x, y);
        //this.label;
        //this.label_metrics;
        this.layout_x = 0;
        this.layout_y = 0;
        this.engine = engine;
        this.trunk = trunk;
        this.edited = edited;
        this.player = player;
        this.parent = parent;
        this.move_number = move_number;
        this.state = state;
        this.trunk_next = undefined;
        this.branches = [];
        this.active_path_number = 0;
        //this.clearMarks();
        this.line_color = -1;
        this.text = "";
    }

    /** Serializes our MoveTree into a MoveTreeJson object */
    public toJson(): MoveTreeJson {
        /* Iterative, because a long variation would overflow the call stack.
         * A child's object is created with only x and y when its parent is
         * visited, and the rest of its fields are added when the child is
         * visited, so the key order is the same as a recursive build. */
        const root: MoveTreeJson = { x: this.x, y: this.y };
        const stack: Array<[MoveTree, MoveTreeJson]> = [[this, root]];

        while (stack.length > 0) {
            const [node, ret] = stack.pop() as [MoveTree, MoveTreeJson];
            const children: Array<[MoveTree, MoveTreeJson]> = [];

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
                ret.trunk_next = { x: node.trunk_next.x, y: node.trunk_next.y };
                children.push([node.trunk_next, ret.trunk_next]);
            }
            if (node.branches.length) {
                ret.branches = [];
                for (let i = 0; i < node.branches.length; ++i) {
                    const branch: MoveTreeJson = {
                        x: node.branches[i].x,
                        y: node.branches[i].y,
                    };
                    ret.branches.push(branch);
                    children.push([node.branches[i], branch]);
                }
            }
            if (node.correct_answer) {
                ret.correct_answer = node.correct_answer;
            }
            if (node.wrong_answer) {
                ret.wrong_answer = node.wrong_answer;
            }

            for (let i = children.length - 1; i >= 0; --i) {
                stack.push(children[i]);
            }
        }

        return root;
    }

    /** Loads the state of this MoveTree node from a MoveTreeJson object */
    public loadJsonForThisNode(json: MoveTreeJson): void {
        /* Unlike toJson, restoring from the json blob is a collaborative effort between
         * MoveTree and the GobanEngine because of all the state we capture along the way..
         * so during restoration GobanEngine will form the tree, and for each node call this
         * method with the json that was captured with toJson for this node */

        if (json.x !== this.x || json.y !== this.y) {
            throw new Error("Node mismatch when unpacking json object in MoveTree.fromJson");
        }

        this.correct_answer = !!json.correct_answer;
        this.wrong_answer = !!json.wrong_answer;
        this.text = json?.text ? json.text : "";

        if (json.marks) {
            for (let i = 0; i < json.marks.length; ++i) {
                const m = json.marks[i];
                for (const k in m.marks) {
                    (this.getMarks(m.x, m.y) as any)[k] = (m.marks as any)[k];
                }
            }
        }
        if (json.pen_marks) {
            this.pen_marks = json.pen_marks;
        }
    }

    /** Recomputes the isobranches for the entire tree. This needs to be called on the root node. */
    public recomputeIsobranches(): void {
        if (this.parent) {
            throw new Error("MoveTree.recomputeIsobranches needs to be called from the root node");
        }

        __isobranches_state_hash = {};

        this.traverse((node) => {
            const hash = node.state.isobranch_hash
                ? node.state.isobranch_hash
                : (node.state.isobranch_hash =
                      node.state.board.map((arr) => arr.join("")).join("") + node.player);
            node.isobranch_hash = hash;

            if (!(hash in __isobranches_state_hash)) {
                __isobranches_state_hash[hash] = [];
            }

            __isobranches_state_hash[hash].push(node);
        });

        this.traverse((node) => {
            node.isobranches = [];

            if (node.x !== -1) {
                /* don't draw iso branches for passes */
                for (const n of __isobranches_state_hash[node.isobranch_hash as string]) {
                    if (node.id !== n.id) {
                        if (node.isAncestorOf(n) || n.isAncestorOf(node)) {
                            continue;
                        }
                        node.isobranches.push(n);
                    }
                }
            }
        });
    }

    lookupMove(x: number, y: number, player: number, edited: boolean): MoveTree | null {
        if (typeof player !== "number") {
            throw new Error(`Invalid player color: ${player}`);
        }

        if (
            this.trunk_next &&
            this.trunk_next.x === x &&
            this.trunk_next.y === y &&
            this.trunk_next.edited === edited &&
            (!edited || this.trunk_next.player)
        ) {
            return this.trunk_next;
        }

        for (let i = 0; i < this.branches.length; ++i) {
            if (
                this.branches[i].x === x &&
                this.branches[i].y === y &&
                (!edited || this.branches[i].player === player) &&
                this.branches[i].edited === edited
            ) {
                return this.branches[i];
            }
        }

        return null;
    }
    move(
        x: number,
        y: number,
        trunk: boolean,
        edited: boolean,
        player: JGOFNumericPlayerColor,
        move_number: number,
        state: any,
    ): MoveTree {
        if (typeof player === "undefined") {
            throw new Error("Invalid player");
        }
        if (typeof player !== "number") {
            throw new Error(`Invalid player color: ${player}`);
        }

        let m = this.lookupMove(x, y, player, edited);
        //if (!m || m.trunk !== trunk) {
        if (!m || (!m.trunk && trunk)) {
            //if (!m) {
            m = new MoveTree(this.engine, trunk, x, y, edited, player, move_number, this, state);
        } else {
            m.state = state;
            m.move_number = move_number;
            return m;
        }

        this.engine.move_tree_layout_dirty = true;

        if (trunk) {
            if (!this.trunk) {
                console.log("Attempted trunk move made on ", this);
                throw new Error("Attempted trunk move made on non-trunk");
            }

            if (this.trunk_next) {
                m = this.trunk_next;
                m.edited = edited;
                m.move_number = move_number;
                m.state = state;
                m.x = x;
                m.y = y;
                m.player = player;
            } else {
                this.trunk_next = m;
            }

            /* Join any branches that may have already been describing this move */
            for (let i = 0; i < this.branches.length; ++i) {
                if (
                    this.branches[i].x === x &&
                    this.branches[i].y === y &&
                    this.branches[i].player === player
                ) {
                    const brs = this.branches[i].branches;
                    for (let j = 0; j < brs.length; ++j) {
                        brs[j].parent = this.trunk_next;
                        this.trunk_next.branches.push(brs[j]);
                    }
                    this.branches.splice(i, 1);
                    break;
                }
            }
        } else {
            let found = false;

            /* TODO: I think we can remove this, we have the lookupMove up above now */
            for (let i = 0; i < this.branches.length; ++i) {
                if (
                    this.branches[i].x === x &&
                    this.branches[i].y === y &&
                    this.branches[i].player === player
                ) {
                    found = true;
                    m = this.branches[i];
                    m.edited = edited;
                    m.move_number = move_number;
                    m.state = state;
                }
            }
            if (!found) {
                this.branches.push(m);
            }
        }

        return m;
    }
    /*
     * walks the tree in depth-first manner, pre-order
     * - calls the `fn` function first on body
     * - then on trunk
     * - then branches
     *
     * The walk uses an explicit stack instead of recursion, because a long
     * variation would overflow the call stack.
     */
    traverse(fn: (node: MoveTree) => void): void {
        const stack: MoveTree[] = [this];
        while (stack.length > 0) {
            const node = stack.pop() as MoveTree;
            fn(node);
            for (let i = node.branches.length - 1; i >= 0; --i) {
                stack.push(node.branches[i]);
            }
            if (node.trunk_next) {
                stack.push(node.trunk_next);
            }
        }
    }
    /*
     * walks the tree in depth-first manner, post-order
     * - calls the `fn` function first on the trunk
     * - then on the branches
     * - then on body
     */
    traversePostOrder(fn: (node: MoveTree) => void): void {
        const stack: MoveTree[] = [this];
        const children_pushed: boolean[] = [false];
        while (stack.length > 0) {
            const top = stack.length - 1;
            const node = stack[top];
            if (children_pushed[top]) {
                stack.pop();
                children_pushed.pop();
                fn(node);
                continue;
            }
            children_pushed[top] = true;
            for (let i = node.branches.length - 1; i >= 0; --i) {
                stack.push(node.branches[i]);
                children_pushed.push(false);
            }
            if (node.trunk_next) {
                stack.push(node.trunk_next);
                children_pushed.push(false);
            }
        }
    }
    /*
     * fold a tree in pre-order manner
     *
     * tree
     *
     * A - B - C - D
     *  \    \
     *   F    E
     *
     * gets folded as
     *
     * ((((((z + A) + B) + C) + D) + E) + F)
     */
    fold<T>(acc: T, plus: (acc: T, node: MoveTree) => T): T {
        let val = acc;
        this.traverse((node) => {
            val = plus(val, node);
        });
        return val;
    }

    /*
     * number of nodes in the tree
     * (including the empty node in the root)
     */
    size(): number {
        return this.fold(0, (acc, node) => acc + 1);
    }

    next(dont_follow_hints?: boolean): MoveTree | null {
        if (this.trunk_next) {
            /* always follow a trunk first if it's available */
            return this.trunk_next;
        }

        /* Remember what branch we were on and follow that by default.. but
         * because we sometimes delete things, we're gonna check to make sure it's
         * still in our list of branches before blindly following it */
        if (this.hint_next && !dont_follow_hints) {
            /*
            if (this.trunk_next && this.hint_next.id === this.trunk_next.id) {
                return this.hint_next;
            }
            */
            for (let i = 0; i < this.branches.length; ++i) {
                if (this.branches[i].id === this.hint_next.id) {
                    return this.hint_next;
                }
            }
        }

        /* If nothing else, follow the first branch we find */
        if (this.branches.length) {
            return this.branches[0];
        }
        return null;
    }
    prev(): MoveTree | null {
        if (this.parent) {
            this.parent.hint_next = this;
        }
        return this.parent;
    }
    index(idx: number): MoveTree {
        let cur: MoveTree = this;
        while (cur.prev() && idx < 0) {
            cur = cur.prev() as MoveTree;
            ++idx;
        }
        while (cur.next(true) && idx > 0) {
            cur = cur.next(true) as MoveTree;
            --idx;
        }
        return cur;
    }
    is(other?: MoveTree): boolean {
        return !!(other && this.id === other.id);
    }

    hasTheSameRootMoveAs(other: MoveTree): boolean {
        return this.x === other.x && this.y === other.y && this.player === other.player;
    }

    findChildWhich(predicate: (node: MoveTree) => boolean): MoveTree | null {
        if (this.trunk_next && predicate(this.trunk_next)) {
            return this.trunk_next;
        }
        for (let i = 0; i < this.branches.length; ++i) {
            const child = this.branches[i];
            if (predicate(child)) {
                return child;
            }
        }
        return null;
    }

    containsOtherTreeAsSubset(other: MoveTree): boolean {
        // we contain a other tree as a subset iff
        return this.hasTheSameRootMoveAs(other) && this.hasAllChildrenOf(other);
    }

    containsOtherTreeAsChild(other: MoveTree): boolean {
        // there can be at most one candidate children to look for the subtree
        // so the only candidate is the one child that has matching root
        const candidate = this.findChildWhich((myChild) => myChild.hasTheSameRootMoveAs(other));
        if (candidate == null) {
            return false;
        }
        // it also needs to have all children recursively
        return candidate.hasAllChildrenOf(other);
    }

    hasAllChildrenOf(other: MoveTree): boolean {
        // in order to contain all children of other, we need to:
        // a) contain other's trunk as a subset
        if (other.trunk_next && !this.containsOtherTreeAsChild(other.trunk_next)) {
            return false;
        }
        // b) contain all the branches
        for (let i = 0; i < other.branches.length; ++i) {
            const otherChild = other.branches[i];
            if (!this.containsOtherTreeAsChild(otherChild)) {
                return false;
            }
        }
        return true;
    }

    remove(): MoveTree {
        if (!this.parent) {
            throw new Error(`Cannot remove MoveTree child without a parent`);
        }

        if (this.is(this.parent.trunk_next)) {
            this.parent.trunk_next = undefined;
        } else {
            for (let i = 0; i < this.parent.branches.length; ++i) {
                if (this.parent.branches[i].is(this)) {
                    this.parent.branches.splice(i, 1);
                    return this.parent;
                }
            }
        }
        return this.parent;
    }
    getRoot(): MoveTree {
        let ret: MoveTree = this;
        while (ret.parent) {
            ret = ret.parent;
        }
        return ret;
    }
    removeIfNoChildren(): void {
        if (this.trunk_next == null && this.branches.length === 0) {
            this.remove();
        }
    }
    getChatLog(): any[] {
        if (!this.chat_log) {
            this.chat_log = [];
        }
        return this.chat_log;
    }
    getAllMarks(): MarkInterface[][] {
        if (!this.marks) {
            this.marks = this.clearMarks();
        }
        return this.marks;
    }
    setAllMarks(marks: MarkInterface[][]): void {
        this.marks = marks;
    }
    clearAIMarks(): MarkInterface[][] {
        let marks: MarkInterface[][];
        if (this.marks === undefined) {
            marks = makeObjectMatrix<MarkInterface>(this.engine.width, this.engine.height);
            this.marks = marks;
        } else {
            marks = this.marks;
        }
        for (let i = 0; i < this.engine.height; i++) {
            for (let j = 0; j < this.engine.width; j++) {
                if (marks[i][j].before_ai !== undefined) {
                    marks[i][j] = JSON.parse(marks[i][j].before_ai!);
                }
            }
        }
        return this.marks;
    }
    clearMarks(): MarkInterface[][] {
        this.marks = makeObjectMatrix<MarkInterface>(this.engine.width, this.engine.height);
        return this.marks;
    }

    /** Saves the current marks in our stash, restore them with popMarks */
    public stashMarks(): void {
        this.stashed_marks.push(this.getAllMarks());
        this.clearMarks();
    }

    /** Restores previously stashed marks */
    public popStashedMarks(): void {
        if (this.stashed_marks.length > 0) {
            this.marks = this.stashed_marks.pop();
        }
    }

    /** Returns true if there are any marks that have been set */
    hasMarks(): boolean {
        if (!this.marks) {
            return false;
        }
        for (let j = 0; j < this.marks.length; ++j) {
            for (let i = 0; i < this.marks[j].length; ++i) {
                for (const k in this.marks[j][i]) {
                    // !!k is to prevent compiler warning about unused k, but
                    // this is called a lot so we don't want to do
                    // Object.keys(..).length here
                    return !!k || true;
                }
            }
        }
        return false;
    }

    /** Calls a callback for each positions that has a mark on it */
    public foreachMarkedPosition(fn: (i: number, j: number) => void): void {
        if (!this.marks) {
            return;
        }

        for (let j = 0; j < this.marks.length; ++j) {
            for (let i = 0; i < this.marks[j].length; ++i) {
                for (const k in this.marks[j][i]) {
                    fn(i, j);
                    // !!k is to prevent compiler warning about unused k, but
                    // this is called a lot so we don't want to do
                    // Object.keys(..).length here
                    if (!!k || true) {
                        break;
                    }
                }
            }
        }
    }
    isAncestorOf(other: MoveTree | null): boolean {
        if (!other) {
            return false;
        }
        do {
            if (other.id === this.id) {
                return true;
            }
            other = other.parent;
        } while (other);
        return false;
    }
    passed(): boolean {
        return this.x === -1;
    }
    debug(depth: number): string {
        let str = "";
        for (let i = 0; i < depth; ++i) {
            str += " ";
        }
        str += "+ " + this.id;
        console.log(str);
        if (this.trunk_next) {
            this.trunk_next.debug(depth);
        }
        for (let i = 0; i < this.branches.length; ++i) {
            this.branches[i].debug(depth + 2);
        }
        return str;
    }
    toSGF(): string {
        /* Iterative, because a long variation would overflow the call stack.
         * The stack holds nodes still to be written and the variation
         * parentheses to write around them. */
        const ret: string[] = [];
        const stack: Array<MoveTree | string> = [this];

        try {
            while (stack.length > 0) {
                const item = stack.pop() as MoveTree | string;
                if (typeof item === "string") {
                    ret.push(item);
                    continue;
                }

                item.pushSGFNodeProperties(ret);

                const children = item.trunk_next
                    ? [item.trunk_next, ...item.branches]
                    : item.branches;
                const wrap = children.length > 1;
                for (let i = children.length - 1; i >= 0; --i) {
                    if (wrap) {
                        stack.push(")");
                    }
                    stack.push(children[i]);
                    if (wrap) {
                        stack.push("(");
                    }
                }
            }
        } catch (e) {
            console.log(e);
            throw e;
        }

        return ret.join("");
    }
    /** Writes the SGF properties of this node, without its children, to `ret` */
    private pushSGFNodeProperties(ret: string[]): void {
        const txt = [];
        if (this.parent != null) {
            ret.push(";");
            if (this.edited) {
                ret.push("A");
            }
            ret.push(this.player === 1 ? "B" : this.player === 2 ? "W" : "E");

            ret.push("[");
            if (this.x === -1) {
                ret.push("");
            } else {
                ret.push(encodeCoordinate(this.x));
                ret.push(encodeCoordinate(this.y));
            }
            ret.push("]");
            txt.push(this.text);
        }

        if (this.chat_log && this.chat_log.length) {
            txt.push("\n\n");
            txt.push("-- chat --");
            txt.push("\n");
            for (let i = 0; i < this.chat_log.length; ++i) {
                txt.push(MoveTree.fmtUsername(this.chat_log[i].username));
                txt.push(
                    MoveTree.markupSGFChatMessage(
                        this.chat_log[i].body,
                        this.engine.width,
                        this.engine.height,
                    ),
                );
                txt.push("\n");
            }
        }

        if (this.marks) {
            for (let y = 0; y < this.marks.length; ++y) {
                for (let x = 0; x < this.marks[0].length; ++x) {
                    const m = this.marks[y][x];
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
                    if (m.letter) {
                        // https://www.red-bean.com/sgf/properties.html
                        // LB is composed type of simple text (== no newlines, escaped colon)
                        const body = newlines_to_spaces(escapeSGFText(m.letter, true));
                        ret.push("LB[" + pos + ":" + body + "]");
                    }
                }
            }
        }
        const comment = txt.join("");
        if (comment !== "") {
            ret.push("C[" + escapeSGFText(comment) + "]");
        }
        ret.push("\n");
    }
    get stoneColor(): "black" | "white" | "empty" {
        switch (this.player) {
            case JGOFNumericPlayerColor.BLACK:
                return "black";
            case JGOFNumericPlayerColor.WHITE:
                return "white";
            case JGOFNumericPlayerColor.EMPTY:
                return "empty";
        }
        throw new Error("Invalid stone color");
    }

    toJGOFMove(): JGOFMove {
        return {
            x: this.x,
            y: this.y,
            color: this.player,
            edited: this.edited,
        };
    }

    /* Returns the node in the main trunk which is our ancestor. May be this node. */
    getBranchPoint(): MoveTree {
        let cur: MoveTree = this;
        while (!cur.trunk && cur.parent) {
            cur = cur.parent;
        }
        return cur;
    }

    /* Returns the index of the node from root. This is only really meaningful as
     * an index on trunk nodes, but will give the distance of the node from the
     * root for any node. */
    getMoveIndex(): number {
        let ct = 0;
        let cur: MoveTree = this;
        while (cur.parent) {
            ++ct;
            cur = cur.parent;
        }
        return ct;
    }

    /* Returns the distance to the given node, or -1 if the node is not a descendent */
    getDistance(node: MoveTree): number {
        let ct = 0;
        let cur: MoveTree = this;
        while (cur.parent && cur.id !== node.id) {
            ++ct;
            cur = cur.parent;
        }
        return ct;
    }

    /* Returns the difference between this move_number and the move number at our branch point */
    getMoveNumberDifferenceFromTrunk(): number {
        return this.move_number - this.getBranchPoint().move_number;
    }

    getMarks(x: number, y: number): MarkInterface {
        if (!this.marks) {
            this.marks = this.clearMarks();
        }

        if (y < this.marks.length && x < this.marks[y].length) {
            return this.marks[y][x];
        } else {
            console.warn(
                "getMarks called with invalid x,y = ",
                x,
                y,
                " engine width/height = ",
                this.engine.width,
                this.engine.height,
            );
            return {};
        }
    }
    setActivePath(path_number: number): void {
        this.active_path_number = path_number;
        let parent = this.parent;
        while (parent) {
            parent.active_path_number = path_number;
            parent = parent.parent;
        }
        let next = this.next();
        while (next) {
            next.active_path_number = path_number;
            next = next.next();
        }
    }
    getMoveStringToThisPoint(): string {
        let move_stack: MoveTree[] = [];
        let cur: MoveTree | null = this;
        let ret = "";
        while (cur) {
            move_stack.push(cur);
            cur = cur.parent;
        }
        move_stack = move_stack.reverse();
        for (let i = 1; i < move_stack.length; ++i) {
            ret += encodeMove(move_stack[i]);
        }
        return ret;
    }

    /**** Layout & Rendering ****/
    static active_path_number: number = 0;
    static current_line_color: number = 0;

    /* Muted earth tones: these are drawn as thin branch lines over the move
     * tree's grey, and the hosts that show a variation's colour beside its
     * name put them next to text. */
    static readonly LINE_COLORS_DARK: ReadonlyArray<string> = [
        "#9E5245", // brick
        "#61804A", // moss
        "#4A6C90", // denim
        "#3F7E78", // teal
        "#B39A4E", // wheat
        "#B5713C", // clay
        "#7B5C8A", // plum
    ];

    /* The same seven hues for a host with a light interface, where the darker
     * set reads heavy beside light text and panels. */
    static readonly LINE_COLORS_LIGHT: ReadonlyArray<string> = [
        "#C07A6B", // brick
        "#86A461", // moss
        "#6E90B8", // denim
        "#63A69E", // teal
        "#C9AE5E", // wheat
        "#CE8F58", // clay
        "#9C7BAA", // plum
    ];

    /* The palette in use, indexed by a node's `line_color`. A host with a
     * light interface assigns `LINE_COLORS_LIGHT`; the slots hold the same
     * hue in either set, so a branch keeps its colour family across the
     * change. Hosts assign this array rather than mutate it. */
    static line_colors: Array<string> = [...MoveTree.LINE_COLORS_DARK];

    static isobranch_colors = {
        strong: "#C100FF",
        weak: "#A582A3",
        //"strong": "#ff0000",
        //"weak": "#0000ff",
    };

    /**
     * Computes the move tree layout position and line color of this node and
     * all of its descendants, and returns the layout row of this node.
     *
     * This is the depth-first algorithm that recursed into `trunk_next` and
     * then into each branch. It uses an explicit stack of frames instead of
     * recursion, because a long variation would overflow the call stack. Each
     * frame holds the local state of one recursive call, and `stage` tells
     * where that call continues when the frame is on top of the stack again.
     */
    layout(
        x: number,
        min_y: number,
        layout_hash: { [coords: string]: MoveTree },
        line_color: number,
    ): number {
        const stack: LayoutFrame[] = [newLayoutFrame(this, x, min_y, line_color)];
        let ret = 0; /* The return value of the frame that finished last */

        while (stack.length > 0) {
            const frame = stack[stack.length - 1];
            const node = frame.node;
            const layout_vector = node.engine.move_tree_layout_vector;

            if (frame.stage === "enter") {
                if (!layout_vector[frame.x]) {
                    layout_vector[frame.x] = 0;
                }

                if (frame.x === 0 && frame.min_y === 0) {
                    MoveTree.current_line_color = 0;
                }

                frame.min_y = Math.max(layout_vector[frame.x] + 1, frame.min_y);
                frame.stage = "trunk_done";

                if (node.trunk_next) {
                    /* The row of the trunk_next is not used */
                    stack.push(
                        newLayoutFrame(
                            node.trunk_next,
                            frame.x + 1,
                            0,
                            (node.move_number + 1) % MoveTree.line_colors.length,
                        ),
                    );
                }
                continue;
            }

            if (frame.stage === "trunk_done") {
                if (node.line_color === -1) {
                    node.line_color = frame.line_color;
                }
                frame.next_line_color = node.line_color + node.move_number;
                frame.branch = 0;
                frame.stage = "next_branch";
                continue;
            }

            if (frame.stage === "branch_done") {
                if (frame.branch === 0) {
                    frame.min_y = Math.max(frame.min_y, ret - 1);
                }
                frame.next_line_color++;
                frame.branch++;
                frame.stage = "next_branch";
                continue;
            }

            /* frame.stage === "next_branch" */
            if (frame.branch < node.branches.length) {
                const i = frame.branch;
                frame.next_line_color %= MoveTree.line_colors.length;
                if (i && frame.next_line_color === node.line_color) {
                    /* prevents neighboring line colors from being the same */
                    frame.next_line_color += 2;
                    frame.next_line_color %= MoveTree.line_colors.length;
                }

                frame.stage = "branch_done";
                stack.push(
                    newLayoutFrame(
                        node.branches[i],
                        frame.x + 1,
                        frame.min_y,
                        i === 0 ? node.line_color : frame.next_line_color++,
                    ),
                );
                continue;
            }

            const x = frame.x;
            let min_y = frame.min_y;

            if (node.trunk) {
                min_y = 0;
            }

            node.layout_x = x;
            node.layout_y = min_y;
            layout_hash[x + "," + min_y] = node;

            node.layout_cx = Math.floor((node.layout_x + 0.5) * MoveTree.stone_square_size) + 0.5;
            node.layout_cy = Math.floor((node.layout_y + 0.5) * MoveTree.stone_square_size) + 0.5;

            layout_vector[x] = Math.max(min_y, layout_vector[x]);
            if (x) {
                /* allocate space for our branch lines */
                layout_vector[x - 1] = Math.max(min_y - 1, layout_vector[x - 1]);
            }

            ret = min_y;
            stack.pop();
        }

        return ret;
    }
    getNodeAtLayoutPosition(layout_x: number, layout_y: number): MoveTree | null {
        const key = layout_x + "," + layout_y;
        if (key in this.engine.move_tree_layout_hash) {
            return this.engine.move_tree_layout_hash[key];
        }
        return null;
    }
    findStrongIsobranches(): Array<MoveTree> {
        let c: MoveTree = this;
        while (c.parent) {
            c = c.parent;
        }

        c.recomputeIsobranches();

        const ret: Array<MoveTree> = [];
        if (this.isobranches) {
            for (let i = 0; i < this.isobranches.length; ++i) {
                if (this.isobranches[i].trunk_next || this.isobranches[i].branches.length) {
                    ret.push(this.isobranches[i]);
                }
            }
        }

        return ret;
    }

    nextSibling(): MoveTree | null {
        let ret = null;
        for (let i = 1; i < 30 && ret == null; ++i) {
            ret = this.getNodeAtLayoutPosition(this.layout_x, this.layout_y + i);
        }
        return ret;
    }
    prevSibling(): MoveTree | null {
        let ret = null;
        for (let i = 1; i < 30 && ret == null; ++i) {
            ret = this.getNodeAtLayoutPosition(this.layout_x, this.layout_y - i);
        }
        return ret;
        //return  this.getNodeAtLayoutPosition(this.layout_x, this.layout_y-1);
    }

    getPositionInParent(): number {
        if (this.parent == null) {
            return -5;
        }

        if (this.parent.trunk_next && this.id === this.parent.trunk_next.id) {
            return -1;
        }

        for (let i = 0; i < this.parent.branches.length; ++i) {
            if (this.id === this.parent.branches[i].id) {
                return i;
            }
        }

        return -5;
    }

    private isBranchWithCorrectAnswer(branch: MoveTree): boolean {
        if (branch.correct_answer) {
            return true;
        }
        if (!branch.branches || branch.branches.length === 0) {
            return false;
        }

        return branch.branches.some((item) => this.isBranchWithCorrectAnswer(item));
    }

    private isBranchWithWrongAnswer(branch: MoveTree): boolean {
        if (branch.wrong_answer) {
            return true;
        }
        if (!branch.branches || branch.branches.length === 0) {
            return false;
        }

        return branch.branches.some((item) => this.isBranchWithWrongAnswer(item));
    }

    public hoistFirstBranchToTrunk(): void {
        /* A loop, not recursion, because a long variation would overflow the call stack */
        let cur: MoveTree | undefined = this;
        while (cur) {
            if (cur.trunk_next) {
                cur = cur.trunk_next;
                continue;
            }

            cur.trunk = true;
            cur.trunk_next = cur.branches.shift();
            cur = cur.trunk_next;
        }
    }

    /**
     * Find branches containing node with correct_answer === true
     */
    findBranchesWithCorrectAnswer(): Array<MoveTree> {
        return this.branches.filter((branch) => this.isBranchWithCorrectAnswer(branch));
    }

    /**
     * Find branches containing node with wrong_answer === true
     */
    findBranchesWithWrongAnswer(): Array<MoveTree> {
        return this.branches.filter((branch) => this.isBranchWithWrongAnswer(branch));
    }

    public clearBranchesExceptFor(node: MoveTree): void {
        this.branches = this.branches.filter((x) => x.id === node.id);
    }

    static markupSGFChatMessage(
        message: MoveTreeChatLineBody | string,
        width: number,
        height: number,
    ): string {
        try {
            if (typeof message === "object") {
                if (message.type === "analysis") {
                    const moves = decodeMoves(message.moves, width, height);
                    let move_str = "";
                    for (let i = 0; i < moves.length; ++i) {
                        move_str += prettyCoordinates(moves[i].x, moves[i].y, height) + " ";
                    }

                    return message.name + ". From move " + message.from + ": " + move_str;
                }
            }
        } catch (e) {
            console.log(e);
        }

        // TODO FIXME: here lives https://github.com/online-go/online-go.com/issues/1518
        return `${message}`;
    }

    static fmtUsername(username: string): string {
        return username ? username + ": " : "";
    }
    static escapedSGFChat(
        username: string,
        message: MoveTreeChatLineBody | string,
        width: number,
        height: number,
    ): string {
        const txt =
            MoveTree.fmtUsername(username) + MoveTree.markupSGFChatMessage(message, width, height);
        return escapeSGFText(txt);
    }
    static markupSGFChat(
        username: string,
        message: MoveTreeChatLineBody | string,
        width: number,
        height: number,
    ): string {
        return "C[" + MoveTree.escapedSGFChat(username, message, width, height) + "]\n";
    }
    /*
     * this is used on backend to serialize chat line
     */
    static markupSGFChatWithoutNode(
        username: string,
        message: MoveTreeChatLineBody | string,
        width: number,
        height: number,
    ): string {
        return MoveTree.escapedSGFChat(username, message, width, height) + "\n";
    }
}
