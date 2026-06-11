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
 * Transport seam for the GobanNativeBridge renderer backend.
 *
 * The goban library never talks to a platform bridge (Capacitor or
 * otherwise) directly: the embedding application injects an object
 * implementing `GobanNativeBridgeTransport` through the renderer config
 * (`NativeBridgeGobanConfig.native_transport`). The shape of this interface
 * mirrors the GobanNative plugin contract v1 (the online-go.com repo's
 * doc/mobile/GOBAN-NATIVE-CONTRACT.md): one method per plugin method, plus
 * a subscription for the single gameplay event the native side may emit
 * (`intentPlace`).
 *
 * Geometry note: `rect` is in CSS pixels in *content* coordinates, i.e. the
 * element's bounding client rect plus the window scroll offsets. The native
 * side anchors its view at those coordinates inside the web view's scroll
 * view, so the view stays pixel-locked through scrolling.
 */

/** Flat board cell value: 0 empty, 1 black, 2 white
 *  (JGOFNumericPlayerColor). */
export type NativeBridgeStone = number;

/** CSS-pixel rectangle in content coordinates (element rect + scroll). */
export interface NativeBridgeRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The five colors the native draw layer needs. CSS color strings;
 *  six-digit hex preferred. */
export interface NativeBridgeTheme {
    /** Board surface fill. */
    boardColor: string;
    /** Grid line / star point color. */
    lineColor: string;
    /** Black stones are shaded procedurally from this color. */
    blackStoneColor: string;
    /** White stones are shaded procedurally from this color. */
    whiteStoneColor: string;
    /** Surround color painted behind the board edges. */
    backgroundColor: string;
}

export interface NativeBridgeAttachOptions {
    id: string;
    rect: NativeBridgeRect;
    /** Board size, e.g. 19. v1 boards are square. */
    size: number;
    /** Flat row-major stones, length size*size, values 0/1/2. */
    board: NativeBridgeStone[];
    colorToMove: 1 | 2;
    lastMove?: { x: number; y: number };
    /** Gestures + ghost stone + loupe + intentPlace events. */
    interactive: boolean;
    theme: NativeBridgeTheme;
    /** Native MAY no-op this in v1. */
    showCoordinates?: boolean;
}

export interface NativeBridgeUpdateOptions {
    id: string;
    board: NativeBridgeStone[];
    colorToMove?: 1 | 2;
    lastMove?: { x: number; y: number };
}

/** Finger released on an intersection of an interactive board. Board
 *  coordinates. This is an *intent*: all legality/turn logic stays in the
 *  TS engine, which treats it exactly like a canvas tap. */
export interface NativeBridgeIntentPlaceEvent {
    id: string;
    x: number;
    y: number;
}

/**
 * The injected transport the GobanNativeBridge renderer drives. All
 * methods return promises and may reject; a rejected `attach` makes the
 * renderer fall back to its web canvas permanently for that instance.
 */
export interface GobanNativeBridgeTransport {
    /** Create and insert the native view. */
    attach(opts: NativeBridgeAttachOptions): Promise<void>;
    /** Re-render state. The native side diffs stones itself. */
    update(opts: NativeBridgeUpdateOptions): Promise<void>;
    /** Reposition/resize the native view. */
    move(opts: { id: string; rect: NativeBridgeRect }): Promise<void>;
    /** Change theme colors without re-attaching. */
    setTheme(opts: { id: string; theme: NativeBridgeTheme }): Promise<void>;
    /** Snapshot the native view as a PNG data-URL, then hide it (so DOM
     *  overlays can stack above the board). */
    suspend(opts: { id: string }): Promise<{ snapshot: string }>;
    /** Show the native view again after a suspend. */
    resume(opts: { id: string }): Promise<void>;
    /** Remove the view and all resources. Safe to call on unknown ids. */
    detach(opts: { id: string }): Promise<void>;
    /** Subscribe to intentPlace events. Returns an unsubscribe function. */
    onIntentPlace(cb: (event: NativeBridgeIntentPlaceEvent) => void): () => void;
}
