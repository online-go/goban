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
 * # Changes from the Socket.IO implementation.
 *  - These updates are guidelines, existing code should work unmodified.
 *    However several optional changes were made to make the interface
 *    more consistent and to remove some of the cruft that had grown
 *    over time.
 *
 *  - All authentication is handled via the `authenticate` message, there
 *    is no longer a need for the various `chat_auth`, `incident_auth`, etc
 *    fields in any of the messages. Those fields are still supported for
 *    backwards compatibility, but if the jwt is provided, they are ignored.
 *
 *  - The `chat/connect` and `incident/connect` messages have been removed
 *    and are an implicitly called by the `authenticate` message.
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
 *
 * @module
 */

export * from "./messages";
export * from "./GobanSocket";
