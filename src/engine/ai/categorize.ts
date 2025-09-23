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

export const DEFAULT_SCORE_DIFF_THRESHOLDS: ScoreDiffThresholds = {
    Excellent: 0.2,
    Great: 0.6,
    Good: 1.2,
    Inaccuracy: 2.0,
    Mistake: 5.0,
};

export type MoveCategory = "Excellent" | "Great" | "Good" | "Inaccuracy" | "Mistake" | "Blunder";

export type ScoreDiffThresholds = {
    Excellent: number;
    Great: number;
    Good: number;
    Inaccuracy: number;
    Mistake: number;
};

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

type CategorizationResult = {
    move_counters: MoveCounters;
    score_loss_list: ScoreLossList;
    total_score_loss: { black: number; white: number };
    categorized_moves: MoveNumbers;
    moves_pending: number;
};

function categorizeFastReview(
    ai_review: JGOFAIReview,
    handicap_offset: number,
    move_player_list: any[],
    scoreDiffThresholds: ScoreDiffThresholds = DEFAULT_SCORE_DIFF_THRESHOLDS,
): CategorizationResult {
    const scores = ai_review.scores;
    if (!scores) {
        throw new Error("Scores are required for fast review categorization");
    }

    const move_counters: MoveCounters = {
        black: { Excellent: 0, Great: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
        white: { Excellent: 0, Great: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
    };
    const score_loss_list: ScoreLossList = { black: [], white: [] };
    const total_score_loss = { black: 0, white: 0 };
    const categorized_moves: MoveNumbers = {
        black: { Excellent: [], Great: [], Good: [], Inaccuracy: [], Mistake: [], Blunder: [] },
        white: { Excellent: [], Great: [], Good: [], Inaccuracy: [], Mistake: [], Blunder: [] },
    };
    const worst_move_keys = Object.keys(ai_review.moves);

    for (let j = 0; j < worst_move_keys.length; j++) {
        (scores as any)[worst_move_keys[j]] = ai_review.moves[worst_move_keys[j]].score;
    }

    for (let move_index = handicap_offset; move_index < scores.length - 1; move_index++) {
        let score_diff = scores[move_index + 1] - scores[move_index];
        const is_b_player = move_player_list[move_index] === JGOFNumericPlayerColor.BLACK;
        const player = is_b_player ? "black" : "white";
        score_diff = is_b_player ? -1 * score_diff : score_diff;
        total_score_loss[player] += score_diff;
        score_loss_list[player].push({ move: move_index + 1, scoreLoss: score_diff });

        const thresholds = {
            Good: scoreDiffThresholds.Good,
            Inaccuracy: scoreDiffThresholds.Inaccuracy,
            Mistake: scoreDiffThresholds.Mistake,
        };

        if (score_diff < thresholds.Good) {
            move_counters[player].Good += 1;
            categorized_moves[player].Good.push(move_index + 1);
        } else if (score_diff < thresholds.Inaccuracy) {
            move_counters[player].Inaccuracy += 1;
            categorized_moves[player].Inaccuracy.push(move_index + 1);
        } else if (score_diff < thresholds.Mistake) {
            move_counters[player].Mistake += 1;
            categorized_moves[player].Mistake.push(move_index + 1);
        } else if (score_diff >= thresholds.Mistake) {
            move_counters[player].Blunder += 1;
            categorized_moves[player].Blunder.push(move_index + 1);
        }
    }

    return {
        move_counters,
        score_loss_list,
        total_score_loss,
        categorized_moves,
        moves_pending: 0,
    };
}

function categorizeFullReview(
    ai_review: JGOFAIReview,
    handicap_offset: number,
    move_player_list: any[],
    scoreDiffThresholds: ScoreDiffThresholds = DEFAULT_SCORE_DIFF_THRESHOLDS,
    includeNegativeScoreLoss: boolean = false,
): CategorizationResult {
    const move_counters: MoveCounters = {
        black: { Excellent: 0, Great: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
        white: { Excellent: 0, Great: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 },
    };
    const score_loss_list: ScoreLossList = { black: [], white: [] };
    const total_score_loss = { black: 0, white: 0 };
    const categorized_moves: MoveNumbers = {
        black: { Excellent: [], Great: [], Good: [], Inaccuracy: [], Mistake: [], Blunder: [] },
        white: { Excellent: [], Great: [], Good: [], Inaccuracy: [], Mistake: [], Blunder: [] },
    };

    let moves_pending = 0;
    for (
        let move_index = handicap_offset;
        move_index < (ai_review?.scores?.length ?? 0) - 1;
        move_index++
    ) {
        if (
            ai_review?.moves[move_index] === undefined ||
            ai_review?.moves[move_index + 1] === undefined
        ) {
            moves_pending++;
            continue;
        }

        const is_b_player = move_player_list[move_index] === JGOFNumericPlayerColor.BLACK;
        const player = is_b_player ? "black" : "white";

        const score_after_last_move = ai_review.moves[move_index].score!;
        const predicted_score_after_blue_move = ai_review.moves[move_index].branches[0].score!;

        const blue_score_loss = score_after_last_move - predicted_score_after_blue_move;

        const score_after_players_move = ai_review.moves[move_index + 1].score!;

        const effective_score_loss =
            score_after_last_move - score_after_players_move - blue_score_loss;

        const score_loss = is_b_player ? effective_score_loss : -1 * effective_score_loss;

        if (includeNegativeScoreLoss || score_loss >= 0) {
            total_score_loss[player] += score_loss;
            score_loss_list[player].push({ move: move_index + 1, scoreLoss: score_loss });
        } else {
            score_loss_list[player].push({ move: move_index + 1, scoreLoss: 0 });
        }

        const thresholds = {
            Excellent: scoreDiffThresholds.Excellent,
            Great: scoreDiffThresholds.Great,
            Good: scoreDiffThresholds.Good,
            Inaccuracy: scoreDiffThresholds.Inaccuracy,
            Mistake: scoreDiffThresholds.Mistake,
        };

        if (score_loss < thresholds.Excellent) {
            move_counters[player].Excellent += 1;
            categorized_moves[player].Excellent.push(move_index + 1);
        } else if (score_loss < thresholds.Great) {
            move_counters[player].Great += 1;
            categorized_moves[player].Great.push(move_index + 1);
        } else if (score_loss < thresholds.Good) {
            move_counters[player].Good += 1;
            categorized_moves[player].Good.push(move_index + 1);
        } else if (score_loss < thresholds.Inaccuracy) {
            move_counters[player].Inaccuracy += 1;
            categorized_moves[player].Inaccuracy.push(move_index + 1);
        } else if (score_loss < thresholds.Mistake) {
            move_counters[player].Mistake += 1;
            categorized_moves[player].Mistake.push(move_index + 1);
        } else {
            move_counters[player].Blunder += 1;
            categorized_moves[player].Blunder.push(move_index + 1);
        }
    }

    return { move_counters, score_loss_list, total_score_loss, categorized_moves, moves_pending };
}

function validateReviewData(
    ai_review: JGOFAIReview,
    engine: GobanEngine,
    b_player: number,
): { isValid: boolean; shouldShowTable: boolean } {
    const is_uploaded = engine.config.original_sgf !== undefined;
    const scores = ai_review.scores;

    if (!scores) {
        return { isValid: false, shouldShowTable: true };
    }

    const check1 = !is_uploaded && engine.config.moves?.length !== scores.length - 1;
    const check2 =
        is_uploaded &&
        (engine.config as any)["all_moves"]?.split("!").length - b_player !== scores.length;

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
 * Categorizes the moves in an AI review as Excellent, Great, Good, Inaccuracy, Mistake, or Blunder.
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

    const handicap = engine.handicap;
    let handicap_offset = handicapOffset(engine);
    handicap_offset = handicap_offset === 1 ? 0 : handicap_offset;
    const b_player = handicap_offset > 0 || handicap > 1 ? 1 : 0;
    const move_player_list = getPlayerColorsMoveList(engine);

    const { isValid } = validateReviewData(ai_review, engine, b_player);
    if (!isValid) {
        return null;
    }

    const { move_counters, score_loss_list, total_score_loss, categorized_moves, moves_pending } =
        ai_review.type === "fast"
            ? categorizeFastReview(
                  ai_review,
                  handicap_offset,
                  move_player_list,
                  scoreDiffThresholds,
              )
            : categorizeFullReview(
                  ai_review,
                  handicap_offset,
                  move_player_list,
                  scoreDiffThresholds,
                  includeNegativeScoreLoss,
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
