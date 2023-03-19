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

import { ClientToServer } from "./ClientToServer";

/** This is an exhaustive list of the messages that the client can send
 *  to the AI servers. */
export interface ClientToAIServer {
    /** Authenticate with the server. This is the same as the authenticate
     *  message in ServerToClient.
     *
     *  Prior to authentication, you should perform a GET request to
     *    `/api/v1/ui/config`
     *  to get the current configuration. Within the returned JSON
     *  you will find all of the necessary fields to authenticate.
     */
    "authenticate": ClientToServer["authenticate"];

    "net/ping": ClientToServer["net/ping"];

    "ai-review-connect": (data: {
        /** AI UUID */
        uuid: string;

        /** The game id we're reviewing */
        game_id: number | string;

        /** The AI review id we're basing our analysis off of */
        ai_review_id: number | string;
    }) => void;

    "ai-review-disconnect": (data: {
        /** AI UUID */
        uuid: string;
    }) => void;

    "ai-analyze-variation": (data: {
        /** AI UUID */
        uuid: string;

        /** The game id we're analyzing */
        game_id: number | string;

        /** The AI review id we're basing our analysis off of */
        ai_review_id: number | string;

        /** The move number we're branching from */
        from: number;

        /** Move string */
        variation: string;
    }) => void;
}
