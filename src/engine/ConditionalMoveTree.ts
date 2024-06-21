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
    /** response_move */
    string | null,

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
}
