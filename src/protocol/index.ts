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

/**
 * The goban library has built in support for communicating to the
 * Online-Go.com game server. This is the official implementation
 * used by the site itself, so it is a good reference if you are making
 * a third party client.
 *
 * All of the communication is done via websockets using simple JSON
 * messages.
 *
 * Messages sent from the client to the server have the following format
 *
 *    `[command: string, data: any, id?: number]`
 *
 * where command is one of the commands listed in the [[ClientToServer]] protocol,
 * data is the data associated with that command, and id is an optional
 * request id that will be echoed in a response if a response is requested.
 *
 * Messages sent from the server to the client have the format
 *
 *    `[event_name: string, data: any]`
 *
 *    or
 *
 *    `[id: number, data?: any, error?: {code: string, message: string}]`
 *
 * where event_name/data is listed in the [[ServerToClient]] protocol, or if
 * the message is a response to a command sent by the client, the id
 * and the data for the response. Exactly one response will be sent for
 * a given command if an id was sent with the request. If no id was sent,
 * no response will be sent (but subsequent named commands can be sent back
 * if appropriate). Responses either have data or error set, never both.
 *
 *
 * # Changes from the Socket.IO implementation.
 *  - Several cleanup updates have been made to remove the need for several old
 *    fields and a few messages that are no longer needed. Including these fields
 *    will not cause any problems, but below are notes if you want to clean up
 *    your code.
 *
 *  - Several cleanup updates have been made that homogenize the type of
 *    fields, namely 0/1 booleans are now true/false booleans and id's are
 *    always numbers. The server still supports coalescing these fields for
 *    backwards compatibility.
 *
 *  - All authentication is now handled via the `authenticate` message, there
 *    is no longer a need for the various `chat_auth`, `incident_auth`, etc
 *    fields in any of the messages. Those fields are still supported for
 *    backwards compatibility, but if the jwt is provided, they are ignored.
 *
 *  - The `auth` field in all game and review messages is no longer necessary
 *    or used
 *
 *  - the `player_id` field in all game and review messages is no longer
 *    necessary or used
 *
 *  - The `chat/connect`, `incident/connect`, and `notification/connect`
 *    messages have been removed and are an implicitly called by the
 *    `authenticate` message.
 *
 *  - `chat/pm/close` and `chat/pm/load` now accept a `{ player_id: number }`
 *    object for consistency. Old clients that simply send a number will still work.
 *
 *  - `remote_storage/sync` now accepts an object `{ from: string }` for
 *    consistency. Old clients that simply send a string will still work.
 *
 *  - `user/monitor` now accepts an object `{ user_ids: number[] }` for
 *    consistency. Old clients that send raw numeric array will still work.
 *
 *  - The `cmoves` parameter has been renamed to `conditional_moves` in
 *    `game/conditional_moves/set`. The server still supports the old name
 *    for backwards compatibility.
 *
 * @module
 */

export * from "./ClientToServer";
export * from "./ServerToClient";
export * from "./ClientToAIServer";
export * from "./AIServerToClient";
