/*
 * Copyright (C)  Online-Go.com
 * Copyright (C)  Benjamin P. Jones
 */
(global as any).CLIENT = true;

import { GobanSocket, GobanSocketMessageParseErrorDetails, closeErrorCodeToString } from "engine";
import WS from "jest-websocket-mock";
import * as protocol from "engine/protocol";

let last_port = 48880;

async function sockets(opts?: any): Promise<[WS, GobanSocket]> {
    const port = ++last_port;
    const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
    const client = new GobanSocket(
        `ws://localhost:${port}`,
        opts ?? { dont_ping: true, quiet: true },
    );
    await server.connected;
    return [server, client];
}

describe("GobanSocket tests", () => {
    beforeEach(() => {
        //
    });

    afterEach(() => {
        /*
        client?.disconnect();
        server?.close();
        */
    });

    test("Protocol interface stub", () => {
        expect(protocol).toBeDefined();
    });

    test("Connection", async () => {
        const [server, client] = await sockets();

        await server.connected;
        expect(client.connected).toBe(true);

        client.send("net/ping", {
            client: Date.now(),
            latency: 0,
            drift: 0,
        });
        await expect(server).toReceiveMessage(expect.arrayContaining(["net/ping"]));
    });

    test("Disconnect", async () => {
        const [server, client] = await sockets();

        await server.connected;
        expect(client.connected).toBe(true);
        client.disconnect();
        expect(client.connected).toBe(false);
    });

    test("Error codes", async () => {
        for (let i = 0; i < 5000; ++i) {
            expect(typeof closeErrorCodeToString(i)).toBe("string");
        }
    });

    test("Reconnect", async () => {
        const [server, client] = await sockets();

        await server.connected;
        expect(client.connected).toBe(true);
        server.close();
        await sleep(1);
        expect(client.connected).toBe(false);
        const server2 = new WS(`ws://localhost:${last_port}`, { jsonProtocol: true });
        await server2.connected;
        expect(client.connected).toBe(true);
    }, 1000);

    test("Unparseable message reports details and reconnects", async () => {
        const port = ++last_port;
        const server = new WS(`ws://localhost:${port}`);
        const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });
        await server.connected;

        const errors: GobanSocketMessageParseErrorDetails[] = [];
        client.on("message_parse_error", (details) => errors.push(details));
        const disconnects: number[] = [];
        client.on("disconnect", (code) => disconnects.push(code));

        const bad = '["active-bots",{"1":{"id":1,"username":"' + "x".repeat(1000);
        server.send(bad);
        await sleep(10);

        expect(errors).toHaveLength(1);
        expect(errors[0].length).toBe(bad.length);
        expect(errors[0].head).toBe(bad.slice(0, 256));
        expect(errors[0].tail).toBe(bad.slice(-256));
        expect(errors[0].messages_received).toBe(0);
        expect(errors[0].ms_since_open).toBeGreaterThanOrEqual(0);
        expect(disconnects).toEqual([4000]);

        await server.connected;
        await sleep(100);
        expect(client.connected).toBe(true);

        server.send("not json");
        await sleep(10);
        expect(errors).toHaveLength(2);
        expect(client.connected).toBe(true);

        client.disconnect();
        server.close();
    });

    test("sendPromise", async () => {
        const [server, client] = await sockets();

        const promise = client.sendPromise("net/ping", {
            client: Date.now(),
            latency: 0,
            drift: 0,
        });
        server.send([(client as any).last_request_id, { server: Date.now() }]);
        const response = await promise;
        expect(response).toEqual({ server: expect.any(Number) });
    });

    test("Authenticate", async () => {
        const [server, client] = await sockets();

        await server.connected;
        client.authenticate({ jwt: "test" });
        await expect(server).toReceiveMessage(
            expect.arrayContaining(["authenticate", { jwt: "test" }]),
        );
    });

    test("ping", async () => {
        const [server, client] = await sockets({ dont_ping: false, quiet: true });
        await expect(server).toReceiveMessage(expect.arrayContaining(["net/ping"]));
        const now = Date.now();
        server.send(["net/pong", { client: now - 100, server: now }]);
        // We record a new Date.now() in the client, so we can't test the exact value,
        // within 10ms should allow for plenty of execution speed slop on the CI though, I hope
        expect(client.latency).toBeGreaterThan(99);
        expect(client.latency).toBeLessThan(110);

        client.options.dont_ping = true;
    });

    test("Send queue", async () => {
        const port = ++last_port;
        const server = new WS(`ws://localhost:${port}`, { jsonProtocol: true });
        const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });

        expect(client.connected).toBe(false);
        client.send("foo" as any, {});
        await server.connected;
        expect(client.connected).toBe(true);
        await expect(server).toReceiveMessage(expect.arrayContaining(["foo"]));
    });

    test("Manual disconnect", async () => {
        const port = ++last_port;
        new WS(`ws://localhost:${port}`, { jsonProtocol: true });
        const client = new GobanSocket(`ws://localhost:${port}`, { dont_ping: true, quiet: true });

        expect(client.connected).toBe(false);
        const promise = client.sendPromise("foo" as any, {});
        client.disconnect();
        await expect(promise).rejects.toEqual(
            expect.objectContaining({ code: "manually_disconnected" }),
        );
    });

    test("Promises in flight rejection", async () => {
        const [, client] = await sockets();

        expect(client.connected).toBe(true);
        const promise = client.sendPromise("foo" as any, {});
        client.disconnect();
        await expect(promise).rejects.toEqual(
            expect.objectContaining({ code: "manually_disconnected" }),
        );
    });
});

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
