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
 * Like setInterval, but debounces catchups (multiple invocation in rapid
 * succession less than our desired interval) that happen in some browsers when
 * tabs wake up from sleep. Cleared with the standard clearInterval.
 * */
export function niceInterval(
    callback: () => void,
    interval: number,
): ReturnType<typeof setInterval> {
    let last = performance.now();
    return setInterval(() => {
        const now = performance.now();
        const diff = now - last;
        if (diff >= interval * 0.9) {
            last = now;
            callback();
        }
    }, interval);
}
