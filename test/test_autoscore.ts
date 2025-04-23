#!/usr/bin/env bun
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

/*** HOW TO ADD A NEW TEST:
 *
 * Go into ../scripts and run:
 *
 *    ./fetch_game_for_autoscore_testing.ts <game_id>
 *
 * This will download the game, edit and move into the autoscore_test_files directory.
 *
 * You can then run the test with:
 *
 *    ./test_autoscore.ts <game_id>
 *
 */

/* This script is for development, debugging, and manual testing of the
 * autoscore functionality
 *
 * Usage:
 *
 *   ./test_autoscore.ts [game_id]
 *
 * If no game id is provided, all test files will be run.
 *
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { autoscore, red, blue, yellow, magenta, black, white } from "../src/engine/autoscore";
import {
    GobanEngine,
    GobanEngineInitialState,
    char2num,
    makeMatrix,
    num2char,
} from "../src/engine";
import {
    JGOFMove,
    JGOFNumericPlayerColor,
    JGOFSealingIntersection,
} from "../src/engine/formats/JGOF";

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

    const rules = data.rules ?? "chinese";

    // validate ownership structures look ok
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
    if (data.sealed_ownership) {
        for (const row of data.sealed_ownership) {
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
    }

    // run autoscore
    const [res, debug_output] = autoscore(data.board, rules, data.black, data.white);

    if (!quiet) {
        console.log("");
        console.log(debug_output);
        console.log("");
    }

    let ok = true;
    if (data.sealed_ownership) {
        ok &&= test_result(
            "Sealed ownership",
            res.sealed_result,
            res.removed,
            res.needs_sealing,
            true,
            data.sealed_ownership,
            quiet,
        );
    }
    ok &&= test_result(
        "Correct ownership",
        res.result,
        res.removed,
        res.needs_sealing,
        false,
        data.correct_ownership,
        quiet,
    );

    return ok;

    function test_result(
        mnemonic: string,
        result: JGOFNumericPlayerColor[][],
        removed: JGOFMove[],
        needs_sealing: JGOFSealingIntersection[],
        perform_sealing: boolean,
        correct_ownership: string[],
        quiet: boolean,
    ) {
        if (!quiet) {
            console.log("");
            console.log(`=== Testing ${mnemonic} ===`);
        }

        let match = true;
        const matches: boolean[][] = [];

        for (let y = 0; y < result.length; ++y) {
            matches[y] = [];
            for (let x = 0; x < result[0].length; ++x) {
                const v = result[y][x];
                let m =
                    correct_ownership[y][x] === "*" ||
                    correct_ownership[y][x] === "s" || // seal
                    (v === 0 && correct_ownership[y][x] === " ") ||
                    (v === 1 && correct_ownership[y][x] === "B") ||
                    (v === 2 && correct_ownership[y][x] === "W");

                if (correct_ownership[y][x] === "s") {
                    const has_needs_sealing =
                        needs_sealing.find((pt) => pt.x === x && pt.y === y) !== undefined;

                    m &&= has_needs_sealing;
                }

                matches[y][x] = m;
                match &&= m;
            }
        }

        /* Ensure all needs_sealing are marked as such */
        for (const { x, y } of needs_sealing) {
            if (correct_ownership[y][x] !== "s" && correct_ownership[y][x] !== "*") {
                console.error(
                    `Engine thought we needed sealing at ${x},${y} but the that spot wasn't flagged as needing it in the test file`,
                );
                match = false;
                matches[y][x] = false;
            }
        }

        if (!quiet) {
            // Double check that when we run everything through our normal GobanEngine.computeScore function,
            // that we get the result we're expecting. We exclude the japanese and korean rules here because
            // our test file ownership maps always include territory and stones.
            if (match && rules !== "japanese" && rules !== "korean") {
                const board = original_board.map((row: number[]) => row.slice());

                if (perform_sealing) {
                    for (const { x, y, color } of needs_sealing) {
                        board[y][x] = color;
                    }
                }

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

                const initial_state: GobanEngineInitialState = {
                    black: black_state,
                    white: white_state,
                };

                const engine = new GobanEngine({
                    width: board[0].length,
                    height: board.length,
                    initial_state,
                    rules,
                    removed,
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
                            correct_ownership[y][x] === "*" ||
                            correct_ownership[y][x] === "s" ||
                            //(v === 0 && correct_ownership[y][x] === "s") ||
                            (v === 0 && correct_ownership[y][x] === " ") ||
                            (v === 1 && correct_ownership[y][x] === "B") ||
                            (v === 2 && correct_ownership[y][x] === "W");
                        official_matches[y][x] = m;
                        official_match &&= m;
                    }
                }

                if (!quiet && !official_match) {
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
                console.log("Expected ownership:");
                print_expected(correct_ownership);
                console.log("Mismatches:");
                print_mismatches(matches);
                console.log("");

                console.log(`${mnemonic} ${path} failed`);
            } else {
                console.log(`${mnemonic} ${path} passed`);
            }
            console.log("");
            console.log("");
        }

        return match;
    }
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
            out += board[y][x] ? black(".") : red("X");
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
                out += white("W");
            } else if (c === "B") {
                out += black("B");
            } else if (c === " ") {
                out += blue(".");
            } else if (c === "*") {
                out += yellow("*");
            } else if (c === "s") {
                out += magenta("s");
            } else {
                out += red(c);
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
