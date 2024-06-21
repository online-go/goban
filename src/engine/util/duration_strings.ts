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

import { interpolate, _ } from "../translate";

/** Takes a number of seconds and returns a string like "1d 3h 2m 52s" */
export function shortDurationString(seconds: number) {
    const weeks = Math.floor(seconds / (86400 * 7));
    seconds -= weeks * 86400 * 7;
    const days = Math.floor(seconds / 86400);
    seconds -= days * 86400;
    const hours = Math.floor(seconds / 3600);
    seconds -= hours * 3600;
    const minutes = Math.floor(seconds / 60);
    seconds -= minutes * 60;
    return (
        "" +
        (weeks ? " " + interpolate(_("%swk"), [weeks]) : "") +
        (days ? " " + interpolate(_("%sd"), [days]) : "") +
        (hours ? " " + interpolate(_("%sh"), [hours]) : "") +
        (minutes ? " " + interpolate(_("%sm"), [minutes]) : "") +
        (seconds ? " " + interpolate(_("%ss"), [seconds]) : "")
    );
}
