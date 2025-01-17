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

import { EventEmitter } from "eventemitter3";
import { niceInterval } from "./util";
import { ClientToServer, ClientToServerBase, ServerToClient } from "./protocol";

type GobanSocketClientToServerMessage<SendProtocol> = [keyof SendProtocol, any?, number?];
type GobanSocketServerToClientMessage<RecvProtocol> = [keyof RecvProtocol | number, any, any];

// Ideally this would be a generic type that extends RecvProtocol, but that
// doesn't seem to be possible in typescript yet
export interface GobanSocketEvents extends ServerToClient {
    connect: () => void;
    disconnect: (code: number) => void;
    reconnect: () => void;
    unrecoverable_error: (code: number, tag: string, message: string) => void;
    /* Emitted when we receive an updated latency measurement */
    latency: (latency: number, clock_drift: number) => void;

    /* Emitted when the time since ping exceeds options.timeout_delay */
    timeout: () => void;
    //[key: string]: (...data: any[]) => void;
}

interface ErrorResponse {
    code: string;
    message: string;
}

interface GobanSocketOptions {
    /** Don't automatically send pings */
    dont_ping?: boolean;

    // Note: you can't turn off ping by setting ping interval to zero or undefined.
    ping_interval?: number; // milliseconds, applied if non-zero.
    timeout_delay?: number;

    /** Don't log connection/disconnect things*/
    quiet?: boolean;
}

const RECONNECTION_INTERVALS = [
    // Connection drops are common and we can usually reconnect immediately. In
    // the case of a server restart, we count on the inherent latency of everyone
    // to even out the initial reconnect surge.
    [50, 50],
    [100, 300], // if that doesn't work, try again in 100-300ms
    [250, 750], // if that doesn't work, keep trying in try again in 250-750ms intervals
];

const DEFAULT_PING_INTERVAL = 10000;

export type DataArgument<Entry> = Entry extends (...args: infer A) => void ? A[0] : never;
export type ProtocolResponseType<Entry> = Entry extends (...args: any[]) => infer R ? R : never;

/**
 * This is a simple wrapper around the WebSocket API that provides a
 * simple interface to connect to the Online-Go.com servers. It provides:
 *
 *  - Reconnection
 *  - Deals with authentication
 *  - Event based API
 *  - Type safe sends and receives
 *  - Optional promise support for sends
 *  - Latency tracking (doubling as keep alive)
 *
 */

export class GobanSocket<
    SendProtocol extends ClientToServerBase = ClientToServer,
    RecvProtocol = ServerToClient,
> extends EventEmitter<GobanSocketEvents> {
    public readonly url: string;
    public clock_drift = 0.0;
    public latency = 0.0;
    public options: GobanSocketOptions;

    private socket: WebSocket;
    private last_request_id = 0;
    private promises_in_flight: Map<
        number,
        {
            command: string;
            args: any[];
            resolve: (...args: any[]) => void;
            reject: (...args: any[]) => void;
        }
    > = new Map();

    private reconnecting = false;
    private reconnect_tries = 0;
    private send_queue: (() => void)[] = [];
    private ping_timer?: ReturnType<typeof niceInterval>;
    private timeout_timer?: ReturnType<typeof setTimeout>;
    private callbacks: Map<number, (data?: any, error?: ErrorResponse) => void> = new Map();
    private authentication?: DataArgument<SendProtocol["authenticate"]>;
    private manually_disconnected = false;
    private current_ping_interval: number;

    constructor(url: string, options: GobanSocketOptions = {}) {
        super();

        this.options = options;
        url = url.replace(/^http/, "ws");

        this.url = url;
        this.current_ping_interval = options.ping_interval || DEFAULT_PING_INTERVAL;

        this.socket = this.connect();

        this.on("net/pong", ({ client, server }: { client: number; server: number }) => {
            const now = Date.now();
            const latency = now - client;
            const drift = now - latency / 2 - server;
            this.latency = latency;
            this.clock_drift = drift;
            this.emit("latency", latency, drift);
            if (this.timeout_timer) {
                clearTimeout(this.timeout_timer);
            }
            ///console.log("Pong:", this.url);
        });
    }

    get connected(): boolean {
        return this.socket.readyState === WebSocket.OPEN;
    }

    public authenticate(authentication: DataArgument<SendProtocol["authenticate"]>): void {
        this.authentication = authentication;
        this.send("authenticate", authentication);
    }

    private sendAuthentication(): void {
        if (this.authentication) {
            this.send("authenticate", this.authentication);
        }
    }

    signalTimeout = () => {
        this.emit("timeout");
    };

    ping = () => {
        if (this.options.dont_ping) {
            return;
        }

        if (this.connected) {
            this.send("net/ping", {
                client: Date.now(),
                drift: this.clock_drift,
                latency: this.latency,
            } as DataArgument<SendProtocol["net/ping"]>);

            if (this.options.timeout_delay) {
                this.timeout_timer = setTimeout(this.signalTimeout, this.options.timeout_delay);
            }

            if (
                this.options.ping_interval &&
                this.options.ping_interval !== this.current_ping_interval
            ) {
                if (this.ping_timer) {
                    clearInterval(this.ping_timer);
                }
                this.ping_timer = niceInterval(
                    this.ping,
                    this.options.ping_interval || DEFAULT_PING_INTERVAL,
                );
                this.current_ping_interval = this.options.ping_interval;
            }
        } else {
            if (this.ping_timer) {
                clearInterval(this.ping_timer);
                this.ping_timer = undefined;
            }
        }
    };

    private startPing(): void {
        if (this.ping_timer) {
            clearInterval(this.ping_timer);
        }
        if (this.timeout_timer) {
            clearTimeout(this.timeout_timer);
        }

        this.ping_timer = niceInterval(
            this.ping,
            this.options.ping_interval || DEFAULT_PING_INTERVAL,
        );
        this.ping();
    }

    private connect(): WebSocket {
        const socket = new WebSocket(this.url);

        socket.addEventListener("open", (_event: Event) => {
            if (!this.options.quiet) {
                console.log("GobanSocket connected to " + this.url);
            }
            this.reconnecting = false;
            this.reconnect_tries = 0;
            if (!this.connected) {
                console.error("GobanSocket connected but readyState !== OPEN");
            }
            try {
                this.emit("connect");
            } catch (e) {
                console.error("GobanSocket connect event handler error", e);
            }

            if (this.promises_in_flight.size > 0) {
                // This shouldn't ever happen
                throw new Error("GobanSocket connected with promises in flight");
            }

            this.sendAuthentication();

            this.startPing();

            for (const send of this.send_queue) {
                send();
            }
            this.send_queue = [];
        });

        socket.addEventListener("error", (event: Event) => {
            if (!this.manually_disconnected) {
                console.error(`GobanSocket error ${(event as any)?.message || event}`);
            }
            /*
            if (!this.connected) {
                this.reconnect();
            }
            */
        });

        socket.addEventListener("close", (event: CloseEvent) => {
            const code = event?.code;

            if (code !== 1000 && !this.manually_disconnected) {
                console.warn(
                    `GobanSocket closed with code ${code}: ${closeErrorCodeToString(code)}`,
                );
            }

            this.rejectPromisesInFlight();

            try {
                this.emit("disconnect", code);
            } catch (e) {
                console.error("Error in disconnect handler", e);
            }

            if (this.manually_disconnected) {
                return;
            }

            if (code === 1014 || code === 1015) {
                console.error("OGS Socket closed with an unrecoverable error, not reconnecting");
                this.emit(
                    "unrecoverable_error",
                    code,
                    code === 1014 ? "bad_gateway" : code === 1015 ? "tls_handshake" : "unknown",
                    closeErrorCodeToString(code),
                );
                return;
            }

            this.reconnecting = false;
            this.reconnect();
        });

        socket.addEventListener("message", (event: MessageEvent) => {
            let payload: GobanSocketServerToClientMessage<RecvProtocol>;
            try {
                payload = JSON.parse(event.data);
            } catch (e) {
                console.error("Error parsing message", {
                    event,
                    data: event?.data,
                    exception: e,
                });
                throw new Error("Error parsing message: " + event?.data);
            }
            const [id_or_command, data, err] = payload;

            if (typeof id_or_command === "number") {
                const cb = this.callbacks.get(id_or_command);
                if (cb) {
                    this.callbacks.delete(id_or_command);
                    cb(data, err);
                }
            } else {
                this.emit(id_or_command as keyof GobanSocketEvents, data);
            }
        });

        return socket;
    }

    private reconnect(): void {
        if (this.manually_disconnected) {
            return;
        }
        if (this.reconnecting) {
            return;
        }
        this.reconnecting = true;

        const range =
            RECONNECTION_INTERVALS[
                Math.min(this.reconnect_tries, RECONNECTION_INTERVALS.length - 1)
            ];
        ++this.reconnect_tries;
        const delay = Math.floor(Math.random() * (range[1] - range[0]) + range[0]);
        if (!this.options.quiet) {
            console.info(`GobanSocket reconnecting in ${delay}ms`);
        }
        setTimeout(() => {
            this.socket = this.connect();
        }, delay);
    }

    private rejectPromisesInFlight(): void {
        for (const [, { reject }] of this.promises_in_flight) {
            try {
                reject(`Socket closed with code ${this.socket.readyState}`);
            } catch (e) {
                console.error("Error in reject handler", e);
            }
        }
        this.promises_in_flight.clear();
    }

    public send<Command extends keyof SendProtocol>(
        command: Command,
        data: DataArgument<SendProtocol[Command]>,
        cb?: (data: ProtocolResponseType<SendProtocol[Command]>, error?: any) => void,
    ): void {
        const request: GobanSocketClientToServerMessage<SendProtocol> = cb
            ? [command, data, ++this.last_request_id]
            : data
              ? [command, data]
              : [command];

        if (cb) {
            this.callbacks.set(this.last_request_id, cb);
        }

        const serialized = JSON.stringify(request);
        if (this.connected) {
            try {
                this.socket.send(serialized);
            } catch (e) {
                // Sometimes we get a NS_ERROR_NOT_CONNECTED error here, I
                // presume because the socket is closed while we are sending
                // or something of the sort, I'm not sure. regardless, we'll
                // just queue up the send and try again when we reconnect and
                // see if that works.
                this.send_queue.push(() => {
                    this.socket.send(serialized);
                });
            }
        } else {
            this.send_queue.push(() => {
                this.socket.send(serialized);
            });
        }
    }

    public sendPromise<Command extends keyof SendProtocol>(
        command: Command,
        data: DataArgument<SendProtocol[Command]>,
    ): Promise<ProtocolResponseType<SendProtocol[Command]>> {
        return new Promise((resolve, reject) => {
            this.send(command, data, (data, error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(data);
                }
            });
        });
    }

    public disconnect() {
        this.manually_disconnected = true;
        this.socket.close();
        this.rejectPromisesInFlight();
        for (const cb of this.callbacks) {
            cb[1](undefined, { code: "manually_disconnected", message: "Manually disconnected" });
        }
    }
}

/* From https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code 2023-03-05 */
export function closeErrorCodeToString(code: number): string {
    if (code >= 0 && code <= 999) {
        return "Not used";
    }
    switch (code) {
        case 1000:
            return "Normal Closure";
        case 1001:
            return "Going Away";
        case 1002:
            return "Protocol error";
        case 1003:
            return "Unsupported Data";
        case 1004:
            return "Reserved";
        case 1005:
            return "No Status Received";
        case 1006:
            return "Abnormal Closure";
        case 1007:
            return "Invalid frame payload data";
        case 1008:
            return "Policy Violation";
        case 1009:
            return "Message Too Big";
        case 1010:
            return "Mandatory Ext.";
        case 1011:
            return "Internal Error";
        case 1012:
            return "Service Restart";
        case 1013:
            return "Try Again Later";
        case 1014:
            return "Bad Gateway";
        case 1015:
            return "TLS handshake";
    }
    if (code >= 1016 && code <= 2999) {
        // For definition by future revisions of the WebSocket Protocol
        // specification, and for definition by extension specifications.
        return "Unknown official error code: " + code;
    }
    if (code >= 3000 && code <= 3999) {
        // For use by libraries, frameworks, and applications. These status
        // codes are registered directly with IANA. The interpretation of
        // these codes is undefined by the WebSocket protocol.
        return "Unknown library status code: " + code;
    }
    if (code >= 4000 && code <= 4999) {
        // For private use, and thus can't be registered. Such codes can
        // be used by prior agreements between WebSocket applications. The
        // interpretation of these codes is undefined by the WebSocket protocol.";
        return "Unknown private error code: " + code;
    }
    return "Unknown error code: " + code;
}
