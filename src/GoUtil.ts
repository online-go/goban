/*
 * Copyright 2012-2020 Online-Go.com
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

import { _, interpolate } from "./translate";
import { JGOFTimeControl } from "./JGOF";
import { GobanCore } from "./GobanCore";

let __deviceCanvasScalingRatio = 0;
let canvases_allocated = 0;

/** On iOS devices they limit the number of canvases we create to a a very low
 * number and so sometimes we'll exhaust that limit. When this happens, we this
 * method will detect that and call our GobanCore.canvasAllocationErrorHandler
 * hook. On OGS we'll reload the page in that hook after logging the error.
 *
 * If string dimensions are used we'll use setAttribute, if numbers are used
 * we'll set the canvas .width and .height parameter. This is for device
 * scaling considerations when the given dimensions are scaled on HDPI devices.
 */
export function allocateCanvasOrError(
    width?: number | string,
    height?: number | string,
): HTMLCanvasElement {
    let canvas = null;
    try {
        canvas = document.createElement("canvas");
        ++canvases_allocated;
        //console.debug("Allocated canvas", canvases_allocated, "width", width, "height", height);
    } catch (e) {
        validateCanvas(null, e);
    }

    if (canvas && width && typeof width === "string") {
        canvas.setAttribute("width", width);
    } else if (canvas && width && typeof width === "number") {
        canvas.width = width;
    }

    if (canvas && height && typeof height === "string") {
        canvas.setAttribute("height", height);
    } else if (canvas && height && typeof height === "number") {
        canvas.height = height;
    }

    if (!validateCanvas(canvas)) {
        return null as unknown as HTMLCanvasElement;
    }
    return canvas as HTMLCanvasElement;
}

/**
 * Validates that a canvas was created successfully and a 2d context can be
 * allocated for it. If not, we call the GobanCore.canvasAllocationErrorHandler
 * hook.
 */

export function validateCanvas(canvas: HTMLCanvasElement | null, err?: Error): boolean {
    let ctx = null;
    let err_string = err ? "Initial error" : null;
    if (!canvas) {
        err_string = err_string || "Canvas allocation failed";
        err = err || new Error(err_string);
    } else {
        try {
            ctx = canvas.getContext("2d");
        } catch (e) {
            err_string = err_string || "Canvas context allocation failed";
            err = err || e;
        }
    }

    if (!ctx) {
        err_string = err_string || "getContext('2d') failed";
    }

    if (err_string && !err) {
        err = new Error(err_string);
    }

    if (err) {
        if (GobanCore.hooks.canvasAllocationErrorHandler) {
            GobanCore.hooks.canvasAllocationErrorHandler(err_string, canvases_allocated, err);
        }
        return false;
    }
    return true;
}

/* Creates a non-blury canvas object. Most systems don't have an issue with
 * this, but HDPI android devices deal with scaling canvases and images in a
 * retarded fashion and require this hack to get around it. */
export function createDeviceScaledCanvas(width: number, height: number): HTMLCanvasElement {
    return allocateCanvasOrError(`${width}px`, `${height}px`);
}

export function resizeDeviceScaledCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
): HTMLCanvasElement {
    validateCanvas(canvas);

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error(`Failed to get context for canvas`);
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingStoreRatio =
        (context as any).webkitBackingStorePixelRatio ||
        (context as any).mozBackingStorePixelRatio ||
        (context as any).msBackingStorePixelRatio ||
        (context as any).oBackingStorePixelRatio ||
        (context as any).backingStorePixelRatio ||
        1;

    const ratio = devicePixelRatio / backingStoreRatio;

    /*
    if (devicePixelRatio !== backingStoreRatio) {
        console.log("Scaling necessary: Device pixel ratio: " + devicePixelRatio + "  background store ratio: " + backingStoreRatio);
    }
    */

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    validateCanvas(canvas);

    try {
        // now scale the context to counter the fact that we've manually
        // scaled our canvas element
        context.scale(ratio, ratio);
    } catch (e) {
        __deviceCanvasScalingRatio = 1.0;
        canvas.width = width;
        canvas.height = height;
        console.warn(e);
    }

    validateCanvas(canvas);

    return canvas;
}

export function deviceCanvasScalingRatio() {
    if (!__deviceCanvasScalingRatio) {
        const canvas = allocateCanvasOrError(257, 257);
        const context = canvas.getContext("2d");

        const devicePixelRatio = window.devicePixelRatio || 1;
        const backingStoreRatio =
            (context as any).webkitBackingStorePixelRatio ||
            (context as any).mozBackingStorePixelRatio ||
            (context as any).msBackingStorePixelRatio ||
            (context as any).oBackingStorePixelRatio ||
            (context as any).backingStorePixelRatio ||
            1;
        const ratio = devicePixelRatio / backingStoreRatio;
        __deviceCanvasScalingRatio = ratio;
    }

    return __deviceCanvasScalingRatio;
}

let last_touch_x = -1000;
let last_touch_y = -1000;

/** Returns {x,y} of the event relative to the event target */
export function getRelativeEventPosition(event: TouchEvent | MouseEvent) {
    let x = -1000;
    let y = -1000;

    const rect = (event.target as HTMLElement).getBoundingClientRect();

    if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
        if (event.touches && event.touches.length) {
            x = event.touches[0].clientX - rect.left;
            y = event.touches[0].clientY - rect.top;
        } else {
            if (event.type !== "touchend") {
                console.log("Missing event tap location:", event);
            } else {
                x = last_touch_x;
                y = last_touch_y;
            }
        }
        last_touch_x = x;
        last_touch_y = y;
    } else if (event instanceof MouseEvent) {
        if (event.clientX) {
            x = event.clientX - rect.left;
            y = event.clientY - rect.top;
        } else {
            console.log("Missing event click location:", event);
        }
    }

    return { x: x, y: y };
}
export function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min)) + min;
}
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
export function dup(obj: any): any {
    let ret: any;
    if (typeof obj === "object") {
        if (Array.isArray(obj)) {
            ret = [];
            for (let i = 0; i < obj.length; ++i) {
                ret.push(dup(obj[i]));
            }
        } else {
            ret = {};
            for (const i in obj) {
                ret[i] = dup(obj[i]);
            }
        }
    } else {
        return obj;
    }
    return ret;
}
export function deepEqual(a: any, b: any) {
    if (typeof a !== typeof b) {
        return false;
    }

    if (typeof a === "object") {
        if (Array.isArray(a)) {
            if (Array.isArray(b)) {
                if (a.length !== b.length) {
                    return false;
                }
                for (let i = 0; i < a.length; ++i) {
                    if (!deepEqual(a[i], b[i])) {
                        return false;
                    }
                }
            } else {
                return false;
            }
        } else {
            for (const i in a) {
                if (!(i in b)) {
                    return false;
                }
                if (!deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            for (const i in b) {
                if (!(i in a)) {
                    return false;
                }
            }
        }
        return true;
    } else {
        return a === b;
    }
}

export function elementOffset(element: HTMLElement): { top: number; left: number } {
    if (!element) {
        throw new Error(`No element passed to elementOffset`);
    }

    const rect = element.getBoundingClientRect();

    if (!rect) {
        throw new Error(`Element.getBoundingClientRect() returned null`);
    }

    return {
        top: rect.top + document.body.scrollTop,
        left: rect.left + document.body.scrollLeft,
    };
}

function averageMovesPerGame(w: number, h: number): number {
    // Rough estimate based on discussion at https://forums.online-go.com/t/average-game-length-on-different-board-sizes/35042/11
    return Math.round(0.7 * w * h);
}

export function computeAverageMoveTime(
    time_control: JGOFTimeControl,
    w?: number,
    h?: number,
): number {
    if (typeof time_control !== "object") {
        console.warn(
            `computAverageMoveTime passed ${time_control} instead of a time_control object`,
        );
        return time_control;
    }
    const moves = w != null && h != null ? averageMovesPerGame(w, h) / 2 : 90;

    try {
        let t: number;
        switch (time_control.system) {
            case "fischer":
                t = time_control.initial_time / moves + time_control.time_increment;
                break;
            case "byoyomi":
                t = time_control.main_time / moves + time_control.period_time;
                break;
            case "simple":
                t = time_control.per_move;
                break;
            case "canadian":
                t =
                    time_control.main_time / moves +
                    time_control.period_time / time_control.stones_per_period;
                break;
            case "absolute":
                t = time_control.total_time / moves;
                break;
            case "none":
                t = 0;
                break;
        }
        return Math.round(t);
    } catch (err) {
        console.error("Error computing avergate move time for time control: ", time_control);
        console.error(err);
        return 60;
    }
}
