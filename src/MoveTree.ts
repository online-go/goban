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

import {GoMath} from "./GoMath";
import {GoEngine, GoEngineState} from "./GoEngine";
import {resizeDeviceScaledCanvas} from "./GoUtil";
import {encodeMove, NumericPlayerColor} from "./GoEngine";

export interface MarkInterface {
    triangle?         : boolean;
    square?           : boolean;
    circle?           : boolean;
    cross?            : boolean;
    letter?           : string;
    transient_letter? : string;
    score?            : string | boolean;
    chat_triangle?    : boolean;
    sub_triangle?     : boolean;
    remove?           : boolean;
    stone_removed?    : boolean;
    mark_x?           : boolean;
    hint?             : boolean;
    black?            : boolean;
    white?            : boolean;
    color?            : string;
}

export type MoveTreePenMarks = Array<{
    color:string;
    points:Array<number>; /* [x1,y1, x2,y2, ...] */
}>;

export interface MoveTreeJson {
    x               : number;
    y               : number;
    pen_marks?      : MoveTreePenMarks;
    marks?          : Array<{x: number, y: number, marks: MarkInterface}>;
    text?           : string;
    trunk_next?     : MoveTreeJson;
    branches?       : Array<MoveTreeJson>;
    correct_answer? : boolean;
    wrong_answer?   : boolean;
}

let __move_tree_id = 0;
let __isobranches_state_hash = {}; /* used while finding isobranches */

/* TODO: If we're on the server side, we shouldn't be doing anything with marks */
export class MoveTree {
    public static readonly stone_radius = 11;
    public static readonly stone_padding = 3;
    public static readonly stone_square_size = (MoveTree.stone_radius + MoveTree.stone_padding) * 2;


    public label: string;

    public move_number: number;
    public readonly pretty_coordinates: string;
    public parent: MoveTree;
    public readonly id: number;
    public trunk_next: MoveTree;
    public branches: Array<MoveTree>;
    public correct_answer: boolean;
    public wrong_answer: boolean;
    private hint_next: MoveTree;
    public player: NumericPlayerColor;
    public line_color: number;
    public trunk: boolean;
    public text: string;
    private readonly engine: GoEngine;
    public x: number;
    public y: number;
    public edited: boolean;
    private active_node_number: number;
    public state: GoEngineState;
    public pen_marks: MoveTreePenMarks = [];

    /* public for use by renderer */
    public active_path_number: number;
    public layout_cx: number;
    public layout_cy: number;
    public layout_x: number;
    public layout_y: number;
    public label_metrics: TextMetrics;

    /* These need to be protected by accessor methods now that we're not
     * initializing them on construction */
    private chatlog: Array<any>;
    private marks: Array<Array<MarkInterface>>;
    public isobranches: any;
    private isobranch_hash : string;

    constructor(engine:GoEngine, trunk:boolean, x:number, y:number, edited:boolean, player:NumericPlayerColor, move_number:number, parent:MoveTree, state:GoEngineState) {
        this.id = ++__move_tree_id;
        this.x = x;
        this.y = y;
        this.pretty_coordinates = engine.prettyCoords(x, y);
        this.label = null;
        this.label_metrics = null;
        this.layout_x = 0;
        this.layout_y = 0;
        this.engine = engine;
        this.trunk = trunk;
        this.edited = edited;
        this.player = player;
        this.parent = parent;
        this.move_number = move_number;
        this.state = state;
        this.trunk_next = null;
        this.branches = [];
        this.active_path_number = 0;
        this.active_node_number = 0;
        //this.clearMarks();
        this.line_color = -1;

        this.text = "";

        this.correct_answer = null;
        this.wrong_answer = null;
    }


    toJson():MoveTreeJson {
        let ret: MoveTreeJson = {
            x: this.x,
            y: this.y,
        };

        if (this.pen_marks && this.pen_marks.length) {
            ret.pen_marks = this.pen_marks;
        }
        if (this.hasMarks()) {
            ret.marks = [];
            this.foreachMarkedPosition((x, y) => {
                ret.marks.push({"x": x, "y": y, "marks": this.getMarks(x, y)});
            });
        }
        if (this.text) {
            ret.text = this.text;
        }

        if (this.trunk_next) {
            ret.trunk_next = this.trunk_next.toJson();
        }
        if (this.branches.length) {
            ret.branches = [];
            for (let i = 0; i < this.branches.length; ++i) {
                ret.branches.push(this.branches[i].toJson());
            }
        }
        if (this.correct_answer) {
            ret.correct_answer = this.correct_answer;
        }
        if (this.wrong_answer) {
            ret.wrong_answer = this.wrong_answer;
        }

        return ret;
    }
    loadJsonForThisNode(json:MoveTreeJson):void {
        /* Unlike toJson, restoring from the json blob is a collaborative effort between
         * MoveTree and the GoEngine because of all the state we capture along the way..
         * so during restoration GoEngine will form the tree, and for each node call this
         * method with the json that was captured with toJson for this node */

        if (json.x !== this.x || json.y !== this.y) {
            throw new Error("Node mismatch when unpacking json object in MoveTree.fromJson");
        }

        this.correct_answer = json.correct_answer;
        this.wrong_answer = json.wrong_answer;
        this.text = json.text ? json.text : "";

        if (json.marks) {
            for (let i = 0; i < json.marks.length; ++i) {
                let m = json.marks[i];
                for (let k in m.marks) {
                    this.getMarks(m.x, m.y)[k] = m.marks[k];
                }
            }
        }
        if (json.pen_marks) {
            this.pen_marks = json.pen_marks;
        }
    }

    recomputeIsobranches():void {
        if (this.parent) {
            throw new Error("MoveTree.recomputeIsobranches needs to be called from the root node");
        }

        __isobranches_state_hash = {};

        let buildHashes = (node:MoveTree):void => {
            let hash = node.state.isobranch_hash ? node.state.isobranch_hash :
                node.state.isobranch_hash = node.state.board.map(arr => arr.join('')).join('') + node.player;
            node.isobranch_hash = hash;

            if (!(hash in __isobranches_state_hash)) {
                __isobranches_state_hash[hash] = [];
            }

            __isobranches_state_hash[hash].push(node);

            if (node.trunk_next) {
                buildHashes(node.trunk_next);
            }

            for (let i = 0; i < node.branches.length; ++i) {
                buildHashes(node.branches[i]);
            }
        };

        let recompute = (node:MoveTree):void => {
            node.isobranches = [];

            for (let n of __isobranches_state_hash[node.isobranch_hash]) {
                if (node.id !== n.id) {
                    if (node.isAncestorOf(n) || n.isAncestorOf(node)) {
                        continue;
                    }
                    node.isobranches.push(n);
                }
            }

            if (node.trunk_next) {
                recompute(node.trunk_next);
            }

            for (let i = 0; i < node.branches.length; ++i) {
                recompute(node.branches[i]);
            }
        };

        buildHashes(this);
        recompute(this);
    }

    lookupMove(x:number, y:number, player:number, edited:boolean):MoveTree {
        if (this.trunk_next &&
            this.trunk_next.x === x &&
                this.trunk_next.y === y &&
                    this.trunk_next.edited === edited &&
                        (!edited || this.trunk_next.player)
            ) {
                return this.trunk_next;
            }

            for (let i = 0; i < this.branches.length; ++i) {
                if (this.branches[i].x === x && this.branches[i].y === y && (!edited || this.branches[i].player === player) && this.branches[i].edited === edited) {
                    return this.branches[i];
                }
            }

            return null;
    }
    move(x:number, y:number, trunk:boolean, edited:boolean, player:NumericPlayerColor, move_number:number, state:any):MoveTree {
        if (typeof(player) === "undefined") {
            throw new Error("Invalid player");
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
                if (this.branches[i].x === x &&
                    this.branches[i].y === y &&
                    this.branches[i].player === player
                ) {
                    let brs = this.branches[i].branches;
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
                if (this.branches[i].x === x && this.branches[i].y === y && this.branches[i].player === player) {
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
    next(dont_follow_hints?:boolean):MoveTree {
        if (this.trunk_next) {
            /* always follow a trunk first if it's available */
            return this.trunk_next;
        }

        /* Remember what branch we were on and follow that by default.. but
         * because we sometimes delete things, we're gonna check to make sure it's
         * still in our list of branches before blindly following it */
        if (this.hint_next && !dont_follow_hints) {
            if (this.trunk_next && this.hint_next.id === this.trunk_next.id) {
                return this.hint_next;
            }
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
    prev():MoveTree {
        if (this.parent) {
            this.parent.hint_next = this;
        }
        return this.parent;
    }
    index(idx):MoveTree {
        let cur:MoveTree = this;
        while (cur.prev() && idx < 0) { cur = cur.prev(); ++idx; }
        while (cur.next(true) && idx > 0) { cur = cur.next(true); --idx; }
        return cur;
    }
    is(other:MoveTree):boolean {
        return other && this.id === other.id;
    }
    remove():MoveTree {
        if (this.is(this.parent.trunk_next)) {
            this.parent.trunk_next = null;
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
    getRoot():MoveTree {
        let ret:MoveTree = this;
        while (ret.parent) {
            ret = ret.parent;
        }
        return ret;
    }
    removeIfNoChildren():void {
        if (this.trunk_next == null && this.branches.length === 0) {
            this.remove();
        }
    }
    getChatLog():Array<any> {
        if (!this.chatlog) {
            this.chatlog = [];
        }
        return this.chatlog;
    }
    getAllMarks():Array<Array<MarkInterface>> {
        if (!this.marks) {
            this.clearMarks();
        }
        return this.marks;
    }
    setAllMarks(marks:Array<Array<MarkInterface>>):void {
        this.marks = marks;
    }
    clearMarks():void {
        this.marks = GoMath.makeObjectMatrix<MarkInterface>(this.engine.width, this.engine.height);
    }
    hasMarks():boolean {
        if (!this.marks) {
            return false;
        }
        for (let j = 0; j < this.marks.length; ++j) {
            for (let i = 0; i < this.marks[j].length; ++i) {
                for (let k in this.marks[j][i]) {
                    return true;
                }
            }
        }
        return false;
    }
    foreachMarkedPosition(fn:(i:number, j:number) => void):boolean {
        if (!this.marks) {
            return;
        }

        for (let j = 0; j < this.marks.length; ++j) {
            for (let i = 0; i < this.marks[j].length; ++i) {
                for (let k in this.marks[j][i]) {
                    fn(i, j);
                    break;
                }
            }
        }
    }
    isAncestorOf(other:MoveTree):boolean {
        do {
            if (other.id === this.id) { return true; }
            other = other.parent;
        } while (other);
        return false;
    }
    passed():boolean {
        return this.x === -1;
    }
    debug(depth:number):string {
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
    toSGF():string {
        let ret = "";

        try {
            let txt = "";
            if (this.parent != null) {
                ret += ";";
                if (this.edited) {
                    ret += "A";
                }
                ret += this.player === 1 ? "B" : (this.player === 2 ? "W" : "E");

                ret += "[";
                if (this.x === -1) {
                    ret += "";
                } else {
                    ret += "abcdefghijklmnopqrstuvwxyz"[this.x];
                    ret += "abcdefghijklmnopqrstuvwxyz"[this.y];
                }
                ret += "]";
                txt = this.text;
            }

            if (this.chatlog && this.chatlog.length) {
                txt += "\n\n-- chat --\n";
                for (let i = 0; i < this.chatlog.length; ++i) {
                    txt += this.chatlog[i].username + ": " + MoveTree.markupSGFChatMessage(this.chatlog[i].body, this.engine.width, this.engine.height) + "\n";
                }
            }

            if (this.marks) {
                for (let y = 0; y < this.marks.length; ++y) {
                    for (let x = 0; x < this.marks[0].length; ++x) {
                        let m = this.marks[y][x];
                        let pos = "abcdefghijklmnopqrstuvwxyz"[x] + "abcdefghijklmnopqrstuvwxyz"[y];
                        if (m.triangle) { ret += "TR[" + pos + "]"; }
                        if (m.square) { ret += "SQ[" + pos + "]"; }
                        if (m.cross) { ret += "XX[" + pos + "]"; }
                        if (m.circle) { ret += "CR[" + pos + "]"; }
                        if (m.letter) { ret += "LB[" + pos + ":" + (m.letter).replace(/[\\]/, "\\\\").replace(/\]/g, "\\]").replace(/[[]/g, "\\[") + "]"; }
                    }
                }
            }

            if (txt !== "") {
                ret += "C[" + (txt).replace(/[\\]/, "\\\\").replace(/\]/g, "\\]").replace(/[[]/g, "\\[") + "\n]\n";
            }
            ret += "\n";

            let brct = (this.trunk_next != null ? 1 : 0) + this.branches.length;
            let A = brct > 1 ? "(" : "";
            let B = brct > 1 ? ")" : "";

            if (this.trunk_next) {
                ret += A + this.trunk_next.toSGF() + B;
            }
            for (let i = 0; i < this.branches.length; ++i) {
                ret += A + this.branches[i].toSGF() + B;
            }
        } catch (e) {
            console.log(e);
            throw e;
        }

        return ret;
    }

    /* Returns the node in the main trunk which is our ancestor. May be this node. */
    getBranchPoint():MoveTree {
        let cur:MoveTree = this;
        while (!cur.trunk && cur.parent) {
            cur = cur.parent;
        }
        return cur;
    }

    /* Returns the index of the node from root. This is only really meaningful as
     * an index on trunk nodes, but will give the distance of the node from the
     * root for any node. */
    getMoveIndex():number {
        let ct = 0;
        let cur:MoveTree = this;
        while (cur.parent) {
            ++ct;
            cur = cur.parent;
        }
        return ct;
    }

    /* Returns the distance to the given node, or -1 if the node is not a descendent */
    getDistance(node:MoveTree):number {
        let ct = 0;
        let cur:MoveTree = this;
        while (cur.parent && cur.id !== node.id) {
            ++ct;
            cur = cur.parent;
        }
        return ct;
    }

    /* Returns the difference between this move_number and the move number at our branch point */
    getMoveNumberDifferenceFromTrunk():number {
        return this.move_number - this.getBranchPoint().move_number;
    }

    getMarks(x:number, y:number):MarkInterface {
        if (!this.marks) {
            this.clearMarks();
        }

        if (y < this.marks.length && x < this.marks[y].length) {
            return this.marks[y][x];
        } else {
            console.warn('getMarks called with invalid x,y = ', x, y, ' engine width/height = ', this.engine.width, this.engine.height);
            return {};
        }
    }
    setActivePath(path_number:number):void {
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
    getMoveStringToThisPoint():string {
        let move_stack = [];
        let cur:MoveTree = this;
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
    static active_path_number:number = 0;
    static current_line_color:number = 0;

    static line_colors:Array<string> = [
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#00ffff",
        "#ffff00",
        "#FF9A00",
        "#9200FF"
        //"#ff00ff"
    ];

    static isobranch_colors = {
        "strong": "#C100FF",
        "weak": "#A582A3",
        //"strong": "#ff0000",
        //"weak": "#0000ff",
    };


    layout(x:number, min_y:number, layout_hash:{[coords:string]:MoveTree}, line_color:number):number {
        if (!this.engine.move_tree_layout_vector[x]) {
            this.engine.move_tree_layout_vector[x] = 0;
        }

        if (x === 0 && min_y === 0) {
            MoveTree.current_line_color = 0;
        }

        min_y = Math.max(this.engine.move_tree_layout_vector[x] + 1, min_y);

        if (this.trunk_next) {
            this.trunk_next.layout(x + 1, 0, layout_hash, (this.move_number + 1) % MoveTree.line_colors.length);
        }

        if (this.line_color === -1) {
            this.line_color = line_color;
        }

        let next_line_color = this.line_color + this.move_number;
        for (let i = 0; i < this.branches.length; ++i) {
            next_line_color %= MoveTree.line_colors.length;
            if (i && next_line_color === this.line_color) {
                next_line_color += 2; /* prevents neighboring line colors from being the same */
                next_line_color %= MoveTree.line_colors.length;
            }

            let by = this.branches[i].layout(x + 1, min_y, layout_hash, i === 0 ? this.line_color : next_line_color++);
            if (i === 0) {
                min_y = Math.max(min_y, by - 1);
            }

            next_line_color++;
        }

        if (this.trunk) {
            min_y = 0;
        }

        this.layout_x = x;
        this.layout_y = min_y;
        layout_hash[x + "," + min_y] = this;

        this.layout_cx = Math.floor((this.layout_x + 0.5) * MoveTree.stone_square_size) + 0.5;
        this.layout_cy = Math.floor((this.layout_y + 0.5) * MoveTree.stone_square_size) + 0.5;

        this.engine.move_tree_layout_vector[x] = Math.max(min_y, this.engine.move_tree_layout_vector[x]);
        if (x) { /* allocate space for our branch lines */
            this.engine.move_tree_layout_vector[x - 1] = Math.max(min_y - 1, this.engine.move_tree_layout_vector[x - 1]);
        }

        return min_y;
    }
    getNodeAtLayoutPosition(layout_x:number, layout_y:number):MoveTree {
        let key = layout_x  + "," + layout_y;
        if (key in this.engine.move_tree_layout_hash) {
            return this.engine.move_tree_layout_hash[key];
        }
        return null;
    }
    findStrongIsobranches():Array<MoveTree> {
        let c:MoveTree = this;
        while (c.parent) {
            c = c.parent;
        }

        c.recomputeIsobranches();

        let ret:Array<MoveTree> = [];
        if (this.isobranches) {
            for (let i = 0; i < this.isobranches.length; ++i) {
                if (this.isobranches[i].trunk_next || this.isobranches[i].branches.length) {
                    ret.push(this.isobranches[i]);
                }
            }
        }

        return ret;
    }


    nextSibling():MoveTree {
        let ret = null;
        for (let i = 1; i < 30 && ret == null; ++i) {
            ret = this.getNodeAtLayoutPosition(this.layout_x, this.layout_y + i);
        }
        return  ret;
    }
    prevSibling():MoveTree {
        let ret = null;
        for (let i = 1; i < 30 && ret == null; ++i) {
            ret = this.getNodeAtLayoutPosition(this.layout_x, this.layout_y - i);
        }
        return  ret;
        //return  this.getNodeAtLayoutPosition(this.layout_x, this.layout_y-1);
    }

    getPositionInParent():number {
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

        return branch.branches.some( item => this.isBranchWithCorrectAnswer(item));
    }

    public hoistFirstBranchToTrunk():void {
        if (this.trunk_next) {
            this.trunk_next.hoistFirstBranchToTrunk();
            return;
        }

        this.trunk = true;
        if (this.branches.length > 0) {
            this.trunk_next = this.branches.shift();
            this.trunk_next.hoistFirstBranchToTrunk();
        }
    }

    /**
     * Find branches containing node with correct_answer === true
     */
    findBranchesWithCorrectAnswer(): Array<MoveTree> {
        return this.branches.filter( branch => this.isBranchWithCorrectAnswer(branch));
    }

    static markupSGFChatMessage(message, width, height) {
        try {
            if (typeof(message) === "object") {
                if (message.type === "analysis") {
                    let moves = GoMath.decodeMoves(message.moves, width, height);
                    let movestr = "";
                    for (let i = 0; i < moves.length; ++i) {
                        movestr += GoMath.prettyCoords(moves[i].x, moves[i].y, height) + " ";
                    }

                    return message.name + ". From move " + message.from + ": " + movestr;
                }
            }
        } catch (e) {
            console.log(e);
        }

        return message;
    }
    static markupSGFChat(username, message, width, height) {
        return "C[" + ((username ? (username + ": ") : "") + MoveTree.markupSGFChatMessage(message, width, height)).replace(/[\\]/, "\\\\").replace(/\]/g, "\\]").replace(/[[]/g, "\\[") + "\n]\n";
    }
    static markupSGFChatWithoutNode(username, message, width, height) {
        return ((username ? (username + ": ") : "") + MoveTree.markupSGFChatMessage(message, width, height)).replace(/[\\]/, "\\\\").replace(/\]/g, "\\]").replace(/[[]/g, "\\[") + "\n";
    }
}
