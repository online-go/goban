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

const mockLoadBackend = jest.fn(() => ({ attachThree: jest.fn() }));
jest.mock("../../src/Goban/Three/backend", () => mockLoadBackend());
jest.mock("../../src/Goban/SVGRenderer", () => ({ SVGRenderer: jest.fn() }));

beforeEach(() => {
    mockLoadBackend.mockClear();
});

test("preloading twice imports the backend once", async () => {
    await jest.isolateModulesAsync(async () => {
        const { preloadThreeGoban } = await import("../../src/Goban/ThreeConfig");
        const first = preloadThreeGoban();
        const second = preloadThreeGoban();

        await expect(first).resolves.toBeUndefined();
        await expect(second).resolves.toBeUndefined();
        expect(mockLoadBackend).toHaveBeenCalledTimes(1);
    });
});

test("a failed preload rejects and the next preload tries again", async () => {
    const error = new Error("3D backend unavailable");
    mockLoadBackend.mockImplementationOnce(() => {
        throw error;
    });

    await jest.isolateModulesAsync(async () => {
        const { preloadThreeGoban } = await import("../../src/Goban/ThreeConfig");

        await expect(preloadThreeGoban()).rejects.toBe(error);
        await expect(preloadThreeGoban()).resolves.toBeUndefined();
        expect(mockLoadBackend).toHaveBeenCalledTimes(2);
    });
});
