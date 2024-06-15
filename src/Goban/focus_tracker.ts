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
 * This provides window focus tracking functionality to aid
 * in anti-cheat measures.
 */

class FocusTracker {
    hasFocus: boolean = true;
    lastFocus: number = Date.now();
    outOfFocusDurations: Array<number> = [];

    constructor() {
        try {
            window.addEventListener("blur", this.onBlur);
            window.addEventListener("focus", this.onFocus);
        } catch (e) {
            console.error(e);
        }
    }

    reset(): void {
        this.lastFocus = Date.now();
        this.outOfFocusDurations = [];
    }

    getMaxBlurDurationSinceLastReset(): number {
        if (!this.hasFocus) {
            this.outOfFocusDurations.push(Date.now() - this.lastFocus);
        }

        if (this.outOfFocusDurations.length === 0) {
            return 0;
        }

        const ret = Math.max.apply(Math.max, this.outOfFocusDurations);

        if (!this.hasFocus) {
            this.outOfFocusDurations.pop();
        }

        return ret;
    }

    onFocus = () => {
        this.hasFocus = true;
        this.outOfFocusDurations.push(Date.now() - this.lastFocus);
        this.lastFocus = Date.now();
    };

    onBlur = () => {
        this.hasFocus = false;
        this.lastFocus = Date.now();
    };
}

export const focus_tracker = new FocusTracker();
