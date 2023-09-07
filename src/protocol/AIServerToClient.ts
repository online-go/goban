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

import { ServerToClient } from "./ServerToClient";

export interface AIServerToClient {
    /** Pong response from a ping */
    "net/pong": ServerToClient["net/pong"];

    /** AI review messages are streamed back to the AI review UUID. */
    [uuid: string]: (data: any) => void;

    /** AI position analysis messages streaming back to a particular channel */
    [k: `ai-position-analysis-stream-review-${string}`]: (data: {
        board_string: string;
        analysis: any;
        final: boolean;
        intermediate: boolean;
    }) => void;
}
