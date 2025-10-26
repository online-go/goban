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
            })
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
});
