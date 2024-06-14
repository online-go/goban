/*
 * Copyright (C) David J Wu
 *
 * An attempt at territory scoring in Go with seki detection.
 * See https://github.com/lightvector/goscorer
 * Original Author: lightvector
 * Released under MIT license (https://github.com/lightvector/goscorer/blob/main/LICENSE.txt)
 */

export const EMPTY: 0;
export const BLACK: 1;
export const WHITE: 2;

export type color = typeof EMPTY | typeof BLACK | typeof WHITE;

/**
 * Indicates how a given location on the board should be scored for territory, along with other metadata.
 * isTerritoryFor is the primary field, indicating the territory (EMPTY / BLACK / WHITE) at each location.
 * See the Python version of this code for more detailed documentation on the fields of this class.
 */
export class LocScore {
    isTerritoryFor: color;
    belongsToSekiGroup: color;
    isFalseEye: boolean;
    isUnscorableFalseEye: boolean;
    isDame: boolean;
    eyeValue: number;
}
/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {float} blackPointsFromCaptures - points to add to black's score due to captures
 * @param {float} whitePointsFromCaptures - points to add to white's score due to captures
 * @param {float} komi - points to add to white's score due to komi
 * @param {bool} [scoreFalseEyes=false] - defaults to false, if set to true will score territory in false eyes even if
 *    is_unscorable_false_eye is true.
 * @return { {black:finalBlackScore,white:finalWhiteScore} }
 */
export function finalTerritoryScore(
    stones: color[][],
    markedDead: boolean[][],
    blackPointsFromCaptures: number,
    whitePointsFromCaptures: number,
    komi: number,
    scoreFalseEyes?: boolean,
): {
    black: number;
    white: number;
};
/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {float} komi - points to add to white's score due to komi
 * @return { {black:finalBlackScore,white:finalWhiteScore} }
 */
export function finalAreaScore(
    stones: color[][],
    markedDead: boolean[][],
    komi: number,
): {
    black: number;
    white: number;
};
/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @param {bool} [scoreFalseEyes=false] - defaults to false, if set to true
 *    will score territory in false eyes even if is_unscorable_false_eye is
 *    true.
 * @return {LocScore[][]}
 */
export function territoryScoring(
    stones: color[][],
    markedDead: boolean[][],
    scoreFalseEyes?: boolean,
): LocScore[][];
/**
 * @param {color[][]} stones - BLACK or WHITE or EMPTY indicating the stones on the board.
 * @param {bool[][]} markedDead - true if the location has a stone marked as dead, and false otherwise.
 * @return {LocScore[][]}
 */
export function areaScoring(stones: color[][], markedDead: boolean[][]): color[][];
export function getOpp(pla: any): number;
export function isOnBoard(y: any, x: any, ysize: any, xsize: any): boolean;
export function isOnBorder(y: any, x: any, ysize: any, xsize: any): boolean;
export function print2d(board: any, f: any): void;
export function string2d(board: any, f: any): string;
export function string2d2(board1: any, board2: any, f: any): string;
export function colorToStr(color: any): "." | "x" | "o";
