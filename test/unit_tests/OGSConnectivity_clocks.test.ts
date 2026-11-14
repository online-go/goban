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
            clock_request_id: expect.any(String),
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

describe("official moves on demo boards", () => {
    function demoLog(game_id: number | undefined, ...entries: any[]): any[] {
        const log = reviewLog(...entries);
        if (game_id) {
            log[0].gamedata.game_id = game_id;
        }
        return log;
    }

    function nodesAt(root: any, x: number, y: number): any[] {
        const found: any[] = [];
        const walk = (node: any) => {
            if (node.x === x && node.y === y) {
                found.push(node);
            }
            if (node.trunk_next) {
                walk(node.trunk_next);
            }
            for (const branch of node.branches) {
                walk(branch);
            }
        };
        walk(root);
        return found;
    }

    test("an om on an occupied point is skipped and the replay continues", async () => {
        const [server, client, goban] = await connect({ review_id: 90, width: 9, height: 9 });
        jest.spyOn(console, "warn").mockImplementation(() => {});

        handler(
            goban,
            "review/90/full_state",
        )(demoLog(undefined, { om: [2, 2, 0, 0] }, { om: [2, 2, 0, 0] }, { om: [3, 3, 0, 0] }));

        const last = goban.engine.last_official_move;
        expect([last.x, last.y, last.move_number]).toEqual([3, 3, 2]);
        expect([last.parent!.x, last.parent!.y]).toEqual([2, 2]);
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("undo on a demo board deletes the undone move", async () => {
        const [server, client, goban] = await connect({ review_id: 91, width: 9, height: 9 });

        handler(
            goban,
            "review/91/full_state",
        )(demoLog(undefined, { om: [2, 2, 0, 0] }, { om: [3, 3, 0, 0] }, { undo: true }));

        const last = goban.engine.last_official_move;
        expect([last.x, last.y]).toEqual([2, 2]);
        expect(last.trunk_next).toBeUndefined();
        expect(nodesAt(goban.engine.move_tree, 3, 3)).toEqual([]);
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("undo moves a viewer on a deleted move to the move before it", async () => {
        const [server, client, goban] = await connect({ review_id: 93, width: 9, height: 9 });
        handler(
            goban,
            "review/93/full_state",
        )(demoLog(undefined, { om: [2, 2, 0, 0] }, { om: [3, 3, 0, 0] }));
        goban.engine.place(4, 4); // the viewer's own variation after the move being undone

        handler(goban, "review/93/r")({ undo: true });

        const live = goban.engine.last_official_move;
        expect([live.x, live.y]).toEqual([2, 2]);
        expect(goban.engine.cur_move.id).toBe(live.id);
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("undo leaves a viewer's variation elsewhere alone", async () => {
        const [server, client, goban] = await connect({ review_id: 94, width: 9, height: 9 });
        handler(
            goban,
            "review/94/full_state",
        )(demoLog(undefined, { om: [2, 2, 0, 0] }, { om: [3, 3, 0, 0] }));
        goban.engine.jumpTo(goban.engine.last_official_move.parent!);
        goban.engine.place(5, 5);
        const variation = goban.engine.cur_move;

        handler(goban, "review/94/r")({ undo: true });

        expect(goban.engine.cur_move.id).toBe(variation.id);
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("a viewer on a variation that becomes the game move ends on the game move", async () => {
        const [server, client, goban] = await connect({ review_id: 95, width: 9, height: 9 });
        handler(goban, "review/95/full_state")(demoLog(undefined, { om: [2, 2, 0, 0] }));
        goban.engine.place(3, 3); // the viewer's own variation

        handler(goban, "review/95/r")({ om: [3, 3, 0, 0] });

        const live = goban.engine.last_official_move;
        expect([live.x, live.y]).toEqual([3, 3]);
        expect(goban.engine.cur_move.id).toBe(live.id);
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("undo on a review of a game keeps today's behavior", async () => {
        const [server, client, goban] = await connect({ review_id: 92, width: 9, height: 9 });

        handler(
            goban,
            "review/92/full_state",
        )(demoLog(5, { om: [2, 2, 0, 0] }, { om: [3, 3, 0, 0] }, { undo: true }));

        const last = goban.engine.last_official_move;
        expect([last.x, last.y]).toEqual([2, 2]);
        expect([last.trunk_next?.x, last.trunk_next?.y]).toEqual([3, 3]);
        client.disconnect();
        server.close();
        goban.destroy();
    });
});

describe("demo board running clock", () => {
    let next_review_id = 300;

    function clockLog(game_id: number | undefined, ...entries: any[]): any[] {
        const log = reviewLog(...entries);
        log[0].gamedata.time_control = BYOYOMI;
        if (game_id) {
            log[0].gamedata.game_id = game_id;
        }
        return log;
    }

    async function demo(...entries: any[]) {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        const full_state = handler(goban, `review/${review_id}/full_state`);
        full_state(clockLog(undefined, ...entries));
        const done = () => {
            client.disconnect();
            server.close();
            goban.destroy();
        };
        return { goban, review_id, full_state, done };
    }

    const now = (ms: number) => jest.spyOn(Date, "now").mockReturnValue(ms);
    afterEach(() => jest.restoreAllMocks());

    const started = [
        { clock_running: true, ts: 1000 },
        { om: [2, 2, 0, 0, { black_clock: { main_time: 590000 } }], ts: 11000 },
    ];

    test("no clock before it is started", async () => {
        const { goban, done } = await demo({ om: [2, 2, 0, 0], ts: 11000 });
        expect(goban.getReviewClock("black")).toBeNull();
        expect(goban.getReviewClock("white")).toBeNull();
        done();
    });

    test("running counts down the player on move", async () => {
        const { goban, done } = await demo(...started);
        now(21000);
        expect(goban.getReviewClock("white")).toEqual({
            clock: { main_time: 590000 },
            on_move: true,
            running: true,
        });
        expect(goban.getReviewClock("black")).toEqual({
            clock: { main_time: 590000 },
            on_move: false,
            running: true,
        });
        done();
    });

    test("pause stops the charge", async () => {
        const { goban, done } = await demo(...started, { clock_running: false, ts: 16000 });
        now(99999);
        expect(goban.getReviewClock("white")).toEqual({
            clock: { main_time: 595000 },
            on_move: true,
            running: false,
        });
        done();
    });

    const edited = [...started, { f: 1, m: "", white_clock: { main_time: 300000 }, ts: 15000 }];

    test("an edit for the player on move restarts the turn", async () => {
        const { goban, done } = await demo(...edited);
        now(20000);
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 295000 });
        done();
    });

    test("an edit on an earlier move carries forward", async () => {
        const { goban, done } = await demo(
            ...started,
            { om: [3, 3, 0, 0], ts: 12000 },
            { f: 1, m: "", black_clock: { main_time: 500000 }, ts: 13000 },
        );
        now(14000);
        expect(goban.getReviewClock("black")).toEqual({
            clock: { main_time: 498000 },
            on_move: true,
            running: true,
        });
        done();
    });

    test("an om with both clocks sets the next player's base", async () => {
        const { goban, done } = await demo(
            { clock_running: true, ts: 1000 },
            {
                om: [
                    2,
                    2,
                    0,
                    0,
                    { black_clock: { main_time: 590000 }, white_clock: { main_time: 400000 } },
                ],
                ts: 11000,
            },
        );
        now(12000);
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 399000 });
        done();
    });

    test("clearing on the live move restarts from the earlier clock", async () => {
        const { goban, done } = await demo(...edited, {
            f: 1,
            m: "",
            white_clock: null,
            ts: 17000,
        });
        now(18000);
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 599000 });
        done();
    });

    test("a game move that cannot be placed leaves the turn's time alone", async () => {
        const { goban, review_id, done } = await demo(...started);
        jest.spyOn(console, "warn").mockImplementation(() => {});
        now(21000);
        handler(goban, `review/${review_id}/r`)({ om: [2, 2, 0, 0], ts: 21000 });
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 590000 });
        done();
    });

    test("an undo with no game move to take back leaves the turn's time alone", async () => {
        const { goban, review_id, done } = await demo({ clock_running: true, ts: 1000 });
        now(11000);
        handler(goban, `review/${review_id}/r`)({ undo: true, ts: 11000 });
        expect(goban.getReviewClock("black")?.clock).toEqual({ main_time: 590000 });
        done();
    });

    test("an undo goes back to the mover's turn with the time they had used", async () => {
        const { goban, review_id, done } = await demo(...started);
        const receive = handler(goban, `review/${review_id}/r`);
        receive({ om: [3, 3, 0, 0, { white_clock: { main_time: 580000 } }], ts: 31000 });
        receive({ undo: true, ts: 36000 }); // a wrong move, taken back
        now(41000);
        // White's turn began at 11000
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 570000 });
        done();
    });

    test.each([
        ["no path", {}],
        ["a path through the move", { f: 0, m: "cc" }],
        ["the live move's own path", { f: 1, m: "" }],
    ])("a clock set for the player on move restarts their turn, named by %s", async (_, path) => {
        const { goban, review_id, done } = await demo(...started);
        now(21000);
        handler(
            goban,
            `review/${review_id}/r`,
        )({
            ...path,
            white_clock: { main_time: 300000 },
            ts: 16000,
        });
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 295000 });
        done();
    });

    test("the controller applies a clock set by another session on its account", async () => {
        const { goban, review_id, done } = await demo(...started);
        (goban as any).isPlayerController = () => true;
        const root = goban.engine.move_tree;
        goban.engine.jumpTo(root);
        now(21000);

        handler(
            goban,
            `review/${review_id}/r`,
        )({
            f: 1,
            m: "",
            white_clock: { main_time: 300000 },
            ts: 16000,
        });

        expect(goban.engine.last_official_move.white_clock).toEqual({ main_time: 300000 });
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 295000 });
        expect(goban.engine.cur_move.id).toBe(root.id);
        done();
    });

    test("a server time ahead of this browser's estimate adds no time", async () => {
        const { goban, done } = await demo(...started);
        now(10500); // before the move's own ts
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 600000 });
        done();
    });

    test("an uploaded SGF's own time settings run the clock", async () => {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        const log = clockLog(undefined, { clock_running: true, ts: 1000 });
        Object.assign(log[0].gamedata, {
            time_control: { system: "none", speed: "correspondence" },
            original_sgf: "(;GM[1]FF[4]SZ[9]TM[600]OT[5x30 byo-yomi];B[cc]BL[590])",
        });
        handler(goban, `review/${review_id}/full_state`)(log);
        now(11000);
        expect(goban.getReviewClock("white")?.clock).toEqual({ main_time: 590000 });
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("a reload rebuilds the same elapsed time", async () => {
        const log = [
            ...started,
            { clock_running: false, ts: 16000 },
            { clock_running: true, ts: 30000 },
        ];
        const { goban, full_state, done } = await demo(...log);
        now(35000);
        const first = goban.getReviewClock("white");
        full_state(clockLog(undefined, ...log));
        expect(goban.getReviewClock("white")).toEqual(first);
        expect(first?.clock).toEqual({ main_time: 590000 });
        done();
    });

    test("a second full_state resets the clock", async () => {
        const { goban, full_state, done } = await demo(...started);
        full_state(clockLog(undefined, { om: [2, 2, 0, 0], ts: 11000 }));
        expect(goban.getReviewClock("white")).toBeNull();
        expect(goban.reviewClockRunning()).toBe(false);
        done();
    });

    test("the controller sees its own clock_running", async () => {
        const { goban, review_id, done } = await demo({ om: [2, 2, 0, 0], ts: 11000 });
        (goban as any).isPlayerController = () => true;
        (goban as any).done_loading_review = true;
        handler(goban, `review/${review_id}/r`)({ clock_running: true, ts: 12000 });
        expect(goban.reviewClockRunning()).toBe(true);
        done();
    });

    test("reviews of games never run a clock", async () => {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        handler(goban, `review/${review_id}/full_state`)(clockLog(5, ...started));
        expect(goban.getReviewClock("white")).toBeNull();
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("setReviewClockRunning sends and takes effect at once", async () => {
        const { goban, review_id, done } = await demo({ om: [2, 2, 0, 0], ts: 11000 });
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        (goban as any).isPlayerController = () => true;
        goban.setReviewClockRunning(true);
        expect(send).toHaveBeenCalledWith("review/append", {
            review_id,
            clock_running: true,
            clock_request_id: expect.any(String),
        });
        expect(goban.reviewClockRunning()).toBe(true);
        done();
    });

    test("undoOfficialMove sends an undo", async () => {
        const { goban, review_id, done } = await demo({ om: [2, 2, 0, 0], ts: 11000 });
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        (goban as any).isPlayerController = () => true;
        goban.undoOfficialMove();
        expect(send).toHaveBeenCalledWith("review/append", { review_id, undo: true });
        done();
    });

    test("undoOfficialMove with no game move to take back sends nothing", async () => {
        const { goban, done } = await demo();
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        (goban as any).isPlayerController = () => true;
        goban.undoOfficialMove();
        goban.setReviewNodeClock("black", { main_time: 1000 });
        expect(send.mock.calls.map((call) => call[1])).not.toContainEqual(
            expect.objectContaining({ undo: true }),
        );
        expect(send).toHaveBeenCalledWith(
            "review/append",
            expect.objectContaining({ black_clock: { main_time: 1000 } }),
        );
        done();
    });
});

describe("Record mode on demo boards", () => {
    let next_review_id = 500;
    afterEach(() => jest.restoreAllMocks());

    function recorder(record: boolean, ...entries: any[]) {
        return recorderWith({}, record, ...entries);
    }

    async function recorderWith(gamedata: object, record: boolean, ...entries: any[]) {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        const log = reviewLog(...entries);
        Object.assign(log[0].gamedata, { time_control: BYOYOMI }, gamedata);
        handler(goban, `review/${review_id}/full_state`)(log);
        (goban as any).isPlayerController = () => true;
        (goban as any).mode = "analyze";
        goban.enableStonePlacement();
        goban.review_record_moves = record;
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        const tap = (x: number, y: number) =>
            (goban as any).tapAtImpl(x, y, false, false, false, 0);
        const receive = handler(goban, `review/${review_id}/r`);
        const done = () => {
            client.disconnect();
            server.close();
            goban.destroy();
        };
        return { goban, review_id, send, tap, receive, done };
    }

    const appended = (send: jest.SpyInstance) =>
        send.mock.calls.filter((call) => call[0] === "review/append").map((call) => call[1]);

    test("Record off sends a variation", async () => {
        const { send, tap, done } = await recorder(false, { om: [2, 2, 0, 0], ts: 1000 });
        tap(4, 4);
        const sent = appended(send);
        expect(sent.length).toBe(1);
        expect(sent[0]).toMatchObject({ m: "ee" });
        expect(sent[0]).not.toHaveProperty("om");
        done();
    });

    test("Record on at the live move sends only om", async () => {
        const { goban, review_id, send, tap, done } = await recorder(true, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        tap(4, 4);
        expect(appended(send)).toEqual([{ review_id, om: [4, 4, 0, 0] }]);
        expect(goban.engine.last_official_move.branches).toEqual([]);
        expect(goban.engine.cur_move.id).toBe(goban.engine.last_official_move.id);
        done();
    });

    test("Record on with a running clock saves the worked-out clock", async () => {
        const { send, tap, done } = await recorder(true, { clock_running: true, ts: 1000 });
        jest.spyOn(Date, "now").mockReturnValue(6000);
        tap(4, 4);
        expect(appended(send)[0].om).toEqual([4, 4, 0, 0, { black_clock: { main_time: 595000 } }]);
        done();
    });

    const lastOm = (send: jest.SpyInstance) => appended(send).slice(-1)[0].om;

    test("a move recorded while paused keeps the time used before the pause", async () => {
        const { send, tap, done } = await recorder(
            true,
            { clock_running: true, ts: 1000 },
            { clock_running: false, ts: 11000 },
        );
        jest.spyOn(Date, "now").mockReturnValue(20000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0, { black_clock: { main_time: 590000 } }]);
        done();
    });

    test("a move on a turn paused throughout saves no clock", async () => {
        const { send, tap, done } = await recorder(
            true,
            { clock_running: true, ts: 1000 },
            { clock_running: false, ts: 1000 },
        );
        jest.spyOn(Date, "now").mockReturnValue(20000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0]);
        done();
    });

    test("a clock typed just before a move counts from when it was typed", async () => {
        const { goban, send, tap, done } = await recorder(true, { clock_running: true, ts: 1000 });
        const now = jest.spyOn(Date, "now").mockReturnValue(61000);
        goban.setReviewNodeClock("black", { main_time: 300000 });
        now.mockReturnValue(62000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0, { black_clock: { main_time: 299000 } }]);
        done();
    });

    test("the server's copy of the controller's clock edit times it from the server", async () => {
        const { goban, send, tap, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        const now = jest.spyOn(Date, "now").mockReturnValue(61000);
        goban.setReviewNodeClock("black", { main_time: 300000 });
        receive({ ...appended(send)[0], ts: 61500 });
        now.mockReturnValue(62000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0, { black_clock: { main_time: 299500 } }]);
        done();
    });

    test("Resume just before a move times it", async () => {
        const { goban, send, tap, done } = await recorder(true);
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        goban.setReviewClockRunning(true);
        now.mockReturnValue(3000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0, { black_clock: { main_time: 598000 } }]);
        done();
    });

    test("an older edit echo preserves a newer edit and the recorded move", async () => {
        const { goban, send, tap, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(61000);
            goban.setReviewNodeClock("black", { main_time: 300000 });
            now.mockReturnValue(62000);
            goban.setReviewNodeClock("black", { main_time: 400000 });
            const [first, second] = appended(send);
            now.mockReturnValue(62500);
            receive({ ...first, ts: 61500 });
            expect(goban.engine.cur_move.black_clock).toEqual({ main_time: 400000 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(399500);
            now.mockReturnValue(63000);
            tap(2, 2);
            const move = appended(send)[2];
            expect(move.om[4].black_clock.main_time).toBe(399000);
            receive({ ...second, ts: 62500 });
            receive({ ...move, ts: 63500 });
            expect(goban.engine.last_official_move.black_clock?.main_time).toBe(399000);

            const replay = await recorder(
                true,
                { clock_running: true, ts: 1000 },
                { ...first, ts: 61500 },
                { ...second, ts: 62500 },
                { ...move, ts: 63500 },
            );
            try {
                expect(replay.goban.engine.last_official_move.black_clock).toEqual(
                    goban.engine.last_official_move.black_clock,
                );
            } finally {
                replay.done();
            }
        } finally {
            done();
        }
    });

    test("a Resume echo cannot resume a pending Pause or count the same run twice", async () => {
        const { goban, send, tap, receive, done } = await recorder(true);
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(1000);
            goban.setReviewClockRunning(true);
            now.mockReturnValue(2000);
            goban.setReviewClockRunning(false);
            const [resume, pause] = appended(send);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599000);
            now.mockReturnValue(3000);
            receive({ ...resume, ts: 1500 });
            expect(goban.reviewClockRunning()).toBe(false);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599500);
            receive({ ...pause, ts: 2500 });
            now.mockReturnValue(4000);
            tap(2, 2);
            expect(lastOm(send)[4].black_clock.main_time).toBe(599000);
        } finally {
            done();
        }
    });

    test("a Pause echo cannot pause a pending Resume", async () => {
        const { goban, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(2000);
            goban.setReviewClockRunning(false);
            now.mockReturnValue(3000);
            goban.setReviewClockRunning(true);
            const [pause, resume] = appended(send);
            now.mockReturnValue(4000);
            receive({ ...pause, ts: 2500 });
            expect(goban.reviewClockRunning()).toBe(true);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(597500);
            receive({ ...resume, ts: 3500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(598000);
        } finally {
            done();
        }
    });

    test("a move recorded before the Pause acknowledgement keeps the pending Pause", async () => {
        const { goban, send, tap, receive, done } = await recorder(true);
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(1000);
            goban.setReviewClockRunning(true);
            now.mockReturnValue(2000);
            goban.setReviewClockRunning(false);
            const [resume, pause] = appended(send);
            now.mockReturnValue(3000);
            receive({ ...resume, ts: 1500 });
            now.mockReturnValue(4000);
            tap(2, 2);
            const move = appended(send)[2];
            // Resume has a confirmed time; Pause still uses its local estimate.
            expect(move.om[4].black_clock.main_time).toBe(599500);
            receive({ ...pause, ts: 2500 });
            receive({ ...move, ts: 4500 });
            expect(goban.engine.last_official_move.black_clock?.main_time).toBe(599500);
        } finally {
            done();
        }
    });

    test("pending edits on other nodes do not restart the live turn", async () => {
        const { goban, send, receive, done } = await recorder(
            true,
            { clock_running: true, ts: 1000 },
            { om: [2, 2, 0, 0], ts: 2000 },
        );
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(3000);
            goban.engine.jumpTo(goban.engine.move_tree);
            goban.setReviewNodeClock("white", { main_time: 400000 });
            now.mockReturnValue(4000);
            goban.setReviewNodeClock("white", { main_time: 500000 });
            const [first, second] = appended(send);
            now.mockReturnValue(5000);
            receive({ ...first, ts: 3500 });
            expect(goban.engine.cur_move).toBe(goban.engine.move_tree);
            expect(goban.getReviewClock("white")?.clock.main_time).toBe(497000);
            receive({ ...second, ts: 4500 });
            expect(goban.getReviewClock("white")?.clock.main_time).toBe(497000);
        } finally {
            done();
        }
    });

    test("another session's identical edit does not acknowledge a local command", async () => {
        const { goban, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(2000);
            goban.setReviewNodeClock("black", { main_time: 400000 });
            const local = appended(send)[0];
            now.mockReturnValue(3000);
            receive({ ...local, clock_request_id: "another-session", ts: 1500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(399000);
            receive({ ...local, ts: 2500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(399500);
            receive({
                ...local,
                black_clock: { main_time: 500000 },
                clock_request_id: "another-session-next",
                ts: 2800,
            });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(499800);
        } finally {
            done();
        }
    });

    test("pending clock commands follow confirmed timestamps even with a slow echo", async () => {
        const { goban, send, receive, done } = await recorder(true);
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(1000);
            goban.setReviewClockRunning(true);
            now.mockReturnValue(2000);
            goban.setReviewClockRunning(false);
            const [resume, pause] = appended(send);
            now.mockReturnValue(4000);
            receive({ ...resume, ts: 3000 });
            expect(goban.reviewClockRunning()).toBe(false);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(600000);
            receive({ ...pause, ts: 3500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599500);
        } finally {
            done();
        }
    });

    test("clearing an absent live clock resets the turn for the controller and replay", async () => {
        const { goban, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(11000);
            goban.setReviewNodeClock("black", null);
            const clear = { ...appended(send)[0], ts: 11500 };
            now.mockReturnValue(12000);
            receive(clear);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599500);
            const replay = await recorder(true, { clock_running: true, ts: 1000 }, clear);
            try {
                expect(replay.goban.getReviewClock("black")).toEqual(goban.getReviewClock("black"));
            } finally {
                replay.done();
            }
        } finally {
            done();
        }
    });

    test("a pending clear survives an older edit echo", async () => {
        const { goban, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(2000);
            goban.setReviewNodeClock("black", { main_time: 400000 });
            now.mockReturnValue(3000);
            goban.setReviewNodeClock("black", null);
            const [edit, clear] = appended(send);
            now.mockReturnValue(4000);
            receive({ ...edit, ts: 2500 });
            expect(goban.engine.cur_move.black_clock).toBeUndefined();
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599000);
            receive({ ...clear, ts: 3500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(599500);
        } finally {
            done();
        }
    });

    test("a full-state reload discards pending commands before replaying the log", async () => {
        const { goban, review_id, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(2000);
            goban.setReviewNodeClock("black", { main_time: 400000 });
            goban.setReviewClockRunning(false);
            const [edit, pause] = appended(send);
            const log = reviewLog({ clock_running: true, ts: 1000 }, { ...edit, ts: 2500 });
            Object.assign(log[0].gamedata, { time_control: BYOYOMI });
            handler(goban, `review/${review_id}/full_state`)(log);
            now.mockReturnValue(4000);
            expect(goban.reviewClockRunning()).toBe(true);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(398500);
            receive({ ...pause, ts: 3500 });
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(399000);
        } finally {
            done();
        }
    });

    test("losing control drops pending commands that the server can reject", async () => {
        const { goban, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(2000);
            goban.setReviewNodeClock("black", { main_time: 400000 });
            goban.setReviewClockRunning(false);
            Object.assign(goban, { isPlayerController: () => false });
            receive({ controller: 99, ts: 1500 });
            receive({ f: 0, m: "", black_clock: { main_time: 500000 }, ts: 2500 });
            now.mockReturnValue(3000);
            expect(goban.reviewClockRunning()).toBe(true);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(499500);
        } finally {
            done();
        }
    });

    test("a reply also settles a command sent before it that the server dropped", async () => {
        const { goban, send, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(5000);
            goban.setReviewClockRunning(false);
            now.mockReturnValue(8000);
            goban.setReviewClockRunning(true);
            receive({ ...appended(send)[1], ts: 8100 });
            now.mockReturnValue(9000);
            expect(goban.reviewClockRunning()).toBe(true);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(592000);
        } finally {
            done();
        }
    });

    test("a command with no reply stops applying after a while", async () => {
        const { goban, done } = await recorder(true, { clock_running: true, ts: 1000 });
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(5000);
            goban.setReviewClockRunning(false);
            now.mockReturnValue(14000);
            expect(goban.reviewClockRunning()).toBe(false);
            now.mockReturnValue(16000);
            expect(goban.reviewClockRunning()).toBe(true);
            expect(goban.getReviewClock("black")?.clock.main_time).toBe(585000);
        } finally {
            done();
        }
    });

    test("a pending edit stays on its move when another session's undo shortens the game", async () => {
        const log = [
            { clock_running: true, ts: 500 },
            { om: [2, 2, 0, 0], ts: 1000 },
            { om: [3, 3, 0, 0], ts: 2000 },
        ];
        const { goban, send, receive, done } = await recorder(true, ...log);
        const other = await viewer(...log);
        const both = (msg: any) => {
            receive(msg);
            other.receive(msg);
        };
        try {
            const now = jest.spyOn(Date, "now").mockReturnValue(3000);
            goban.setReviewNodeClock("black", { main_time: 300000 });
            goban.setReviewNodeClock("white", { main_time: 200000 });
            const [edit, white_edit] = appended(send);
            both({ undo: true, ts: 3010 });
            now.mockReturnValue(3500);
            // The white edit was on the undone move, so White's turn goes on
            expect(goban.getReviewClock("white")).toEqual(other.goban.getReviewClock("white"));
            both({ om: [5, 5, 0, 0], ts: 3020 });
            both({ ...edit, ts: 3050 });
            both({ ...white_edit, ts: 3060 });

            const before = (g: TestGoban) => g.engine.last_official_move.parent!;
            expect(before(goban).black_clock).toBeUndefined();
            expect(before(other.goban).black_clock).toBeUndefined();
            expect(goban.engine.last_official_move.black_clock).toEqual({ main_time: 300000 });
        } finally {
            other.done();
            done();
        }
    });

    test("Pause just before a move stops its time", async () => {
        const { goban, send, tap, done } = await recorder(true, { clock_running: true, ts: 1000 });
        const now = jest.spyOn(Date, "now").mockReturnValue(11000);
        goban.setReviewClockRunning(false);
        now.mockReturnValue(20000);
        tap(4, 4);
        expect(lastOm(send)).toEqual([4, 4, 0, 0, { black_clock: { main_time: 590000 } }]);
        done();
    });

    test("a second stone before the first comes back is dropped", async () => {
        const { goban, review_id, send, tap, receive, done } = await recorder(true, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        tap(4, 4);
        tap(5, 5);
        expect(appended(send)).toEqual([{ review_id, om: [4, 4, 0, 0] }]);
        expect(goban.engine.last_official_move.branches).toEqual([]);

        receive({ om: [4, 4, 0, 0], ts: 2000 });
        tap(5, 5);
        expect(appended(send).length).toBe(2);
        expect(lastOm(send)).toEqual([5, 5, 0, 0]);
        done();
    });

    test("a second Undo before the first comes back is dropped", async () => {
        const { goban, review_id, send, done } = await recorder(
            true,
            { om: [2, 2, 0, 0], ts: 1000 },
            { om: [3, 3, 0, 0], ts: 2000 },
        );
        goban.undoOfficialMove();
        goban.undoOfficialMove();
        expect(appended(send)).toEqual([{ review_id, undo: true }]);
        done();
    });

    test("a stone before an Undo comes back is dropped", async () => {
        const { goban, send, tap, done } = await recorder(true, { om: [2, 2, 0, 0], ts: 1000 });
        goban.undoOfficialMove();
        tap(4, 4);
        expect(appended(send).filter((m) => "om" in m)).toEqual([]);
        done();
    });

    test("after a recorded move, going back to the last synced move names it again", async () => {
        const { goban, send, tap, receive, done } = await recorder(true, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        const synced = goban.engine.last_official_move;
        goban.syncReviewMove();
        tap(4, 4);
        receive({ ...appended(send).slice(-1)[0], ts: 2000 });

        goban.engine.jumpTo(synced);
        goban.syncReviewMove(undefined, "a comment");
        expect(appended(send).slice(-1)[0]).toMatchObject({ f: 1, m: "", t: "a comment" });
        done();
    });

    /** A plain viewer of the same review, to replay what the controller sent */
    async function viewer(...entries: any[]) {
        const board = await recorder(false, ...entries);
        (board.goban as any).isPlayerController = () => false;
        return board;
    }
    const replay = (send: jest.SpyInstance, to: { receive: (obj: any) => void }) =>
        appended(send).forEach((msg, i) => to.receive({ ...msg, ts: 5000 + i }));

    test("a comment and pen mark made before a recorded move comes back stay on their move", async () => {
        const { goban, send, tap, done } = await recorder(true, { om: [2, 2, 0, 0], ts: 1000 });
        const other = await viewer({ om: [2, 2, 0, 0], ts: 1000 });
        goban.syncReviewMove();
        tap(3, 3);
        goban.syncReviewMove({ pen: "#ff0000", pp: [1, 1] });
        goban.syncReviewMove({ pp: [2, 2] });
        goban.syncReviewMove(undefined, "note on cc");

        replay(send, other);
        const recorded = other.goban.engine.last_official_move;
        expect([recorded.x, recorded.y]).toEqual([3, 3]);
        expect(recorded.parent!.text).toBe("note on cc");
        expect(recorded.parent!.pen_marks).toEqual([{ color: "#ff0000", points: [1, 1, 2, 2] }]);
        expect(recorded.text).toBe("");
        expect(recorded.pen_marks).toEqual([]);
        other.done();
        done();
    });

    test("edits on a move being taken back go with it, not onto the move before", async () => {
        const log = [
            { om: [2, 2, 0, 0], ts: 1000 },
            { f: 1, m: "", t: "keep me", ts: 1500 },
            { om: [3, 3, 0, 0], ts: 2000 },
        ];
        const { goban, send, done } = await recorder(true, ...log);
        const other = await viewer(...log);
        goban.syncReviewMove();
        goban.undoOfficialMove();
        goban.syncReviewMove(undefined, "note on dd");
        goban.setReviewNodeClock("white", { main_time: 1000 });

        replay(send, other);
        const before = other.goban.engine.last_official_move;
        expect([before.x, before.y]).toEqual([2, 2]);
        expect(before.text).toBe("keep me");
        expect(before.white_clock).toBeUndefined();
        expect(before.branches).toEqual([]);
        other.done();
        done();
    });

    test("deleting a variation after another session's game move names it", async () => {
        const { goban, send, tap, receive, done } = await recorder(false, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        tap(3, 3);
        receive({ om: [4, 4, 0, 0], ts: 2000 });
        goban.deleteBranch();
        expect(appended(send).slice(-1)[0]).toMatchObject({ f: 1, m: "dd", delete: 1 });
        done();
    });

    test("a stone whose echo is late still blocks a second stone", async () => {
        const { goban, send, tap, receive, done } = await recorder(true, {
            clock_running: true,
            ts: 1000,
        });
        const now = jest.spyOn(Date, "now").mockReturnValue(11000);
        tap(2, 2);
        now.mockReturnValue(60000);
        tap(3, 3);
        const moves = appended(send).filter((m) => "om" in m);
        expect(moves.length).toBe(1);

        receive({ ...moves[0], ts: 11000 });
        expect(goban.engine.last_official_move.black_clock).toEqual({ main_time: 590000 });
        done();
    });

    test("an Undo whose echo is late still blocks a second Undo", async () => {
        const { goban, review_id, send, done } = await recorder(
            true,
            { om: [2, 2, 0, 0], ts: 1000 },
            { om: [3, 3, 0, 0], ts: 2000 },
        );
        const now = jest.spyOn(Date, "now").mockReturnValue(10000);
        goban.undoOfficialMove();
        now.mockReturnValue(60000);
        goban.undoOfficialMove();
        expect(appended(send)).toEqual([{ review_id, undo: true }]);
        done();
    });

    test("a reload ends the wait for a stone that never came back", async () => {
        const { goban, review_id, send, tap, done } = await recorder(true);
        tap(4, 4);
        const log = reviewLog();
        Object.assign(log[0].gamedata, { time_control: BYOYOMI });
        handler(goban, `review/${review_id}/full_state`)(log);
        goban.enableStonePlacement();
        tap(5, 5);
        expect(appended(send).filter((m) => "om" in m).length).toBe(2);
        done();
    });

    test("losing control ends the wait for a stone the server turned away", async () => {
        const { goban, send, tap, receive, done } = await recorder(true, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        tap(4, 4);
        (goban as any).isPlayerController = () => false;
        receive({ controller: 99, ts: 2000 });
        (goban as any).isPlayerController = () => true;
        receive({ controller: 1, ts: 3000 });
        tap(5, 5);
        expect(appended(send).filter((m) => "om" in m).length).toBe(2);
        done();
    });

    test.each([0, 1])(
        "a pass that places nothing during handicap placement records nothing (%i placed)",
        async (placed) => {
            const handicap = { handicap: 3, free_handicap_placement: true };
            const stones = placed ? [{ om: [2, 2, 0, 0], ts: 1000 }] : [];
            const { goban, send, done } = await recorderWith(handicap, true, ...stones);
            const live = goban.engine.last_official_move;

            expect(() => goban.pass()).not.toThrow();

            expect(goban.engine.last_official_move.id).toBe(live.id);
            expect(live.parent ? live.parent.trunk_next?.id : goban.engine.move_tree.id).toBe(
                live.id,
            );
            expect(appended(send).filter((m) => "om" in m)).toEqual([]);
            done();
        },
    );

    test("a variation that becomes the game move keeps its notes", async () => {
        const { goban, send, tap, receive, done } = await recorder(
            true,
            { om: [2, 2, 0, 0], ts: 1000 },
            {
                f: 1,
                m: "ee",
                t: "a likely reply",
                k: { triangle: "cc" },
                black_clock: { main_time: 420000 },
                ts: 2000,
            },
            { pen: "#ff0000", ts: 2100 },
            { pp: [1, 1, 2, 2], ts: 2200 },
            { f: 1, m: "eeff", ts: 3000 },
        );
        goban.engine.jumpTo(goban.engine.last_official_move);
        tap(4, 4);
        receive({ ...appended(send)[0], ts: 4000 });

        const official = goban.engine.last_official_move;
        expect([official.x, official.y]).toEqual([4, 4]);
        expect(official.text).toBe("a likely reply");
        expect(official.getMarks(2, 2).triangle).toBe(true);
        expect(official.pen_marks.length).toBe(1);
        expect(official.black_clock).toEqual({ main_time: 420000 });
        expect(official.branches.map((b) => [b.x, b.y])).toEqual([[5, 5]]);
        done();
    });

    test("Record keeps an existing variation", async () => {
        const { goban, tap, done } = await recorder(
            true,
            { om: [2, 2, 0, 0], ts: 1000 },
            { f: 1, m: "ee", ts: 2000 },
        );
        goban.engine.jumpTo(goban.engine.last_official_move);
        tap(4, 4);
        const kept = goban.engine.last_official_move.branches.map((b) => [b.x, b.y]);
        expect(kept).toEqual([[4, 4]]);
        done();
    });

    test("Record on at the live move records a pass as a game move", async () => {
        const { goban, review_id, send, done } = await recorder(true, {
            om: [2, 2, 0, 0],
            ts: 1000,
        });
        goban.pass();
        expect(appended(send)).toEqual([{ review_id, om: [-1, -1, 0, 0] }]);
        expect(goban.engine.last_official_move.branches).toEqual([]);
        done();
    });

    test("Record away from the live move sends a variation", async () => {
        const { goban, send, tap, done } = await recorder(
            true,
            { om: [2, 2, 0, 0], ts: 1000 },
            { om: [3, 3, 0, 0], ts: 2000 },
        );
        goban.engine.jumpTo(goban.engine.last_official_move.parent!);
        tap(4, 4);
        const sent = appended(send);
        expect(sent.length).toBe(1);
        expect(sent[0]).not.toHaveProperty("om");
        done();
    });
});
