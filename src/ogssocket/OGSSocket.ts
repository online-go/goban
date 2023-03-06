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

import WebSocket from "isomorphic-ws";
import { EventEmitter } from "eventemitter3";

console.log("WebSocket", WebSocket);

/* Like setInterval, but debounces catchups that happen
 * when tabs wake up on some browsers. Cleared with
 * the standard clearInterval. */
export function niceInterval(
    callback: () => void,
    interval: number,
): ReturnType<typeof setInterval> {
    let last = performance.now();
    return setInterval(() => {
        const now = performance.now();
        const diff = now - last;
        if (diff >= interval * 0.9) {
            last = now;
            callback();
        }
    }, interval);
}

export interface OGSClientToServerMessages {
    //
    [key: string]: any;
}

export interface OGSServerToClientMessages {
    response: {
        u: string | number; // User data sent with the request
    };
    error: {
        u: string | number; // User data sent with the request
    };
}

interface OGSSocketClientToServerMessage {
    c: string | keyof OGSClientToServerMessages; // Command
    a?: any[]; // Arguments
    u?: string | number; // User defined data to be sent back in the response
}

interface OGSSocketServerToClientMessage {
    e: keyof OGSServerToClientMessages; // Event
    a?: any[]; // Arguments
    u?: string | number; // User defined data, available if this is a response
}

interface Events {
    connect: () => void;
    disconnect: () => void;
    reconnect: () => void;
    unrecoverable_error: (code: number, tag: string, message: string) => void;
    /* Emitted when we receive an updated latency measurement */
    latency: (latency: number, clock_drift: number) => void;

    "net/pong": (params: { client: number; server: number }) => void;

    [key: string]: (...args: any[]) => void;
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

export class OGSSocket extends EventEmitter<Events> {
    public readonly url: string;
    public clock_drift = 0.0;
    public latency = 0.0;
    private socket: WebSocket;
    private last_udata_id = 0;
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

    constructor(url: string) {
        super();

        this.url = url;
        this.socket = this.connect();

        this.on("net/pong", ({ client, server }) => {
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
            throw new Error("OGSSocket not connected");
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
            console.info("OGSSocket connected", event);
            this.reconnecting = false;
            this.reconnect_tries = 0;
            if (!this.connected) {
                console.error("OGSSocket connected but readyState !== OPEN");
            }
            try {
                this.emit("connect");
            } catch (e) {
                console.error("OGSSocket connect event handler error", e);
            }

            if (this.promises_in_flight.size > 0) {
                // This shouldn't ever happen
                throw new Error("OGSSocket connected with promises in flight");
            }

            this.sendAuthentication();

            this.startPing();

            for (const send of this.send_queue) {
                send();
            }
            this.send_queue = [];
        });

        socket.addEventListener("error", (event: Event) => {
            console.error("OGSSocket error", event);
            /*
            if (!this.connected) {
                this.reconnect();
            }
            */
        });

        socket.addEventListener("close", (event: CloseEvent) => {
            console.info(
                `OGSSocket closed with code ${event.code}: ${closeErrorCodeToString(event.code)}`,
                event,
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
            //console.log("Message from server ", event.data);
            const payload: OGSSocketServerToClientMessage = JSON.parse(event.data);
            if (payload.u) {
                const entry = this.promises_in_flight.get(payload.u as number);
                if (entry) {
                    const { command, args, resolve, reject } = entry;
                    try {
                        if (payload.e === "response") {
                            resolve(...(payload.a ?? []));
                        } else if (payload.e === "error") {
                            reject(...(payload.a ?? []));
                        } else {
                            console.error(
                                `OGSSocket received unknown response type ${payload.e} for command ${command} with args ${args}`,
                            );
                        }
                    } catch (e) {
                        console.error(`Error in callback from ${command} with args `, args, e);
                    }
                    this.promises_in_flight.delete(payload.u as number);
                }
            }
            if (payload.e) {
                if (payload.a) {
                    this.emit(payload.e, ...payload.a);
                } else {
                    this.emit(payload.e);
                }
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
        console.info(`OGSSocket reconnecting in ${delay}ms`);
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

    public send(command: string, ...args: any[]): void {
        const request: OGSSocketClientToServerMessage = {
            c: command,
        };
        if (args) {
            request.a = args;
        }

        if (this.connected) {
            this.socket.send(JSON.stringify(request));
        } else {
            this.send_queue.push(() => {
                this.socket.send(JSON.stringify(request));
            });
        }
    }

    public sendPromise(command: string, ...args: any[]): Promise<any> {
        return new Promise((resolve, reject) => {
            const udata_id = ++this.last_udata_id;

            const request: OGSSocketClientToServerMessage = {
                c: command,
                u: udata_id,
            };
            if (args) {
                request.a = args;
            }

            if (this.connected) {
                this.promises_in_flight.set(udata_id, { command, args, resolve, reject });
                this.socket.send(JSON.stringify(request));
            } else {
                this.send_queue.push(() => {
                    this.promises_in_flight.set(udata_id, { command, args, resolve, reject });
                    this.socket.send(JSON.stringify(request));
                });
            }
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
