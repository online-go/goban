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
import { angles, BoardProjection, roomLayout, crownHeight } from "../../src/Goban/Three/projection";

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
                for (const x of [left - 0.5, right + 0.5]) {
                    for (const y of [top - 0.5, bottom + 0.5]) {
                        const p = projection.project({ x, y });
                        assert.ok(p.x > 0 && p.x < size.x);
                        assert.ok(p.y > 0 && p.y < size.y);
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

/** Share of the viewport the grid plus edge stones spans along its tighter axis. */
function gridFill(projection: BoardProjection, size: { x: number; y: number }): number {
    const { left, top, right, bottom } = projection.bounds;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const x of [left - 0.5, right + 0.5]) {
        for (const y of [top - 0.5, bottom + 0.5]) {
            const p = projection.project({ x, y });
            xs.push(p.x);
            ys.push(p.y);
        }
    }
    return Math.max(
        (Math.max(...xs) - Math.min(...xs)) / size.x,
        (Math.max(...ys) - Math.min(...ys)) / size.y,
    );
}

test("frames the grid tightly at every style, angle and rotation, cropping the wood if needed", () => {
    for (const boardStyle of ["tabletop", "floor"] as const) {
        for (const rotation of [0, 45, 90, 200]) {
            for (const bounds of crops) {
                const projection = new BoardProjection(bounds, { boardStyle, rotation });
                for (const size of sizes) {
                    for (const angle of [...angles, 60, 75]) {
                        projection.fit(size.x, size.y, angle);
                        const { left, top, right, bottom } = bounds;
                        for (const x of [left - 0.5, right + 0.5]) {
                            for (const y of [top - 0.5, bottom + 0.5]) {
                                for (const elevation of [0, crownHeight]) {
                                    const p = projection.project({ x, y }, elevation);
                                    expect(p.x).toBeGreaterThan(0);
                                    expect(p.x).toBeLessThan(size.x);
                                    expect(p.y).toBeGreaterThan(0);
                                    expect(p.y).toBeLessThan(size.y);
                                }
                            }
                        }
                        expect(gridFill(projection, size)).toBeGreaterThan(0.65);
                        const edge = { x: right, y: bottom };
                        expect(projection.pick(projection.project(edge))).toEqual(edge);
                    }
                }
            }
        }
    }
});

test("keeps the centre of each capture lid in view with the room enabled", () => {
    for (const boardStyle of ["tabletop", "floor"] as const) {
        for (const rotation of [0, 45, 90, 180]) {
            const bounds = crops[0];
            const projection = new BoardProjection(bounds, { boardStyle, room: true, rotation });
            const room = roomLayout(bounds, boardStyle);
            for (const size of sizes) {
                for (const angle of [...angles, 60, 75]) {
                    projection.fit(size.x, size.y, angle);
                    for (const direction of [-1, 1]) {
                        const lid = {
                            x: room.x + direction * room.side,
                            y: room.z - direction * room.separation,
                        };
                        const p = projection.project(lid, room.surface + room.radius * 0.2);
                        expect(p.x).toBeGreaterThan(0);
                        expect(p.x).toBeLessThan(size.x);
                        expect(p.y).toBeGreaterThan(0);
                        expect(p.y).toBeLessThan(size.y);
                    }
                }
            }
        }
    }
});

test("picks the same intersection at any camera orientation with the room enabled", () => {
    const bounds = { left: 0, top: 0, right: 18, bottom: 12 };
    const point = { x: 3, y: 9 };

    for (const rotation of [0, 41.5, 90, 127, 180, 229.5, 270, 310]) {
        const projection = new BoardProjection(bounds, { room: true, rotation });
        assert.equal(projection.rotation, rotation);
        for (const angle of [0, 15, 23.5, 35]) {
            projection.fit(390, 330, angle);
            assert.deepEqual(projection.pick(projection.project(point)), point);
        }
    }
});
