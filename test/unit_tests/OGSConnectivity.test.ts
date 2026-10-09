/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import WS from "jest-websocket-mock";
import { TestGoban } from "../../src/index";
import { GobanSocket } from "engine";

let last_port = 38880;

async function createGobanWithSocket(game_id: number): Promise<any[]> {
    const port = ++last_port;
    const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
    const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });
    const instance = new TestGoban({ game_id, server_socket: client });
    (instance as any).post_config_constructor();
    await server.connected;
    return [server, client, instance];
}

describe("OGSConnectivity isInPushedAnalysis guard", () => {
    test("move handler does not log error when isInPushedAnalysis is deleted", async () => {
        const [server, client, instance] = await createGobanWithSocket(123);

        const moveHandler = (instance as any).socket_event_bindings.find(
            (binding: any) => binding[0] === "game/123/move",
        )?.[1];

        delete (instance as any).isInPushedAnalysis;

        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        moveHandler({ game_id: 123, move: "aa" });

        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining("isInPushedAnalysis is not a function"),
            }),
        );

        consoleErrorSpy.mockRestore();
        client.disconnect();
        server.close();
    });

    test("syncReviewMove does not throw when isInPushedAnalysis is deleted", () => {
        const instance = new TestGoban({ review_id: 123 });

        (instance as any).done_loading_review = true;
        (instance as any).isPlayerController = () => true;
        (instance as any).socket = { send: () => {} };

        delete (instance as any).isInPushedAnalysis;

        expect(() => {
            (instance as any).syncReviewMove();
        }).not.toThrow();

        instance.destroy();
    });

    test("a live stone played while viewing the start is not announced as a pass", async () => {
        const [server, client, instance] = await createGobanWithSocket(456);

        instance.engine.place(0, 0, false, false, true, true, true);
        instance.engine.setLastOfficialMove();
        const start = instance.engine.cur_move.parent;
        instance.mode = "analyze";
        instance.engine.jumpTo(start);

        const heard: string[] = [];
        instance.on("audio-pass", () => heard.push("pass"));
        instance.on("audio-stone", () => heard.push("stone"));

        const moveHandler = (instance as any).socket_event_bindings.find(
            (binding: any) => binding[0] === "game/456/move",
        )?.[1];

        moveHandler({ game_id: 456, move: "ba", move_number: 2 });

        expect(heard).toEqual(["stone"]);
        expect(instance.engine.cur_move).toBe(start);

        client.disconnect();
        server.close();
        instance.destroy();
    });

    test("a real pass is still announced as a pass", async () => {
        const [server, client, instance] = await createGobanWithSocket(789);

        instance.engine.place(0, 0, false, false, true, true, true);
        instance.engine.setLastOfficialMove();

        const heard: string[] = [];
        instance.on("audio-pass", () => heard.push("pass"));
        instance.on("audio-stone", () => heard.push("stone"));

        const moveHandler = (instance as any).socket_event_bindings.find(
            (binding: any) => binding[0] === "game/789/move",
        )?.[1];

        moveHandler({ game_id: 789, move: "..", move_number: 2 });

        expect(heard).toEqual(["pass"]);

        client.disconnect();
        server.close();
        instance.destroy();
    });
});

describe("review gamedata after the review has loaded", () => {
    test("a metadata refresh keeps moves, variations and comments", async () => {
        const port = ++last_port;
        const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
        const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });
        const instance = new TestGoban({
            review_id: 2447,
            server_socket: client,
            width: 9,
            height: 9,
        });
        (instance as any).post_config_constructor();
        await server.connected;

        const onReview = (instance as any).socket_event_bindings.find(
            (binding: any) => binding[0] === "review/2447/r",
        )?.[1];

        const players = {
            black: { id: 1, username: "black", name: "Black", rank: 10 },
            white: { id: 2, username: "white", name: "White", rank: 10 },
        };
        onReview({
            gamedata: {
                width: 9,
                height: 9,
                game_name: "Demo",
                rules: "japanese",
                komi: 6.5,
                phase: "play",
                players,
            },
        });

        instance.engine.place(2, 2, false, false, true, true, false);
        const trunk = instance.engine.cur_move;
        trunk.text = "the main line";
        instance.engine.jumpTo(trunk.parent);
        instance.engine.place(3, 3, false, false, true, true, false);
        const branch = instance.engine.cur_move;
        branch.text = "a variation";
        (instance as any).done_loading_review = true;

        onReview({
            gamedata: {
                width: 9,
                height: 9,
                game_name: "Renamed demo",
                rules: "chinese",
                komi: 7.5,
                outcome: "B+0.5",
                handicap: 0,
                phase: "play",
                players: {
                    black: { id: 1, username: "black", name: "Ada", rank: 20 },
                    white: { id: 2, username: "white", name: "Bea", rank: 12 },
                },
            },
        });

        expect(instance.engine.cur_move).toBe(branch);
        expect(branch.text).toBe("a variation");
        expect(trunk.text).toBe("the main line");
        expect(instance.engine.getMoveNumber()).toBe(1);
        expect(instance.engine.config.game_name).toBe("Renamed demo");
        expect(instance.config.game_name).toBe("Renamed demo");
        expect(instance.engine.komi).toBe(7.5);
        expect(instance.engine.rules).toBe("chinese");
        expect(instance.engine.outcome).toBe("B+0.5");
        expect(instance.engine.players.black.name).toBe("Ada");
        expect(instance.engine.players.black.rank).toBe(20);

        client.disconnect();
        server.close();
        instance.destroy();
    });
});
