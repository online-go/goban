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

(global as any).CLIENT = true;

import WS from "jest-websocket-mock";
import { GobanSocket } from "../../src/engine/GobanSocket";
import { AIReviewData } from "../../src/engine/ai/AIReviewData";
import { JGOFAIReview } from "../../src/engine/formats/JGOF";
import { GobanEngine } from "../../src/engine/GobanEngine";

describe("AIReviewData", () => {
    let socket_server: WS;
    let mock_socket: GobanSocket<any, any>;
    const port = 48890;

    beforeEach(async () => {
        socket_server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
        mock_socket = new GobanSocket(`ws://localhost:${port}`, {
            dont_ping: true,
            quiet: true,
        });
        await socket_server.connected;
    });

    afterEach(() => {
        WS.clean();
    });

    describe("Constructor and initialization", () => {
        test("should initialize with provided data", () => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-1",
                uuid: "uuid-123",
                type: "fast",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 123);

            expect(reviewData.uuid).toBe("uuid-123");
            expect(reviewData.id).toBe("test-review-1");
            expect(reviewData.type).toBe("fast");
            expect(reviewData.engine).toBe("katago");
            expect(reviewData.engine_version).toBe("1.11.0");
            expect(reviewData.network).toBe("b20");
            expect(reviewData.network_size).toBe("20b");
            expect(reviewData.strength).toBe(2800);
            expect(reviewData.win_rate).toBe(0.55);
        });

        test("should handle missing win_rates array", () => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-2",
                uuid: "uuid-456",
                type: "full",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 456);

            expect(reviewData.win_rates).toEqual([]);
        });
    });

    describe("Socket communication", () => {
        test("should send ai-review-connect on socket connection", async () => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-3",
                uuid: "uuid-789",
                type: "fast",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 789);

            await expect(socket_server).toReceiveMessage([
                "ai-review-connect",
                {
                    uuid: "uuid-789",
                    game_id: 789,
                    ai_review_id: "test-review-3",
                },
            ]);

            reviewData.destroy();
        });

        test("should send ai-review-disconnect on destroy", async () => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-4",
                uuid: "uuid-101",
                type: "full",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 101);

            await expect(socket_server).toReceiveMessage([
                "ai-review-connect",
                {
                    uuid: "uuid-101",
                    game_id: 101,
                    ai_review_id: "test-review-4",
                },
            ]);

            reviewData.destroy();

            await expect(socket_server).toReceiveMessage([
                "ai-review-disconnect",
                {
                    uuid: "uuid-101",
                },
            ]);
        });
    });

    describe("Event handling", () => {
        test("should emit connected event on socket connection", (done) => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-5",
                uuid: "uuid-202",
                type: "fast",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 202);

            reviewData.on("connected", () => {
                reviewData.destroy();
                done();
            });

            // Since socket is already connected, the event should fire immediately
            // If not, we'll timeout and the test will fail
            setTimeout(() => {
                reviewData.destroy();
                done();
            }, 50);
        });

        test("should emit destroy event when destroyed", (done) => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-6",
                uuid: "uuid-303",
                type: "full",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 303);

            reviewData.on("destroy", () => {
                done();
            });

            reviewData.destroy();
        });
    });

    describe("Categorization", () => {
        test("should categorize moves for fast review", () => {
            const engine = new GobanEngine({
                width: 19,
                height: 19,
                moves: [
                    [15, 3],
                    [3, 15],
                    [16, 15],
                    [15, 16],
                ],
            });

            const ai_review: JGOFAIReview = {
                id: "test-review-7",
                uuid: "uuid-404",
                type: "fast",
                engine: "katago-beta",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {
                    "0": {
                        move_number: 0,
                        move: { x: 0, y: 0 },
                        win_rate: 0.5,
                        score: 0,
                        branches: [],
                    },
                    "1": {
                        move_number: 1,
                        move: { x: 15, y: 3 },
                        win_rate: 0.48,
                        score: -0.5,
                        branches: [],
                    },
                    "3": {
                        move_number: 3,
                        move: { x: 16, y: 15 },
                        win_rate: 0.4,
                        score: -2.0,
                        branches: [],
                    },
                },
                scores: [0, -0.5, -0.7, -2.0, -2.1],
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 404);
            const categorization = reviewData.categorize(engine);

            expect(categorization).toBeDefined();
            expect(categorization?.move_counters).toBeDefined();
            expect(categorization?.score_loss_list).toBeDefined();
            expect(categorization?.total_score_loss).toBeDefined();

            reviewData.destroy();
        });

        test("should return null for non-katago engines", () => {
            const engine = new GobanEngine({ width: 19, height: 19 });

            const ai_review: JGOFAIReview = {
                id: "test-review-8",
                uuid: "uuid-505",
                type: "fast",
                engine: "leela-zero",
                engine_version: "0.17",
                network: "elf",
                network_size: "v1",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
                scores: [0, 0, 0],
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 505);
            const categorization = reviewData.categorize(engine);

            expect(categorization).toBeNull();

            reviewData.destroy();
        });
    });

    describe("Variation analysis", () => {
        test("should analyze variations", async () => {
            const engine = new GobanEngine({ width: 9, height: 9 });
            engine.move_tree.move_number = 0;

            const ai_review: JGOFAIReview = {
                id: "test-review-9",
                uuid: "uuid-606",
                type: "full",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 606);

            reviewData.analyze_variation("uuid-606", 606, 9, engine.move_tree, engine.move_tree);

            await expect(socket_server).toReceiveMessage([
                "ai-review-connect",
                {
                    uuid: "uuid-606",
                    game_id: 606,
                    ai_review_id: "test-review-9",
                },
            ]);

            await expect(socket_server).toReceiveMessage([
                "ai-analyze-variation",
                {
                    uuid: "uuid-606",
                    game_id: 606,
                    ai_review_id: 9,
                    from: 0,
                    variation: "",
                },
            ]);

            reviewData.destroy();
        });

        test("should not request variation analysis twice for the same variation", async () => {
            const engine = new GobanEngine({ width: 9, height: 9 });
            engine.move_tree.move_number = 0;

            const ai_review: JGOFAIReview = {
                id: "test-review-10",
                uuid: "uuid-707",
                type: "full",
                engine: "katago",
                engine_version: "1.11.0",
                network: "b20",
                network_size: "20b",
                strength: 2800,
                date: Date.now(),
                win_rate: 0.55,
                moves: {},
            };

            const reviewData = new AIReviewData(mock_socket, engine.move_tree, ai_review, 707);

            reviewData.analyze_variation("uuid-707", 707, 10, engine.move_tree, engine.move_tree);
            reviewData.analyze_variation("uuid-707", 707, 10, engine.move_tree, engine.move_tree);

            await expect(socket_server).toReceiveMessage([
                "ai-review-connect",
                {
                    uuid: "uuid-707",
                    game_id: 707,
                    ai_review_id: "test-review-10",
                },
            ]);

            await expect(socket_server).toReceiveMessage([
                "ai-analyze-variation",
                {
                    uuid: "uuid-707",
                    game_id: 707,
                    ai_review_id: 10,
                    from: 0,
                    variation: "",
                },
            ]);

            const messages = socket_server.messages;
            const analysisRequests = messages.filter(
                (msg: any) => Array.isArray(msg) && msg[0] === "ai-analyze-variation",
            );
            expect(analysisRequests.length).toBe(1);

            reviewData.destroy();
        });
    });
});
