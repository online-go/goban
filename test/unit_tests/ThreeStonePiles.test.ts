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
import { Quaternion, Vector3 } from "three";
import { bowlHeightRatio, crownHeight } from "../../src/Goban/Three/projection";
import { bowlStonePile, lidStonePile } from "../../src/Goban/Three/stonePiles";

const radius = 3.45;
const bowlHeightScale = bowlHeightRatio / 0.78;

describe.each([
    ["bowl", bowlStonePile],
    ["lid", lidStonePile],
] as const)("%s stone pile", (_name, pile) => {
    test("contains finite poses with unit quaternions", () => {
        assert(pile.length > 0);
        for (const stone of pile) {
            assert.equal(stone.length, 7);
            assert(stone.every(Number.isFinite));
            assert(Math.abs(Math.hypot(...stone.slice(3)) - 1) <= 0.001);
        }
    });

    test("keeps stone centres apart", () => {
        const centres = pile.map(([x, y, z, qx, qy, qz, qw]) =>
            new Vector3(0, crownHeight / 2, 0)
                .applyQuaternion(new Quaternion(qx, qy, qz, qw))
                .add(new Vector3(x, y, z)),
        );
        for (let i = 0; i < centres.length; i++) {
            for (let j = i + 1; j < centres.length; j++) {
                assert(
                    centres[i].distanceTo(centres[j]) >= crownHeight * 0.5,
                    `Stones ${i + 1} and ${j + 1}`,
                );
            }
        }
    });
});

test("bowl stones are inside the bowl", () => {
    for (const [x, y, z] of bowlStonePile) {
        assert(Math.hypot(x, z) < 0.91 * radius);
        assert(y >= 0.25 * radius * bowlHeightScale - 0.01);
        assert(y <= 0.78 * radius * bowlHeightScale);
    }
});

test("lid stones are inside the lid, then on the table beside it", () => {
    const inLid = lidStonePile.findIndex(([x, , z]) => Math.hypot(x, z) >= 0.89 * radius);
    const lid = inLid === -1 ? lidStonePile : lidStonePile.slice(0, inLid);
    assert(lid.length >= 30);
    for (const [x, y, z] of lid) {
        assert(Math.hypot(x, z) < 0.89 * radius);
        // A tilted stone's origin, under its middle, can dip a little below the dish floor.
        assert(y >= 0.16 * radius - 0.02);
    }
    for (const [x, y, z] of lidStonePile.slice(lid.length)) {
        // Table stones can tuck under the lid's flared outer wall, but not into its foot.
        assert(Math.hypot(x, z) > 0.73 * radius);
        assert(y >= -0.01);
    }
});
