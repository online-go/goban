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

import { EventEmitter } from "eventemitter3";

// EventEmitter3 is has typing now, but the generic parameter is slightly
// different (more flexible, but also more verbose) than what OGS had:
//
//        OGS                       EventEmitter
// interface Events {        interface Events
//     a: number,                a: (data: number) => void,
//     b: string,                b: (data: string) => void,
//     c: never,                 c: () => void,
//     d: undefined,             d: () => void,
// }
//
//     ...
//
// emitter.on("a", (data: number) => console.log("a emitted", data * 2));
// emitter.on("b", (data: string) => console.log("b emitted", data.length));
// emitter.on("c", () => console.log("c emitted"))
// emitter.on("d", () => console.log("d emitted"))

// This shim allows us to use OGS's events type definitions while using
// EventEmitter3's types for everything else.

export type LegacyEventsShim<T extends object> = {
    [K in keyof T]: T[K] extends undefined ? () => void : (data: T[K]) => void;
};

export class TypedEventEmitter<T extends object> extends EventEmitter<LegacyEventsShim<T>> {}
