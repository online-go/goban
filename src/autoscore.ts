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

/**
 * The autoscore function takes an existing board state, two ownership
 * matrices, and does it's best to determine which stones should be
 * removed, which intersections should be considered dame, and what
 * should be left alone.
 */

import { GoStoneGroups } from "./GoStoneGroups";
import { JGOFNumericPlayerColor } from "./JGOF";
import { makeMatrix, num2char } from "./GoMath";
import * as clc from "cli-color";

interface AutoscoreResults {
    result: JGOFNumericPlayerColor[][];
    removed_string: string;
    removed: [number, number, /* reason */ string][];
}

const REMOVAL_THRESHOLD = 0.7;
const WHITE_THRESHOLD = -REMOVAL_THRESHOLD;
const BLACK_THRESHOLD = REMOVAL_THRESHOLD;

function isWhite(ownership: number): boolean {
    return ownership <= WHITE_THRESHOLD;
}

function isBlack(ownership: number): boolean {
    return ownership >= BLACK_THRESHOLD;
}

function isDameOrUnknown(ownership: number): boolean {
    return ownership > WHITE_THRESHOLD && ownership < BLACK_THRESHOLD;
}

type DebugOutput = string;

let debug_output = "";
function debug(...args: any[]) {
    debug_output += args.join(" ") + "\n";
}
function reset_debug_output() {
    debug_output = "";
}

export function autoscore(
    board: JGOFNumericPlayerColor[][],
    black_plays_first_ownership: number[][],
    white_plays_first_ownership: number[][],
): [AutoscoreResults, DebugOutput] {
    const original_board = board.map((row) => row.slice()); // copy
    const width = board[0].length;
    const height = board.length;
    const removed: [number, number, string][] = [];
    const removal = makeMatrix(width, height);
    const is_settled = makeMatrix(width, height);
    const settled = makeMatrix(width, height);
    const final_ownership = makeMatrix(board[0].length, board.length);

    const average_ownership = makeMatrix(width, height);
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            average_ownership[y][x] =
                (black_plays_first_ownership[y][x] + white_plays_first_ownership[y][x]) / 2;
        }
    }

    reset_debug_output();
    debug("Initial board:");
    debug_board_output(board);

    debug("Ownership if black moves first:");
    debug_ownership_output(black_plays_first_ownership);

    debug("Ownership if white moves first:");
    debug_ownership_output(white_plays_first_ownership);

    settle_agreed_upon_territory();
    remove_obviously_dead_stones();
    mark_settled_positions();
    clear_unsettled_stones_from_territory();
    seal_territory();
    compute_final_ownership();
    final_dame_pass();

    /** Marks a position as being removed (either dead stone or dame) */
    function remove(x: number, y: number, reason: string) {
        if (removal[y][x]) {
            return;
        }

        removed.push([x, y, reason]);
        board[y][x] = JGOFNumericPlayerColor.EMPTY;
        removal[y][x] = 1;
    }

    /*
     * Settle agreed-upon territory
     *
     * The purpose of this function is to ignore potential invasions
     * by looking at the average territory ownership. If overall the
     * territory is owned by one player, then we mark it as settled along
     * with adjacent groups.
     */
    function settle_agreed_upon_territory() {
        debug("### Settling agreed upon territory");

        const groups = new GoStoneGroups({
            width,
            height,
            board,
            removal: makeMatrix(width, height),
        });

        debug_groups(groups);

        groups.foreachGroup((group) => {
            const color = group.territory_color;
            if (group.is_territory && color) {
                let total_ownership = 0;

                group.foreachStone((point) => {
                    const x = point.x;
                    const y = point.y;
                    total_ownership += average_ownership[y][x];
                });

                const avg = total_ownership / group.points.length;

                if (
                    (color === JGOFNumericPlayerColor.BLACK && avg > BLACK_THRESHOLD) ||
                    (color === JGOFNumericPlayerColor.WHITE && avg < WHITE_THRESHOLD)
                ) {
                    group.foreachStone((point) => {
                        const x = point.x;
                        const y = point.y;
                        is_settled[y][x] = 1;
                        settled[y][x] = color;
                    });
                    group.neighbors.forEach((neighbor) => {
                        neighbor.foreachStone((point) => {
                            const x = point.x;
                            const y = point.y;
                            is_settled[y][x] = 1;
                            settled[y][x] = color;
                        });
                    });
                }
            }
        });
    }

    /*
     * Remove obviously dead stones
     *
     * If we estimate that if either player moves first, yet a stone
     * is dead, then we say the players agree - the stone is dead. This
     * function detects these cases and removes the stones.
     */
    function remove_obviously_dead_stones() {
        debug("### Removing stones both agree on:");
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                if (
                    board[y][x] === JGOFNumericPlayerColor.WHITE &&
                    isBlack(black_plays_first_ownership[y][x]) &&
                    isBlack(white_plays_first_ownership[y][x])
                ) {
                    remove(x, y, "both players agree this is captured by black");
                }

                if (
                    board[y][x] === JGOFNumericPlayerColor.BLACK &&
                    isWhite(black_plays_first_ownership[y][x]) &&
                    isWhite(white_plays_first_ownership[y][x])
                ) {
                    remove(x, y, "both players agree this is captured by white");
                }

                if (
                    board[y][x] === JGOFNumericPlayerColor.EMPTY &&
                    isDameOrUnknown(black_plays_first_ownership[y][x]) &&
                    isDameOrUnknown(white_plays_first_ownership[y][x])
                ) {
                    remove(x, y, "both players agree this is dame");
                }
            }
        }
    }

    /*
     * Mark settled intersections as settled
     *
     * If both players agree on the ownership of an intersection, then
     * mark it as settled for that player.
     */
    function mark_settled_positions() {
        debug("### Marking settled positions");
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                if (
                    isWhite(black_plays_first_ownership[y][x]) &&
                    isWhite(white_plays_first_ownership[y][x])
                ) {
                    is_settled[y][x] = 1;
                    settled[y][x] = JGOFNumericPlayerColor.WHITE;
                }

                if (
                    isBlack(black_plays_first_ownership[y][x]) &&
                    isBlack(white_plays_first_ownership[y][x])
                ) {
                    is_settled[y][x] = 1;
                    settled[y][x] = JGOFNumericPlayerColor.BLACK;
                }

                if (
                    isDameOrUnknown(black_plays_first_ownership[y][x]) &&
                    isDameOrUnknown(white_plays_first_ownership[y][x])
                ) {
                    is_settled[y][x] = 1;
                    settled[y][x] = JGOFNumericPlayerColor.EMPTY;
                    remove(x, y, "both players agree this is dame");
                }
            }
        }

        debug_print_settled(is_settled);
        debug_board_output(board);
    }

    /*
     * Consider unsettled groups (as defined by looking at connected
     * intersections that are not settled, regardless of whether they have a
     * stone on them or not).
     *
     * Pick an owner for this area based first on the average ownership
     * of the area. If the average ownership exceeds our threshold, then
     * we assume that the area is owned by the player. Otherwise, if the
     * owner isn't clear according to our ownership estimations, then we
     * go by the majority of the surrounding and contained stones - the
     * one with the most stones wins.
     *
     * If we've determined a color for the area, then we remove any stones
     * that are not of that color in the unsettled area.
     *
     * After this, we mark the area as settled.
     */
    function clear_unsettled_stones_from_territory() {
        /*
         * Consider unsettled groups. Count the unsettled stones along with
         * their neighboring stones
         */
        const groups = new GoStoneGroups({
            width,
            height,
            board: is_settled,
            removal: makeMatrix(width, height),
        });

        groups.foreachGroup((group) => {
            // if this group is a settled group, ignore it, we don't care about those
            const pt = group.points[0];
            if (is_settled[pt.y][pt.x]) {
                return;
            }

            // Otherwise, count
            const surrounding = [
                0, // empty
                0, // black
                0, // white
            ];
            const contained = [
                0, // empty
                0, // black
                0, // white
            ];
            let total_ownership_estimate = 0;

            const already_tallied = makeMatrix(width, height);
            function tally_edge(x: number, y: number) {
                if (x < 0 || x >= width || y < 0 || y >= height) {
                    return;
                }
                if (already_tallied[y][x]) {
                    return;
                }
                if (is_settled[y][x]) {
                    surrounding[settled[y][x]]++;
                    already_tallied[y][x] = 1;
                }
            }

            group.foreachStone((point) => {
                const x = point.x;
                const y = point.y;
                contained[board[y][x]]++;
                tally_edge(x - 1, y);
                tally_edge(x + 1, y);
                tally_edge(x, y - 1);
                tally_edge(x, y + 1);

                total_ownership_estimate +=
                    black_plays_first_ownership[y][x] + white_plays_first_ownership[y][x];
            });

            const average_color_estimate = total_ownership_estimate / group.points.length;

            let color_judgement: JGOFNumericPlayerColor;

            const total = [
                surrounding[0] + contained[0],
                surrounding[1] + contained[1],
                surrounding[2] + contained[2],
            ];
            if (average_color_estimate > 0.5) {
                color_judgement = JGOFNumericPlayerColor.BLACK;
            } else if (total_ownership_estimate < -0.5) {
                color_judgement = JGOFNumericPlayerColor.WHITE;
            } else {
                if (total[JGOFNumericPlayerColor.BLACK] > total[JGOFNumericPlayerColor.WHITE]) {
                    color_judgement = JGOFNumericPlayerColor.BLACK;
                } else if (
                    total[JGOFNumericPlayerColor.WHITE] > total[JGOFNumericPlayerColor.BLACK]
                ) {
                    color_judgement = JGOFNumericPlayerColor.WHITE;
                } else {
                    color_judgement = JGOFNumericPlayerColor.EMPTY;
                }
            }

            group.foreachStone((point) => {
                const x = point.x;
                const y = point.y;
                if (board[y][x] && board[y][x] !== color_judgement) {
                    remove(x, y, "clearing unsettled stones within assumed territory");
                    is_settled[y][x] = 1;
                    settled[y][x] = color_judgement;
                }
            });

            debug(
                "Group: ",
                group.id,
                "contained",
                contained,
                "surrounding",
                surrounding,
                " total ownership estimate",
                total_ownership_estimate,
                " average color estimate",
                average_color_estimate,
                " color judgement",
                color_judgement === JGOFNumericPlayerColor.BLACK
                    ? "black"
                    : color_judgement === JGOFNumericPlayerColor.WHITE
                      ? "white"
                      : "empty",
            );
        });
    }

    /*
     * Attempt to seal territory
     *
     * This function attempts to seal territory that has been overlooked
     * by the players.
     *
     * We do this by looking at unowned territory that has been settled
     * by the players as either dame or owned by one player. If the
     * intersection is owned by one player but immediately adjacent to
     * an intersection owned by the other player, then we mark it as
     * dame to (help) seal the territory.
     *
     * Note, this needs to be run after obviously dead stones have been
     * removed.
     */

    function seal_territory() {
        debug(`### Sealing territory`);
        //const dame_map = makeMatrix(width, height);
        {
            let groups = new GoStoneGroups(
                {
                    width,
                    height,
                    board,
                    removal,
                },
                original_board,
            );

            debug("Initial groups:");
            debug_groups(groups);

            groups.foreachGroup((group) => {
                // unowned territory
                if (group.color === JGOFNumericPlayerColor.EMPTY && !group.is_territory) {
                    group.foreachStone((point) => {
                        const x = point.x;
                        const y = point.y;

                        // If we have an intersection we believe is owned by a player, but it is also
                        // adjacent to another the other players stone, mark it as dame
                        if (is_settled[y][x] && settled[y][x] !== JGOFNumericPlayerColor.EMPTY) {
                            const opposing_color =
                                settled[y][x] === JGOFNumericPlayerColor.BLACK
                                    ? JGOFNumericPlayerColor.WHITE
                                    : JGOFNumericPlayerColor.BLACK;
                            const adjacent_to_opposing_color =
                                board[y + 1]?.[x] === opposing_color ||
                                board[y - 1]?.[x] === opposing_color ||
                                board[y][x + 1] === opposing_color ||
                                board[y][x - 1] === opposing_color;

                            if (adjacent_to_opposing_color) {
                                remove(x, y, "sealing territory");
                                is_settled[y][x] = 1;
                                settled[y][x] = JGOFNumericPlayerColor.EMPTY;
                            }
                        }
                    });
                }
            });

            groups = new GoStoneGroups(
                {
                    width: board[0].length,
                    height: board.length,
                    board,
                    removal,
                },
                original_board,
            );
            debug("Sealed groups:");
            debug_groups(groups);

            debug("Settle sealed groups");
            groups.foreachGroup((group) => {
                if (group.is_territory || group.color !== JGOFNumericPlayerColor.EMPTY) {
                    group.foreachStone((point) => {
                        is_settled[point.y][point.x] = 1;
                        settled[point.y][point.x] = group.color;
                    });
                }
            });
        }
    }

    function compute_final_ownership() {
        for (let y = 0; y < board.length; ++y) {
            for (let x = 0; x < board[y].length; ++x) {
                if (is_settled[y][x]) {
                    //final_ownership[y][x] = board[y][x];
                    final_ownership[y][x] = settled[y][x];
                } else {
                    if (
                        isBlack(black_plays_first_ownership[y][x]) &&
                        isBlack(white_plays_first_ownership[y][x])
                    ) {
                        final_ownership[y][x] = JGOFNumericPlayerColor.BLACK;
                    } else if (
                        isWhite(black_plays_first_ownership[y][x]) &&
                        isWhite(white_plays_first_ownership[y][x])
                    ) {
                        final_ownership[y][x] = JGOFNumericPlayerColor.WHITE;
                    } else {
                        final_ownership[y][x] = JGOFNumericPlayerColor.EMPTY;
                    }
                }
            }
        }

        // fill in territory for final ownership
        {
            const groups = new GoStoneGroups(
                {
                    width,
                    height,
                    board,
                    removal,
                },
                original_board,
            );
            groups.foreachGroup((group) => {
                if (
                    group.color === JGOFNumericPlayerColor.EMPTY &&
                    group.is_territory &&
                    group.territory_color

                    //&& !group.is_territory_in_seki
                ) {
                    group.foreachStone((point) => {
                        if (is_settled[point.y][point.x]) {
                            final_ownership[point.y][point.x] = group.territory_color;
                        }
                    });
                }
            });

            debug("Final ownership:");
            debug_board_output(final_ownership);
        }
    }

    function final_dame_pass() {
        for (let y = 0; y < final_ownership.length; ++y) {
            for (let x = 0; x < final_ownership[y].length; ++x) {
                if (final_ownership[y][x] === JGOFNumericPlayerColor.EMPTY) {
                    remove(x, y, "final dame");
                }
            }
        }
    }

    return [
        {
            result: final_ownership,
            removed_string: removed.map((pt) => `${num2char(pt[0])}${num2char(pt[1])}`).join(""),
            removed,
        },
        debug_output,
    ];
}

function debug_ownership_output(ownership: number[][]) {
    let out = "\n   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < ownership[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < ownership.length; ++y) {
        out += ` ${ownership.length - y} `.substr(-3);
        for (let x = 0; x < ownership[y].length; ++x) {
            //out += ` ${("    " + ownership[y][x].toFixed(1)).substr(-4)} `;
            out += colorizeOwnership(ownership[y][x]);
        }
        out += " " + ` ${ownership.length - y} `.substr(-3);
        out += "\n";
    }

    out += "   ";
    for (let x = 0; x < ownership[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    out += "\n";

    debug(out);
}

function colorizeOwnership(ownership: number): string {
    const mag = Math.round(Math.abs(ownership * 10));
    let mag_str = "";
    if (mag > 9) {
        mag_str = ownership > 0 ? "B" : "W";
    } else {
        mag_str = mag.toString();
    }

    if (mag < 7) {
        if (ownership > 0) {
            return clc.blue(mag_str);
        } else {
            return clc.cyan.bold(mag_str);
        }
    }
    if (ownership > 0) {
        return clc.black.bold(mag_str);
    } else {
        return clc.white.bold(mag_str);
    }
}

function debug_board_output(board: JGOFNumericPlayerColor[][]) {
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            let c = "";
            if (board[y][x] === 0) {
                c = ".";
            } else if (board[y][x] === 1) {
                c = "B";
            } else if (board[y][x] === 2) {
                c = "W";
            } else {
                c = "?";
            }
            out += colorizeIntersection(c);
        }

        out += " " + ` ${board.length - y} `.substr(-3);
        out += "\n";
    }

    out += "   ";
    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    out += "\n";
    debug(out);
}

function colorizeIntersection(c: string): string {
    if (c === "B" || c === "s") {
        return clc.black(c);
    } else if (c === "W") {
        return clc.white.bold(c);
    } else if (c === "?") {
        return clc.red(c);
    } else if (c === ".") {
        return clc.blue(c);
    } else if (c === " " || c === "_") {
        return clc.blue("_");
    }
    return clc.yellow(c);
}

function debug_print_settled(board: number[][]) {
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            out += colorizeIntersection(board[y][x] ? "s" : " ");
        }

        out += " " + ` ${board.length - y} `.substr(-3);
        out += "\n";
    }

    out += "   ";
    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    out += "\n";
    debug(out);
}

function debug_groups(groups: GoStoneGroups) {
    const group_map: string[][] = makeMatrix(
        groups.group_id_map[0].length,
        groups.group_id_map.length,
    ) as any;
    const symbols = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let group_idx = 0;

    groups.foreachGroup((group) => {
        let group_color = clc.red;

        if (group.color === JGOFNumericPlayerColor.EMPTY) {
            if (group.is_territory_in_seki) {
                group_color = clc.yellow;
            } else if (group.is_territory) {
                if (group.territory_color) {
                    group_color =
                        group.territory_color === JGOFNumericPlayerColor.BLACK
                            ? clc.black
                            : clc.white;
                } else {
                    group_color = clc.blue;
                }
            } else {
                group_color = clc.magenta;
            }
        } else if (group.color === JGOFNumericPlayerColor.BLACK) {
            group_color = clc.black;
        } else if (group.color === JGOFNumericPlayerColor.WHITE) {
            group_color = clc.white;
        } else {
            group_color = clc.red;
        }

        const symbol = symbols[group_idx % symbols.length];

        group.foreachStone((point) => {
            group_map[point.y][point.x] = group_color(symbol);
        });
        group_idx++;
    });

    debug("Group map:");
    debug("Legend: ");
    debug("  " + clc.black("Black") + " ");
    debug("  " + clc.white("White") + " ");
    debug("  " + clc.blue("Dame") + " ");
    debug("  " + clc.yellow("Territory in Seki") + " ");
    debug("  " + clc.magenta("Undecided territory") + " ");
    debug("  " + clc.red("Error") + " ");

    debug_group_map(group_map);
}

function debug_group_map(board: string[][]) {
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            out += board[y][x];
        }

        out += " " + ` ${board.length - y} `.substr(-3);
        out += "\n";
    }

    out += "   ";
    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    out += "\n";
    debug(out);
}
