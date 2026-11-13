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

describe("MoveTree.applyClockUpdate", () => {
    test("sets, replaces and clears each color independently", () => {
        const goban = new TestGoban({ width: 9, height: 9 });
        goban.engine.place(2, 2);
        const node = goban.engine.cur_move;

        node.applyClockUpdate({ black: { main_time: 1000 }, white: { main_time: 2000 } });
        node.applyClockUpdate({ black: { main_time: 500 } });
        expect(node.black_clock).toEqual({ main_time: 500 });
        expect(node.white_clock).toEqual({ main_time: 2000 });

        node.applyClockUpdate({ white: null });
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
            move: [2, 2, 900, undefined, { clock: { main_time: 1000 } }],
        });

        expect(goban.engine.last_official_move.black_clock).toEqual({ main_time: 1000 });
        client.disconnect();
        server.close();
        goban.destroy();
    });

    test("a review replays, then clears, a node clock", async () => {
        const [server, client, goban] = await connect({ review_id: 77, width: 9, height: 9 });
        const full_state = handler(goban, "review/77/full_state");

        full_state(reviewLog({ f: 0, m: "dd" }, { clock: { black: { main_time: 42000 } } }));
        const node = goban.engine.cur_review_move!;
        expect(node.black_clock).toEqual({ main_time: 42000 });

        full_state(
            reviewLog(
                { f: 0, m: "dd" },
                { clock: { black: { main_time: 42000 } } },
                { clock: { black: null } },
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
        )(reviewLog({ om: [2, 2, 0, undefined, { clock: { main_time: 61000 } }] }));

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
            clock: { white: clock },
            review_id: 123,
        });
        goban.destroy();
    });

    test("clearing sends null", () => {
        const { goban, send } = reviewBoard(true);
        goban.setReviewNodeClock("black", { main_time: 5000 });
        goban.setReviewNodeClock("black", null);

        expect(goban.engine.cur_move.black_clock).toBeUndefined();
        expect(send).toHaveBeenLastCalledWith(
            "review/append",
            expect.objectContaining({ clock: { black: null } }),
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
