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

import { ClientToServerBase, RuleSet } from "./ClientToServer";
import { JGOFMove, JGOFNumericPlayerColor } from "../formats/JGOF";

/** This is an exhaustive list of the messages that the client can send
 *  to the AI servers. */
export interface ClientToAIServer extends ClientToServerBase {
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

    /** Requests a position be analyzed, intermediate and final results are
     *  sent to the given channel. The final response is returned as well. */
    "ai-analyze-position": (data: {
        /** UUID identifying the request */
        uuid: string;

        /** Channel identifier, for instance ai-position-analysis-stream-review-<id> */
        channel_id: string;

        /** Ruleset to use */
        rules: RuleSet;

        /** Board position state */
        board: number[][];

        /** Number of captures black has */
        black_prisoners: number;

        /** Number of captures white has */
        white_prisoners: number;

        /** Komi */
        komi: number;

        /** Whose turn it is */
        player: JGOFNumericPlayerColor;

        /** Moves to replay */
        moves?: JGOFMove[];

        /** Unique board string used to relay to other clients */
        board_string?: string;
    }) => any;

    /** Relay an already analyzed position out to any other viewers */
    "ai-relay-analyzed-position": (data: {
        /** Channel identifier, for instance ai-position-analysis-stream-review-<id> */
        channel_id: string;

        data: any;
    }) => any;

    /** Subscribers to analyze position calls */
    "ai-analyze-subscribe": (data: { channel_id: string }) => void;

    /** Un-subscribers to analyze position calls */
    "ai-analyze-unsubscribe": (data: { channel_id: string }) => void;
}
