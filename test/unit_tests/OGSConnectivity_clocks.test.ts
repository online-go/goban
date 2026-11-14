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
    const BYOYOMI = {
        system: "byoyomi",
        time_control: "byoyomi",
        speed: "live",
        main_time: 600,
        periods: 5,
        period_time: 30,
    };
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

    test("setReviewClockRunning sends but does not change state", async () => {
        const { goban, review_id, done } = await demo({ om: [2, 2, 0, 0], ts: 11000 });
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        (goban as any).isPlayerController = () => true;
        goban.setReviewClockRunning(true);
        expect(send).toHaveBeenCalledWith("review/append", { review_id, clock_running: true });
        expect(goban.reviewClockRunning()).toBe(false);
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
});

describe("Record mode on demo boards", () => {
    const BYOYOMI = {
        system: "byoyomi",
        time_control: "byoyomi",
        speed: "live",
        main_time: 600,
        periods: 5,
        period_time: 30,
    };
    let next_review_id = 500;
    afterEach(() => jest.restoreAllMocks());

    async function recorder(record: boolean, ...entries: any[]) {
        const review_id = ++next_review_id;
        const [server, client, goban] = await connect({ review_id, width: 9, height: 9 });
        const log = reviewLog(...entries);
        log[0].gamedata.time_control = BYOYOMI;
        handler(goban, `review/${review_id}/full_state`)(log);
        (goban as any).isPlayerController = () => true;
        (goban as any).mode = "analyze";
        goban.enableStonePlacement();
        goban.review_record_moves = record;
        const send = jest.spyOn((goban as any).socket, "send").mockImplementation(() => {});
        const tap = (x: number, y: number) =>
            (goban as any).tapAtImpl(x, y, false, false, false, 0);
        const done = () => {
            client.disconnect();
            server.close();
            goban.destroy();
        };
        return { goban, review_id, send, tap, done };
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
