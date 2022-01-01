/*
 * Copyright 2012-2020 Online-Go.com
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

import { GoStoneGroup } from "./GoStoneGroup";
import {
    JGOFIntersection,
    JGOFMove,
    JGOFNumericPlayerColor,
} from './JGOF';
import { AdHocPackedMove } from './AdHocFormat';


export type Move = JGOFMove;
export type Intersection = JGOFIntersection;
export type Group = Array<JGOFIntersection>;
export type NumberMatrix = Array<Array<number>>;
export type StringMatrix = Array<Array<string>>;

export interface BoardState {
    width: number;
    height: number;
    board: Array<Array<JGOFNumericPlayerColor>>;
    removal: Array<Array<number>>;
    foreachNeighbor: (pt_or_group:Intersection | Group, fn_of_neighbor_pt:(x:number, y:number) => void) => void;
}



export class GoMath {
    private state: BoardState;
    public group_id_map: Array<Array<number>>;
    public groups: Array<GoStoneGroup>;

    constructor(state:BoardState, original_board?:Array<Array<number>>) {
        let groups:Array<GoStoneGroup> = Array(1); // this is indexed by group_id, so we 1 index this array so group_id >= 1
        let group_id_map:Array<Array<number>> = GoMath.makeMatrix(state.width, state.height);

        this.state = state;
        this.group_id_map = group_id_map;
        this.groups = groups;

        let floodFill = (x:number, y:number, color:JGOFNumericPlayerColor, dame:boolean, id:number):void => {
            if (x >= 0 && x < this.state.width) {
                if (y >= 0 && y < this.state.height) {
                    if (this.state.board[y][x] === color
                        && group_id_map[y][x] === 0
                        && (!original_board
                            || ((!dame && (original_board[y][x] !== 0 || !this.state.removal[y][x]))
                                 || ( dame && (original_board[y][x] === 0 &&  this.state.removal[y][x]))
                               )
                           )
                    ) {
                        group_id_map[y][x] = id;
                        floodFill(x - 1, y, color, dame, id);
                        floodFill(x + 1, y, color, dame, id);
                        floodFill(x, y - 1, color, dame, id);
                        floodFill(x, y + 1, color, dame, id);
                    }
                }
            }
        };

        /* Build groups */
        let groupId = 1;
        for (let y = 0; y < this.state.height; ++y) {
            for (let x = 0; x < this.state.width; ++x) {
                if (group_id_map[y][x] === 0) {
                    floodFill(x, y, this.state.board[y][x], !!(original_board && this.state.removal[y][x] && original_board[y][x] === 0), groupId++);
                }

                if (!(group_id_map[y][x] in groups)) {
                    groups.push(new GoStoneGroup(this.state, group_id_map[y][x], this.state.board[y][x], !!(original_board && this.state.removal[y][x] && original_board[y][x] === 0)));
                }
                groups[group_id_map[y][x]].addStone(x, y);
            }
        }

        /* Compute group neighbors */
        this.foreachGroup((gr) => {
            gr.foreachStone((pt) => {
                let x = pt.x;
                let y = pt.y;
                if (x - 1 >= 0 && group_id_map[y][x - 1] !== gr.id) {
                    gr.addNeighborGroup(groups[group_id_map[y][x - 1]]);
                }
                if (x + 1 < this.state.width  && group_id_map[y][x + 1] !== gr.id) {
                    gr.addNeighborGroup(groups[group_id_map[y][x + 1]]);
                }
                if (y - 1 >= 0 && group_id_map[y - 1][x] !== gr.id) {
                    gr.addNeighborGroup(groups[group_id_map[y - 1][x]]);
                }
                if (y + 1 < this.state.height && group_id_map[y + 1][x] !== gr.id) {
                    gr.addNeighborGroup(groups[group_id_map[y + 1][x]]);
                }
                for (let Y = -1; Y <= 1; ++Y) {
                    for (let X = -1; X <= 1; ++X) {
                        if (x + X >= 0 && x + X < this.state.width && y + Y >= 0 && y + Y < this.state.height) {
                            gr.addCornerGroup(x + X, y + Y, groups[group_id_map[y + Y][x + X]]);
                        }
                    }
                }
            });
        });

        this.foreachGroup((gr) => { gr.computeIsTerritory(); });
        this.foreachGroup((gr) => { gr.computeIsTerritoryInSeki(); });
        this.foreachGroup((gr) => { gr.computeIsEye(); });
        this.foreachGroup((gr) => { gr.computeIsStrongEye(); });
        this.foreachGroup((gr) => { gr.computeIsStrongString(); });
    }
    public foreachGroup(fn:(gr:GoStoneGroup) => void) {
        for (let i = 1; i < this.groups.length; ++i) {
            fn(this.groups[i]);
        }
    }
    //private getGroup(x, y) {
    //    return this.groups[this.group_id_map[y][x]];
    //};

    public static makeMatrix(width:number, height:number, initialValue:number = 0):NumberMatrix {
        let ret:NumberMatrix = [];
        for (let y = 0; y < height; ++y) {
            ret.push([]);
            for (let x = 0; x < width; ++x) {
                ret[y].push(initialValue);
            }
        }
        return ret;
    }
    public static makeStringMatrix(width:number, height:number, initialValue:string = ''):StringMatrix {
        let ret:StringMatrix = [];
        for (let y = 0; y < height; ++y) {
            ret.push([]);
            for (let x = 0; x < width; ++x) {
                ret[y].push(initialValue);
            }
        }
        return ret;
    }
    public static makeObjectMatrix<T>(width:number, height:number):Array<Array<T>> {
        let ret = new Array<Array<T>>(height);
        for (let y = 0; y < height; ++y) {
            let row = new Array<T>(width);
            for (let x = 0; x < width; ++x) {
                row[x] = {} as T;
            }
            ret[y] = row;
        }
        return ret;
    }
    public static makeEmptyObjectMatrix<T>(width:number, height:number):Array<Array<T>> {
        let ret = new Array<Array<T>>(height);
        for (let y = 0; y < height; ++y) {
            let row = new Array<T>(width);
            ret[y] = row;
        }
        return ret;
    }
    public static prettyCoords(x:number, y:number, board_height:number):string {
        if (x >= 0) {
            return ("ABCDEFGHJKLMNOPQRSTUVWXYZ"[x]) + ("" + (board_height - y));
        }
        return "pass";
    }
    public static decodeGTPCoordinate(move: string, width:number, height:number): JGOFMove {
        if (move === ".." || move.toLowerCase() === "pass") {
            return {x: -1, y: -1};
        }
        let y = height - parseInt(move.substr(1));
        let x = "ABCDEFGHJKLMNOPQRSTUVWXYZ".indexOf(move[0].toUpperCase());
        if (x === -1) {
            y = -1;
        }
        return {x, y};
    }
    public static decodeMoves(move_obj:AdHocPackedMove | string | Array<AdHocPackedMove> | [object] | Array<JGOFMove> | JGOFMove | undefined, width:number, height:number): Array<JGOFMove> {
        let ret: Array<Move> = [];

        if (!move_obj) {
            return [];
        }

        function decodeSingleMoveArray(arr:[number, number, number, number?, object?]):Move {
            let obj:Move = {
                x         : arr[0],
                y         : arr[1],
                timedelta : arr.length > 2 ? arr[2] : -1,
                color     : (arr.length > 3 ? arr[3] : 0) as JGOFNumericPlayerColor,
            };
            let extra:any = arr.length > 4 ? arr[4] : {};
            for (let k in extra) {
                (obj as any)[k] = extra[k];
            }
            return obj;
        }

        if (move_obj instanceof Array) {
            if (move_obj.length === 0) {
                return [];
            }
            if (typeof(move_obj[0]) === "number") {
                ret.push(decodeSingleMoveArray(move_obj as [number, number, number, number]));
            }
            else {
                if (typeof(move_obj[0]) === 'object' && 'x' in move_obj[0] && typeof(move_obj[0].x) === "number") {
                    return move_obj as Array<JGOFMove>;
                }

                for (let i = 0; i < move_obj.length; ++i) {
                    let mv:any = move_obj[i];
                    if (mv instanceof Array && typeof(mv[0]) === "number") {
                        ret.push(decodeSingleMoveArray(mv as [number, number, number, number]));
                    }
                    else {
                        console.error("mv: ", mv);
                        throw new Error(`Unrecognized move format: ${mv}`);
                    }
                }
            }
        }
        else if (typeof(move_obj) === "string") {
            if (!height || !width) {
                throw new Error(`decodeMoves requires a height and width to be set when decoding a string coordinate`);
            }

            if (/[a-zA-Z][0-9]/.test(move_obj)) {
                /* coordinate form, used from human input. */
                let move_string = move_obj;

                let moves = move_string.split(/([a-zA-Z][0-9]+|pass|[.][.])/);
                for (let i = 0; i < moves.length; ++i) {
                    if (i % 2) { /* even are the 'splits', which should always be blank unless there is an error */
                        let x = GoMath.pretty_char2num(moves[i][0]);
                        let y = height - parseInt(moves[i].substring(1));
                        if ((width && x >= width) || x < 0) {
                            x = y = -1;
                        }
                        if ((height && y >= height) || y < 0) {
                            x = y = -1;
                        }
                        ret.push({"x": x, "y": y, "edited": false, "color": 0});
                    } else {
                        if (moves[i] !== "") {
                            throw "Unparsed move input: " + moves[i];
                        }
                    }
                }
            } else {
                /* Pure letter encoded form, used for all records */
                let move_string = move_obj;

                for (let i = 0; i < move_string.length - 1; i += 2) {
                    let edited = false;
                    let color:JGOFNumericPlayerColor = 0;
                    if (move_string[i + 0] === "!") {
                        edited = true;
                        if (move_string.substr(i, 10) === '!undefined') { /* bad data */
                            color = 0;
                            i += 10;
                        } else {
                            color = parseInt(move_string[i + 1]) as JGOFNumericPlayerColor;
                            i += 2;
                        }
                    }


                    let x = GoMath.char2num(move_string[i]);
                    let y = GoMath.char2num(move_string[i + 1]);
                    if (width && x >= width) {
                        x = y = -1;
                    }
                    if (height && y >= height) {
                        x = y = -1;
                    }
                    ret.push({"x": x, "y": y, "edited": edited, "color": color});
                }
            }
        }
        else if (typeof(move_obj) === 'object' && 'x' in move_obj && typeof(move_obj.x) === "number") {
            return [move_obj] as Array<JGOFMove>;
        }
        else {
            throw new Error("Invalid move format: " + JSON.stringify(move_obj));
        }

        return ret;
    }
    private static char2num(ch:string):number {
        if (ch === ".") { return -1; }
        return "abcdefghijklmnopqrstuvwxyz".indexOf(ch);
    }
    private static pretty_char2num(ch:string):number {
        if (ch === ".") { return -1; }
        return "abcdefghjklmnopqrstuvwxyz".indexOf(ch.toLowerCase());
    }
    public static num2char(num:number):string {
        if (num === -1) { return "."; }
        return "abcdefghijklmnopqrstuvwxyz"[num];
    }
    public static encodeMove(x:number | Move, y?:number):string {
        if (typeof(x) === "number") {
            if (typeof(y) !== "number") {
                throw new Error(`Invalid y parameter to encodeMove y = ${y}`);
            }
            return GoMath.num2char(x) + GoMath.num2char(y);
        } else {
            let mv:Move = x;

            if (!mv.edited) {
                return GoMath.num2char(mv.x) + GoMath.num2char(mv.y);
            } else {
                return "!" + mv.color + GoMath.num2char(mv.x) + GoMath.num2char(mv.y);
            }
        }
    }
    public static encodePrettyCoord(coord: string, height: number) { // "C12" with no "I"
        const x = GoMath.num2char(GoMath.pretty_char2num(coord.charAt(0).toLowerCase()));
        const y = GoMath.num2char(height - parseInt(coord.substring(1)));
        return x + y;
    }
    public static encodeMoves(lst:Array<Move>):string {
        let ret = "";
        for (let i = 0; i < lst.length; ++i) {
            ret += GoMath.encodeMove(lst[i]);
        }
        return ret;
    }
    public static encodeMoveToArray(mv:Move):AdHocPackedMove {
        let extra:any = {};
        if (mv.blur) {
            extra.blur = mv.blur;
        }
        if (mv.sgf_downloaded_by) {
            extra.sgf_downloaded_by = mv.sgf_downloaded_by;
        }
        if (mv.played_by) {
            extra.played_by = mv.played_by;
        }
        if (mv.player_update) {
            extra.player_update = mv.player_update;
        }

        // don't add an extra if there is nothing extra...
        if (Object.keys(extra).length === 0) {
            extra = undefined;
        }

        let arr:AdHocPackedMove = [mv.x, mv.y, mv.timedelta ? mv.timedelta : -1, undefined, extra];
        if (mv.edited) {
            arr[3] = mv.color;
            if (!extra) {
                arr.pop();
            }
        } else {
            if (!extra) {
                arr.pop(); // extra
                arr.pop(); // edited
            }
        }
        return arr;
    }
    public static encodeMovesToArray(moves:Array<Move>):Array<AdHocPackedMove> {
        let ret:Array<AdHocPackedMove> = [];
        for (let i = 0; i < moves.length; ++i) {
            ret.push(GoMath.encodeMoveToArray(moves[i]));
        }
        return ret;
    }

    /**
     * Removes superfluous fields from the JGOFMove objects, such as
     * edited=false and color=0. This does not modify the original array.
     */
    public static trimJGOFMoves(arr:Array<JGOFMove>):Array<JGOFMove> {
        return arr.map(o => {
            let r:JGOFMove = {
                x: o.x,
                y: o.y,
            };
            if (o.edited) {
                r.edited = o.edited;
            }
            if (o.color) {
                r.color = o.color;
            }
            if (o.timedelta) {
                r.timedelta = o.timedelta;
            }
            return r;
        });
    }


    /** Returns a sorted move string, this is used in our stone removal logic */
    public static sortMoves(move_string:string, width:number, height:number):string {
        let moves = GoMath.decodeMoves(move_string, width, height);
        moves.sort((a, b) => {
            let av = (a.edited ? 1 : 0) * 10000 + a.x + a.y * 100;
            let bv = (b.edited ? 1 : 0) * 10000 + b.x + b.y * 100;
            return av - bv;
        });
        return GoMath.encodeMoves(moves);
    }
}
