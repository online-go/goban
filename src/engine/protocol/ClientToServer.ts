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

import type { JGOFMove, JGOFPlayerClock, JGOFSealingIntersection } from "../formats/JGOF";
import type { ReviewMessage } from "../GobanEngine";
import type { ConditionalMoveResponse } from "../ConditionalMoveTree";

/** Messages that clients send, regardless of target server */
export interface ClientToServerBase {
    /** Authenticate with the server.
     *
     *  Prior to authentication, you should perform a GET request to
     *    `/api/v1/ui/config`
     *  to get the current configuration. Within the returned JSON
     *  you will find all of the necessary fields to authenticate.
     */
    "authenticate": (data: {
        /** The JSON Web Token (`user_jwt` field) from `/api/v1/ui/config`. If
         * connecting as a guest, send "" */
        jwt: string;
        /** Client generated unique id for the device. */
        device_id?: string;
        /** Browser user agent (or websocket library) */
        user_agent?: string;
        /** ISO 639-1 language code used on this device. */
        language?: string;
        /** The version of the translation dictionary.  */
        language_version?: string;
        /** Client name (your application name) */
        client?: string;
        /** Client version string. */
        client_version?: string;

        /** Bot username connecting, if applicable */
        bot_username?: string;
        /** Bot API key, if applicable */
        bot_apikey?: string;
    }) =>
        | {
              id: number;
              username: string;
          }
        | undefined;

    /** Sends a ping to the server. This message should be
     *  sent regularly. The default interval is 10 seconds.
     *  This keeps the connection alive and allows a client
     *  to measure clock drift and latency, both of which
     *  are vital to adjusting the client's game clock displays.
     */
    "net/ping": (data: {
        /** Client timestamp - milliseconds since epoch */
        client: number;
        /** Last clock drift measurement, or `0` */
        drift: number;
        /** Last latency measurement, or `0` */
        latency: number;
    }) => void;
}

/** This is an exhaustive list of the messages that the client can send
 *  to the server.
 *
 *  This documentation is generated from the official typescript interface.
 *  To interpret it, you will every message organized as the name of the
 *  message followed by a function taking the message data parameters and
 *  returning what you can expect tor receive back.
 *
 *  For example, the authentication message documentation looks like this:
 *
 *  ```typescript
 *    authenticate: ((data: {
 *        bot_apikey?: string;
 *        bot_username?: string;
 *        client?: string;
 *        client_version?: string;
 *        device_id?: string;
 *        jwt: string;
 *        language?: string;
 *        language_version?: string;
 *        user_agent?: string;
 *    }) => undefined | {
 *        id: number;
 *        username: string;
 *    })
 *  ```
 *
 *  The command you will send is `authenticate`, the data you send will be an object with the following format:
 *  ```typescript
 *   {
 *       bot_apikey?: string;
 *       bot_username?: string;
 *       client?: string;
 *       client_version?: string;
 *       device_id?: string;
 *       jwt: string;
 *       language?: string;
 *       language_version?: string;
 *       user_agent?: string;
 *   }
 *  ```
 *
 *  and you can expect to receive back either `undefined` or `{id: number, username: string}`
 *
 */
export interface ClientToServer extends ClientToServerBase {
    /** Get active automatch entries for the current user */
    "automatch/list": (data: {}) => void;

    /** Message to let the server know the client is still interested
     *  in the specified blitz or live challenge. These should be sent
     *  about once a second to prevent the server from canceling the challenge.
     */
    "challenge/keepalive": (data: { challenge_id: number; game_id: number }) => void;

    /** Connect to a game. Once connected, the client will receive game
     *  updates relevant to the game. */
    "game/connect": (data: {
        /** The game id to connect to */
        game_id: number;

        /** If true, the client will receive the game chat log and new chat events */
        chat?: boolean;
    }) => void;

    /** Disconnect from a game. This will stop game updates for a particular game. */
    "game/disconnect": (data: { game_id: number }) => void;

    /** Sets removed stones in the stone removal phase. */
    "game/removed_stones/set": (data: {
        /** The game id */
        game_id: number;

        /** True if the stones should be marked as removed (or intersections marked
         * as dame if there is no stone there), false if they should be marked as
         * not removed / open area. */
        removed: boolean;

        /** List of intersections that are to be removed. */
        stones: JGOFMove[] | string;

        /** List of intersections that need to be sealed before the game can be
         *  correctly scored. Note, if this is undefined, the value will not
         *  be changed on the server side. To specify there are no more intersections
         *  that need to be cleared, set it to `[]` specifically.
         */
        needs_sealing?: JGOFSealingIntersection[];

        /** Japanese rules technically have some special scoring rules about
         * whether territory in seki should be counted or not. This is supported
         * by the backend but the official client no longer displays this as an
         * option to the user as it was very largely unused and was a large
         * source of confusion. This field is deprecated and will likely be
         * removed in the future.*/
        strict_seki_mode?: boolean;
    }) => void;

    /** Rejects the removed stones and resumes the game from the stone removal phase */
    "game/removed_stones/reject": (data: {
        /** The game id */
        game_id: number;
    }) => void;

    /** Accepts the stones as removed. Once both players have accepted the same
     *  stones, the stone removal phase will conclude and the game will finish. */
    "game/removed_stones/accept": (data: {
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
    }) => void;

    /** Submit a move for a game */
    "game/move": (data: {
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
    }) => void;

    /** Requests an undo */
    "game/undo/request": (data: {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    }) => void;

    /** Accepts an undo */
    "game/undo/accept": (data: {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    }) => void;

    /** Cancels an undo request */
    "game/undo/cancel": (data: {
        /** The game id */
        game_id: number;
        /** The current move number */
        move_number: number;
    }) => void;

    /** Pauses the game clocks */
    "game/pause": (data: {
        /** The game id */
        game_id: number;
    }) => void;

    /** Resumes the game clocks */
    "game/resume": (data: {
        /** The game id */
        game_id: number;
    }) => void;

    /** Resigns from the game */
    "game/resign": (data: {
        /** The game id */
        game_id: number;
    }) => void;
    "game/delayed_resign": (data: {
        /** The game id */
        game_id: number;
    }) => void;
    "game/clear_delayed_resign": (data: {
        /** The game id */
        game_id: number;
    }) => void;
    /** Cancels a game. This is effectively the same as resign, except the
     *  game will not be ranked. This is only allowed within the first few
     *  moves of the game. (See GobanEngine.gameCanBeCancelled for cancellation ) */
    "game/cancel": (data: {
        /** The game id */
        game_id: number;
    }) => void;
    /** In Japanese rules, if the game is found to be repeating, the players
     *  may opt to annul the entire game and start over.
     *
     *  This is largely undesired in an online setting and support for this
     *  will probably be removed in the future, dont' bother implementing
     *  this.
     */
    "game/annul": (data: {
        /** The game id */
        game_id: number;
    }) => void;

    /** Request the server end a game that is being stalled by one of the
     * players. This will only work if the server agrees in the outcome. */
    "game/prevent_stalling": (data: {
        /** The game id */
        game_id: number;

        /** The proposed winner */
        winner: "black" | "white";
    }) => void;

    /** Request the server end a game that someone has left without resigning
     * from  */
    "game/prevent_escaping": (data: {
        /** The game id */
        game_id: number;

        /** The proposed winner */
        winner: "black" | "white";

        /** Request that the game be annulled or not */
        annul: boolean;
    }) => void;

    /** Inform the server that the client believes it's clock has timed out
     *  and the game should be ended in a timeout. This is not strictly necessary
     *  to implement as the server will also timeout games, however there is
     *  a grace period to account for network latency, so well behaved clients
     *  can (and should) send this message to be very exact with timeouts. */
    "game/timed_out": (data: {
        /** The game id */
        game_id: number;
    }) => void;

    /** Sets conditional moves to be made on behalf of the player in response
     *  to a move by the opponent. */
    "game/conditional_moves/set": (data: {
        /** The game id */
        game_id: number;
        /** The move number from which the conditional moves are rooted in */
        move_number: number;
        /** The conditional moves. The top level should be an array that looks
         *  like `[null, { ... }]` where the second element contains the responses
         *  to the opponent's move. */
        conditional_moves: ConditionalMoveResponse;
    }) => void;

    /** Sends a chat message to a game */
    "game/chat": (data: {
        /** The game id */
        game_id: number;
        /** The type of chat message being sent */
        type: "main" | "malkovich" | "moderator" | "hidden" | "personal";
        /** The move number currently being viewed */
        move_number: number;
        /** The chat message */
        body: string | GameChatTranslatedMessage | GameChatAnalysisMessage | GameChatReviewMessage;
    }) => void;

    /** Update your latency information for a particular game. This is used
     *  for clock synchronization. It is not strictly required, however strongly
     *  suggested for live games. */
    "game/latency": (data: {
        /** The game id */
        game_id: number;
        /** Network latency, measured in milliseconds. See net/ping to measure this. */
        latency: number;
    }) => void;

    /** Connects to a review */
    "review/connect": (data: {
        /** The review id */
        review_id: number;
    }) => void;

    /** Disconnects from a review */
    "review/disconnect": (data: {
        /** The review id */
        review_id: number;
    }) => void;

    /** Append a review action to the review log. */
    "review/append": (data: ReviewMessage) => void;

    /** Sends a chat message to a review */
    "review/chat": (data: {
        /** The review id */
        review_id: number;
        /** The root of the branch the user is viewing */
        from: number;
        /** The analysis branch the user is viewing */
        moves: string;
        /** The chat message */
        body: string;
    }) => void;

    /** Request the number of unique authenticated players
     *  online within the given interval */
    "stats/online": (data: {
        /** Interval in seconds */
        interval: number;
    }) => number;

    /** Deletes a notification */
    "notification/delete": (data: { notification_id: string }) => void;

    /** Connects to the game list count.
     *  Once connected you'll start receiving `gamelist-count` or
     *  `gamelist-count-${channel}` messages.
     */
    "gamelist/count/subscribe": (data: {
        /** The group or tournament channel to subscribe to. If no
         *  channel is provided, the global server counts will be
         *  sent */
        channel?: string;
    }) => void;

    /** Disconnects from the game list count */
    "gamelist/count/unsubscribe": (data: {
        /** The group or tournament channel to unsubscribe from. If no
         * channel is provided, the global server counts will be
         * unsubscribed from */
        channel?: string;
    }) => void;

    /** Queries the server for a list of games */
    "gamelist/query": (data: {
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
    }) =>
        | undefined
        | {
              list: string;
              by: string;
              size: number;
              where: GameListWhere;
              from: number;
              limit: number;
              results: GameListEntry[];
          };

    /** Returns an event log for the given game. This is primarily
     *  for moderation purposes, although the endpoint is generally
     *  available to all users. */
    "game/log": (data: { game_id: number }) => { timestamp: string; event: string; data: any }[];

    /** Subscribes to online status updates for the given player ids */
    "user/monitor": (data: { user_ids: number[] }) => void;

    /** Sends an "Inter Tab Communication" message to all other connected
     *  clients for the current user. This includes other devices, so the
     *  "Tab" part is a bit of a misnomer. */
    "itc": (data: {
        /** User defined event string */
        event: string;
        /** User defined data */
        data: any;
    }) => void;

    /** Set the given key in the remote storage system for this user
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/set": (data: {
        key: string;
        value: any;
        replication: RemoteStorageReplication;
    }) => { error?: string; retry?: boolean } | { success: true };

    /** Remove the given key from remote storage system for this user
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/remove": (data: {
        key: string;
        replication: RemoteStorageReplication;
    }) => { error?: string; retry?: boolean } | { success: true };

    /** Requests all updated key/value pairs for this user since the
     *  provided timestamp (as as ISO 8601 string).
     *
     *  For more details on the remote storage replication system see:
     *   https://github.com/online-go/online-go.com/blob/devel/src/lib/data.ts
     */
    "remote_storage/sync": (data: {
        /** ISO 8601 timestamp. Updates made after this timestamp will be sent to the client. */
        since: string;
    }) => { error?: string; retry?: boolean } | { success: true };

    /** Sets a channel topic */
    "chat/topic": (data: { channel: string; topic: string }) => void;

    /** Sends a chat message to the given channel */
    "chat/send": (data: {
        /** Channel to send the message to */
        channel: string;
        /** ID for the message */
        uuid: string;
        /** Message text */
        message: string;
    }) => void;

    /** Join a chat channel */
    "chat/join": (data: {
        /** Channel to join */
        channel: string;
    }) => void;

    /** Leave a channel */
    "chat/part": (data: {
        /** Channel to leave */
        channel: string;
    }) => void;

    /** Subscribes to UI related push event messages sent to a particular channel */
    "ui-pushes/subscribe": (data: { channel: string }) => void;

    /** Un-Subscribes to UI related push event messages sent to a particular channel */
    "ui-pushes/unsubscribe": (data: { channel: string }) => void;

    /** Subscribes to the seek graph events. The channel is required to be "global"
     *  for now and the foreseeable future. */
    "seek_graph/connect": (data: { channel: "global" }) => void;

    /** Un-Subscribes to the seek graph events. The channel is required to be "global"
     *  for now and the foreseeable future. */
    "seek_graph/disconnect": (data: { channel: "global" }) => void;

    /** Send a private message to another user */
    "chat/pm": (data: {
        /** Player ID of the recipient */
        player_id: number;
        /** Username of the recipient */
        username: string;
        /** UUID for the message */
        uid: string;
        /** Message text */
        message: string;
        /** Moderator option to send the chat from the system not from their personal PM */
        as_system?: true;
    }) =>
        | undefined
        | {
              from: User;
              to: {
                  id: number;
                  username: string;
              };
              message: {
                  i: string;
                  t: number;
                  m: string;
              };
          };

    /** Loads the current user's private message session history with the given player id */
    "chat/pm/load": (data: { player_id: number }) => void;

    /** Closes the current user's private message session with the given player id */
    "chat/pm/close": (data: { player_id: number }) => void;

    /** Begins a "super chat" session with the given player id, which creates an
     *  unclosable dialog if enable is true, and makes the dialog closable again
     * if enable is false. This is only available to moderators. */
    "chat/pm/superchat": (data: {
        /* Player ID of the recipient */
        player_id: number;
        /** Username of the recipient */
        username: string;
        /** Set to true if you want the modal to be unclosable, false if you want
         * the modal to be closable again */
        enable: boolean;
    }) => void;

    /** Moderator only command to remove all chat messages for a given player */
    "chat/remove_all": (data: {
        /** Player id to remove all messages for */
        player_id: number;
    }) => void;

    /** Moderator only command to remove a single chat message */
    "chat/remove": (data: { uuid: string }) => void;

    /** Moderator only command to remove a single chat message from a game */
    "game/chat/remove": (data: { game_id: number; channel: string; chat_id: string }) => void;

    /** Moderator only command to remove a single chat message from a game */
    "review/chat/remove": (data: { review_id: number; channel: string; chat_id: string }) => void;

    /** Retrieve host information for the termination server you are connected to */
    "hostinfo": (data: {}) => {
        "hostname": string;
        "clients": number;
        "uptime": number;
        "ggs-version": string;
    };

    /** Request a match via the automatch system */
    "automatch/find_match": (data: AutomatchPreferences) => void;

    /** Cancel a match request */
    "automatch/cancel": (data: { uuid: string }) => void;

    /** Subscribe to automatch offers */
    "automatch/available/subscribe": () => void;

    /** Unsubscribe from automatch offers */
    "automatch/available/unsubscribe": () => void;

    /** Updates the config for the bot */
    "bot/config": (config: BotConfig) => void;

    /** Update the number of games that the bot is currently playing */
    "bot/status": (data: {
        ongoing_blitz_count: number;
        ongoing_live_count: number;
        ongoing_correspondence_count: number;
    }) => void;
}

export interface BotAllowedClockSettingsV1 {
    simple?: {
        per_move_time_range: [number, number];
    };
    byoyomi?: {
        main_time_range: [number, number];
        period_time_range: [number, number];
        periods_range: [number, number];
    };
    fischer?: {
        max_time_range: [number, number];
        time_increment_range: [number, number];
    };

    concurrent_games?: number;
}

export interface BotAllowedClockSettingsV2 {
    simple?: {
        per_move_time_range: [number, number];
    };
    byoyomi?: {
        main_time_range: [number, number];
        period_time_range: [number, number];
        periods_range: [number, number];
    };
    fischer?: {
        initial_time_range: [number, number];
        max_time_range: [number, number];
        time_increment_range: [number, number];
    };

    concurrent_games?: number;
}

export interface BotConfigV0 {
    _config_version: 0;
}
export interface BotConfigV1 {
    _config_version: 1;
    hidden: boolean;
    bot_id: number;
    username: string;
    allowed_time_control_systems: ("simple" | "byoyomi" | "fischer")[];
    allowed_board_sizes: number[] | "all" | "square" | number;
    allowed_blitz_settings?: BotAllowedClockSettingsV1;
    allowed_rapid_settings?: BotAllowedClockSettingsV1;
    allowed_live_settings?: BotAllowedClockSettingsV1;
    allowed_correspondence_settings?: BotAllowedClockSettingsV1;
    allow_ranked: boolean;
    allow_unranked: boolean;
    allowed_rank_range: [string, string];
    allow_ranked_handicap: boolean;
    allow_unranked_handicap: boolean;
    allowed_komi_range: [number, number];
    decline_new_challenges: boolean;
    min_move_time: number; // ms
    max_games_per_player: number;
}

export interface BotConfigV2 {
    _config_version: 2;
    hidden: boolean;
    bot_id: number;
    username: string;
    allowed_time_control_systems: ("simple" | "byoyomi" | "fischer")[];
    allowed_board_sizes: number[] | "all" | "square" | number;
    allowed_blitz_settings?: BotAllowedClockSettingsV2;
    allowed_rapid_settings?: BotAllowedClockSettingsV2;
    allowed_live_settings?: BotAllowedClockSettingsV2;
    allowed_correspondence_settings?: BotAllowedClockSettingsV2;
    allow_ranked: boolean;
    allow_unranked: boolean;
    allowed_rank_range: [string, string];
    allow_ranked_handicap: boolean;
    allow_unranked_handicap: boolean;
    allowed_komi_range: [number, number];
    decline_new_challenges: boolean;
    min_move_time: number; // ms
    max_games_per_player: number;
}

export type BotConfig = BotConfigV0 | BotConfigV1 | BotConfigV2;

export type Speed = "blitz" | "rapid" | "live" | "correspondence";
export type Size = "9x9" | "13x13" | "19x19";
export type AutomatchCondition = "required" | "preferred" | "no-preference";
export type RuleSet = "japanese" | "chinese" | "aga" | "korean" | "nz" | "ing";

export interface AutomatchPreferences {
    uuid: string;
    size_speed_options: Array<{ size: Size; speed: Speed; system: "fischer" | "byoyomi" }>;

    timestamp?: number;
    lower_rank_diff: number;
    upper_rank_diff: number;
    rules: {
        condition: AutomatchCondition;
        value: "japanese" | "chinese" | "aga" | "korean" | "nz" | "ing";
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

interface GameListPlayer {
    username: string;
    id: number;
    rank: number;
    professional: boolean;
    accepted: boolean;
    ratings: {
        version: number;
        overall: {
            rating: number;
            deviation: number;
            volatility: number;
        };
    };
}

export interface GameListEntry {
    id: number;
    group_ids?: Array<number>;
    group_ids_map?: { [id: string]: boolean };
    kidsgo_game?: boolean;
    phase: string;
    name: string;
    player_to_move: number;
    width: number;
    height: number;
    move_number: number;
    paused: boolean;
    private: boolean;
    black: GameListPlayer;
    white: GameListPlayer;

    rengo: boolean;
    rengo_teams: {
        black: Array<User>;
        white: Array<User>;
    };
    dropped_player: number;
    rengo_casual_mode: boolean;

    _participants?: Array<number>; // computed internally, used for internal lookup

    time_per_move: number;
    clock_expiration: number;

    bot_game?: boolean;
    ranked?: boolean;
    handicap?: number;
    tournament_id?: number;
    ladder_id?: number;
    komi?: number;
    socket_id?: any;

    in_beginning?: boolean;
    in_middle?: boolean;
    in_end?: boolean;
    malkovich_present?: boolean;
    //chat_count?:number;
}

export interface User {
    id: number;
    username: string;
    ratings?: { [speed_size: string]: Glicko2 };
    ranking?: number;
    professional?: boolean;
    country?: string;
    ui_class?: string;
}

export interface Glicko2 {
    rating: number;
    deviation: number;
    volatility: number;
    games_played?: number;
}

export interface GameChatTranslatedMessage {
    type: "translated";
    en: string;
    [lang: string]: string;
}

export interface GameChatAnalysisMessage {
    type: "analysis";
    name?: string;
    branch_move?: number; // deprecated
    from?: number;
    moves?: string;
    marks?: { [mark: string]: string };
    pen_marks?: unknown[];
    engine_analysis?: {
        win_rate: number;
        score?: number;
        visits?: number;
        [key: string]: number | undefined;
    };
}

export interface GameChatReviewMessage {
    type: "review";
    review_id: number;
}
