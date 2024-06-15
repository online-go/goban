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

import { callbacks } from "./callbacks";

let __deviceCanvasScalingRatio = 0;
let canvases_allocated = 0;
let total_pixels_allocated = 0;

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
    let canvas: HTMLCanvasElement | null = null;
    try {
        canvas = document.createElement("canvas");
        ++canvases_allocated;
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

    if (!validateCanvas(canvas, undefined, width, height)) {
        return null as unknown as HTMLCanvasElement;
    }
    total_pixels_allocated += ((canvas && canvas.width) || 0) * ((canvas && canvas.height) || 0);
    return canvas as HTMLCanvasElement;
}

/**
 * Validates that a canvas was created successfully and a 2d context can be
 * allocated for it. If not, we call the GobanCore.canvasAllocationErrorHandler
 * hook.
 */

export function validateCanvas(
    canvas: HTMLCanvasElement | null,
    err?: Error,
    width?: number | string,
    height?: number | string,
): boolean {
    let ctx: CanvasRenderingContext2D | null = null;
    let err_string = err ? "Initial error" : null;
    if (!canvas) {
        err_string = err_string || "Canvas allocation failed";
        err = err || new Error(err_string);
    } else {
        try {
            ctx = canvas.getContext("2d", { willReadFrequently: true });
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
        if (callbacks.canvasAllocationErrorHandler) {
            callbacks.canvasAllocationErrorHandler(err_string, err, {
                total_pixels_allocated,
                total_allocations_made: canvases_allocated,
                width,
                height,
            });
        }
        return false;
    }
    return true;
}

/* Creates a non-blurry canvas object. Most systems don't have an issue with
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

    const context = canvas.getContext("2d", { willReadFrequently: true });
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
        const context = canvas.getContext("2d", { willReadFrequently: true });

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

/** Returns `{x,y}` of the event relative to the event target */
export function getRelativeEventPosition(event: TouchEvent | MouseEvent, target?: HTMLElement) {
    let x = -1000;
    let y = -1000;

    const rect = (target || (event.target as HTMLElement)).getBoundingClientRect();

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
