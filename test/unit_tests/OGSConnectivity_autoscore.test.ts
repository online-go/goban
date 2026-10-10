/*
 * Copyright (C)  Online-Go.com
 */

/*
 * A player's client waits for the server's dead-stone proposal at stone
 * removal and scores locally only when the server cannot.
 */

(global as any).CLIENT = true;

import { TestGoban } from "../../src/index";
import { SERVER_AUTOSCORE_WAIT_MS } from "../../src/Goban/OGSConnectivity";

const GAME_ID = 7;
const BLACK = 123;
const WHITE = 456;

/** The game as the server would send it in a `gamedata` message. */
function gamedata(extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        game_id: GAME_ID,
        width: 9,
        height: 9,
        phase: "play",
        black_player_id: BLACK,
        white_player_id: WHITE,
        players: {
            black: { id: BLACK, username: "p1" },
            white: { id: WHITE, username: "p2" },
        },
        moves: [
            [0, 0],
            [1, 0],
        ],
        ...(extra ?? {}),
    };
}

interface Harness {
    goban: TestGoban;
    send: jest.Mock;
    /** Deliver a server message as the socket would. */
    receive: (event: string, data: unknown) => void;
}

function makeGoban(extra?: Record<string, unknown>): Harness {
    const send = jest.fn();
    const socket: any = {
        connected: true,
        url: "",
        clock_drift: 0,
        latency: 0,
        options: {},
        on: jest.fn(),
        off: jest.fn(),
        send,
    };
    const goban = new TestGoban({
        player_id: BLACK,
        server_socket: socket,
        ...(gamedata(extra) as any),
    });
    (goban as any).post_config_constructor();
    const receive = (event: string, data: unknown) => {
        const handlers = (goban as any).socket_event_bindings
            .filter((binding: any) => binding[0] === event)
            .map((binding: any) => binding[1]);
        expect(handlers.length).toBeGreaterThan(0);
        for (const handler of handlers) {
            handler(data);
        }
    };
    return { goban, send, receive };
}

function sentRemovedStones(send: jest.Mock): unknown[] {
    return send.mock.calls.filter((call) => call[0] === "game/removed_stones/set");
}

describe("stone removal autoscoring", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        window.history.pushState({}, "", `/game/${GAME_ID}`);
        (window as any).user = { id: BLACK };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("waits for the server's proposal instead of scoring at once", () => {
        const { goban, send, receive } = makeGoban();
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        jest.advanceTimersByTime(1000);

        expect(started).toHaveBeenCalledTimes(1);
        expect(local).not.toHaveBeenCalled();
        expect(sentRemovedStones(send)).toHaveLength(0);
        goban.destroy();
    });

    test("applies the server's proposal and ends the wait", () => {
        const { goban, receive } = makeGoban();
        const complete = jest.fn();
        const sealing = jest.fn();
        goban.on("stone-removal.auto-scoring-complete", complete);
        goban.on("stone-removal.needs-sealing", sealing);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/removed_stones`, {
            removed: true,
            stones: "aa",
            all_removed: "aa",
            needs_sealing: [{ x: 2, y: 0, color: 1 }],
            auto_scored: true,
        });

        expect(goban.engine.removal[0][0]).toBe(true);
        expect(goban.engine.removal[0][1]).toBe(false);
        expect(goban.engine.needs_sealing).toEqual([{ x: 2, y: 0, color: 1 }]);
        expect(goban.engine.auto_scoring_done).toBe(true);
        expect(sealing).toHaveBeenCalledWith([{ x: 2, y: 0, color: 1 }]);
        expect(complete).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).not.toHaveBeenCalled();
        goban.destroy();
    });

    test("a proposal replaces marks made before it arrived", () => {
        const { goban, receive } = makeGoban();
        jest.spyOn(goban, "performStoneRemovalAutoScoring").mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/removed_stones`, {
            removed: true,
            stones: "ba",
            all_removed: "ba",
        });
        expect(goban.engine.removal[0][1]).toBe(true);

        receive(`game/${GAME_ID}/removed_stones`, {
            removed: true,
            stones: "aa",
            all_removed: "aa",
            auto_scored: true,
        });

        expect(goban.engine.removal[0][0]).toBe(true);
        expect(goban.engine.removal[0][1]).toBe(false);
        goban.destroy();
    });

    test("scores locally when the server reports failure", () => {
        const { goban, receive } = makeGoban();
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/auto_scoring_failed`, {});

        expect(local).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).toHaveBeenCalledTimes(1);
        goban.destroy();
    });

    test("scores locally when no proposal arrives in time", () => {
        const { goban, receive } = makeGoban();
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS - 1);
        expect(local).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(local).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            "No dead-stone proposal from the server, scoring locally",
        );
        warn.mockRestore();
        goban.destroy();
    });

    test("re-arms the wait after a resumed game passes out again", () => {
        const { goban, receive } = makeGoban();
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/phase`, "play");
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).not.toHaveBeenCalled();

        receive(`game/${GAME_ID}/phase`, "stone removal");
        expect(started).toHaveBeenCalledTimes(2);
        goban.destroy();
    });

    test("leaving stone removal mid-wait clears the busy state", () => {
        const { goban, receive } = makeGoban();
        const complete = jest.fn();
        goban.on("stone-removal.auto-scoring-complete", complete);
        const clearMessage = jest.spyOn(goban, "clearMessage");
        jest.spyOn(goban, "performStoneRemovalAutoScoring").mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        clearMessage.mockClear();
        receive(`game/${GAME_ID}/phase`, "finished");

        expect(complete).toHaveBeenCalledTimes(1);
        expect(clearMessage).toHaveBeenCalled();
        goban.destroy();
    });

    test("waits again after a game that had a proposal resumes and passes out again", () => {
        const { goban, receive } = makeGoban();
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/removed_stones`, {
            removed: true,
            stones: "aa",
            all_removed: "aa",
            auto_scored: true,
        });
        receive(`game/${GAME_ID}/phase`, "play");
        expect(goban.engine.auto_scoring_done).toBeFalsy();

        receive(`game/${GAME_ID}/phase`, "stone removal");
        expect(started).toHaveBeenCalledTimes(2);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).toHaveBeenCalledTimes(1);
        warn.mockRestore();
        goban.destroy();
    });

    test("ends the wait without scoring when another client marks stones first", () => {
        const { goban, receive } = makeGoban();
        const complete = jest.fn();
        goban.on("stone-removal.auto-scoring-complete", complete);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(`game/${GAME_ID}/removed_stones`, {
            removed: true,
            stones: "ba",
            all_removed: "ba",
        });

        expect(complete).toHaveBeenCalledTimes(1);
        expect(goban.engine.removal[0][1]).toBe(true);
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).not.toHaveBeenCalled();
        goban.destroy();
    });

    test("a reload that carries the proposal ends a running wait", () => {
        const { goban, receive } = makeGoban();
        const complete = jest.fn();
        goban.on("stone-removal.auto-scoring-complete", complete);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        receive(
            `game/${GAME_ID}/gamedata`,
            gamedata({ phase: "stone removal", removed: "aa", auto_scoring_done: true }),
        );

        expect(complete).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);
        expect(local).not.toHaveBeenCalled();
        expect(goban.engine.removal[0][0]).toBe(true);
        goban.destroy();
    });

    test("skips when the loaded gamedata already carries auto_scoring_done", () => {
        const { goban, receive } = makeGoban();
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(
            `game/${GAME_ID}/gamedata`,
            gamedata({ phase: "stone removal", removed: "aa", auto_scoring_done: true }),
        );
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);

        expect(started).not.toHaveBeenCalled();
        expect(local).not.toHaveBeenCalled();
        expect(goban.engine.removal[0][0]).toBe(true);
        goban.destroy();
    });

    test("waits again on load without auto_scoring_done", () => {
        const { goban, receive } = makeGoban();
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        jest.spyOn(goban, "performStoneRemovalAutoScoring").mockImplementation(() => {});

        receive(`game/${GAME_ID}/gamedata`, gamedata({ phase: "stone removal" }));

        expect(started).toHaveBeenCalledTimes(1);
        goban.destroy();
    });

    test("scores locally at once on a 25x25 board", () => {
        const { goban, receive } = makeGoban({ width: 25, height: 25 });
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");

        expect(local).toHaveBeenCalledTimes(1);
        goban.destroy();
    });

    test("a spectator neither waits nor scores", () => {
        (window as any).user = { id: 999 };
        const { goban, receive } = makeGoban({ player_id: 999 });
        const started = jest.fn();
        goban.on("stone-removal.auto-scoring-started", started);
        const local = jest
            .spyOn(goban, "performStoneRemovalAutoScoring")
            .mockImplementation(() => {});

        receive(`game/${GAME_ID}/phase`, "stone removal");
        jest.advanceTimersByTime(SERVER_AUTOSCORE_WAIT_MS);

        expect(started).not.toHaveBeenCalled();
        expect(local).not.toHaveBeenCalled();
        goban.destroy();
    });
});
