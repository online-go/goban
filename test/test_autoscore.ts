#!/usr/bin/env ts-node
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

/* This script is for development, debugging, and manual testing of the
 * autoscore functionality found in src/autoscore.ts
 *
 * Usage:
 *
 *   ./test_autoscore.ts [game_id]
 *
 * If no game id is provided, all test files will be run.
 *
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { autoscore } from "../src/autoscore";
import * as clc from "cli-color";
import { GoEngine, GoEngineInitialState } from "../src/GoEngine";
import { char2num, makeMatrix, num2char } from "../src/GoMath";
import { JGOFNumericPlayerColor } from "../src/JGOF";

function run_autoscore_tests() {
    const test_file_directory = "autoscore_test_files";
    if (!existsSync(test_file_directory)) {
        throw new Error(`Missing tests directory ${test_file_directory}`);
    }

    const files = readdirSync(test_file_directory);

    const failures: string[] = [];
    let passed = 0;

    for (const file of files) {
        if (process.argv[2] && !file.includes(process.argv[2])) {
            continue;
        }

        const quiet = process.argv.length < 3; // testing all files? be quieter

        if (!test_file(`${test_file_directory}/${file}`, quiet)) {
            failures.push(file);
        } else {
            ++passed;
        }
    }

    if (failures.length > 0) {
        console.log("");
        console.log("");
        console.log("Failures:");
        for (const failure of failures) {
            console.log(
                `  ${failure}:   https://online-go.com/game/${failure.replace(/[^\d]/g, "")}`,
            );
        }
    } else {
        if (passed > 1) {
            console.log(`All ${passed} tests passed`);
        }
    }
}

function test_file(path: string, quiet: boolean): boolean {
    // convert board to jgof number encoding
    const data = JSON.parse(readFileSync(path, "utf-8"));
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
    const original_board = data.board.map((row: string | any[]) => row.slice());

    // Ensure the test file has the correct structure
    if (!data) {
        throw new Error(`Failed to parse ${path}`);
    }
    if (!data.board) {
        throw new Error(`${path} board field is invalid`);
    }
    if (!data.black) {
        throw new Error(`${path} black field is invalid`);
    }
    if (!data.white) {
        throw new Error(`${path} white field is invalid`);
    }
    if (!data.correct_ownership) {
        throw new Error(`${path} correct_ownership field is invalid`);
    }
    for (const row of data.correct_ownership) {
        for (const cell of row) {
            const is_w_or_b =
                cell === "W" || // owned by white
                cell === "B" || // owned by black
                cell === " " || // dame
                cell === "*" || // anything
                cell === "s"; // marked for needing to seal
            if (!is_w_or_b) {
                throw new Error(
                    `${path} correct_ownership field contains "${cell}" which is invalid`,
                );
            }
        }
    }

    // run autoscore
    const [res, debug_output] = autoscore(data.board, data.black, data.white);

    let match = true;
    const matches: boolean[][] = [];

    for (let y = 0; y < res.result.length; ++y) {
        matches[y] = [];
        for (let x = 0; x < res.result[0].length; ++x) {
            const v = res.result[y][x];
            let m =
                data.correct_ownership[y][x] === "*" ||
                data.correct_ownership[y][x] === "s" || // seal
                (v === 0 && data.correct_ownership[y][x] === " ") ||
                (v === 1 && data.correct_ownership[y][x] === "B") ||
                (v === 2 && data.correct_ownership[y][x] === "W");

            if (data.correct_ownership[y][x] === "s") {
                const has_needs_sealing =
                    res.needs_sealing.find(([x2, y2]) => x2 === x && y2 === y) !== undefined;

                m &&= has_needs_sealing;
            }

            matches[y][x] = m;
            match &&= m;
        }
    }

    /* Ensure all needs_sealing are marked as such */
    for (const [x, y] of res.needs_sealing) {
        if (data.correct_ownership[y][x] !== "s" && data.correct_ownership[y][x] !== "*") {
            console.error(
                `Engine thought we needed sealing at ${x},${y} but the that spot wasn't flagged as needing it in the test file`,
            );
            match = false;
            matches[y][x] = false;
        }
    }

    if (!quiet) {
        // Double check that when we run everything through our normal GoEngine.computeScore function,
        // that we get the result we're expecting
        if (match) {
            const board = original_board.map((row: number[]) => row.slice());

            let black_state = "";
            let white_state = "";

            for (let y = 0; y < board.length; ++y) {
                for (let x = 0; x < board[y].length; ++x) {
                    const v = board[y][x];
                    const c = num2char(x) + num2char(y);
                    if (v === JGOFNumericPlayerColor.BLACK) {
                        black_state += c;
                    } else if (v === 2) {
                        white_state += c;
                    }
                }
            }

            const initial_state: GoEngineInitialState = {
                black: black_state,
                white: white_state,
            };

            const engine = new GoEngine({
                width: board[0].length,
                height: board.length,
                initial_state,
                rules: "chinese", // for area scoring
                removed: res.removed_string,
            });

            const score = engine.computeScore();

            const scored_board = makeMatrix(board[0].length, board.length, 0);

            for (let i = 0; i < score.black.scoring_positions.length; i += 2) {
                const x = char2num(score.black.scoring_positions[i]);
                const y = char2num(score.black.scoring_positions[i + 1]);
                scored_board[y][x] = JGOFNumericPlayerColor.BLACK;
            }
            for (let i = 0; i < score.white.scoring_positions.length; i += 2) {
                const x = char2num(score.white.scoring_positions[i]);
                const y = char2num(score.white.scoring_positions[i + 1]);
                scored_board[y][x] = JGOFNumericPlayerColor.WHITE;
            }

            let official_match = true;
            const official_matches: boolean[][] = [];
            for (let y = 0; y < scored_board.length; ++y) {
                official_matches[y] = [];
                for (let x = 0; x < scored_board[0].length; ++x) {
                    const v = scored_board[y][x];
                    const m =
                        data.correct_ownership[y][x] === "*" ||
                        (v === 0 && data.correct_ownership[y][x] === "s") ||
                        (v === 0 && data.correct_ownership[y][x] === " ") ||
                        (v === 1 && data.correct_ownership[y][x] === "B") ||
                        (v === 2 && data.correct_ownership[y][x] === "W");
                    official_matches[y][x] = m;
                    official_match &&= m;
                }
            }

            if (!quiet) {
                console.log("");
                console.log("");
                console.log("Final scored board");
                print_expected(
                    scored_board.map((row) =>
                        row.map((v) => (v === 1 ? "B" : v === 2 ? "W" : " ")).join(""),
                    ),
                );

                if (official_match) {
                    console.log("Final autoscore matches official scoring");
                } else {
                    console.error("Official score did not match our expected scoring");
                    print_mismatches(official_matches);
                }
            }

            match &&= official_match;
        }

        if (!match) {
            console.log("");
            console.log("");
            console.log(`>>> ${path} failed`);
            console.log(`>>> ${path} failed`);
            console.log(`>>> ${path} failed`);
            console.log("");
            console.log(debug_output);
            console.log("");
            console.log("Expected ownership:");
            print_expected(data.correct_ownership);
            console.log("Mismatches:");
            print_mismatches(matches);
            console.log("");

            /*
            console.log("Removed");
            for (const [x, y, reason] of res.removed) {
                console.log(
                    `  ${"ABCDEFGHJKLMNOPQRSTUVWXYZ"[x]}${data.board.length - y}: ${reason}`,
                );
            }
            */

            console.log(`<<< ${path} failed`);
            console.log(`<<< ${path} failed`);
            console.log(`<<< ${path} failed`);
            console.log("");
            console.log("");
        } else {
            console.log("");
            console.log("");
            console.log(debug_output);
            console.log("");
            console.log("");
            console.log(`${path} passed`);
        }
    }

    return match;
}

if (require.main === module) {
    run_autoscore_tests();
}

function print_mismatches(board: boolean[][]) {
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            out += board[y][x] ? clc.black(".") : clc.red("X");
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

    console.log(out);
}

function print_expected(board: string[]) {
    let out = "   ";
    const x_coords = "ABCDEFGHJKLMNOPQRST"; // cspell: disable-line

    for (let x = 0; x < board[0].length; ++x) {
        out += `${x_coords[x]}`;
    }
    out += "\n";

    for (let y = 0; y < board.length; ++y) {
        out += ` ${board.length - y} `.substr(-3);
        for (let x = 0; x < board[y].length; ++x) {
            const c = board[y][x];
            if (c === "W") {
                out += clc.white.bold("W");
            } else if (c === "B") {
                out += clc.black("B");
            } else if (c === " ") {
                out += clc.blue(".");
            } else if (c === "*") {
                out += clc.yellow("*");
            } else if (c === "s") {
                out += clc.magenta("s");
            } else {
                out += clc.red(c);
            }
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

    console.log(out);
}
