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

/*

This script fetches a game, scores it, and writes it to a test file.

Presumably you are fetching a game because the autoscoring function is not
working for that game, so you'll need to manually score the game.

Note: this script requires a JWT to be provided in the file "user.jwt"

*/

import { readFileSync, writeFileSync } from "fs";
import { ScoreEstimateRequest } from "engine";

const jwt = readFileSync("user.jwt").toString().replace(/"/g, "").trim();
const game_id = process.argv[2];

if (!jwt) {
    console.log(
        'user.jwt file missing. Please open your javascript console and run  data.get("config.user_jwt"), then ' +
            'put the contents in a file called "user.jwt" in the same directory as this script.',
    );
    process.exit(1);
}
if (!game_id) {
    console.log("Usage: ts-node fetch_game.ts <game_id>");
    process.exit(1);
}
console.log(`Fetching game ${game_id}...`);

const TERM_SERVER = process.env.TERM_SERVER || "https://online-go.com";
const AI_SERVER = process.env.AI_SERVER || "https://ai.online-go.com";

(async () => {
    //fetch(`https://online-go.com/termination-api/game/${game_id}/score`, {
    const res = await fetch(`${TERM_SERVER}/termination-api/game/${game_id}/state`);
    const json = await res.json();
    const board_state = json.board;

    const ser_black: ScoreEstimateRequest = {
        player_to_move: "black",
        width: board_state[0].length,
        height: board_state.length,
        board_state,
        rules: "chinese",
        jwt,
    };
    const ser_white = { ...ser_black, player_to_move: "white" };

    const estimate_responses = await Promise.all([
        // post to https://ai.online-go.com/api/score

        fetch(`${AI_SERVER}/api/score`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(ser_black),
        }),

        fetch(`${AI_SERVER}/api/score`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(ser_white),
        }),
    ]);

    const estimates = await Promise.all(estimate_responses.map((r) => r.json()));

    let output = "{\n";

    output += `  "game_id": ${game_id},\n`;
    output += `  "board": [\n`;
    for (let row of board_state) {
        output +=
            `    "` +
            row
                .map((c: number) => {
                    switch (c) {
                        case 0:
                            return " ";
                        case 1:
                            return "b";
                        case 2:
                            return "W";
                    }
                    return "?";
                })
                .join("");
        if (row === board_state[board_state.length - 1]) {
            output += `"\n`;
        } else {
            output += `",\n`;
        }
    }
    output += "  ],\n";

    output += '  "black": [\n';
    for (let row of estimates[0].ownership) {
        output += `    [${row.map((x: number) => ("    " + x.toFixed(1)).substr(-4)).join(", ")}]`;
        if (row === estimates[0].ownership[estimates[0].ownership.length - 1]) {
            output += `\n`;
        } else {
            output += `,\n`;
        }
    }
    output += "  ],\n";

    output += '  "white": [\n';
    for (let row of estimates[1].ownership) {
        output += `    [${row.map((x: number) => ("    " + x.toFixed(1)).substr(-4)).join(", ")}]`;
        if (row === estimates[1].ownership[estimates[1].ownership.length - 1]) {
            output += `\n`;
        } else {
            output += `,\n`;
        }
    }

    output += "  ],\n";

    output += '  "correct_ownership": [\n';

    const avg_ownership = estimates[0].ownership.map((row: number[], i: number) =>
        row.map((x: number, j: number) => (x + estimates[1].ownership[i][j]) / 2),
    );

    for (let row of avg_ownership) {
        output +=
            `    "` +
            row
                .map((c: number) => {
                    if (c < -0.5) {
                        return "W";
                    }
                    if (c > 0.5) {
                        return "B";
                    }
                    return "?";
                })
                .join("");

        if (row === avg_ownership[avg_ownership.length - 1]) {
            output += `"\n`;
        } else {
            output += `",\n`;
        }
    }
    output += "  ]\n";

    output += "}\n";

    console.log(output);
    console.log(`Writing to game_${game_id}.json`);
    writeFileSync(`game_${game_id}.json`, output);
})()
    .then(() => console.log("Done, exiting"))
    .catch(console.error);
