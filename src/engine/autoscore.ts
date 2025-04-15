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

import { StoneStringBuilder } from "./StoneStringBuilder";
import { JGOFNumericPlayerColor, JGOFSealingIntersection, JGOFMove } from "./formats/JGOF";
import { char2num, makeMatrix, num2char, encodePrettyXCoordinate } from "./util";
import { GobanEngine, GobanEngineInitialState, GobanEngineRules } from "./GobanEngine";
import { BoardState } from "./BoardState";

interface AutoscoreResults {
    result: JGOFNumericPlayerColor[][];
    sealed_result: JGOFNumericPlayerColor[][];
    removed: JGOFMove[];
    needs_sealing: JGOFSealingIntersection[];
}

const REMOVAL_THRESHOLD = 0.7;
const SEAL_THRESHOLD = 0.3;
const WHITE_THRESHOLD = -REMOVAL_THRESHOLD;
const BLACK_THRESHOLD = REMOVAL_THRESHOLD;
const WHITE_SEAL_THRESHOLD = -SEAL_THRESHOLD;
const BLACK_SEAL_THRESHOLD = SEAL_THRESHOLD;

function isWhite(ownership: number): boolean {
    return ownership <= WHITE_THRESHOLD;
}

function isBlack(ownership: number): boolean {
    return ownership >= BLACK_THRESHOLD;
}

export function autoscore(
    board: JGOFNumericPlayerColor[][],
    rules: GobanEngineRules,
    black_plays_first_ownership: number[][],
    white_plays_first_ownership: number[][],
): [AutoscoreResults, DebugOutput] {
    const original_board = board.map((row) => row.slice()); // copy
    const width = board[0].length;
    const height = board.length;
    const removed: JGOFMove[] = [];
    const removal = makeMatrix(width, height, false);
    const is_settled = makeMatrix(width, height, 0);
    const settled = makeMatrix(width, height, 0);
    const final_ownership = makeMatrix(board[0].length, board.length, 0);
    const final_sealed_ownership = makeMatrix(board[0].length, board.length, 0);
    const sealed = makeMatrix(width, height, 0);
    const needs_sealing: JGOFSealingIntersection[] = [];

    const average_ownership = makeMatrix(width, height, 0);
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            average_ownership[y][x] =
                (black_plays_first_ownership[y][x] + white_plays_first_ownership[y][x]) / 2;
        }
    }

    // Print out our starting state
    stage("Initial state");
    debug_board_output("Board", board);
    debug_ownership_output("Black plays first estimates", black_plays_first_ownership);
    debug_ownership_output("White plays first estimates", white_plays_first_ownership);
    debug_ownership_output("Average estimates", average_ownership);

    const groups = new StoneStringBuilder(
        new BoardState({
            board,
            removal: makeMatrix(width, height, false),
        }),
    );

    debug_groups("Groups", groups);

    // Perform our removal logic
    //normalize_ownership();
    settle_snapback_locations();
    settle_agreed_upon_stones();
    settle_agreed_upon_territory();
    remove_obviously_dead_stones();
    settle_groups_that_have_significant_of_territory();
    clear_unsettled_stones_from_territory();
    seal_territory();
    score_positions();

    stage("Final state");
    const final_ownership_with_seals = makeMatrix(width, height, ".");
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            if (sealed[y][x]) {
                final_ownership_with_seals[y][x] = "s";
            } else {
                final_ownership_with_seals[y][x] =
                    final_ownership[y][x] === 1 ? "B" : final_ownership[y][x] === 2 ? "W" : ".";
            }
        }
    }

    //debug_board_output("Final ownership", final_ownership);
    debug_board_string_output("Final ownership", final_ownership_with_seals);
    debug_boolean_board("Sealed", sealed, "s");
    debug_board_output("Final sealed ownership", final_sealed_ownership);

    return [
        {
            result: final_ownership,
            sealed_result: final_sealed_ownership,
            removed,
            needs_sealing,
        },
        finalize_debug_output(),
    ];

    /** Marks a position as being removed (either dead stone or dame) */
    function remove(x: number, y: number, removal_reason: string) {
        if (removal[y][x]) {
            return;
        }

        removed.push({ x, y, removal_reason });
        board[y][x] = JGOFNumericPlayerColor.EMPTY;
        removal[y][x] = true;
        stage_log(`Removing ${encodePrettyXCoordinate(x)}${height - y}: ${removal_reason}`);
    }

    /**
     * Normalizes the string ownerships, this prevents single stones out of a group being marked
     * as captured when there are snapback situation still left on the board.
     */
    /*
    function normalize_ownership() {
        stage("Ownership normalization");

        const stone_strings = new StoneStringBuilder(
            new BoardState({
                board,
                removal,
            }),
            original_board,
        );

        stone_strings.foreachGroup((stone_string) => {
            let black = 0;
            let white = 0;
            let avg = 0;
            stone_string.intersections.forEach((point) => {
                const { x, y } = point;
                black += black_plays_first_ownership[y][x];
                white += white_plays_first_ownership[y][x];
                avg += average_ownership[y][x];
            });
            black /= stone_string.intersections.length;
            white /= stone_string.intersections.length;
            avg /= stone_string.intersections.length;
            stone_string.intersections.forEach((point) => {
                const { x, y } = point;
                black_plays_first_ownership[y][x] = black;
                white_plays_first_ownership[y][x] = white;
                average_ownership[y][x] = avg;
            });
        });

        debug_board_output("Board", board);
        debug_ownership_output("Black plays first estimates", black_plays_first_ownership);
        debug_ownership_output("White plays first estimates", white_plays_first_ownership);
        debug_ownership_output("Average estimates", average_ownership);
    }
    */

    /**
     * Look for groups that look like they are at risk of a snapback and
     * mark them as settled to avoid trying to be too smart, let the players
     * figure out what they want to with those stones, if anything. Neighboring
     * strings are also marked as settled as any that aren't are likely intwined
     * in the life and death and resulting status of the snapback, so again to
     * avoid trying to be too smart, just trust that the players intended to
     * end the game in this state and score it.
     */
    function settle_snapback_locations() {
        stage("Settling snapbacks");

        const snapbacks = makeMatrix(width, height, false);
        const neighbors_of_snapbacks = makeMatrix(width, height, false);

        const stone_strings = new StoneStringBuilder(
            new BoardState({
                board,
                removal,
            }),
            original_board,
        );
        stone_strings.foreachGroup((stone_string) => {
            if (stone_string.color === JGOFNumericPlayerColor.EMPTY) {
                return;
            }

            let looks_like_snapback =
                stone_string.intersections.some(({ x, y }) =>
                    isBlack(black_plays_first_ownership[y][x]),
                ) &&
                stone_string.intersections.some(({ x, y }) =>
                    isWhite(black_plays_first_ownership[y][x]),
                );
            looks_like_snapback ||=
                stone_string.intersections.some(({ x, y }) =>
                    isBlack(white_plays_first_ownership[y][x]),
                ) &&
                stone_string.intersections.some(({ x, y }) =>
                    isWhite(white_plays_first_ownership[y][x]),
                );
            looks_like_snapback ||=
                stone_string.intersections.some(({ x, y }) => isBlack(average_ownership[y][x])) &&
                stone_string.intersections.some(({ x, y }) => isWhite(average_ownership[y][x]));

            if (looks_like_snapback) {
                const color = stone_string.color;
                stone_string.intersections.forEach(({ x, y }) => {
                    is_settled[y][x] = 1;
                    settled[y][x] = color;
                    snapbacks[y][x] = true;
                });

                // settle our neighbors as well as they are likely part of the snapback
                stone_string.foreachNeighboringStoneString((neighbor) => {
                    const color = neighbor.color;
                    neighbor.intersections.forEach(({ x, y }) => {
                        is_settled[y][x] = 1;
                        settled[y][x] = color;

                        neighbors_of_snapbacks[y][x] = true;
                    });
                });
            }
        });

        debug_boolean_board("Snapbacks", snapbacks, "s");
        debug_boolean_board("Neighbors of snapbacks", neighbors_of_snapbacks, "n");
        debug_boolean_board("Settled", is_settled);
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
        stage("Settling agreed upon territory");

        const groups = new StoneStringBuilder(
            new BoardState({
                board,
                removal,
            }),
            original_board,
        );

        debug_groups("Initial", groups);

        groups.foreachGroup((group) => {
            const color = group.territory_color;
            if (group.is_territory && color) {
                let total_ownership = 0;

                group.map((point) => {
                    const x = point.x;
                    const y = point.y;
                    total_ownership += average_ownership[y][x];
                });

                const avg = total_ownership / group.intersections.length;

                if (
                    (color === JGOFNumericPlayerColor.BLACK && avg > BLACK_THRESHOLD) ||
                    (color === JGOFNumericPlayerColor.WHITE && avg < WHITE_THRESHOLD)
                ) {
                    group.map((point) => {
                        const x = point.x;
                        const y = point.y;
                        is_settled[y][x] = 1;
                        settled[y][x] = color;
                    });
                    group.neighbors.forEach((neighbor) => {
                        neighbor.map((point) => {
                            const x = point.x;
                            const y = point.y;
                            is_settled[y][x] = 1;
                            settled[y][x] = color;
                        });
                    });
                }
            }
        });

        debug_boolean_board("Settled", is_settled);
        debug_board_output("Settled ownership", settled);
    }

    /*
     * If both players agree on the ownership of certain stones,
     * mark them as settled.
     */
    function settle_agreed_upon_stones() {
        stage("Marking settled stones");
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                if (
                    board[y][x] === JGOFNumericPlayerColor.WHITE &&
                    isWhite(black_plays_first_ownership[y][x]) &&
                    isWhite(white_plays_first_ownership[y][x])
                ) {
                    is_settled[y][x] = 1;
                    settled[y][x] = JGOFNumericPlayerColor.WHITE;
                }

                if (
                    board[y][x] === JGOFNumericPlayerColor.BLACK &&
                    isBlack(black_plays_first_ownership[y][x]) &&
                    isBlack(white_plays_first_ownership[y][x])
                ) {
                    is_settled[y][x] = 1;
                    settled[y][x] = JGOFNumericPlayerColor.BLACK;
                }
            }
        }

        debug_boolean_board("Settled", is_settled);
        debug_board_output("Resulting board", board);
    }

    /*
     * Remove obviously dead stones
     *
     * If we estimate that if either player moves first, yet a stone
     * is dead, then we say the players agree - the stone is dead. This
     * function detects these cases and removes the stones.
     */
    function remove_obviously_dead_stones() {
        stage("Removing stones both estimates agree upon");
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                if (is_settled[y][x]) {
                    continue;
                }
                if (
                    board[y][x] === JGOFNumericPlayerColor.WHITE &&
                    isBlack(black_plays_first_ownership[y][x]) &&
                    isBlack(white_plays_first_ownership[y][x])
                ) {
                    remove(x, y, "both players agree this is captured by black");
                } else if (
                    board[y][x] === JGOFNumericPlayerColor.BLACK &&
                    isWhite(black_plays_first_ownership[y][x]) &&
                    isWhite(white_plays_first_ownership[y][x])
                ) {
                    remove(x, y, "both players agree this is captured by white");
                }
            }
        }
        debug_boolean_board("Removed", removal, "x");
    }

    /**
     * Groups that are not definitely alive, not definitely dead, and
     * have a good amount of territory associated with them should
     * be considered settled as the players likely intended for the
     * group to be considered alive.
     */

    function settle_groups_that_have_significant_of_territory() {
        stage("Settle groups with significant amounts of territory");
        const groups = new StoneStringBuilder(
            new BoardState({
                board,
                removal,
            }),
        );
        debug_groups("Initial groups", groups);

        const new_settled = makeMatrix(width, height, false);

        groups.foreachGroup((group) => {
            if (is_settled[group.intersections[0].y][group.intersections[0].x]) {
                return;
            }

            let amount_of_territory = 0;
            let number_of_possible_eyes = 0; // could be false eyes, but we'll count them at this stage
            group.foreachNeighboringEmptyString((empty_intersections) => {
                /*
                const { x, y } = empty_intersections.intersections[0];
                stage_log(
                    `Group at ${encodePrettyXCoordinate(x)}${height - y} with color ${
                        group.color
                    } has ${
                        empty_intersections.intersections.length
                    } empty intersections and is territory = ${empty_intersections.is_territory}`,
                );
                */
                if (empty_intersections.is_territory) {
                    number_of_possible_eyes++;
                    amount_of_territory += empty_intersections.intersections.length;
                }
            });

            if (amount_of_territory > 4 || number_of_possible_eyes > 1) {
                group.map((point) => {
                    const x = point.x;
                    const y = point.y;
                    new_settled[y][x] = true;
                    is_settled[y][x] = 1;
                    settled[y][x] = group.color;
                });
            }
        });

        debug_boolean_board("Newly settled", new_settled, "s");
        debug_boolean_board("Settled", is_settled, "s");
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
        stage("Clear unsettled stones from territory");

        const stones_removed_before = removal.map((row) => row.slice());

        /*
         * Consider unsettled groups. Count the unsettled stones along with
         * their neighboring stones
         */
        const unsettled_intersection_groups = new StoneStringBuilder(
            new BoardState({
                board: is_settled,
                removal: makeMatrix(width, height, false),
            }),
        );

        debug_groups("Settlement intersection groups", unsettled_intersection_groups);

        unsettled_intersection_groups.foreachGroup((group) => {
            // if this group is a settled group, ignore it, we don't care about those
            const pt = group.intersections[0];
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
            let total_ownership_tally = 0;

            const already_tallied = makeMatrix(width, height, 0);
            let tally_ct = 0;

            /** Tallies the surrounding stones */
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

            group.map((point) => {
                const x = point.x;
                const y = point.y;
                contained[board[y][x]]++;
                tally_edge(x - 1, y);
                tally_edge(x + 1, y);
                tally_edge(x, y - 1);
                tally_edge(x, y + 1);
                total_ownership_estimate += average_ownership[y][x];
                tally_ct += 1;

                total_ownership_tally +=
                    board[y][x] === JGOFNumericPlayerColor.BLACK
                        ? 1
                        : board[y][x] === JGOFNumericPlayerColor.WHITE
                          ? -1
                          : 0;
            });

            const average_color_estimate = total_ownership_tally / tally_ct;

            let color_judgement: JGOFNumericPlayerColor;

            // We need to have a lot of empty intersections compared to the
            // stones we're considering in order for this to usually make sense
            const required_empty_intersections = 8;
            const ratio_threshold = 1.5; // if one color has 1.5 times the stones of the other

            if (contained[0] < required_empty_intersections) {
                const { x, y } = group.intersections[0];
                stage_log(
                    `${encodePrettyXCoordinate(x)}${height - y} Not enough empty intersections to judge color ${contained}`,
                );
                return;
            }

            const pretty_coord =
                encodePrettyXCoordinate(group.intersections[0].x) +
                (height - group.intersections[0].y);

            const total = [
                surrounding[0] + contained[0],
                surrounding[1] + contained[1],
                surrounding[2] + contained[2],
            ];
            if (average_color_estimate > 0.5) {
                stage_log(
                    `${pretty_coord} Average color estimate is black (${average_color_estimate})`,
                );
                color_judgement = JGOFNumericPlayerColor.BLACK;
            } else if (average_color_estimate < -0.5) {
                stage_log(
                    `${pretty_coord} Average color estimate is white (${average_color_estimate})`,
                );
                color_judgement = JGOFNumericPlayerColor.WHITE;
            } else {
                if (
                    total[JGOFNumericPlayerColor.BLACK] >
                    total[JGOFNumericPlayerColor.WHITE] * ratio_threshold
                ) {
                    color_judgement = JGOFNumericPlayerColor.BLACK;
                    stage_log(
                        `${pretty_coord} Average color estimate is black (${
                            total[JGOFNumericPlayerColor.BLACK]
                        } black stones vs ${total[JGOFNumericPlayerColor.WHITE]})`,
                    );
                } else if (
                    total[JGOFNumericPlayerColor.WHITE] >
                    total[JGOFNumericPlayerColor.BLACK] * ratio_threshold
                ) {
                    stage_log(
                        `${pretty_coord} Average color estimate is white (${
                            total[JGOFNumericPlayerColor.WHITE]
                        } white stones vs ${total[JGOFNumericPlayerColor.BLACK]})`,
                    );
                    color_judgement = JGOFNumericPlayerColor.WHITE;
                } else {
                    color_judgement = JGOFNumericPlayerColor.EMPTY;
                    stage_log(`${pretty_coord} Average color estimate is empty`);
                }
            }

            if (color_judgement !== JGOFNumericPlayerColor.EMPTY) {
                group.map((point) => {
                    const x = point.x;
                    const y = point.y;
                    if (board[y][x] && board[y][x] !== color_judgement) {
                        const stone_color =
                            board[y][x] === JGOFNumericPlayerColor.BLACK ? "black" : "white";
                        const judgement_color =
                            color_judgement === JGOFNumericPlayerColor.BLACK ? "black" : "white";

                        remove(
                            x,
                            y,
                            `clearing unsettled ${stone_color} stones within assumed ${judgement_color} territory `,
                        );
                        is_settled[y][x] = 1;
                        settled[y][x] = color_judgement;
                    }
                });
            }
        });

        const removal_diff = removal.map((row, y) =>
            row.map((v, x) => (v && !stones_removed_before[y][x] ? 1 : 0)),
        );
        debug_boolean_board("Removed", removal_diff, "x");
    }

    /*
     * Attempt to seal territory
     *
     * This function attempts to seal territory that has been overlooked
     * by the players.
     *
     * We do this by looking at unowned territory that is predominantly owned
     * by one of the players. Adjacent intersections to the opposing color are
     * marked as points needing sealing. We mark them as dame as well to facilitate
     * forced automatic scoring (e.g. bot games, moderator auto-score, correspondence
     * timeouts, etc), however when both players are present it's expected that the
     * interface will prohibit accepting the score until the players have resumed
     * and finished the game.
     *
     * Note, this needs to be run after obviously dead stones have been
     * removed.
     */

    function seal_territory() {
        stage(`Sealing territory`);
        {
            let groups = new StoneStringBuilder(
                new BoardState({
                    board,
                    removal,
                }),
                original_board,
            );

            debug_groups("Initial groups", groups);

            groups.foreachGroup((group) => {
                // Large enough unowned territory where sealing might make a difference
                if (
                    group.color === JGOFNumericPlayerColor.EMPTY &&
                    !group.is_territory &&
                    group.intersections.length > 3
                ) {
                    // If it looks like our group is probably mostly owned by a player, but
                    // there are spots that are not sealed, mark those spots as dame so our
                    // future scoring steps can do things like clearing out unwanted stones from
                    // the proposed territory, but also mark them as needing to be sealed.
                    // so the players have to resume to finish the game.
                    let total_ownership = 0;

                    group.map((point) => {
                        const x = point.x;
                        const y = point.y;
                        total_ownership += average_ownership[y][x];
                    });

                    const avg = total_ownership / group.intersections.length;

                    // If we meet our sealing threshold, seal
                    if (avg <= WHITE_SEAL_THRESHOLD || avg >= BLACK_SEAL_THRESHOLD) {
                        const color =
                            avg <= WHITE_SEAL_THRESHOLD
                                ? JGOFNumericPlayerColor.WHITE
                                : JGOFNumericPlayerColor.BLACK;

                        // For each point, if it's touching a stone of the other color, mark it
                        // as a seal point.
                        group.map((point) => {
                            const x = point.x;
                            const y = point.y;

                            const opposing_color =
                                avg <= WHITE_SEAL_THRESHOLD
                                    ? JGOFNumericPlayerColor.BLACK
                                    : JGOFNumericPlayerColor.WHITE;

                            const adjacent_to_opposing_color =
                                board[y + 1]?.[x] === opposing_color ||
                                board[y - 1]?.[x] === opposing_color ||
                                board[y][x + 1] === opposing_color ||
                                board[y][x - 1] === opposing_color;

                            if (adjacent_to_opposing_color) {
                                //remove(x, y, "sealing territory");
                                is_settled[y][x] = 1;
                                settled[y][x] = JGOFNumericPlayerColor.EMPTY;
                                sealed[y][x] = 1;
                                needs_sealing.push({ x, y, color });
                            }
                        });
                    }
                }
            });

            groups = new StoneStringBuilder(
                new BoardState({
                    board,
                    removal,
                }),
                original_board,
            );

            debug_boolean_board("Sealed positions", sealed, "s");
            debug_groups("After sealing", groups);
        }
    }

    /** Compute our final ownership and scoring positions */
    function score_positions() {
        stage("Score positions");
        let black_state = "";
        let white_state = "";

        for (let y = 0; y < original_board.length; ++y) {
            for (let x = 0; x < original_board[y].length; ++x) {
                const v = original_board[y][x];
                const c = num2char(x) + num2char(y);
                if (v === JGOFNumericPlayerColor.BLACK) {
                    black_state += c;
                } else if (v === 2) {
                    white_state += c;
                }
            }
        }

        const sealed_black_state =
            black_state +
            needs_sealing
                .filter((s) => s.color === JGOFNumericPlayerColor.BLACK)
                .map((p) => num2char(p.x) + num2char(p.y))
                .join("");
        const sealed_white_state =
            white_state +
            needs_sealing
                .filter((s) => s.color === JGOFNumericPlayerColor.WHITE)
                .map((p) => num2char(p.x) + num2char(p.y))
                .join("");

        const real_initial_state: GobanEngineInitialState = {
            black: black_state,
            white: white_state,
        };
        const sealed_initial_state: GobanEngineInitialState = {
            black: sealed_black_state,
            white: sealed_white_state,
        };

        for (const initial_state of [sealed_initial_state, real_initial_state]) {
            const cur_ownership = makeMatrix(width, height, 0);

            const engine = new GobanEngine({
                width: original_board[0].length,
                height: original_board.length,
                initial_state,
                rules,
                removed,
            });

            const board = engine.board.map((row) => row.slice());
            removed.map((pt) => (board[pt.y][pt.x] = 0));

            const score = engine.computeScore();
            const scoring_positions = makeMatrix(width, height, 0);

            for (let i = 0; i < score.black.scoring_positions.length; i += 2) {
                const x = char2num(score.black.scoring_positions[i]);
                const y = char2num(score.black.scoring_positions[i + 1]);
                cur_ownership[y][x] = JGOFNumericPlayerColor.BLACK;
                scoring_positions[y][x] = JGOFNumericPlayerColor.BLACK;
            }
            for (let i = 0; i < score.white.scoring_positions.length; i += 2) {
                const x = char2num(score.white.scoring_positions[i]);
                const y = char2num(score.white.scoring_positions[i + 1]);
                cur_ownership[y][x] = JGOFNumericPlayerColor.WHITE;
                scoring_positions[y][x] = JGOFNumericPlayerColor.WHITE;
            }

            for (let y = 0; y < board.length; ++y) {
                for (let x = 0; x < board[y].length; ++x) {
                    if (board[y][x] !== JGOFNumericPlayerColor.EMPTY) {
                        cur_ownership[y][x] = board[y][x];
                    }
                }
            }

            const groups = new StoneStringBuilder(
                new BoardState({
                    board,
                    removal,
                }),
                engine.board,
            );

            if (initial_state === real_initial_state) {
                substage("Unsealed");
                for (let y = 0; y < cur_ownership.length; ++y) {
                    final_ownership[y] = cur_ownership[y].slice();
                }
            } else {
                substage("Sealed");
                for (let y = 0; y < cur_ownership.length; ++y) {
                    final_sealed_ownership[y] = cur_ownership[y].slice();
                }
            }

            debug_groups("groups", groups);
            debug_board_output(`Scoring positions (${rules})`, scoring_positions);
            debug_board_output("Board", board);
            debug_board_output("Ownership", cur_ownership);
        }
        //debug_boolean_board("Sealed", sealed, "s");

        const print_final_ownership_string = true;
        // aid while correcting and forming the test files
        if (print_final_ownership_string) {
            let ownership_string = '\n  "correct_ownership": [\n';
            for (let y = 0; y < final_ownership.length; ++y) {
                ownership_string += '    "';
                for (let x = 0; x < final_ownership[y].length; ++x) {
                    if (sealed[y][x]) {
                        ownership_string += "s";
                    } else {
                        ownership_string +=
                            final_ownership[y][x] === 1
                                ? "B"
                                : final_ownership[y][x] === 2
                                  ? "W"
                                  : " ";
                    }
                }
                if (y !== final_ownership.length - 1) {
                    ownership_string += '",\n';
                } else {
                    ownership_string += '"\n';
                }
            }

            ownership_string += "  ]\n";

            stage_log(ownership_string);
        }
    }
}

function debug_ownership_output(title: string, ownership: number[][]) {
    begin_board(title);
    let out = "   ";
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

    board_output(out);
    end_board();
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
            return blue(mag_str);
        } else {
            return cyanBright(mag_str);
        }
    }
    if (ownership > 0) {
        return blackBright(mag_str);
    } else {
        return whiteBright(mag_str);
    }
}

function debug_board_output(title: string, board: JGOFNumericPlayerColor[][]) {
    begin_board(title);
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
    board_output(out);
    end_board();
}

function debug_board_string_output(title: string, board: string[][]) {
    begin_board(title);
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            out += colorizeIntersection(board[y][x]);
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
    board_output(out);
    end_board();
}

function colorizeIntersection(c: string): string {
    if (c === "B" || c === "S") {
        return black(c);
    } else if (c === "W") {
        return whiteBright(c);
    } else if (c === "?") {
        return red(c);
    } else if (c === "x") {
        return red(c);
    } else if (c === "e") {
        return magenta(c);
    } else if (c === "s") {
        return magenta(c);
    } else if (c === ".") {
        return blue(c);
    } else if (c === " " || c === "_") {
        return blue("_");
    }
    return yellow(c);
}

function debug_boolean_board(title: string, board: (boolean | number)[][], mark = "S") {
    begin_board(title);
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            out += colorizeIntersection(board[y][x] ? mark : " ");
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
    board_output(out);
    end_board();
}

function debug_groups(title: string, groups: StoneStringBuilder) {
    const group_map: string[][] = makeMatrix(
        groups.stone_string_id_map[0].length,
        groups.stone_string_id_map.length,
        "",
    );
    const symbols = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    let group_idx = 0;

    groups.foreachGroup((group) => {
        let group_color = red;

        if (group.color === JGOFNumericPlayerColor.EMPTY) {
            //if (group.is_territory_in_seki) {
            if (false) {
                group_color = yellow;
            } else if (group.is_territory) {
                if (group.territory_color) {
                    group_color =
                        group.territory_color === JGOFNumericPlayerColor.BLACK ? black : white;
                } else {
                    group_color = blue;
                }
            } else {
                group_color = magenta;
            }
        } else if (group.color === JGOFNumericPlayerColor.BLACK) {
            group_color = black;
        } else if (group.color === JGOFNumericPlayerColor.WHITE) {
            group_color = white;
        } else {
            group_color = red;
        }

        const symbol = symbols[group_idx % symbols.length];

        group.map((point) => {
            group_map[point.y][point.x] = group_color(symbol);
        });
        group_idx++;
    });

    debug_group_map(title, group_map);
}

function debug_group_map(title: string, board: string[][]) {
    begin_board(title);
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
    board_output(out);
    end_board();
}

export function white(str: string) {
    return `\x1b[37m${str}\x1b[0m`;
}
export function red(str: string) {
    return `\x1b[31m${str}\x1b[0m`;
}
export function green(str: string) {
    return `\x1b[32m${str}\x1b[0m`;
}
export function yellow(str: string) {
    return `\x1b[33m${str}\x1b[0m`;
}
export function blue(str: string) {
    return `\x1b[34m${str}\x1b[0m`;
}
export function magenta(str: string) {
    return `\x1b[35m${str}\x1b[0m`;
}
export function cyan(str: string) {
    return `\x1b[36m${str}\x1b[0m`;
}
export function black(str: string) {
    return `\x1b[30m${str}\x1b[0m`;
}
export function whiteBright(str: string) {
    return `\x1b[97m${str}\x1b[0m`;
}
export function cyanBright(str: string) {
    return `\x1b[96m${str}\x1b[0m`;
}
export function blackBright(str: string) {
    return `\x1b[90m${str}\x1b[0m`;
}

function count_color_code_characters(str: string): number {
    let count = 0;
    for (let i = 0; i < str.length; ++i) {
        if (str[i] === "\x1b") {
            count++; // for x1b
            while (str[i] !== "m") {
                ++i;
                ++count;
            }
        }
    }
    return count;
}

/******************************/
/*** Debug output functions ***/
/******************************/

type DebugOutput = string;

let final_output = "";
let current_stage = "";
let board_outputs: string[] = [];
let current_board_output = "";
let current_stage_log = "";

function stage(name: string) {
    end_stage();
    current_stage = name;
    const title_line = `####   ${current_stage}   ####`;
    const pounds = "#".repeat(title_line.length);
    final_output += `\n\n${pounds}\n${title_line}\n${pounds}\n\n`;
}

function substage(name: string) {
    end_stage();

    current_stage = name;
    const title_line = `====   ${current_stage}   ====`;
    final_output += `${title_line}\n\n`;
}

function stage_log(str: string) {
    current_stage_log += "    " + str + "\n";
}

function end_stage() {
    end_board();

    if (!current_stage) {
        return;
    }

    current_stage = "";

    const boards_per_line = 5;

    while (board_outputs.length > 0) {
        const wide_lines: string[] = [];
        const str_grid: string[][] = [];
        const segment_length = 30;

        for (let x = 0; x < board_outputs.length && x < boards_per_line; ++x) {
            const lines = board_outputs[x].split("\n");
            for (let y = 0; y < lines.length; ++y) {
                if (!str_grid[y]) {
                    str_grid[y] = [];
                }
                str_grid[y][x] = lines[y];
            }
        }

        board_outputs = board_outputs.slice(boards_per_line);

        for (let y = 0; y < str_grid.length; ++y) {
            let line = "";
            for (let x = 0; x < str_grid[y].length; ++x) {
                //const segment = str_grid[y][x] ?? "";
                /*
            const segment =
                ((str_grid[y][x] ?? "") + " ".repeat(segment_length)).substr(segment_length) + " ";
            line += segment;
            */
                const num_color_code_characters = count_color_code_characters(str_grid[y][x] ?? "");
                const length_without_color_codes =
                    (str_grid[y][x]?.length ?? 0) - num_color_code_characters;
                if (length_without_color_codes < 0) {
                    throw new Error("length_without_color_codes < 0");
                }
                line +=
                    (str_grid[y][x] ?? "") +
                    " ".repeat(Math.max(0, segment_length - length_without_color_codes)) +
                    " ";
            }
            final_output += line + "\n";
            //wide_lines.push(line);
        }

        for (let i = 0; i < wide_lines.length; ++i) {
            final_output += wide_lines[i] + "\n";
        }
    }

    if (current_stage_log) {
        final_output += "\n\nLog:\n" + current_stage_log + "\n";
        current_stage_log = "";
    }
}

function begin_board(name: string) {
    end_board();
    current_board_output = `${name}\n`;
}

function end_board() {
    if (!current_board_output) {
        return;
    }
    board_outputs.push(current_board_output);
    current_board_output = "";
}

function board_output(str: string) {
    current_board_output += str;
}

function finalize_debug_output(): string {
    end_stage();
    const ret = final_output;
    board_outputs = [];
    final_output = "";

    let legend = "";
    legend += "Stone string coloring legend (not boolean maps):\n";
    legend += "  " + black("Black") + "\n";
    legend += "  " + white("White") + "\n";
    legend += "  " + blue("Dame") + "\n";
    //legend += "  " + yellow("Territory in Seki") + "\n";
    legend += "  " + magenta("Undecided territory") + "\n";
    legend += "  " + red("Error") + "\n";

    return legend + ret;
}
