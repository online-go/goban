/*
 * Copyright (C)  Online-Go.com
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

export type Matrix<T> = T[][];
export type NumberMatrix = Matrix<number>;
export type StringMatrix = Matrix<string>;

/** Returns a cloned copy of the provided matrix */
export function cloneMatrix<T>(matrix: T[][]): T[][] {
    const ret = new Array(matrix.length);
    for (let i = 0; i < matrix.length; ++i) {
        ret[i] = matrix[i].slice();
    }
    return ret;
}

/**
 * Returns true if the contents of the two 2d matrices are equal when the
 * cells are compared with ===
 */
export function matricesAreEqual<T>(m1: T[][], m2: T[][]): boolean {
    if (m1.length !== m2.length) {
        return false;
    }

    for (let y = 0; y < m1.length; ++y) {
        if (m1[y].length !== m2[y].length) {
            return false;
        }

        for (let x = 0; x < m1[0].length; ++x) {
            if (m1[y][x] !== m2[y][x]) {
                return false;
            }
        }
    }
    return true;
}

export function makeMatrix<T = number>(width: number, height: number, initialValue: T): Matrix<T> {
    const ret: Matrix<T> = [];
    for (let y = 0; y < height; ++y) {
        ret.push([]);
        for (let x = 0; x < width; ++x) {
            ret[y].push(initialValue);
        }
    }
    return ret;
}
export function makeObjectMatrix<T>(width: number, height: number): Array<Array<T>> {
    const ret = new Array<Array<T>>(height);
    for (let y = 0; y < height; ++y) {
        const row = new Array<T>(width);
        for (let x = 0; x < width; ++x) {
            row[x] = {} as T;
        }
        ret[y] = row;
    }
    return ret;
}

export function makeEmptyMatrix<T>(width: number, height: number): Array<Array<T | undefined>> {
    const ret = new Array<Array<T>>(height);
    for (let y = 0; y < height; ++y) {
        ret[y] = new Array<T>(width);
    }
    return ret;
}
