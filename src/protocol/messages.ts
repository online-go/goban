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

/** This is an exhaustive list of the messages that the client can send
 *  to the server. */
/*eslint quote-props: ["error", "as-needed"]*/
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
        game_id: number;
    };

    /** Disconnect from a game. This will stop game updates for a particular game. */
    "game/disconnect": {
        game_id: number;
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
    [key: string]: any;
}
