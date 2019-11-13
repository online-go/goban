/*
 * Copyright 2012-2019 Online-Go.com
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


type ConditionalMoveResponse = [
    /** response_move */
    string | null,

    /** next: */
    ConditionalMoveTree
];

interface ConditionalMoveTree {
    [move: string]: ConditionalMoveResponse;
}

export class GoConditionalMove {
    children: {
        [move:string]: GoConditionalMove;
    };
    parent?: GoConditionalMove;
    move: string | null;

    constructor(move:string | null, parent?:GoConditionalMove) {
        this.move = move;
        this.parent = parent;
        this.children = {};
    }

    encode():ConditionalMoveResponse {
        let ret:ConditionalMoveTree = {};
        for (let ch in this.children) {
            ret[ch] = this.children[ch].encode();
        }
        return [this.move, ret];
    }
    static decode(data:ConditionalMoveResponse):GoConditionalMove {
        let move = data[0];
        let children = data[1];
        let ret = new GoConditionalMove(move);
        for (let ch in children) {
            let child = GoConditionalMove.decode(children[ch]);
            child.parent = ret;
            ret.children[ch] = child;
        }
        return ret;
    }
    getChild(mv:string):GoConditionalMove {
        if (mv in this.children) {
            return this.children[mv];
        }
        return new GoConditionalMove(null, this);
    }
    duplicate():GoConditionalMove {
        return GoConditionalMove.decode(this.encode());
    }
}
