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

/** A branch in the conditional move tree, consists of the response move and
 *  the sub-tree of the next possible moves */
export type ConditionalMoveResponse = [
    (
        /** response_move */
        string | null
    ),

    /** next move tree */
    ConditionalMoveResponseTree,
];

export interface ConditionalMoveResponseTree {
    [move: string]: ConditionalMoveResponse;
}

export class ConditionalMoveTree {
    children: {
        [move: string]: ConditionalMoveTree;
    };
    parent?: ConditionalMoveTree;
    move: string | null;

    constructor(move: string | null, parent?: ConditionalMoveTree) {
        this.move = move;
        this.parent = parent;
        this.children = {};
    }

    encode(): ConditionalMoveResponse {
        const ret: ConditionalMoveResponseTree = {};
        for (const ch in this.children) {
            ret[ch] = this.children[ch].encode();
        }
        return [this.move, ret];
    }
    static decode(data: ConditionalMoveResponse): ConditionalMoveTree {
        const move = data[0];
        const children = data[1];
        const ret = new ConditionalMoveTree(move);
        for (const ch in children) {
            const child = ConditionalMoveTree.decode(children[ch]);
            child.parent = ret;
            ret.children[ch] = child;
        }
        return ret;
    }
    getChild(mv: string): ConditionalMoveTree {
        if (mv in this.children) {
            return this.children[mv];
        }
        return new ConditionalMoveTree(null, this);
    }
    duplicate(): ConditionalMoveTree {
        return ConditionalMoveTree.decode(this.encode());
    }

    /**
     * Merge another conditional move tree into this one. The other tree's
     * branches override this tree's where they conflict — see
     * {@link mergeResponseTrees} for the per-branch rule.
     */
    merge(other: ConditionalMoveTree): ConditionalMoveTree {
        const treeA = this.encode()[1];
        const treeB = other.encode()[1];
        mergeResponseTrees(treeA, treeB);
        return ConditionalMoveTree.decode([null, treeA]);
    }

    /**
     * Build a conditional move tree from a flat sequence of moves that
     * alternate "opponent move, our planned response". The string is taken
     * pair-by-pair (each move is two characters) starting from the most
     * recent and working back to the root, so the resulting tree describes:
     * "if opponent plays move N, respond with move N+1; if then opponent
     * plays move N+2, respond with move N+3; …"
     *
     * Required shape: `moves.length % 2 === 0`. The first move in the string
     * is the opponent's. A trailing unpaired opponent move with no planned
     * response is allowed (the deepest node has `move = null`).
     */
    static fromMoveDiff(moves: string): ConditionalMoveTree {
        if (moves.length % 2 !== 0) {
            throw new Error("invalid move string");
        }

        let tree = new ConditionalMoveTree(null);
        const start = moves.length - 1 - ((moves.length - 1) % 4);
        for (let i = start; i >= 0; i -= 4) {
            const opponent = moves.slice(i, i + 2);
            const player = moves.slice(i + 2, i + 4) || null;

            tree.move = player;
            const parent = new ConditionalMoveTree(null, tree);
            if (player != null) {
                parent.children[opponent] = tree;
            }
            tree = parent;
        }
        return tree;
    }
}

/**
 * Merge two response-tree maps in place. `b`'s branches overwrite `a`'s
 * where the same opponent move maps to a different planned response;
 * matching responses recurse into their sub-trees.
 */
function mergeResponseTrees(a: ConditionalMoveResponseTree, b: ConditionalMoveResponseTree): void {
    if (a === b) {
        return;
    }

    for (const move in b) {
        if (!Object.prototype.hasOwnProperty.call(a, move)) {
            // Deep copy.
            a[move] = JSON.parse(JSON.stringify(b[move]));
            continue;
        }

        const [responseA, nextA] = a[move];
        const [responseB, nextB] = b[move];
        if (responseA !== responseB) {
            a[move] = JSON.parse(JSON.stringify(b[move]));
            continue;
        }

        mergeResponseTrees(nextA, nextB);
    }
}
