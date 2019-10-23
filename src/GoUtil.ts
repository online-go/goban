/*
 * Copyright 2012-2019 Online-Go.com
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

import {_, pgettext, interpolate} from "./translate";

let __deviceCanvasScalingRatio:number = null;

/* Creates a non-blury canvas object. Most systems don't have an issue with
 * this, but HDPI android devices deal with scaling canvases and images in a
 * retarded fashion and require this hack to get around it. */
export function createDeviceScaledCanvas(width:number, height:number):HTMLCanvasElement {
    let canvas = document.createElement("canvas");
    canvas.setAttribute("width", `${width}px`);
    canvas.setAttribute("height", `${height}px`);
    return canvas;
}

export function resizeDeviceScaledCanvas(canvas:HTMLCanvasElement, width:number, height:number):HTMLCanvasElement {
    let context = canvas.getContext("2d");

    let devicePixelRatio = window.devicePixelRatio || 1;
    let backingStoreRatio = (context as any).webkitBackingStorePixelRatio ||
                            (context as any).mozBackingStorePixelRatio ||
                            (context as any).msBackingStorePixelRatio ||
                            (context as any).oBackingStorePixelRatio ||
                            (context as any).backingStorePixelRatio || 1;

    let ratio = devicePixelRatio / backingStoreRatio;

    if (devicePixelRatio !== backingStoreRatio) {
        console.log("Scaling necessary: Device pixel ratio: " + devicePixelRatio + "  background store ratio: " + backingStoreRatio);

        canvas.width = width * ratio;
        canvas.height = height * ratio;
        //canvas.attr("width", width * ratio);
        //canvas.attr("height", height * ratio);

        canvas.style.width = width + "px";
        canvas.style.height = height + "px";

        // now scale the context to counter
        // the fact that we've manually scaled
        // our canvas element

        try {
            context.scale(ratio, ratio);
        } catch (e) {
            __deviceCanvasScalingRatio = 1.0;
            canvas.width = width;
            canvas.height = height;
            console.warn(e);
        }
    } else {
        canvas.width = width;
        canvas.height = height;
    }

    return canvas;
}

export function deviceCanvasScalingRatio() {
    if (!__deviceCanvasScalingRatio) {
        let canvas = document.createElement('canvas');
        canvas.width = 257;
        canvas.height = 257;
        let context = (canvas as HTMLCanvasElement).getContext("2d");

        let devicePixelRatio = window.devicePixelRatio || 1;
        let backingStoreRatio = (context as any).webkitBackingStorePixelRatio ||
                                (context as any).mozBackingStorePixelRatio ||
                                (context as any).msBackingStorePixelRatio ||
                                (context as any).oBackingStorePixelRatio ||
                                (context as any).backingStorePixelRatio || 1;
        let ratio = devicePixelRatio / backingStoreRatio;
        __deviceCanvasScalingRatio = ratio;
    }

    return __deviceCanvasScalingRatio;
}

export function getRelativeEventPosition(event:TouchEvent | MouseEvent) {
    let x = -1000;
    let y = -1000;
    let offset = elementOffset(event.target as HTMLElement);

    if (typeof(TouchEvent) !== "undefined" && event instanceof TouchEvent) {
        if (event.touches && event.touches.length) {
            x = event.touches[0].pageX - offset.left;
            y = event.touches[0].pageY - offset.top;
        } else if (event.touches && event.touches.length) {
            x = event.touches[0].pageX - offset.left;
            y = event.touches[0].pageY - offset.top;
        } else {
            console.log("Missing event tap location:", event);
        }
    } else if (event instanceof MouseEvent) {
        if (event.pageX) {
            x = event.pageX - offset.left;
            y = event.pageY - offset.top;
        } else {
            console.log("Missing event click location:", event);
        }
    }

    return {"x": x, "y": y};
}
export function getRandomInt(min:number, max:number) {
  return Math.floor(Math.random() * (max - min)) + min;
}
export function shortDurationString(seconds:number) {
    let weeks = Math.floor(seconds / (86400 * 7)); seconds -= weeks * 86400 * 7;
    let days = Math.floor(seconds / 86400); seconds -= days * 86400;
    let hours = Math.floor(seconds / 3600); seconds -= hours * 3600;
    let minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
    return "" +
        (weeks ? " " + interpolate(pgettext("Short time (weeks)", "%swk"), [weeks]) : "") +
        (days ? " " + interpolate(pgettext("Short time (days)", "%sd"), [days]) : "") +
        (hours ? " " + interpolate(pgettext("Short time (hours)", "%sh"), [hours]) : "") +
        (minutes ? " " + interpolate(pgettext("Short time (minutes)", "%sm"), [minutes]) : "") +
        (seconds ? " " + interpolate(pgettext("Short time (seconds)", "%ss"), [seconds]) : "");
}
export function dup(obj: any): any {
    let ret:any;
    if (typeof(obj) === "object") {
        if (Array.isArray(obj)) {
            ret = [];
            for (let i = 0; i < obj.length; ++i) {
                ret.push(dup(obj[i]));
            }
        } else {
            ret = {};
            for (let i in obj) {
                ret[i] = dup(obj[i]);
            }
        }
    } else {
        return obj;
    }
    return ret;
}
export function deepEqual(a: any, b: any) {
    if (typeof(a) !== typeof(b)) { return false; }

    if (typeof(a) === "object") {
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
            for (let i in a) {
                if (!(i in b)) {
                    return false;
                }
                if (!deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            for (let i in b) {
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

export function elementOffset(element:HTMLElement) {
    if (!element) {
        return null;
    }

    let rect = element.getBoundingClientRect();

    if (!rect) {
        return null;
    }

    return {
        top: rect.top + document.body.scrollTop,
        left: rect.left + document.body.scrollLeft
    };
}
