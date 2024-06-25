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
import { readFileSync, readdirSync } from "fs";
import { autoscore } from "engine";

describe("Auto-score tests ", () => {
    const files = readdirSync("test/autoscore_test_files");

    for (const file of files) {
        const data = JSON.parse(readFileSync(`test/autoscore_test_files/${file}`, "utf-8"));
        data.board = data.board.map((row: string) =>
            row.split("").map((cell: string) => {
                switch (cell) {
                    case "w":
                    case "W":
                        return 2;
                    case "B":
                    case "b":
                        return 1;
                    default:
                        return 0;
                }
            }),
        );

        test(`Test ${file}`, () => {
            // file structure sanity test
            expect(data).toBeDefined();
            expect(data.board).toBeDefined();
            expect(data.black).toBeDefined();
            expect(data.white).toBeDefined();
            expect(data.correct_ownership).toBeDefined();
            for (const row of data.correct_ownership) {
                for (const cell of row) {
                    const is_w_or_b =
                        cell === "W" ||
                        cell === "B" ||
                        cell === " " ||
                        cell === "*" ||
                        cell === "s";
                    expect(is_w_or_b).toBe(true);
                }
            }

            // actual test
            const [res, _debug_output] = autoscore(
                data.board,
                data.rules ?? "chinese",
                data.black,
                data.white,
            );

            let match = true;
            for (let y = 0; y < res.result.length; ++y) {
                for (let x = 0; x < res.result[0].length; ++x) {
                    const v = res.result[y][x];
                    match &&=
                        data.correct_ownership[y][x] === "*" ||
                        data.correct_ownership[y][x] === "s" ||
                        (v === 0 && data.correct_ownership[y][x] === " ") ||
                        (v === 1 && data.correct_ownership[y][x] === "B") ||
                        (v === 2 && data.correct_ownership[y][x] === "W");
                }
            }

            const needs_sealing = res.needs_sealing;
            /* Ensure all needs_sealing are marked as such */
            for (const { x, y } of needs_sealing) {
                if (data.correct_ownership[y][x] !== "s" && data.correct_ownership[y][x] !== "*") {
                    console.error(
                        `Engine thought we needed sealing at ${x},${y} but the that spot wasn't flagged as needing it in the test file`,
                    );
                    match = false;
                }
            }

            expect(match).toBe(true);
        });
    }
});
