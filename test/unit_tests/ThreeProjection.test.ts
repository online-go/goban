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
import assert from "node:assert/strict";
import {
    angles,
    BoardProjection,
    boardDimensions,
    crownHeight,
} from "../../src/Goban/Three/projection";

const crops = [
    { left: 0, top: 0, right: 18, bottom: 18 },
    { left: 0, top: 0, right: 12, bottom: 12 },
    { left: 0, top: 0, right: 8, bottom: 8 },
    { left: 3, top: 2, right: 8, bottom: 6 },
];
const sizes = [
    { x: 782, y: 710 },
    { x: 352, y: 480 },
    { x: 700, y: 310 },
];

for (const angle of angles) {
    test(`surface and crown centers map to the same intersection at ${angle}°`, () => {
        for (const bounds of crops) {
            const projection = new BoardProjection(bounds);
            for (const size of sizes) {
                projection.fit(size.x, size.y, angle);
                for (let y = bounds.top; y <= bounds.bottom; y++) {
                    for (let x = bounds.left; x <= bounds.right; x++) {
                        const board = { x, y };
                        const center = projection.project(board);
                        const crown = projection.project(board, crownHeight);
                        assert.deepEqual(projection.pick(center), board);
                        assert.deepEqual(
                            projection.pick(crown, (point) => point.x === x && point.y === y),
                            board,
                        );
                        const hit = projection.unproject(center);
                        assert.ok(hit && Math.hypot(hit.x - x, hit.y - y) < 1e-8);
                    }
                }
                for (const point of [
                    { x: bounds.left - 0.47, y: bounds.top },
                    { x: bounds.right + 0.47, y: bounds.bottom },
                    { x: bounds.left, y: bounds.top - 1 },
                    { x: bounds.right, y: bounds.bottom + 1 },
                    { x: bounds.left + 0.5, y: bounds.top + 1 },
                ]) {
                    assert.equal(projection.pick(projection.project(point)), null);
                }
            }
        }
    });
}

test("perspective preserves a square overhead and converges toward the far edge", () => {
    for (const bounds of crops) {
        const projection = new BoardProjection(bounds);
        for (const size of sizes) {
            for (const angle of angles) {
                projection.fit(size.x, size.y, angle);
                const { left, top, right, bottom } = bounds;
                const near =
                    projection.project({ x: right, y: bottom }).x -
                    projection.project({ x: left, y: bottom }).x;
                const far =
                    projection.project({ x: right, y: top }).x -
                    projection.project({ x: left, y: top }).x;
                if (angle === 0) {
                    assert.ok(Math.abs(near - far) < 1e-8);
                    const a = projection.project({ x: left, y: top });
                    const b = projection.project({ x: left, y: top + 1 });
                    assert.ok(Math.abs(b.y - a.y - far / (right - left)) < 1e-8);
                } else {
                    assert.ok(near / far > (bounds.right - bounds.left < 8 ? 1.07 : 1.1));
                    assert.ok(near / far < 1.48);
                }
                for (const x of [left - 1, right + 1]) {
                    for (const y of [top - 1, bottom + 1]) {
                        const p = projection.project({ x, y });
                        assert.ok(p.x > size.x * 0.04 && p.x < size.x * 0.96);
                        assert.ok(p.y > size.y * 0.04 && p.y < size.y * 0.96);
                    }
                }
            }
        }
    }
});

test("a visible raised edge remains selectable when it projects into the empty-cell dead band", () => {
    const projection = new BoardProjection(crops[0], { fieldOfView: 33, distanceScale: 1.6 });
    projection.fit(1040, 700, 35);
    const stone = { x: 9, y: 0 };
    const edge = projection.project({ x: 9, y: -0.42 }, 0.13);
    assert.equal(projection.pick(edge), null);
    assert.deepEqual(
        projection.pick(edge, (p) => p.x === stone.x && p.y === stone.y),
        stone,
    );
});

test("frames the floor goban's block and feet while picking on the unchanged playing surface", () => {
    for (const bounds of crops) {
        const projection = new BoardProjection(bounds, { boardStyle: "floor" });
        const { width, depth, thickness, legHeight } = boardDimensions(bounds, "floor");
        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;
        for (const size of sizes) {
            for (const angle of angles) {
                projection.fit(size.x, size.y, angle);
                for (const dx of [-1, 1]) {
                    for (const dy of [-1, 1]) {
                        const corner = {
                            x: centerX + (dx * width) / 2,
                            y: centerY + (dy * depth) / 2,
                        };
                        for (const elevation of [0, -thickness - legHeight - 0.003]) {
                            const point = projection.project(corner, elevation);
                            expect(point.x).toBeGreaterThan(size.x * 0.03);
                            expect(point.x).toBeLessThan(size.x * 0.97);
                            expect(point.y).toBeGreaterThan(size.y * 0.03);
                            expect(point.y).toBeLessThan(size.y * 0.97);
                        }
                    }
                }
                const edge = { x: bounds.right, y: bounds.bottom };
                expect(projection.pick(projection.project(edge))).toEqual(edge);
            }
        }
    }
});
