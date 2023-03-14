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

import type { JGOFPlayerClock } from "../JGOF";
import type { ReviewMessage } from "../GoEngine";
import type { ConditionalMoveResponse } from "../GoConditionalMove";

/** This is an exhaustive list of the messages that the client can send
 *  to the server. */
export interface ClientToServer {
    /** Authenticate with the server.
     *
     *  Prior to authentication, you should perform a GET request to
     *    `/api/v1/ui/config`
     *  to get the current configuration. Within the returned JSON
     *  you will find all of the necessary fields to authenticate.
     */
    "authenticate": {
        /** The JSON Web Token (`user_jwt` field) from `/api/v1/ui/config` */
        jwt: string;
        /** Client generated unique id for the device. */
        device_id: string;
        /** Browser user agent, or application name */
        user_agent: string;
        /** ISO 639-1 language code used on this device. */
        language?: string;
        /** The version of the translation dictionary.  */
        language_version?: string;
        /** Client version string. */
        client_version?: string;
    };

    /** Sends a ping to the server. This message should be
     *  sent regularly. The default interval is 10 seconds.
     *  This keeps the connection alive and allows a client
     *  to measure clock drift and latency, both of which
     *  are vital to adjusting the client's game clock displays.
     */
    "net/ping": {
        /** Client timestamp - milliseconds since epoch */
        client: number;
        /** Last clock drift measurement, or `0` */
        drift: number;
        /** Last latency measurement, or `0` */
        latency: number;
    };

    /** Get active automatch entries for the current user */
    "automatch/list": {};

    /** Message to let the server know the client is still interested
     *  in the specified blitz or live challenge. These should be sent
     *  about once a second to prevent the server from canceling the challenge.
     */
    "challenge/keepalive": {
        challenge_id: number;
        game_id: number;
    };

    /** Connect to a game. Once connected, the client will receive game
     *  updates relevant to the game. */
    "game/connect": {
        /** The game id to connect to */
        game_id: number;

        /** If true, the client will receive the game chat log and new chat events */
        chat?: boolean;
    };

    /** Disconnect from a game. This will stop game updates for a particular game. */
    "game/disconnect": {
        game_id: number;
    };

    /** Sets removed stones in the stone removal phase. */
    "game/removed_stones/set": {
        /** The game id */
        game_id: number;

        /** True if the stones should be marked as removed (or intersections marked
         * as dame if there is no stone there), false if they should be marked as
         * not removed / open area. */
        removed: boolean;

        /** String encoded list of intersections */
        stones: string;

        /** Japanese rules technically have some special scoring rules about
         * whether territory in seki should be counted or not. This is supported
         * by the backend but the official client no longer displays this as an
         * option to the user as it was very largely unused and was a large
         * source of confusion. This field is deprecated and will likely be
         * removed in the future.*/
        strict_seki_mode?: boolean;
    };

    /** Rejects the removed stones and resumes the game from the stone removal phase */
    "game/removed_stones/reject": {
        /** The game id */
        game_id: number;
    };

    /** Accepts the stones as removed. Once both players have accepted the same
     *  stones, the stone removal phase will conclude and the game will finish. */
    "game/removed_stones/accept": {
        /** The game id */
        game_id: number;
        /** All of the stones that are accepted as removed, and all
         * intersections marked as dame */
        stones: string;
        /** Japanese rules technically have some special scoring rules about
         * whether territory in seki should be counted or not. This is supported
         * by the backend but clients should always set this to false in this
         * era of the game, the official client no longer displays this as an
         * option to the user as it was very largely unused and was a large
         * source of confusion. */
        strict_seki_mode: boolean;
    };

    /** Submit a move for a game */
    "game/move": {
        /** The game id */
        game_id: number;
        /** The move number to play at */
        move: string;

        /** Maximum number of milliseconds the client was out of focus between
         * the last move and this move */
        blur?: number;

        /** Clock according to the client. If this is within the margin of
         *  error of the server's clock, the server will accept the new
         *  clock value. If not provided, the server clock will be used. */
        clock?: JGOFPlayerClock;
    };

    /** Requests an undo */
    "game/undo/request": {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    };

    /** Accepts an undo */
    "game/undo/accept": {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    };

    /** Cancels an undo request */
    "game/undo/cancel": {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    };

    /** Pauses the game clocks */
    "game/pause": {
        /** The game id */
        game_id: number;
    };

    /** Resumes the game clocks */
    "game/resume": {
        /** The game id */
        game_id: number;
    };

    /** Resigns from the game */
    "game/resign": {
        /** The game id */
        game_id: number;
    };
    "game/delayed_resign": {
        /** The game id */
        game_id: number;
    };
    "game/clear_delayed_resign": {
        /** The game id */
        game_id: number;
    };
    /** Cancels a game. This is effectively the same as resign, except the
     *  game will not be ranked. This is only allowed within the first few
     *  moves of the game. (See GoEngine.gameCanBeCancelled for cancelation ) */
    "game/cancel": {
        /** The game id */
        game_id: number;
    };
    /** In Japanese rules, if the game is found to be repeating, the players
     *  may opt to annul the entire game and start over.
     *
     *  This is largely undesired in an online setting and support for this
     *  will probably be removed in the future, dont' bother implemeting
     *  this.
     */
    "game/annul": {
        /** The game id */
        game_id: number;
    };

    /** Inform the server that the client believes it's clock has timed out
     *  and the game should be ended in a timeout. This is not strictly necessary
     *  to implement as the server will also timeout games, however there is
     *  a grace period to account for network latency, so well behaved clients
     *  can (and should) send this message to be very exact with timeouts. */
    "game/timed_out": {
        /** The game id */
        game_id: number;
    };

    /** Sets conditional moves to be made on behalf of the player in response
     *  to a move by the opponent. */
    "game/conditional_moves/set": {
        /** The game id */
        game_id: number;
        /** The move number from which the condtional moves are rooted in */
        move_number: number;
        /** The conditional moves. The top level should be an array that looks
         *  like `[null, { ... }]` where the second element contains the responses
         *  to the opponent's move. */
        conditional_moves: ConditionalMoveResponse;
    };

    /** Sends a chat message to a game */
    "game/chat": {
        /** The game id */
        game_id: number;
        /** The type of chat message being sent */
        type: "main" | "malkovich" | "moderator" | "hidden" | "personal";
        /** The move number currently being viewed */
        move_number: number;
        /** The chat message */
        body: string;
    };

    /** Update your latency information for a particular game. This is used
     *  for clock synchronization. It is not strictly required, however strongly
     *  suggested for live games. */
    "game/latency": {
        /** The game id */
        game_id: number;
        /** Network latency, measured in milliseconds. See net/ping to measure this. */
        latency: number;
    };

    /** Connects to a review */
    "review/connect": {
        /** The review id */
        review_id: number;
    };

    /** Disconnects from a review */
    "review/disconnect": {
        /** The review id */
        review_id: number;
    };

    /** Append a review action to the review log. */
    "review/append": ReviewMessage;

    /** Sends a chat message to a review */
    "review/chat": {
        /** The review id */
        review_id: number;
        /** The root of the branch the user is viewing */
        from: number;
        /** The analysis branch the user is viewing */
        moves: string;
        /** The chat message */
        body: string;
    };

    /** Request the number of unique authenticated players
     *  online within the given interval */
    "stats/online": {
        /** Interval in seconds */
        interval: number;
    };

    /** Deletes a notification */
    "notification/delete": {
        player_id: number;
        auth: string;
        notification_id: number;
    };

    /** Connects to the game list count.
     *  Once connected you'll start receiving `gamelist-count` or
     *  `gamelist-count-${channel}` messages.
     */
    "gamelist/count/subscribe": {
        /** The group or tournament channel to subscribe to. If no
         *  channel is provided, the global server counts will be
         *  sent */
        channel?: string;
    };

    /** Disconnects from the game list count */
    "gamelist/count/unsubscribe": {
        /** The group or tournament channel to unsubscribe from. If no
         * channel is provided, the global server counts will be
         * unsubscribed from */
        channel?: string;
    };

    /** Queries the server for a list of games */
    "gamelist/query": {
        list: "live" | "corr" | "kidsgo";
        sort_by: "rank";
        /** Filtering options */
        where: GameListWhere;
        /** The number of games to skip before returning results */
        from: number;
        /** Number of games to return, between 1 and 300 */
        limit: number;

        /** The group or tournament channel to query */
        channel?: string;
    };

    /** Returns an event log for the given game. This is primarily
     *  for moderation purposes, although the endpoint is generally
     *  available to all users. */
    "game/log": {
        game_id: number;
    };

    /** Subscribes to online status updates for the given player ids */
    "user/monitor": {
        user_ids: number[];
    };

    /** Sends an "Inter Tab Communication" message to all other connected
     *  clients for the current user. This includes other devices, so the
     *  "Tab" part is a bit of a misnomer. */
    "itc": {
        event: string;
        data: any;
    };

    /** Set the given key in the remote storage system for this user
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/set": {
        key: string;
        value: any;
        replication: RemoteStorageReplication;
    };

    /** Remove the given key from remote storage system for this user
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/remove": {
        key: string;
        replication: RemoteStorageReplication;
    };

    /** Requests all updated key/value pairs for this user since the
     *  provided timestamp (as as ISO 8601 string).
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/sync": {
        /** ISO 8601 timestamp. Updates made after this timestamp will be sent to the client. */
        since: string;
    };

    /** Sets a channel topic */
    "chat/topic": {
        channel: string;
        topic: string;
    };

    /** Sends a chat message to the given channel */
    "chat/send": {
        /** Channel to send the message to */
        channel: string;
        /** ID for the message */
        uuid: string;
        /** Message text */
        message: string;
    };

    /** Join a chat channel */
    "chat/join": {
        /** Channel to join */
        channel: string;
    };

    /** Leave a channel */
    "chat/part": {
        /** Channel to leave */
        channel: string;
    };

    /** Subscribes to UI related push event messages sent to a particular channel */
    "ui-pushes/subscribe": {
        channel: string;
    };

    /** Un-Subscribes to UI related push event messages sent to a particular channel */
    "ui-pushes/unsubscribe": {
        channel: string;
    };

    /** Subscribes to the seek graph events. The channel is required to be "global"
     *  for now and the foreseeable future. */
    "seek_graph/connect": {
        channel: "global";
    };

    /** Un-Subscribes to the seek graph events. The channel is required to be "global"
     *  for now and the foreseeable future. */
    "seek_graph/disconnect": {
        channel: "global";
    };

    /** Send a private message to another user */
    "chat/pm": {
        /** Player ID of the recipient */
        player_id: number;
        /** Username of the recipient */
        username: string;
        /** UUID for the message */
        uid: string;
        /** Message text */
        message: string;
    };

    /** Loads the current user's private message session history with the given player id */
    "chat/pm/load": {
        player_id: number;
    };

    /** Closes the current user's private message session with the given player id */
    "chat/pm/close": {
        player_id: number;
    };

    /** Begins a "super chat" session with the given player id, which creates an
     *  unclosable dialog if enable is true, and makes the dialog closable again
     * if enable is false. This is only available to moderators. */
    "chat/pm/superchat": {
        /* Player ID of the recipient */
        player_id: number;
        /** Username of the recipient */
        username: string;
        /** Set to true if you want the modal to be unclosable, false if you want
         * the modal to be closable again */
        enable: boolean;
    };

    /** Moderator only command to remove all chat messages for a given player */
    "chat/remove_all": {
        /** Player id to remove all messages for */
        player_id: number;
    };

    /** Moderator only command to remove a single chat message */
    "chat/remove": {
        uuid: string;
    };

    /** Moderator only command to remove a single chat message from a game */
    "game/chat/remove": {
        game_id: number;
        channel: string;
        chat_id: string;
    };

    /** Moderator only command to remove a single chat message from a game */
    "review/chat/remove": {
        review_id: number;
        channel: string;
        chat_id: string;
    };

    /** Retreive host infomration for the termination server you are connected to */
    "hostinfo": {};

    /** Request a match via the automatch system */
    "automatch/find_match": AutomatchPreferences;

    /** Cancel a match request */
    "automatch/cancel": {
        uuid: string;
    };
}

export type Speed = "blitz" | "live" | "correspondence";
export type Size = "9x9" | "13x13" | "19x19";
export type AutomatchCondition = "required" | "preferred" | "no-preference";
export type RuleSet = "japanese" | "chinese" | "aga" | "korean" | "nz" | "ing";

interface AutomatchPreferences {
    uuid: string;
    size_speed_options: Array<{ size: Size; speed: Speed }>;

    timestamp?: number;
    lower_rank_diff: number;
    upper_rank_diff: number;
    rules: {
        condition: AutomatchCondition;
        value: "japanese" | "chinese" | "aga" | "korean" | "nz" | "ing";
    };
    time_control: {
        condition: AutomatchCondition;
        value: {
            system: "byoyomi" | "fischer" | "simple" | "canadian";
            initial_time?: number;
            time_increment?: number;
            max_time?: number;
            main_time?: number;
            period_time?: number;
            periods?: number;
            stones_per_period?: number;
            per_move?: number;
            pause_on_weekends?: boolean;
        };
    };
    handicap: {
        condition: AutomatchCondition;
        value: "enabled" | "disabled";
    };
}

/** This enum defines the various replication strategies for the remote storage
 *  system. For more details on the remote storage replication system see:
 *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
 */
export enum RemoteStorageReplication {
    /** No replication of this change */
    NONE = 0x0,
    /** Locally set data will overwrite remotely set data, but if not
     *  set will default to remotely set data */
    LOCAL_OVERWRITES_REMOTE = 0x1,
    /** Remotely set data will overwrite locally set data */
    REMOTE_OVERWRITES_LOCAL = 0x2,
    /** Remotely set data, but do not update our local value */
    REMOTE_ONLY = 0x4,
}

/** Parameters for the `gamelist/query` message */
export interface GameListWhere {
    hide_ranked?: boolean;
    hide_unranked?: boolean;
    rengo_only?: boolean;
    hide_19x19?: boolean;
    hide_9x9?: boolean;
    hide_13x13?: boolean;
    hide_other?: boolean;
    hide_tournament?: boolean;
    hide_ladder?: boolean;
    hide_open?: boolean;
    hide_handicap?: boolean;
    hide_even?: boolean;
    hide_bot_games?: boolean;
    hide_beginning?: boolean;
    hide_middle?: boolean;
    hide_end?: boolean;
    players?: Array<number>;
    tournament_id?: number;
    ladder_id?: number;
    malk_only?: boolean;
}

export interface ServerToClient {
    /** Pong response from a ping */
    "net/pong": {
        /** Client timestamp that was sent */
        client: number;
        /** Server timestamp when it was received */
        server: number;
    };
}
