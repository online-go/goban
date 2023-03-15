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
import { niceInterval } from "./GoUtil";
import { ClientToServer, ServerToClient } from "./protocol";

type GobanSocketClientToServerMessage = [keyof ClientToServer, any?, number?];
type GobanSocketServerToClientMessage = [keyof ServerToClient | number, any, any];

type DataToEventEmitterShim<T extends object> = {
    [K in keyof T]: T[K] extends undefined ? () => void : (data: T[K]) => void;
};

export interface GobanSocketEvents extends DataToEventEmitterShim<ServerToClient> {
    connect: () => void;
    disconnect: () => void;
    reconnect: () => void;
    unrecoverable_error: (code: number, tag: string, message: string) => void;
    /* Emitted when we receive an updated latency measurement */
    latency: (latency: number, clock_drift: number) => void;

    [key: string]: (...data: any[]) => void;
}

interface ErrorResponse {
    code: string;
    message: string;
}

const RECONNECT_MIN_DELAY = 500;
const RECONNECT_MAX_DELAY = 2000;
const PING_INTERVAL = 10000;

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

export class GobanSocket extends EventEmitter<GobanSocketEvents> {
    public readonly url: string;
    public clock_drift = 0.0;
    public latency = 0.0;
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
    private ping_interval?: ReturnType<typeof niceInterval>;
    private callbacks: Map<number, (data?: any, error?: ErrorResponse) => void> = new Map();

    constructor(url: string) {
        super();

        url = url.replace(/^http/, "ws");

        this.url = url;
        this.socket = this.connect();

        this.on("net/pong", ({ client, server }: { client: number; server: number }) => {
            const now = Date.now();
            const latency = now - client;
            const drift = now - latency / 2 - server;
            this.latency = latency;
            this.clock_drift = drift;
            this.emit("latency", latency, drift);
        });
    }

    get connected(): boolean {
        return this.socket.readyState === WebSocket.OPEN;
    }

    private sendAuthentication(): void {
        //console.log("TODO: Implement authentication");
    }

    private startPing(): void {
        if (!this.connected) {
            throw new Error("GobanSocket not connected");
        }

        const ping = () => {
            if (this.connected) {
                this.send("net/ping", {
                    client: Date.now(),
                    drift: this.clock_drift,
                    latency: this.latency,
                });
            } else {
                if (this.ping_interval) {
                    clearInterval(this.ping_interval);
                    this.ping_interval = undefined;
                }
            }
        };

        if (this.ping_interval) {
            clearInterval(this.ping_interval);
        }

        this.ping_interval = niceInterval(ping, PING_INTERVAL);
        ping();
    }

    private connect(): WebSocket {
        const socket = new WebSocket(this.url);

        socket.addEventListener("open", (event: Event) => {
            console.log("GobanSocket connected to " + this.url);
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
            console.error("GobanSocket error", event);
            /*
            if (!this.connected) {
                this.reconnect();
            }
            */
        });

        socket.addEventListener("close", (event: CloseEvent) => {
            console.log(
                `GobanSocket closed with code ${event.code}: ${closeErrorCodeToString(event.code)}`,
            );

            this.rejectPromisesInFlight();

            try {
                this.emit("disconnect");
            } catch (e) {
                console.error("Error in disconnect handler", e);
            }

            if (event.code === 1014 || event.code === 1015) {
                console.error("OGS Socket closed with an unrecoverable error, not reconnecting");
                this.emit(
                    "unrecoverable_error",
                    event.code,
                    event.code === 1014
                        ? "bad_gateway"
                        : event.code === 1015
                        ? "tls_handshake"
                        : "unknown",
                    closeErrorCodeToString(event.code),
                );
                return;
            }

            this.reconnecting = false;
            this.reconnect();
        });

        socket.addEventListener("message", (event: MessageEvent) => {
            const payload: GobanSocketServerToClientMessage = JSON.parse(event.data);
            const [id_or_command, data, err] = payload;

            if (typeof id_or_command === "number") {
                const cb = this.callbacks.get(id_or_command);
                if (cb) {
                    this.callbacks.delete(id_or_command);
                    cb(data, err);
                }
            } else {
                this.emit(id_or_command, data);
            }
        });

        return socket;
    }

    private reconnect(): void {
        if (this.reconnecting) {
            return;
        }
        this.reconnecting = true;

        ++this.reconnect_tries;
        const delay = Math.min(
            RECONNECT_MAX_DELAY,
            RECONNECT_MIN_DELAY * Math.pow(1.5, this.reconnect_tries),
        );
        console.info(`GobanSocket reconnecting in ${delay}ms`);
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

    public send<KeyT extends keyof ClientToServer>(
        command: KeyT,
        data: ClientToServer[KeyT],
        cb?: (data?: any, error?: any) => void,
    ): void {
        const request: GobanSocketClientToServerMessage = cb
            ? [command, data, ++this.last_request_id]
            : data
            ? [command, data]
            : [command];

        if (cb) {
            this.callbacks.set(this.last_request_id, cb);
        }

        if (this.connected) {
            this.socket.send(JSON.stringify(request));
        } else {
            this.send_queue.push(() => {
                this.socket.send(JSON.stringify(request));
            });
        }
    }

    public sendPromise<KeyT extends keyof ClientToServer>(
        command: KeyT,
        data: ClientToServer[KeyT],
    ): Promise<any> {
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
}

/* From https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code 2023-03-05 */
function closeErrorCodeToString(code: number): string {
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
            return "No Status Rcvd";
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
