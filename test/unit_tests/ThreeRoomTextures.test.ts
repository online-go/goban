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

import { tatamiTexture } from "../../src/Goban/Three/roomTextures";

test("tatami textures draw once and keep their own repeat settings", () => {
    const canvasPrototype: {
        getContext(contextId: "2d"): CanvasRenderingContext2D | null;
    } = HTMLCanvasElement.prototype;
    const getContext = jest.spyOn(canvasPrototype, "getContext").mockImplementation(function (
        this: HTMLCanvasElement,
    ) {
        return {
            canvas: this,
            createImageData: (width: number, height: number) => ({
                width,
                height,
                data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData: jest.fn(),
            save: jest.fn(),
            translate: jest.fn(),
            rotate: jest.fn(),
            drawImage: jest.fn(),
            fillRect: jest.fn(),
            restore: jest.fn(),
        } as unknown as CanvasRenderingContext2D;
    });

    try {
        const first = tatamiTexture(2, 3);
        const second = tatamiTexture(2, 3);
        const differentRepeat = tatamiTexture(4, 5);

        expect(first).not.toBe(second);
        expect(first).not.toBe(differentRepeat);
        expect(first.image).toBe(second.image);
        expect(first.image).toBe(differentRepeat.image);
        expect(first.repeat.toArray()).toEqual([2, 3]);
        expect(differentRepeat.repeat.toArray()).toEqual([4, 5]);
        expect(getContext).toHaveBeenCalledTimes(2);
    } finally {
        getContext.mockRestore();
    }
});
