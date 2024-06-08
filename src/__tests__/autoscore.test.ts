import { readFileSync, readdirSync } from "fs";
import { autoscore } from "../autoscore";

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
                    const is_w_or_b = cell === "W" || cell === "B" || cell === " " || cell === "*";
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
                        (v === 0 && data.correct_ownership[y][x] === " ") ||
                        (v === 1 && data.correct_ownership[y][x] === "B") ||
                        (v === 2 && data.correct_ownership[y][x] === "W");
                }
            }

            expect(match).toBe(true);
        });
    }
});
