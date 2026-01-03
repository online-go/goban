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

import { JGOFAIReview, JGOFNumericPlayerColor } from "../formats/JGOF";
import { GobanEngine } from "../GobanEngine";
import { MoveTree } from "../MoveTree";

export const DEFAULT_SCORE_DIFF_THRESHOLDS: ScoreDiffThresholds = {
    Excellent: 0.2,
    Great: 0.6,
    Good: 1.2,
    Inaccuracy: 2.0,
    Mistake: 5.0,
};

export type MoveCategory =
    | "Excellent"
    | "Great"
    | "Joseki"
    | "Good"
    | "Inaccuracy"
    | "Mistake"
    | "Blunder";

export type ScoreDiffThresholds = {
    Excellent: number;
    Great: number;
    Good: number;
    Inaccuracy: number;
    Mistake: number;
};

// Joseki detection constants
const STRONG_MOVE_SCORE_LOSS_THRESHOLD = 1.2;
const SINGLE_MOVE_LOSS_THRESHOLD = 1.2;

export interface AiReviewCategorization {
    uuid: string;
    move_counters: MoveCounters;
    score_loss_list: ScoreLossList;
    total_score_loss: { black: number; white: number };
    categorized_moves: MoveNumbers;
    avg_score_loss: { black: number; white: number };
    median_score_loss: { black: number; white: number };
    strong_move_rate: { black: number; white: number };
    moves_pending: number;
}

type PlayerMoveCounts = {
    [K in MoveCategory]: number;
};

type PlayerMoveNumbers = {
    [K in MoveCategory]: number[];
};

type MoveCounters = {
    black: PlayerMoveCounts;
    white: PlayerMoveCounts;
};

type MoveNumbers = {
    black: PlayerMoveNumbers;
    white: PlayerMoveNumbers;
};

type ScoreLossList = {
    black: { move: number; scoreLoss: number }[];
    white: { move: number; scoreLoss: number }[];
};

function medianList(numbers: { scoreLoss: number }[]): number {
    const mid = numbers.length === 0 ? undefined : Math.floor(numbers.length / 2);
    if (mid === undefined) {
        return -1;
    }

    const median =
        numbers.length % 2 !== 0
            ? numbers[mid].scoreLoss
            : (numbers[mid].scoreLoss + numbers[mid - 1].scoreLoss) / 2;
    return median;
}

function handicapOffset(engine: GobanEngine): number {
    if (engine && engine.free_handicap_placement && engine.handicap > 0) {
        return engine.handicap;
    }
    return 0;
}

// Joseki zone detection functions
interface JosekiZoneState {
    still_joseki: boolean[];
    moves_in_zone: number[];
    zone_loss: number[];
}

function getMoveCutoff(size: number): number {
    if (size === 9) {
        return 10;
    } else if (size === 13) {
        return 15;
    }
    return 20;
}

/**
 * Get the half-width of the center band based on board size.
 * Returns -1 for 9x9 (no middle zones), 0 for 13x13 (single line), 1 for 19x19 (3 lines).
 */
function getCenterHalfWidth(size: number): number {
    if (size <= 9) {
        return -1; // No middle zones for small boards
    } else if (size <= 13) {
        return 0; // Single center line
    }
    return 1; // 3 center lines
}

/**
 * Zone adjacency map for propagation.
 * When a zone exits joseki, these adjacent zones also exit.
 *
 * Zone layout for 13x13+:
 *     0  |  4  |  1
 *    ----+-----+----
 *     7  |  *  |  5
 *    ----+-----+----
 *     2  |  6  |  3
 */
const ZONE_ADJACENCY: { [key: number]: number[] } = {
    0: [4, 7], // top-left corner → top middle, left middle
    1: [4, 5], // top-right corner → top middle, right middle
    2: [6, 7], // bottom-left corner → bottom middle, left middle
    3: [5, 6], // bottom-right corner → bottom middle, right middle
    4: [0, 1], // top middle → top-left corner, top-right corner
    5: [1, 3], // right middle → top-right corner, bottom-right corner
    6: [2, 3], // bottom middle → bottom-left corner, bottom-right corner
    7: [0, 2], // left middle → top-left corner, bottom-left corner
};

/**
 * Propagate joseki exit from a zone to its adjacent zones.
 */
function propagateJosekiExit(zone: number, stillJoseki: boolean[]): void {
    for (const adjacentZone of ZONE_ADJACENCY[zone] ?? []) {
        stillJoseki[adjacentZone] = false;
    }
}

// Distance from zone boundary to be considered "on the edge"
const EDGE_DISTANCE = 2;

// Zone regions relative to center band: -1 = left/top, 0 = in center, 1 = right/bottom
const ZONE_X_REGION: readonly number[] = [-1, 1, -1, 1, 0, 1, 0, -1];
const ZONE_Y_REGION: readonly number[] = [-1, -1, 1, 1, -1, 0, 1, 0];

/**
 * Get adjacent zones that this position is near (within EDGE_DISTANCE of the boundary).
 *
 * Computes the shared boundary between adjacent zones geometrically based on
 * their relative positions, rather than enumerating cases per zone.
 */
function getNearbyAdjacentZones(
    x: number,
    y: number,
    width: number,
    height: number,
    zone: number,
): number[] {
    const maxSize = Math.max(width, height);
    const halfWidth = getCenterHalfWidth(maxSize);

    if (halfWidth < 0) {
        return []; // No edge detection for 9x9
    }

    const centerX = Math.floor((width - 1) / 2);
    const centerY = Math.floor((height - 1) / 2);

    const left = centerX - halfWidth;
    const right = centerX + halfWidth;
    const top = centerY - halfWidth;
    const bottom = centerY + halfWidth;

    const nearby: number[] = [];
    const zx = ZONE_X_REGION[zone];
    const zy = ZONE_Y_REGION[zone];

    for (const adj of ZONE_ADJACENCY[zone] ?? []) {
        const ax = ZONE_X_REGION[adj];
        const ay = ZONE_Y_REGION[adj];

        let near: boolean;
        if (zx !== ax) {
            // Zones differ in X - check distance to vertical boundary
            const boundary = zx < 0 || ax < 0 ? left : right;
            const approachFromLow = zx < 0 || (zx === 0 && ax > 0);
            near = approachFromLow ? x >= boundary - EDGE_DISTANCE : x <= boundary + EDGE_DISTANCE;
        } else {
            // Zones differ in Y - check distance to horizontal boundary
            const boundary = zy < 0 || ay < 0 ? top : bottom;
            const approachFromLow = zy < 0 || (zy === 0 && ay > 0);
            near = approachFromLow ? y >= boundary - EDGE_DISTANCE : y <= boundary + EDGE_DISTANCE;
        }

        if (near) {
            nearby.push(adj);
        }
    }

    return nearby;
}

/**
 * Get the zone indices that contain a given position.
 *
 * The board is divided into 8 zones: 4 corner zones (0-3) and 4 middle zones (4-7).
 * Center handling varies by size:
 * - 9x9: No middle zones, center included in corner zones with overlap
 * - 13x13+: Middle zones are the center bands, center intersection is ignored
 *
 * Zone layout for 13x13+:
 *     0  |  4  |  1      (corners 0-3, middles 4-7)
 *    ----+-----+----
 *     7  |  *  |  5      (* = center intersection, ignored)
 *    ----+-----+----
 *     2  |  6  |  3
 *
 * For 9x9, only corner zones (0-3) are used with overlap at center.
 */
function getZones(x: number, y: number, width: number, height: number): number[] {
    const maxSize = Math.max(width, height);
    const halfWidth = getCenterHalfWidth(maxSize);
    const centerX = Math.floor((width - 1) / 2);
    const centerY = Math.floor((height - 1) / 2);

    // For 9x9, only corner zones with overlap at center
    if (halfWidth < 0) {
        const zones: number[] = [];
        if (x <= centerX) {
            if (y <= centerY) {
                zones.push(0); // top-left
            }
            if (y >= centerY) {
                zones.push(2); // bottom-left
            }
        }
        if (x >= centerX) {
            if (y <= centerY) {
                zones.push(1); // top-right
            }
            if (y >= centerY) {
                zones.push(3); // bottom-right
            }
        }
        return zones;
    }

    // For larger boards, check center bands for middle zones
    const inVerticalBand = Math.abs(x - centerX) <= halfWidth;
    const inHorizontalBand = Math.abs(y - centerY) <= halfWidth;

    // Center intersection is ignored (no zones)
    if (inVerticalBand && inHorizontalBand) {
        return [];
    }

    // Vertical band (top middle or bottom middle)
    if (inVerticalBand) {
        if (y < centerY - halfWidth) {
            return [4]; // top middle
        } else {
            return [6]; // bottom middle
        }
    }

    // Horizontal band (left middle or right middle)
    if (inHorizontalBand) {
        if (x < centerX - halfWidth) {
            return [7]; // left middle
        } else {
            return [5]; // right middle
        }
    }

    // Corner zones (outside center bands)
    if (x < centerX - halfWidth) {
        if (y < centerY - halfWidth) {
            return [0]; // top-left corner
        } else {
            return [2]; // bottom-left corner
        }
    } else {
        if (y < centerY - halfWidth) {
            return [1]; // top-right corner
        } else {
            return [3]; // bottom-right corner
        }
    }
}

function getNumZones(size: number): number {
    const halfWidth = getCenterHalfWidth(size);
    return halfWidth < 0 ? 4 : 8; // 4 zones for 9x9, 8 zones for larger boards
}

interface MoveCoordinate {
    move_number: number;
    x: number;
    y: number;
    player: "black" | "white";
}

function getMoveCoordinates(engine: GobanEngine): MoveCoordinate[] {
    const moves: MoveCoordinate[] = [];
    let cur_move = engine.move_tree.trunk_next;

    while (cur_move !== undefined) {
        moves.push({
            move_number: cur_move.move_number,
            x: cur_move.x,
            y: cur_move.y,
            player: cur_move.player === JGOFNumericPlayerColor.BLACK ? "black" : "white",
        });
        cur_move = cur_move.trunk_next;
    }

    return moves;
}

interface JosekiMoves {
    black: Set<number>;
    white: Set<number>;
}

/**
 * Detect joseki moves using zone-based heuristics.
 *
 * This algorithm tracks 8 zones (4 corners + 4 middles for larger boards)
 * and determines which moves are part of joseki (opening patterns).
 * A zone remains "joseki" until:
 * - Accumulated score loss in the zone exceeds threshold
 * - A single move has very high score loss (> 2.4)
 * - Too many moves have been played in the zone
 *
 * When a zone exits joseki, it propagates to adjacent zones:
 * - Corner zones propagate to their two adjacent middle zones
 * - Middle zones propagate to their two adjacent corner zones
 *
 * For 9x9, only corner zones (0-3) are used with overlap at center.
 */
function detectJosekiMoves(engine: GobanEngine, score_loss_list: ScoreLossList): JosekiMoves {
    const width = engine.width;
    const height = engine.height;
    const maxDimension = Math.max(width, height);

    const move_cutoff = getMoveCutoff(maxDimension);
    const accumulated_loss_threshold = STRONG_MOVE_SCORE_LOSS_THRESHOLD * move_cutoff;
    const num_zones = getNumZones(maxDimension);

    // Track zones (shared between both players - either player breaking joseki ends it)
    const zoneState: JosekiZoneState = {
        still_joseki: Array(num_zones).fill(true),
        moves_in_zone: Array(num_zones).fill(0),
        zone_loss: Array(num_zones).fill(0),
    };

    // Build a map of move_number -> score_loss for quick lookup
    const scoreLossMap: { black: Map<number, number>; white: Map<number, number> } = {
        black: new Map(score_loss_list.black.map((m) => [m.move, m.scoreLoss])),
        white: new Map(score_loss_list.white.map((m) => [m.move, m.scoreLoss])),
    };

    const josekiMoves: JosekiMoves = { black: new Set(), white: new Set() };
    const moveCoords = getMoveCoordinates(engine);

    for (const move of moveCoords) {
        const { move_number, x, y, player } = move;

        // Skip pass moves - they don't belong to any zone
        if (x < 0 || y < 0) {
            continue;
        }

        const move_loss = scoreLossMap[player].get(move_number) ?? 0;

        const zones = getZones(x, y, width, height);
        // AND semantics: move is joseki only if ALL zones are (and remain) in joseki
        let is_joseki = zones.length > 0;

        for (const zone of zones) {
            if (!zoneState.still_joseki[zone]) {
                is_joseki = false;
                continue;
            }

            // Always count the move in this zone before any exit checks
            zoneState.moves_in_zone[zone] += 1;
            zoneState.zone_loss[zone] += move_loss;

            // Check if move is on the edge near an adjacent zone that's not in joseki
            if (num_zones === 8) {
                const nearbyAdjacent = getNearbyAdjacentZones(x, y, width, height, zone);
                const adjacentNotJoseki = nearbyAdjacent.some(
                    (adj) => !zoneState.still_joseki[adj],
                );
                if (adjacentNotJoseki) {
                    // Bust this zone out of joseki and propagate
                    zoneState.still_joseki[zone] = false;
                    propagateJosekiExit(zone, zoneState.still_joseki);
                    is_joseki = false;
                    continue;
                }
            }

            // First move in a zone gets 2x threshold tolerance
            const effectiveSingleMoveThreshold =
                zoneState.moves_in_zone[zone] === 1
                    ? SINGLE_MOVE_LOSS_THRESHOLD * 2
                    : SINGLE_MOVE_LOSS_THRESHOLD;

            // Middle zones (4-7) only allow 2 joseki moves
            const zoneLimit = zone >= 4 ? 2 : move_cutoff;

            if (
                zoneState.zone_loss[zone] > accumulated_loss_threshold ||
                move_loss > effectiveSingleMoveThreshold ||
                zoneState.moves_in_zone[zone] > zoneLimit
            ) {
                zoneState.still_joseki[zone] = false;
                // Propagate to adjacent zones (only for 8-zone boards)
                if (num_zones === 8) {
                    propagateJosekiExit(zone, zoneState.still_joseki);
                }
                is_joseki = false;
            }
        }

        if (is_joseki) {
            josekiMoves[player].add(move_number);
        }
    }

    return josekiMoves;
}

function getPlayerColorsMoveList(engine: GobanEngine) {
    const init_move = engine.move_tree;
    const move_list: any[] = [];
    let cur_move = init_move.trunk_next;

    while (cur_move !== undefined) {
        move_list.push(cur_move.player);
        cur_move = cur_move.trunk_next;
    }
    return move_list;
}

type ScoreLossResult = {
    score_loss_list: ScoreLossList;
    total_score_loss: { black: number; white: number };
    moves_pending: number;
};

function buildScoreLossList(
    ai_review: JGOFAIReview,
    handicap_offset: number,
    move_player_list: (typeof JGOFNumericPlayerColor)[keyof typeof JGOFNumericPlayerColor][],
    includeNegativeScoreLoss: boolean = false,
): ScoreLossResult {
    const score_loss_list: ScoreLossList = { black: [], white: [] };
    const total_score_loss = { black: 0, white: 0 };
    let moves_pending = 0;
    const is_full_review = ai_review.type === "full";

    for (
        let move_index = handicap_offset;
        move_index < (ai_review?.scores?.length ?? 0) - 1;
        move_index++
    ) {
        const is_b_player = move_player_list[move_index] === JGOFNumericPlayerColor.BLACK;
        const player = is_b_player ? "black" : "white";

        let score_loss: number;

        const has_branch_data =
            ai_review?.moves[move_index]?.branches?.[0]?.score !== undefined &&
            ai_review?.moves[move_index + 1]?.score !== undefined;

        if (has_branch_data) {
            // Full calculation with blue move adjustment
            const score_after_last_move = ai_review.moves[move_index].score!;
            const predicted_score_after_blue_move = ai_review.moves[move_index].branches[0].score!;
            const blue_score_loss = score_after_last_move - predicted_score_after_blue_move;
            const score_after_players_move = ai_review.moves[move_index + 1].score!;
            const effective_score_loss =
                score_after_last_move - score_after_players_move - blue_score_loss;
            score_loss = is_b_player ? effective_score_loss : -1 * effective_score_loss;
        } else if (is_full_review) {
            // Full review but data not available yet - skip this move (wait for data)
            moves_pending++;
            continue;
        } else {
            // Fast review - use simple score difference (this is the expected/complete data)
            const scores = ai_review.scores!;
            const score_diff = scores[move_index + 1] - scores[move_index];
            score_loss = is_b_player ? -1 * score_diff : score_diff;
        }

        if (includeNegativeScoreLoss || score_loss >= 0) {
            total_score_loss[player] += score_loss;
            score_loss_list[player].push({ move: move_index + 1, scoreLoss: score_loss });
        } else {
            score_loss_list[player].push({ move: move_index + 1, scoreLoss: 0 });
        }
    }

    return { score_loss_list, total_score_loss, moves_pending };
}

type CategorizationResult = {
    move_counters: MoveCounters;
    categorized_moves: MoveNumbers;
};

function categorizeMoves(
    score_loss_list: ScoreLossList,
    josekiMoves: JosekiMoves,
    scoreDiffThresholds: ScoreDiffThresholds = DEFAULT_SCORE_DIFF_THRESHOLDS,
): CategorizationResult {
    const move_counters: MoveCounters = {
        black: {
            Excellent: 0,
            Great: 0,
            Joseki: 0,
            Good: 0,
            Inaccuracy: 0,
            Mistake: 0,
            Blunder: 0,
        },
        white: {
            Excellent: 0,
            Great: 0,
            Joseki: 0,
            Good: 0,
            Inaccuracy: 0,
            Mistake: 0,
            Blunder: 0,
        },
    };
    const categorized_moves: MoveNumbers = {
        black: {
            Excellent: [],
            Great: [],
            Joseki: [],
            Good: [],
            Inaccuracy: [],
            Mistake: [],
            Blunder: [],
        },
        white: {
            Excellent: [],
            Great: [],
            Joseki: [],
            Good: [],
            Inaccuracy: [],
            Mistake: [],
            Blunder: [],
        },
    };

    const thresholds = {
        Excellent: scoreDiffThresholds.Excellent,
        Great: scoreDiffThresholds.Great,
        Good: scoreDiffThresholds.Good,
        Inaccuracy: scoreDiffThresholds.Inaccuracy,
        Mistake: scoreDiffThresholds.Mistake,
    };

    for (const player of ["black", "white"] as const) {
        for (const { move, scoreLoss } of score_loss_list[player]) {
            // Check if this is a joseki move first
            if (josekiMoves[player].has(move)) {
                move_counters[player].Joseki += 1;
                categorized_moves[player].Joseki.push(move);
                continue;
            }

            // Categorize based on score loss
            if (scoreLoss < thresholds.Excellent) {
                move_counters[player].Excellent += 1;
                categorized_moves[player].Excellent.push(move);
            } else if (scoreLoss < thresholds.Great) {
                move_counters[player].Great += 1;
                categorized_moves[player].Great.push(move);
            } else if (scoreLoss < thresholds.Good) {
                move_counters[player].Good += 1;
                categorized_moves[player].Good.push(move);
            } else if (scoreLoss < thresholds.Inaccuracy) {
                move_counters[player].Inaccuracy += 1;
                categorized_moves[player].Inaccuracy.push(move);
            } else if (scoreLoss < thresholds.Mistake) {
                move_counters[player].Mistake += 1;
                categorized_moves[player].Mistake.push(move);
            } else {
                move_counters[player].Blunder += 1;
                categorized_moves[player].Blunder.push(move);
            }
        }
    }

    return { move_counters, categorized_moves };
}

/**
 * Gets the number of moves in the main line (trunk) of the move tree.
 * This excludes variations/branches but includes pass moves.
 */
function getTrunkLength(moveTree: MoveTree): number {
    let count = 0;
    let current: MoveTree | undefined = moveTree.trunk_next; // Start from first move, not root
    while (current) {
        count++;
        current = current.trunk_next;
    }
    return count;
}

function validateReviewData(
    ai_review: JGOFAIReview,
    engine: GobanEngine,
): { isValid: boolean; shouldShowTable: boolean } {
    const is_uploaded = engine.config.original_sgf !== undefined;
    const scores = ai_review.scores;

    if (!scores) {
        return { isValid: false, shouldShowTable: true };
    }

    // For uploaded SGFs, use the trunk length (main line only, excluding variations)
    // For regular games, use the moves array length
    // Both should satisfy: moves_count === scores.length - 1
    // (scores includes the initial position, so there's one more score than moves)
    const trunk_length = is_uploaded ? getTrunkLength(engine.move_tree) : 0;
    const check1 = !is_uploaded && engine.config.moves?.length !== scores.length - 1;
    const check2 = is_uploaded && trunk_length !== scores.length - 1;

    if (check1 || check2) {
        return { isValid: false, shouldShowTable: true };
    }

    if (ai_review.type === "fast") {
        const check3 =
            ai_review.moves === undefined ||
            (Object.keys(ai_review.moves).length !== 3 && scores.length > 4);
        if (check3) {
            return { isValid: false, shouldShowTable: true };
        }
        return { isValid: true, shouldShowTable: false };
    }

    if (ai_review.type === "full") {
        return { isValid: true, shouldShowTable: false };
    }

    return { isValid: false, shouldShowTable: true };
}

/*
 * Categorizes the moves in an AI review as Excellent, Great, Good, Joseki, Inaccuracy, Mistake, or Blunder.
 *
 * Called by AIReviewData.categorize to perform actual categorization work.
 *
 * */
export function AIReviewData_categorize(
    ai_review: JGOFAIReview,
    engine: GobanEngine,
    scoreDiffThresholds: ScoreDiffThresholds = DEFAULT_SCORE_DIFF_THRESHOLDS,
    includeNegativeScoreLoss: boolean = false,
): AiReviewCategorization | null {
    if (!ai_review.engine.includes("katago") || !["fast", "full"].includes(ai_review.type)) {
        return null;
    }

    let handicap_offset = handicapOffset(engine);
    handicap_offset = handicap_offset === 1 ? 0 : handicap_offset;
    const move_player_list = getPlayerColorsMoveList(engine);

    const { isValid } = validateReviewData(ai_review, engine);
    if (!isValid) {
        return null;
    }

    const { score_loss_list, total_score_loss, moves_pending } = buildScoreLossList(
        ai_review,
        handicap_offset,
        move_player_list,
        includeNegativeScoreLoss,
    );
    const josekiMoves = detectJosekiMoves(engine, score_loss_list);
    const { move_counters, categorized_moves } = categorizeMoves(
        score_loss_list,
        josekiMoves,
        scoreDiffThresholds,
    );

    const avg_score_loss = {
        black:
            score_loss_list.black.length > 0
                ? Number(
                      score_loss_list.black.reduce((sum, item) => sum + item.scoreLoss, 0) /
                          score_loss_list.black.length,
                  )
                : 0,
        white:
            score_loss_list.white.length > 0
                ? Number(
                      score_loss_list.white.reduce((sum, item) => sum + item.scoreLoss, 0) /
                          score_loss_list.white.length,
                  )
                : 0,
    };

    const sortedScoreLoss = {
        black: [...score_loss_list.black].sort((a, b) => a.scoreLoss - b.scoreLoss),
        white: [...score_loss_list.white].sort((a, b) => a.scoreLoss - b.scoreLoss),
    };

    const median_score_loss = {
        black: Number(medianList(sortedScoreLoss.black)),
        white: Number(medianList(sortedScoreLoss.white)),
    };

    const totalMoves = {
        black: Object.values(move_counters.black).reduce((sum, count) => sum + count, 0),
        white: Object.values(move_counters.white).reduce((sum, count) => sum + count, 0),
    };

    const calculateStrongMoveRate = (counters: PlayerMoveCounts, totalMoves: number): number => {
        if (totalMoves === 0) {
            return 0;
        }
        return Number(((counters.Excellent + counters.Great + counters.Good) / totalMoves) * 100);
    };

    const strong_move_rate =
        ai_review.type === "full"
            ? {
                  black: calculateStrongMoveRate(move_counters.black, totalMoves.black),
                  white: calculateStrongMoveRate(move_counters.white, totalMoves.white),
              }
            : { black: 0, white: 0 };

    return {
        uuid: ai_review.uuid,
        move_counters,
        score_loss_list,
        total_score_loss,
        categorized_moves,
        avg_score_loss,
        median_score_loss,
        strong_move_rate,
        moves_pending,
    };
}
