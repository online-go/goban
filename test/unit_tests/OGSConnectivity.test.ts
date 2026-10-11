/*
 * Copyright (C)  Online-Go.com
 */

(global as any).CLIENT = true;

import WS from "jest-websocket-mock";
import { TestGoban } from "../../src/index";
import { GobanSocket } from "engine";
import { SVGRenderer } from "../../src/Goban/SVGRenderer";
import { MoveTree } from "../../src/engine/MoveTree";

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

describe("a saved review is replayed from the full log", () => {
    function walk(node: MoveTree, into: { nodes: number; text: string; pens: number }) {
        into.nodes += 1;
        into.text += node.text || "";
        into.pens += node.pen_marks?.length || 0;
        for (const branch of node.branches) {
            walk(branch, into);
        }
    }

    async function replay(asController: boolean) {
        const port = ++last_port;
        const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
        const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });
        const board_div = document.createElement("div");
        document.body.appendChild(board_div);
        const goban = new SVGRenderer({
            review_id: 2447,
            server_socket: client,
            square_size: 10,
            board_div,
            interactive: true,
            width: 9,
            height: 9,
            isPlayerController: () => asController,
        });
        await server.connected;

        const onFull = (goban as any).socket_event_bindings.find(
            (binding: any) => binding[0] === "review/2447/full_state",
        )[1];
        const players = {
            black: { id: 1, username: "black", name: "Black", rank: 10 },
            white: { id: 2, username: "white", name: "White", rank: 10 },
        };
        const log = (name: string, komi: number) => [
            {
                gamedata: {
                    width: 9,
                    height: 9,
                    game_name: name,
                    rules: "japanese",
                    komi,
                    phase: "play",
                    players,
                },
            },
            { om: [2, 2, 0] },
            { f: 0, m: "dd" },
            { "t+": "first comment" },
            { pen: "#000000", pp: [1, 2] },
        ];

        const errors = jest.spyOn(console, "error").mockImplementation(() => {});
        let ended = 0;
        goban.on("review.load-end", () => {
            ended += 1;
        });

        onFull(log("Demo", 6.5));
        const first = { nodes: 0, text: "", pens: 0 };
        walk(goban.engine.move_tree, first);

        onFull(log("Renamed demo", 7.5));
        const second = { nodes: 0, text: "", pens: 0 };
        walk(goban.engine.move_tree, second);

        expect(errors).not.toHaveBeenCalled();
        expect(ended).toBe(2);
        expect((goban as any).drawing_enabled).toBe(true);
        expect(first.nodes).toBeGreaterThan(1);
        expect(second).toEqual(first);
        expect(second.text).toBe("first comment");
        expect(second.pens).toBe(1);
        expect(goban.engine.last_official_move.move_number).toBe(1);
        expect(goban.engine.config.game_name).toBe("Renamed demo");
        expect(goban.engine.komi).toBe(7.5);

        errors.mockRestore();
        client.disconnect();
        server.close();
        goban.destroy();
        board_div.remove();
    }

    test("the controller keeps the tree, the comment and the pen mark", async () => {
        await replay(true);
    });

    test("a viewer does not get a second copy of the comment or the pen mark", async () => {
        await replay(false);
    });
});
