/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import WS from "jest-websocket-mock";
import { TestGoban } from "../../src/index";
import { GobanSocket } from "engine";

let last_port = 39880;

async function connect(config: any): Promise<[WS, GobanSocket, TestGoban]> {
    const port = ++last_port;
    const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
    const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });
    const goban = new TestGoban({ ...config, server_socket: client });
    (goban as any).post_config_constructor();
    await server.connected;
    return [server, client, goban];
}

function handler(goban: TestGoban, event: string): (data: any) => void {
    return (goban as any).socket_event_bindings.find((binding: any) => binding[0] === event)[1];
}

const players = {
    black: { id: 1, username: "black", name: "Black", rank: 10 },
    white: { id: 2, username: "white", name: "White", rank: 10 },
};

function reviewLog(...entries: any[]): any[] {
    return [
        {
            gamedata: {
                width: 9,
                height: 9,
                rules: "japanese",
                komi: 6.5,
                phase: "play",
                players,
            },
        },
        ...entries,
    ];
}

const BYOYOMI = {
    system: "byoyomi",
    time_control: "byoyomi",
    speed: "live",
    main_time: 600,
    periods: 5,
    period_time: 30,
};

describe("MoveTree.applyClocks", () => {
    test("sets, replaces and clears each color independently", () => {
        const goban = new TestGoban({ width: 9, height: 9 });
        goban.engine.place(2, 2);
        const node = goban.engine.cur_move;

        node.applyClocks({ black_clock: { main_time: 1000 }, white_clock: { main_time: 2000 } });
        node.applyClocks({ black_clock: { main_time: 500 } });
        expect(node.black_clock).toEqual({ main_time: 500 });
        expect(node.white_clock).toEqual({ main_time: 2000 });

        node.applyClocks({ white_clock: null });
        expect(node.white_clock).toBeUndefined();
        expect(node.black_clock).toEqual({ main_time: 500 });
        goban.destroy();
    });
});

describe("clocks arriving from the server", () => {
    test("a live move's clock lands on the new node", async () => {
        const [server, client, goban] = await connect({ game_id: 321, width: 9, height: 9 });

        handler(
            goban,
            "game/321/move",
        )({
            game_id: 321,
            move_number: 1,
            move: [2, 2, 900, undefined, { black_clock: { main_time: 1000 } }],
        });

        expect(goban.engine.last_official_move.black_clock).toEqual({ main_time: 1000 });
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("a review replays, then clears, a node clock", async () => {
        const [server, client, goban] = await connect({ review_id: 77, width: 9, height: 9 });
        const full_state = handler(goban, "review/77/full_state");

        full_state(reviewLog({ f: 0, m: "dd" }, { black_clock: { main_time: 42000 } }));
        const node = goban.engine.cur_review_move!;
        expect(node.black_clock).toEqual({ main_time: 42000 });

        full_state(
            reviewLog(
                { f: 0, m: "dd" },
                { black_clock: { main_time: 42000 } },
                { black_clock: null },
            ),
        );
        expect(goban.engine.cur_review_move!.black_clock).toBeUndefined();
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("an official move relayed to a review keeps its clock", async () => {
        const [server, client, goban] = await connect({ review_id: 78, width: 9, height: 9 });

        handler(
            goban,
            "review/78/full_state",
        )(reviewLog({ om: [2, 2, 0, undefined, { black_clock: { main_time: 61000 } }] }));

        expect(goban.engine.last_official_move.black_clock).toEqual({ main_time: 61000 });
        client.disconnect();
        server.close();
        goban.destroy();
    });
});

describe("setReviewNodeClock", () => {
    function reviewBoard(controller: boolean) {
        const goban = new TestGoban({ review_id: 123, width: 9, height: 9 });
        const send = jest.fn();
        (goban as any).done_loading_review = true;
        (goban as any).isPlayerController = () => controller;
        (goban as any).socket = { send };
        goban.engine.place(3, 3);
        return { goban, send };
    }

    test("the controller sets the clock and sends it with the node's path", () => {
        const { goban, send } = reviewBoard(true);
        const clock = { main_time: 0, period_time_left: 30000, periods_left: 3 };

        goban.setReviewNodeClock("white", clock);

        expect(goban.engine.cur_move.white_clock).toEqual(clock);
        expect(send).toHaveBeenCalledWith("review/append", {
            f: 0,
            m: "dd",
            white_clock: clock,
            review_id: 123,
        });
        goban.destroy();
    });

    test("the controller's own view is told the review changed", () => {
        const { goban } = reviewBoard(true);
        const updated = jest.fn();
        goban.on("review.updated", updated);

        goban.setReviewNodeClock("black", { main_time: 5000 });

        expect(updated).toHaveBeenCalledTimes(1);
        goban.destroy();
    });

    test("clearing sends null", () => {
        const { goban, send } = reviewBoard(true);
        goban.setReviewNodeClock("black", { main_time: 5000 });
        goban.setReviewNodeClock("black", null);

        expect(goban.engine.cur_move.black_clock).toBeUndefined();
        expect(send).toHaveBeenLastCalledWith(
            "review/append",
            expect.objectContaining({ black_clock: null }),
        );
        goban.destroy();
    });

    test("a sync back on the previously synced node still names that node", () => {
        const { goban, send } = reviewBoard(true);
        goban.syncReviewMove();
        const synced = goban.engine.cur_move;
        goban.engine.place(5, 5);
        goban.setReviewNodeClock("black", { main_time: 5000 });

        goban.engine.jumpTo(synced);
        goban.syncReviewMove(undefined, "Comment on dd");

        expect(send).toHaveBeenLastCalledWith(
            "review/append",
            expect.objectContaining({ f: 0, m: "dd", t: "Comment on dd" }),
        );
        goban.destroy();
    });

    test("a viewer cannot set clocks", () => {
        const { goban, send } = reviewBoard(false);
        goban.setReviewNodeClock("black", { main_time: 5000 });

        expect(send).not.toHaveBeenCalled();
        expect(goban.engine.cur_move.black_clock).toBeUndefined();
        goban.destroy();
    });
});

describe("demo boards", () => {
    let next_review_id = 300;
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        jest.restoreAllMocks();
    });

    const now = (ms: number) => jest.spyOn(Date, "now").mockReturnValue(ms);

    /** A board loaded from a review log with a byo-yomi time control */
    async function demo(
        entries: any[],
        { controller = false, record = false, gamedata = {} } = {},
    ) {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        cleanups.push(() => {
            client.disconnect();
            server.close();
            goban.destroy();
        });
        const full_state = handler(goban, `review/${review_id}/full_state`);
        const load = (entries: any[]) => {
            const log = reviewLog(...entries);
            Object.assign(log[0].gamedata, { time_control: BYOYOMI }, gamedata);
            full_state(log);
            goban.enableStonePlacement();
        };
        load(entries);
        const setController = (on: boolean) => ((goban as any).isPlayerController = () => on);
        setController(controller);
        (goban as any).mode = "analyze";
        goban.review_record_moves = record;
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        return {
            goban,
            review_id,
            load,
            setController,
            receive: handler(goban, `review/${review_id}/r`),
            tap: (x: number, y: number) => (goban as any).tapAtImpl(x, y, false, false, false, 0),
            sent: (): any[] =>
                send.mock.calls
                    .filter((call) => call[0] === "review/append")
                    .map((call) => call[1]),
        };
    }
    type Board = Awaited<ReturnType<typeof demo>>;

    const started = [
        { clock_running: true, ts: 1000 },
        { om: [2, 2, 0, 0, { black_clock: { main_time: 590000 } }], ts: 11000 },
    ];
    const white_set = { f: 1, m: "", white_clock: { main_time: 300000 }, ts: 15000 };
    const one_move = [{ om: [2, 2, 0, 0], ts: 1000 }];
    const two_moves = [...one_move, { om: [3, 3, 0, 0], ts: 2000 }];

    describe("running clock", () => {
        test.each([
            [
                "the player on move counts down from the start of their turn",
                started,
                21000,
                "white",
                590000,
            ],
            ["the player not on move keeps their clock", started, 21000, "black", 590000],
            [
                "a pause stops the countdown",
                [...started, { clock_running: false, ts: 16000 }],
                99999,
                "white",
                595000,
            ],
            [
                "setting the clock of the player on move starts their turn again",
                [...started, white_set],
                20000,
                "white",
                295000,
            ],
            [
                "clearing it starts their turn again from the clock before",
                [...started, white_set, { ...white_set, white_clock: null, ts: 17000 }],
                18000,
                "white",
                599000,
            ],
            [
                "setting a clock on an earlier move leaves the turn alone",
                [
                    ...started,
                    { om: [3, 3, 0, 0], ts: 12000 },
                    { f: 1, m: "", black_clock: { main_time: 500000 }, ts: 13000 },
                ],
                14000,
                "black",
                498000,
            ],
            [
                "an undo goes back to the turn before, with the time it used",
                [
                    ...started,
                    { om: [3, 3, 0, 0, { white_clock: { main_time: 580000 } }], ts: 31000 },
                    { undo: true, ts: 36000 },
                ],
                41000,
                "white",
                570000,
            ],
            [
                "a local time behind the last server time adds no time",
                started,
                10500,
                "white",
                600000,
            ],
        ])("%s", async (_, entries, at, color, main_time) => {
            const { goban } = await demo(entries);
            now(at);
            expect(goban.getReviewClock(color as "black" | "white")?.clock).toEqual({ main_time });
        });

        test.each([
            ["before the clock first starts", one_move, {}],
            ["on a review of an OGS game", started, { game_id: 5 }],
        ])("there is no running clock %s", async (_, entries, gamedata) => {
            const { goban } = await demo(entries, { gamedata });
            expect(goban.getReviewClock("white")).toBeNull();
        });

        test("an uploaded SGF's own time settings take precedence", async () => {
            const { goban } = await demo([{ clock_running: true, ts: 1000 }], {
                gamedata: {
                    time_control: { system: "none", speed: "correspondence" },
                    original_sgf: "(;GM[1]FF[4]SZ[9]TM[600]OT[5x30 byo-yomi];B[cc]BL[590])",
                },
            });
            now(11000);
            expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 590000 });
        });

        test("a reload rebuilds the clock from the new log", async () => {
            const { goban, load } = await demo(started);
            load(one_move);
            expect(goban.reviewClockRunning()).toBe(false);
            expect(goban.getReviewClock("white")).toBeNull();
        });

        test("the controller's Resume and Pause apply when the server sends them back", async () => {
            const { goban, review_id, receive, sent } = await demo(one_move, { controller: true });
            goban.setReviewClockRunning(true);
            expect(goban.reviewClockRunning()).toBe(false);
            goban.setReviewClockRunning(false);
            expect(sent()).toEqual([
                { review_id, clock_running: true },
                { review_id, clock_running: false },
            ]);

            receive({ ...sent()[0], ts: 2000 });
            expect(goban.reviewClockRunning()).toBe(true);
            receive({ ...sent()[1], ts: 2500 });
            now(9000);
            expect(goban.getReviewClock("white")).toEqual({
                clock: { main_time: 599500 },
                on_move: true,
                running: false,
            });
        });

        test("the controller's clock edit for the player on move starts their turn at once", async () => {
            const board = await demo([{ clock_running: true, ts: 1000 }], {
                controller: true,
                record: true,
            });
            now(61000);
            board.goban.setReviewNodeClock("black", { main_time: 300000 });
            // The controller does not apply the server's copy of its own edit
            board.receive({ ...board.sent()[0], ts: 61500 });
            now(62000);
            board.tap(4, 4);
            expect(board.sent()[1].om[4]).toEqual({ black_clock: { main_time: 299000 } });
        });

        test("a viewer cannot run the clock or undo", async () => {
            const { goban, sent } = await demo(two_moves);
            goban.setReviewClockRunning(true);
            goban.undoOfficialMove();
            expect(sent()).toEqual([]);
        });
    });

    describe("Record", () => {
        test.each([
            ["a stone", (board: Board) => board.tap(4, 4), [4, 4, 0, 0]],
            ["a pass", (board: Board) => board.goban.pass(), [-1, -1, 0, 0]],
        ])("at the live move sends %s as a game move only", async (_, play, om) => {
            const board = await demo(one_move, { controller: true, record: true });
            const live = board.goban.engine.last_official_move;
            play(board);
            expect(board.sent()).toEqual([{ review_id: board.review_id, om }]);
            expect(board.goban.engine.cur_move.id).toBe(live.id);
            expect(live.branches).toEqual([]);
        });

        test.each([
            ["off", false, false],
            ["away from the live move", true, true],
        ])("%s sends a stone as a variation", async (_, record, away) => {
            const board = await demo(two_moves, { controller: true, record });
            if (away) {
                board.goban.engine.jumpTo(board.goban.engine.last_official_move.parent!);
            }
            board.tap(4, 4);
            expect(board.sent()).toEqual([expect.objectContaining({ m: "ee" })]);
            expect(board.sent()[0]).not.toHaveProperty("om");
        });

        test("keeps a variation that a stone at the live move follows", async () => {
            const board = await demo([...one_move, { f: 1, m: "ee", ts: 2000 }], {
                controller: true,
                record: true,
            });
            const live = board.goban.engine.last_official_move;
            board.goban.engine.jumpTo(live);
            board.tap(4, 4);
            expect(board.sent()).toEqual([{ review_id: board.review_id, om: [4, 4, 0, 0] }]);
            expect(live.branches.map((branch) => [branch.x, branch.y])).toEqual([[4, 4]]);
        });

        test.each([
            ["the time they used", [{ clock_running: true, ts: 1000 }], 6000, 595000],
            [
                "the time used before a pause",
                [
                    { clock_running: true, ts: 1000 },
                    { clock_running: false, ts: 11000 },
                ],
                20000,
                590000,
            ],
            [
                "no clock for a turn the clock never timed",
                [
                    { clock_running: true, ts: 1000 },
                    { clock_running: false, ts: 1000 },
                ],
                20000,
                undefined,
            ],
            ["no clock before the clock first starts", [], 20000, undefined],
        ])("saves with the game move %s", async (_, entries, at, main_time) => {
            const board = await demo(entries, { controller: true, record: true });
            now(at);
            board.tap(4, 4);
            const clock = main_time ? [{ black_clock: { main_time } }] : [];
            expect(board.sent()[0].om).toEqual([4, 4, 0, 0, ...clock]);
        });

        test("saves the Fischer increment for a move made the moment the clock starts", async () => {
            const board = await demo([{ clock_running: true, ts: 1000 }], {
                controller: true,
                record: true,
                gamedata: {
                    time_control: {
                        system: "fischer",
                        speed: "live",
                        initial_time: 600,
                        time_increment: 10,
                        max_time: 900,
                    },
                },
            });
            now(1000);
            board.tap(4, 4);
            expect(board.sent()[0].om[4]).toEqual({ black_clock: { main_time: 610000 } });
        });

        test.each([
            [
                "a second stone",
                (board: Board) => board.tap(4, 4),
                (board: Board) => board.tap(5, 5),
            ],
            [
                "a stone after an undo",
                (board: Board) => board.goban.undoOfficialMove(),
                (board: Board) => board.tap(5, 5),
            ],
            [
                "a second undo",
                (board: Board) => board.goban.undoOfficialMove(),
                (board: Board) => board.goban.undoOfficialMove(),
            ],
        ])("drops %s until the server sends the first change back", async (_, first, second) => {
            const board = await demo(two_moves, { controller: true, record: true });
            const live = board.goban.engine.last_official_move;
            first(board);
            second(board);
            expect(board.sent()).toHaveLength(1);
            expect(live.branches).toEqual([]);
        });

        test.each([
            [
                "the server sends it back",
                (board: Board) => board.receive({ ...board.sent()[0], ts: 2000 }),
            ],
            ["the review reloads", (board: Board) => board.load([])],
            [
                "control changes",
                (board: Board) => {
                    board.setController(false);
                    board.receive({ controller: 99, ts: 2000 });
                    board.setController(true);
                },
            ],
        ])("sends the next game move after %s", async (_, settle) => {
            const board = await demo(one_move, { controller: true, record: true });
            board.tap(4, 4);
            settle(board);
            board.tap(5, 5);
            expect(board.sent().filter((msg) => "om" in msg)).toHaveLength(2);
        });

        test("after a game move, a sync on the move before names that move", async () => {
            const board = await demo(one_move, { controller: true, record: true });
            const before = board.goban.engine.last_official_move;
            board.goban.syncReviewMove();
            board.tap(4, 4);
            board.receive({ ...board.sent()[1], ts: 2000 });
            board.goban.engine.jumpTo(before);
            board.goban.syncReviewMove(undefined, "a comment");
            expect(board.sent().slice(-1)[0]).toMatchObject({ f: 1, m: "", t: "a comment" });
        });

        /** Relays, in order, what the controller sent since the last relay,
         * including anything it sends while receiving */
        function relayer(board: Board, viewer: Board) {
            let relayed = board.sent().length;
            return (ts: number) => {
                while (relayed < board.sent().length) {
                    const msg = { ...board.sent()[relayed++], ts };
                    board.receive(msg);
                    viewer.receive(msg);
                }
            };
        }

        test("a sync while a game move is in flight leaves viewers following the game", async () => {
            const board = await demo(one_move, { controller: true, record: true });
            const viewer = await demo(one_move);
            const relay = relayer(board, viewer);
            board.tap(4, 4);
            board.goban.syncReviewMove(undefined, "a comment on move 1");
            relay(2000);
            board.tap(5, 5);
            relay(3000);
            expect(viewer.goban.engine.cur_move.move_number).toBe(3);
        });

        test("a comment typed on a move being undone does not replace the move before's", async () => {
            const log = [
                ...one_move,
                { f: 1, m: "", t: "move 1", ts: 1100 },
                { om: [3, 3, 0, 0], ts: 2000 },
                { f: 2, m: "", t: "move 2", ts: 2100 },
            ];
            const board = await demo(log, { controller: true, record: true });
            const viewer = await demo(log);
            const relay = relayer(board, viewer);
            board.goban.undoOfficialMove();
            board.goban.syncReviewMove(undefined, "move 2!");
            relay(3000);
            expect(viewer.goban.engine.last_official_move.text).toBe("move 1");
        });

        test.each([0, 1])(
            "records nothing for a pass during handicap placement (%i stones placed)",
            async (placed) => {
                const board = await demo(placed ? one_move : [], {
                    controller: true,
                    record: true,
                    gamedata: { handicap: 3, free_handicap_placement: true },
                });
                const { engine } = board.goban;
                const live = engine.last_official_move;
                expect(() => board.goban.pass()).not.toThrow();
                expect(engine.last_official_move.id).toBe(live.id);
                expect((live.parent ? live.parent.trunk_next : engine.move_tree)?.id).toBe(live.id);
                expect(board.sent().filter((msg) => "om" in msg)).toEqual([]);
            },
        );
    });

    describe("undo", () => {
        test("the controller's undo removes the game move on a demo board", async () => {
            const board = await demo(two_moves, { controller: true, record: true });
            board.goban.undoOfficialMove();
            expect(board.sent()).toEqual([{ review_id: board.review_id, undo: true }]);
            board.receive({ undo: true, ts: 3000 });
            const live = board.goban.engine.last_official_move;
            expect([live.x, live.y, live.trunk_next]).toEqual([2, 2, undefined]);
        });

        /** The color of the stone on (x, y) at the live move: 0, 1 or 2 */
        const liveStone = (board: Board, x: number, y: number) =>
            board.goban.engine.last_official_move.state.board[y][x];

        test("a game move on a point with a stone replaces that stone, and the log replays on", async () => {
            const board = await demo([
                ...one_move,
                { om: [2, 2, 0, 0], ts: 2000 },
                { om: [4, 4, 0, 0], ts: 3000 },
                { t: "after", ts: 3100 },
            ]);
            const live = board.goban.engine.last_official_move;
            expect([live.x, live.y, live.text]).toEqual([4, 4, "after"]);
            expect(liveStone(board, 2, 2)).toBe(2);
        });

        test("an undo of a replacing game move puts the old stone and its turn back", async () => {
            const board = await demo([
                ...started,
                { om: [2, 2, 0, 0], ts: 21000 },
                { undo: true, ts: 26000 },
                { t: "back", ts: 27000 },
            ]);
            now(31000);
            const live = board.goban.engine.last_official_move;
            expect([live.text, live.trunk_next]).toEqual(["back", undefined]);
            expect(liveStone(board, 2, 2)).toBe(1);
            expect(board.goban.getReviewClock("white")?.clock).toEqual({ main_time: 580000 });
        });

        test("an undo on a review of an OGS game keeps the move", async () => {
            const { goban } = await demo([...two_moves, { undo: true }], {
                gamedata: { game_id: 5 },
            });
            const live = goban.engine.last_official_move;
            expect([live.x, live.y, live.trunk_next?.x, live.trunk_next?.y]).toEqual([2, 2, 3, 3]);
        });

        test.each([
            ["after the undone move goes back to the move before it", false],
            ["on another variation stays there", true],
        ])("a viewer %s", async (_, elsewhere) => {
            const { goban, receive } = await demo(two_moves);
            if (elsewhere) {
                goban.engine.jumpTo(goban.engine.last_official_move.parent!);
            }
            goban.engine.place(5, 5);
            const variation = goban.engine.cur_move;
            receive({ undo: true, ts: 3000 });
            const expected = elsewhere ? variation : goban.engine.last_official_move;
            expect(goban.engine.cur_move.id).toBe(expected.id);
        });

        test("a viewer following the review onto a variation after the undone move goes back to the move before it", async () => {
            const { goban, receive } = await demo([...two_moves, { f: 2, m: "ff", ts: 2500 }]);
            receive({ undo: true, ts: 3000 });
            expect(goban.engine.cur_move.id).toBe(goban.engine.last_official_move.id);
        });
    });
});
