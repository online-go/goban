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

import type {
    GameListEntry,
    User,
    AutomatchPreferences,
    RemoteStorageReplication,
    BotConfig,
} from "./ClientToServer";
import type { JGOFTimeControl } from "../formats/JGOF";
import type { ConditionalMoveResponse } from "../ConditionalMoveTree";
import type { GobanEngineConfig, Score, ReviewMessage } from "../GobanEngine";
import type { AdHocPackedMove } from "../formats/AdHocFormat";

interface Vote {
    voter_id: number;
    action: string;
    updated: string;
}

/* NOTE: The reason for the :id non template literal key variants of our
 *       messages is to allow typedoc generate documentation for them,
 *       as documentation is not generated for template literal keys
 *       at the time of writing. */

export interface ServerToClient {
    /** Pong response from a ping */
    "net/pong": (data: {
        /** Client timestamp that was sent */
        client: number;
        /** Server timestamp when it was received */
        server: number;
    }) => void;

    /** The client should reload */
    "HUP": () => void;

    /** An error occurred, the message string should be displayed to the user.
     * For a list of errcode's used, see
     * https://github.com/online-go/online-go.com/blob/devel/src/components/Errcode/Errcode.tsx
     */
    "ERROR": (data: string | { errcode: string }) => void;

    /** General host information for the termination server you
     * are connected to. This is a response to the `hostinfo` client message. */
    "hostinfo": (data: {
        /** The hostname of the server */
        hostname: string;
        /** Number of clients connected, if available */
        clients: number;
        /** Number of seconds the server has been running */
        uptime: number;
    }) => void;

    /** "Inter Tab Communication" message. This is a client utility to enable
     *  relaying of messages between devices - the event and data are
     *  application defined, the server blindly relays to all connected devices
     *  for the sending user. Note this is relayed to all devices regardless
     *  of client, so your application should be prepared to handle ITC messages
     *  from other applications, not just your own application. (For instance,
     *  the web client sending this will arrive on an android and ios instance)
     */
    "itc": (data: {
        /** User defined event string */
        event: string;
        /** User defined data */
        data: any;
    }) => void;

    /** A UI Push notification. The event and data are not well defined here,
     *  they come as a result to subscribing to ui push channels with
     *  `ui-pushes/subscribe`.
     */
    "ui-push": (data: {
        /** UI Push event */
        event: string;
        /** UI Push data */
        data: string;
    }) => void;

    /** Update the user's JWT token */
    "user/jwt": (jwt: string) => void;

    /** Update user information. For other players, this has the standard User
     *  fields, when this is the current user, it can have additional fields
     *  that are found in the ui/config */
    "user/update": (user: User & { [extra: string]: any }) => void;

    /** Updates whether a user is online or not. Subscribe to these updates for
     *  particular users using the `user/monitor` command. */
    "user/state": (data: { [player_id: number]: boolean }) => void;
    /** A notification that should be displayed to the user
     *  These are not strongly modeled, see
     *     https://github.com/online-go/online-go.com/blob/devel/src/components/Notifications/Notifications.tsx
     *  as a reference for what types there are and what data they contain
     */
    "notification": (data: {
        /** The notification id */
        id: string;
        /** The notification type */
        type: string;
        /** There are often more fields here */
        [key: string]: any;
    }) => void;
    /** Message to inform the client of an active game, or a change to an existing game */
    "active_game": (data: GameListEntry) => void;

    /** Updates the list of bots that are connected and ready to the server */
    "active-bots": (data: { [id: number]: User & { config: BotConfig } }) => void;

    /** An automatch request was canceled */
    "automatch/cancel": (data: {
        // The automatch id that was cancelled
        uuid: string;
    }) => void;

    /** An automatch request is active */
    "automatch/entry": (data: AutomatchPreferences) => void;

    /** An automatch request was started */
    "automatch/start": (data: {
        // The automatch id that was cancelled
        uuid: string;
        // The game id that was started
        game_id: number;
    }) => void;

    /** An automatch offer was added */
    "automatch/available/add": (data: {
        uuid: string;
        preferences: AutomatchPreferences;
        player: {
            id: number;
            username: string;
        };
        created: number;
    }) => void;

    /** An automatch offer was removed */
    "automatch/available/remove": (uuid: string) => void;

    /** User(s) joined a chat channel */
    "chat-join": (data: {
        /** The channel */
        channel: string;
        /** List of users that joined */
        users: User[];
    }) => void;

    /** Chat message was received */
    "chat-message": (data: {
        /** The channel */
        channel: string;
        /** User id of the sender */
        id: number;
        /** Username of the sender */
        username: string;
        /** UI class of the sender */
        ui_class: string;
        /** Ranking of the sender */
        ranking: number;
        /** True if the user is a professional */
        professional: boolean;
        /** Country the user is from */
        country?: string;
        /** Whether it's a system message or not */
        system?: true;
        /** The message received */
        message: {
            /** Message id. This is always set for non system messages. */
            i?: string;
            /** Message text */
            m: string;
            /** Timestamp of the message */
            t: number;
        };
        system_message_type?: "flood";
    }) => void;

    /** User left a chat channel */
    "chat-part": (data: {
        /** The channel */
        channel: string;
        /** User that left */
        user: User;
    }) => void;

    /** A chat message should be removed from the display */
    "chat-message-removed": (data: {
        /** The channel */
        channel: string;
        /** Message id. Note, despite the name, I don't think this is always a
         * uuid in uuid format, just treat it as a string. */
        uuid: string;
    }) => void;

    /** Channel topic was updated */
    "chat-topic": (data: {
        /** The channel */
        channel: string;
        /** The new topic */
        topic: string;
        /** Timestamp (ms) of the topic change */
        timestamp: number;

        /** User id of the user that changed the topic */
        id: number;
        /** Username of the user that changed the topic */
        username: string;
        /** Ranking of the user that changed the topic */
        ranking: number;
        /** If the user that changed the topic was a professional */
        professional: boolean;
        /** UI class of the user that changed the topic */
        ui_class: string;
        /** Country of the user that changed the topic */
        country?: string;
    }) => void;

    /** A user's profile was updated */
    "chat-update-user": (data: {
        /** The channel */
        channel: string;
        /** Player id entry that was update. This might change in the case of a
         * guest logging in, in this case this will switch from being a
         * negative (guest) id, to some positive id. It is not expected that a
         * non guest id should change using this system. */
        old_player_id: number;

        /** New user details */
        user: User;
    }) => void;

    /** Update number of live and correspondence games are currently being
     * played */
    "gamelist-count": (data: {
        /** Number of live games */
        live: number;
        /** Number of correspondence games */
        correspondence: number;
    }) => void;

    /** Update number of live and correspondence games are currently being
     * played in a particular channel */
    "gamelist-count-:channel": (data: {
        /** Number of live games */
        live: number;
        /** Number of correspondence games */
        correspondence: number;
    }) => void;
    [k: `gamelist-count-${string}`]: ServerToClient["gamelist-count-:channel"];

    /** Incident report update */
    "incident-report": (data: {
        id: number;
        created: string;
        updated: string;
        state: "pending" | "claimed" | "resolved";
        escalated: boolean;
        escalated_at: string;
        source: string;
        report_type: string;
        reporting_user?: User;
        reported_user?: User;
        reported_game?: number;
        reported_review?: number;
        reported_conversation?: string;
        url: string;
        moderator?: User;
        cleared_by_user?: boolean;
        was_helpful: boolean;
        reporter_note: string;
        reporter_note_translation: {
            source_language: string;
            source_text: string;
            target_language: string;
            target_text: string;
        };
        moderator_note: string;
        system_note: string;
        voters: Vote[];
    }) => void;

    /** A private message was received */
    "private-message": (data: {
        /** Who sent the message */
        from: User;

        /** Your user id */
        to: User;

        /** If true, the private message should be forced to be in focus, this
         * is when a moderator needs to talk with a player and ignoring the
         * moderator is not suitable thing to do. */
        superchat_enabled?: boolean;

        /** The message received */
        message: {
            /** Timestamp of the message */
            t: number;
            /** Message id. */
            i: string;
            /** Message text */
            m: string;
        };
    }) => void;

    /** Notify the client that a private message "super chat" has started. A
     * super chat is an undismissable chat sent by a moderator. It should take
     * all focus and not let the client do anything until the conversation is
     * resolved (the enable flag is set to false) */
    "private-superchat": (data: {
        /** The moderator id contacting the player */
        moderator_id: number;
        /** The moderator username contacting the player */
        moderator_username: string;
        /** Your id */
        player_id: number;
        /** Your username */
        player_username: string;
        /** Whether the superchat is enabled or not. When true, the client
         * should make an undismissable chat window, when false the window
         * can be dismissed. */
        enable: boolean;
    }) => void;

    /** Notification that the server has completed sending all remote storage
     *  data and the client should now be up to date. */
    "remote_storage/sync_complete": () => void;

    /** Updates a key value pair */
    "remote_storage/update": (data: {
        /** Key for the k/v pair  */
        key: string;
        /** Value of of the k/v pair */
        value: any;
        /** Replication mode */
        replication: RemoteStorageReplication;
        /** Timestamp of the update */
        modified: string;
    }) => void;

    /** Notifies the client whether the the client shares an IP with one of the
     * players of the game. This is used to disable the score estimator in
     * anonymous browsing windows for players of a game when the score
     * estimator is disabled for the game. */
    "score-estimator-enabled-state": (data: {
        /** The game ID */
        game_id: number;

        /** True if the client shares an IP with one of the players of the game */
        shared_ip_with_player: boolean;
    }) => void;

    "seekgraph/global": (
        messages: (SeekgraphDeleteMessage | SeekgraphStartedMessage | SeekgraphChallengeMessage)[],
    ) => void;

    /** Informs the client the player is scheduled to resign if not cleared */
    "game/:id/auto_resign": (data: {
        /** The game id */
        game_id: number;
        /** The player id */
        player_id: number;
        /** When the auto resign will happen */
        expiration: number;
    }) => void;
    [k: `game/${number}/auto_resign`]: ServerToClient["game/:id/auto_resign"];

    /** The auto resign for the given player has been cleared */
    "game/:id/clear_auto_resign": (data: {
        /** The game id */
        game_id: number;
        /** The player id */
        player_id: number;
    }) => void;
    [k: `game/${number}/clear_auto_resign`]: ServerToClient["game/:id/clear_auto_resign"];

    /**  A game chat message */
    "game/:id/chat": (data: GameChatMessage) => void;
    [k: `game/${number}/chat`]: ServerToClient["game/:id/chat"];

    /** Game chat lines should be removed */
    "game/:id/chat/remove": (data: {
        /** The game id */
        game_id: number;
        /** The chat ids */
        chat_ids: string[];
    }) => void;
    [k: `game/${number}/chat/remove`]: ServerToClient["game/:id/chat/remove"];

    /** Game clock update */
    "game/:id/clock": (data: GameClock) => void;
    [k: `game/${number}/clock`]: ServerToClient["game/:id/clock"];

    /** Update the conditional moves currently active */
    "game/:id/conditional_moves": (data: {
        /** The game id */
        game_id: number;
        /** The move number from which the conditional moves are rooted in */
        move_number: number;
        /** The conditional moves. The top level should be an array that looks
         *  like `[null, { ... }]` where the second element contains the responses
         *  to the opponent's move. */
        conditional_moves: ConditionalMoveResponse;
    }) => void;
    [k: `game/${number}/conditional_moves`]: ServerToClient["game/:id/conditional_moves"];

    /** Error that should be displayed to the user */
    "game/:id/error": (data: string) => void;
    [k: `game/${number}/error`]: ServerToClient["game/:id/error"];

    /** Update the entire game state */
    "game/:id/gamedata": (data: GobanEngineConfig) => void;
    [k: `game/${number}/gamedata`]: ServerToClient["game/:id/gamedata"];

    /** Update latency information for a player */
    "game/:id/latency": (data: {
        /** The game id */
        game_id: number;
        /** The player id */
        player_id: number;
        /** The latency in milliseconds */
        latency: number;
    }) => void;
    [k: `game/${number}/latency`]: ServerToClient["game/:id/latency"];

    /** A move was made on a game */
    [k: `game/${number}/move`]: (data: {
        /** The game id */
        game_id: number;
        /** Move number the move was made from*/
        move_number: number;
        /** Move string encoded move */
        move: AdHocPackedMove;
    }) => void;
    /** The phase has changed for the game */
    "game/:id/phase": (data: "play" | "stone removal" | "finished") => void;
    [k: `game/${number}/phase`]: ServerToClient["game/:id/phase"];

    /** Player information has been updated. This is a rengo game thing, every move we rotate out players if applicable. */
    [k: `game/${number}/player_update`]: (data: {
        players: {
            /** Active black player id */
            black: number;
            /** Active white player id */
            white: number;
        };
        rengo_teams: {
            /** Active black player ids (in the order of which they'll play) */
            black: number[];
            /** Active white player ids (in the order of which they'll play) */
            white: number[];
        };
    }) => void;

    /** Update the state of the stone removal phase */
    "game/:id/removed_stones": (
        data:
            | {
                  /** Whether the stones are being flagged or unflagged for
                   * removal */
                  removed: boolean;
                  /** The stones that have changed state. Note, these can be
                   * empty intersections as well, in which case we are flagging
                   * them as dame */
                  stones: string;
                  /** Current state of all removed stones */
                  all_removed: string;
              }
            | { strict_seki_mode: boolean },
    ) => void;
    [k: `game/${number}/removed_stones`]: ServerToClient["game/:id/removed_stones"];

    /** The stone removal phase has been completed, this is the final state and
     * indicates a phase change to the given phase (should always be
     * "finished") */
    "game/:id/removed_stones_accepted": (data: {
        player_id: number;
        stones: string;
        /** True if Japanese strict seki mode was true. This will probably
         * always be false and may be removed in the future. */
        strict_seki_mode: boolean;
        /** Current players and their accepted stone statuses */
        players: {
            /** Active black player id */
            black: User | { accepted_stones: string; accepted_strict_seki_mode: boolean };
            white: User | { accepted_stones: string; accepted_strict_seki_mode: boolean };
        };
        /** Game phase (finished */
        phase: "finished";
        /** Score */
        score: Score;
        /** Player id of the winner */
        winner: number;
        /** Outcome of the game */
        outcome: string;
        /** Timestamp in ms */
        end_time: number;
    }) => void;
    [
        k: `game/${number}/removed_stones_accepted`
    ]: ServerToClient["game/:id/removed_stones_accepted"];

    /** The chat log should be reset. */
    "game/:id/reset-chats": () => void;
    [k: `game/${number}/reset-chats`]: ServerToClient["game/:id/reset-chats"];

    /** Undo move has been accepted, the parameter is the new move number */
    "game/:id/undo_accepted": (data: number) => void;
    [k: `game/${number}/undo_accepted`]: ServerToClient["game/:id/undo_accepted"];

    /** Undo request has been canceled, the parameter is the move number of the original request */
    "game/:id/undo_canceled": (data: number) => void;
    [k: `game/${number}/undo_canceled`]: ServerToClient["game/:id/undo_canceled"];

    /** Undo request has been requested, the parameter is the move number that we want to go back to */
    "game/:id/undo_requested": (data: number) => void;
    [k: `game/${number}/undo_requested`]: ServerToClient["game/:id/undo_requested"];

    /** A score estimation result has been broadcast, this is used for avoiding game stalling */
    "game/:id/stalling_score_estimate": (data?: StallingScoreEstimate) => void;
    [
        k: `game/${number}/stalling_score_estimate`
    ]: ServerToClient["game/:id/stalling_score_estimate"];

    /** Replay of the entire full state of the review */
    "review/:id/full_state": (data: ReviewMessage[]) => void;
    [k: `review/${number}/full_state`]: ServerToClient["review/:id/full_state"];

    /** An incremental modification to the review stream */
    "review/:id/r": (data: ReviewMessage) => void;
    [k: `review/${number}/r`]: ServerToClient["review/:id/r"];

    // I don't think this is used anymore
    //[k: `game/${number}/rejected`]: (data: any) => void;
}

export interface GameChatLine {
    chat_id: string;
    body: string | AnalysisComment | ReviewComment;
    date: number;
    move_number: number;
    from?: number;
    moves?: string;
    channel: string;
    player_id: number;
    username?: string;
}
interface AnalysisComment {
    type: "analysis";
    name?: string;
    branch_move?: number; // deprecated
    from?: number;
    moves?: string;
    marks?: { [mark: string]: string };
    pen_marks?: unknown[];
}
interface ReviewComment {
    type: "review";
    review_id: number;
}

type NoneClock = undefined;
type SimpleClock = number;
interface AbsoluteClock {
    thinking_time: number;
}
interface FischerClock {
    thinking_time: number;
    skip_bonus: boolean;
}
interface ByoYomiClock {
    thinking_time: number;
    periods: number;
    period_time: number;
    period_time_left?: number;
}
interface CanadianClock {
    thinking_time: number;
    moves_left: number;
    block_time: number;
}

type ClockTime =
    | NoneClock
    | SimpleClock
    | AbsoluteClock
    | FischerClock
    | ByoYomiClock
    | CanadianClock;

export interface GameClock {
    game_id: number;
    title: string;
    expiration: number;
    stone_removal_mode?: boolean;
    stone_removal_expiration?: number;
    black_player_id: number;
    white_player_id: number;
    current_player: number;
    expiration_delta?: number;
    pause_delta?: number;
    last_move: number;
    now?: number;
    paused_since?: number;
    start_mode?: boolean;
    black_time?: ClockTime;
    white_time?: ClockTime;
    pause?: {
        paused?: boolean;
        paused_since?: number;
        pause_control?: {
            [key: string]: boolean;
        };
    };
}

export interface SeekgraphDeleteMessage {
    /** The ID of the challenge */
    challenge_id: number;
    /** The entry should be deleted if this field exists and is true */
    delete: true;
}
export interface SeekgraphStartedMessage {
    /** The ID of the challenge */
    challenge_id: number;
    /** If exists and is true, the game has been started and the entry should be removed from the seek graph */
    game_started?: true;
    /** The game id */
    game_id: number;
    /** Player ID of the creator */
    creator: number;
    /** Black player */
    black: User;
    /** White player */
    white: User;
    /** Time control system */
    time_control: string;
    /** Time control parameters */
    time_control_parameters: JGOFTimeControl;
    /** Rengo game if true */
    rengo?: true;
    /** Player ids of the players on the Black team */
    rengo_black_team?: number[];
    /** Player ids of the players on the White team */
    rengo_white_team?: number[];
    /** Wether it's a Casual mode rengo game */
    rengo_casual_mode?: boolean;
    /** Whether the rengo game with automatically start */
    rengo_auto_start?: boolean;
}
export interface SeekgraphChallengeMessage {
    /** The ID of the challenge */
    challenge_id: number;
    /** User id of the player who is looking for a game */
    user_id: number;
    /** Username of the player looking for the game */
    username: string;
    /** Their ranking **/
    ranking: number;
    /** If they are a professional player */
    professional: boolean;
    /** Minimum rank allowed to accept the game */
    min_rank: number;
    /** Maximum rank allowed to accept the game */
    max_rank: number;
    /** The game ID */
    game_id: number;
    /** Game name */
    name: string;
    /** If the game is ranked */
    ranked: boolean;
    /** The game handicap */
    handicap: number | null;
    /** Komi */
    komi: number | null;
    /** Rules being used */
    rules: string;
    /** Board width */
    width: number;
    /** Board height */
    height: number;
    /** Color the accepting player will be */
    challenger_color: "black" | "white" | "automatic";
    /** If analysis is disabled */
    disable_analysis: boolean;
    /** Time control system type */
    time_control: string;
    /** Time control parameters */
    time_control_parameters: JGOFTimeControl;
    /** Average time per move */
    time_per_move: number;
    /** If it's a rengo game */
    rengo: boolean;
    /** Player ids of people that have been nominated to play */
    rengo_nominees: number[];
    /** Player ids of the players on the Black team */
    rengo_black_team: number[];
    /** Player ids of the players on the White team */
    rengo_white_team: number[];
    /** All player ids involved in the game */
    rengo_participants: number[];
    /** If the game is a casual rengo game */
    rengo_casual_mode: boolean;
    /** If the rengo game will automatically start */
    rengo_auto_start: boolean;
    /** If the game is only joinable by invitation */
    invite_only: boolean;
    /** A UUID for the invitation */
    uuid: string;
}

export interface StallingScoreEstimate {
    move_number: number;
    predicted_winner: "black" | "white";
    game_id: number;
    removed: string;
    score: number;
    win_rate: number;
    ownership: any[];
}

export interface GameChatMessage {
    channel: "main" | "spectator" | "malkovich" | "shadowban" | "hidden" | "personal";
    line: GameChatLine;
}
