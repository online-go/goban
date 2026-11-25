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

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import RAPIER from "@dimforge/rapier3d-compat";
import { format, resolveConfig } from "prettier";
import { Quaternion, Vector3 } from "three";
import { crownHeight, stoneBase, stoneRadius } from "../../src/Goban/Three/projection";
import { bowlHeightScale, bowlProfile, lidProfile } from "../../src/Goban/Three/room";

type Profile = readonly (readonly [number, number])[];

const vesselRadius = 3.45;
const rimHeight = 0.78 * vesselRadius * bowlHeightScale;
const timeStep = 1 / 240;
const dropTimeLimit = 8;
const maxDropAttempts = 20;
// Rapier's default normalized linear sleep threshold.
const sleepSpeed = 0.05;
const surfaceTolerance = 0.01;
const vesselSegments = 64;
const vesselSector = (2 * Math.PI) / vesselSegments;
const axis = new Vector3(0, 1, 0);

function mulberry32(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function revolve(profile: Profile, segments: number): Vector3[] {
    return profile.flatMap(([radius, y]) =>
        Array.from({ length: segments }, (_, i) => {
            const angle = (i * 2 * Math.PI) / segments;
            return new Vector3(radius * Math.sin(angle), y, radius * Math.cos(angle));
        }),
    );
}

function vertexBuffer(points: Vector3[]): Float32Array {
    return new Float32Array(points.flatMap(({ x, y, z }) => [x, y, z]));
}

function dishCollider(profile: Profile) {
    const segments = vesselSegments;
    const indices: number[] = [];
    for (let row = 1; row < profile.length; row++) {
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % segments;
            const a = (row - 1) * segments + i;
            const b = a - i + next;
            const c = row * segments + i;
            const d = c - i + next;
            // Face the cavity and skip the degenerate second triangle at the centre.
            indices.push(a, b, c);
            if (profile[row][0] > 0) {
                indices.push(b, d, c);
            }
        }
    }
    return RAPIER.ColliderDesc.trimesh(
        vertexBuffer(revolve(profile, segments)),
        new Uint32Array(indices),
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
    );
}

const stonePoints = revolve(
    Array.from({ length: 10 }, (_, i) => {
        const t = (i * Math.PI) / 9;
        return [
            stoneRadius * Math.sin(t),
            stoneBase + ((crownHeight - stoneBase) * (1 - Math.cos(t))) / 2,
        ];
    }),
    24,
);
const stoneVertices = vertexBuffer(stonePoints);

function surfaceHeight(profile: Profile, x: number, z: number): number {
    // Measure against the polygonal cross-section used by the collider.
    const angle = Math.atan2(x, z);
    const normal = (Math.floor(angle / vesselSector) + 0.5) * vesselSector;
    const radius = (Math.hypot(x, z) * Math.cos(angle - normal)) / Math.cos(vesselSector / 2);
    for (let i = 1; i < profile.length; i++) {
        const [outerRadius, outerHeight] = profile[i - 1];
        const [innerRadius, innerHeight] = profile[i];
        if (radius >= innerRadius) {
            const fraction = Math.min(1, (radius - innerRadius) / (outerRadius - innerRadius));
            return innerHeight + fraction * (outerHeight - innerHeight);
        }
    }
    return profile[profile.length - 1][1];
}

function cavityRadius(profile: Profile, height: number): number {
    for (let i = 1; i < profile.length; i++) {
        const [innerRadius, innerHeight] = profile[i];
        if (height >= innerHeight) {
            const [outerRadius, outerHeight] = profile[i - 1];
            const fraction = Math.min(1, (height - innerHeight) / (outerHeight - innerHeight));
            return innerRadius + fraction * (outerRadius - innerRadius);
        }
    }
    return 0;
}

function pose(body: RAPIER.RigidBody) {
    const { x, y, z } = body.translation();
    const { x: qx, y: qy, z: qz, w: qw } = body.rotation();
    const origin = new Vector3(x, y, z);
    const rotation = new Quaternion(qx, qy, qz, qw);
    const centre = new Vector3(0, crownHeight / 2, 0).applyQuaternion(rotation).add(origin);
    const points = stonePoints.map((point) => point.clone().applyQuaternion(rotation).add(origin));
    return { origin, rotation, centre, points };
}

function penetrationDepth(profile: Profile, { points }: ReturnType<typeof pose>): number {
    return Math.max(...points.map(({ x, y, z }) => surfaceHeight(profile, x, z) - y));
}

function simulate(
    name: string,
    innerProfile: Profile,
    heightScale: number,
    count: number,
    dropRadiusRatio: number,
    maxHeight?: number,
) {
    const profile = innerProfile.map(
        ([r, h]) => [r * vesselRadius, h * vesselRadius * heightScale] as const,
    );
    const random = mulberry32(3974);
    let world = new RAPIER.World({ x: 0, y: -9.81 / 0.022, z: 0 });
    world.timestep = timeStep;
    world.integrationParameters.numSolverIterations = 8;
    if (maxHeight !== undefined) {
        world.integrationParameters.numInternalPgsIterations = 2;
    }
    const vessel = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
        dishCollider(profile)
            .setFriction(0.35)
            .setRestitution(0.1)
            .setContactSkin(maxHeight === undefined ? 0.012 : 0.02),
        vessel,
    );
    const floorHeight = profile[profile.length - 1][1];
    const floorHalfThickness = 0.025;
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(profile[0][0], floorHalfThickness, profile[0][0])
            .setTranslation(0, floorHeight - floorHalfThickness - 0.002, 0)
            .setFriction(0.35)
            .setRestitution(0.1),
        vessel,
    );
    const stone = RAPIER.ColliderDesc.convexHull(stoneVertices);
    if (!stone) {
        throw new Error("Could not build the stone convex hull");
    }
    stone.setFriction(0.35).setRestitution(0.1);
    let bodies: RAPIER.RigidBody[] = [];
    let top = floorHeight;
    let poses: ReturnType<typeof pose>[] = [];
    let moving = 0;
    let timedOut = 0;
    let retries = 0;
    const targetTop = maxHeight === undefined ? Infinity : maxHeight - 0.35;
    for (let i = 0; i < count && top < targetTop; i++) {
        const snapshot = world.takeSnapshot();
        const handles = bodies.map(({ handle }) => handle);
        for (let attempt = 1; attempt <= maxDropAttempts; attempt++) {
            if (attempt > 1) {
                retries++;
            }
            const dropRadius = maxHeight === undefined ? profile[0][0] : cavityRadius(profile, top);
            const distance = Math.sqrt(random()) * dropRadius * dropRadiusRatio;
            const releaseHeight =
                maxHeight === undefined ? top + 0.4 : Math.max(top + 0.6, rimHeight + 0.001);
            const angle = random() * 2 * Math.PI;
            const tiltAngle = random() * 2 * Math.PI;
            const tiltAxis = new Vector3(Math.cos(tiltAngle), 0, Math.sin(tiltAngle));
            const rotation = new Quaternion()
                .setFromAxisAngle(tiltAxis, (random() * 25 * Math.PI) / 180)
                .multiply(new Quaternion().setFromAxisAngle(axis, random() * 2 * Math.PI));
            const body = world.createRigidBody(
                RAPIER.RigidBodyDesc.dynamic()
                    .setTranslation(
                        distance * Math.cos(angle),
                        releaseHeight,
                        distance * Math.sin(angle),
                    )
                    .setRotation(rotation)
                    .setCcdEnabled(true)
                    .setLinearDamping(0.4)
                    .setAngularDamping(0.8),
            );
            world.createCollider(stone, body);
            const anyAwake = () =>
                !body.isSleeping() || bodies.some((stone) => !stone.isSleeping());
            for (let step = 0; step < dropTimeLimit / timeStep && anyAwake(); step++) {
                world.step();
            }
            if (anyAwake()) {
                timedOut++;
            }

            const landed = pose(body);
            const inside =
                Math.hypot(landed.origin.x, landed.origin.z) < profile[0][0] &&
                penetrationDepth(profile, landed) <= surfaceTolerance;
            const velocity = body.linvel();
            const settled =
                body.isSleeping() ||
                Math.hypot(velocity.x, velocity.y, velocity.z) < sleepSpeed * world.lengthUnit;
            if (inside && settled) {
                bodies.push(body);
                break;
            }

            world.removeRigidBody(body);
            world.free();
            if (attempt === maxDropAttempts) {
                throw new Error(
                    `${name}: stone ${i + 1} failed all ${maxDropAttempts} attempts (${retries} retries and ${timedOut} time-limit hits so far; last attempt inside: ${inside}, settled: ${settled}).`,
                );
            }
            // Discard the rejected drop's effects on the previously accepted stones.
            world = RAPIER.World.restoreSnapshot(snapshot);
            bodies = handles.map((handle) => world.getRigidBody(handle));
        }

        poses = bodies.map(pose);
        top = Math.max(...poses.map(({ points }) => Math.max(...points.map(({ y }) => y))));
        moving = bodies.filter((stone) => !stone.isSleeping()).length;
    }
    world.free();
    const penetrations = poses.map((stone) => penetrationDepth(profile, stone));
    const below = penetrations.filter((depth) => depth > surfaceTolerance).length;
    console.log(
        `${name} after ${poses.length} drops: top ${top.toFixed(4)}, ${below} below surface, ${moving} awake, ${retries} retries, ${timedOut} attempts hit the time limit.`,
    );
    if (below > 0) {
        throw new Error(
            `${name}: ${below} stones below the surface (maximum depth ${Math.max(...penetrations).toFixed(4)})`,
        );
    }
    if (moving > 0 || (maxHeight !== undefined && top > maxHeight)) {
        throw new Error(`${name}: final pile must be asleep and fit below the rim`);
    }
    return poses;
}

function reportLidPrefix(poses: ReturnType<typeof pose>[]) {
    const violations: string[] = [];
    poses.forEach(({ centre: a }, i) => {
        for (let j = i + 1; j < poses.length; j++) {
            const { centre: b } = poses[j];
            if (b.y < a.y && Math.hypot(b.x - a.x, b.z - a.z) < 1.5 * stoneRadius) {
                violations.push(`${i + 1}/${j + 1}`);
            }
        }
    });
    console.log(
        `Lid prefix: ${violations.length} flagged pairs (earlier/later)${violations.length ? `: ${violations.join(", ")}` : "."}`,
    );
}

const flip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);

/**
 * The lens is symmetric top to bottom, so an upside-down stone has an identical right-way-up
 * pose: turned over about its middle. Save that one, because the stone material is only ever
 * seen from above on the board and reads as glassy from below.
 */
function upright({ origin, rotation }: ReturnType<typeof pose>) {
    if (new Vector3(0, 1, 0).applyQuaternion(rotation).y >= 0) {
        return { origin, rotation };
    }
    return {
        origin: new Vector3(0, stoneBase + crownHeight, 0).applyQuaternion(rotation).add(origin),
        rotation: rotation.clone().multiply(flip),
    };
}

function serialize(name: string, poses: ReturnType<typeof pose>[]): string {
    const entries = poses
        .map(upright)
        .map(({ origin, rotation }) =>
            [...origin.toArray(), ...rotation.toArray()]
                .map((value) => value.toFixed(4))
                .join(", "),
        );
    return `export const ${name}: readonly (readonly number[])[] = [
${entries.map((entry) => `[${entry}],`).join("\n")}
];`;
}

async function main() {
    await RAPIER.init();
    const bowl = simulate("Bowl", bowlProfile.slice(8), bowlHeightScale, 200, 0.85, rimHeight);
    const lid = simulate("Lid", lidProfile.slice(6), 1, 30, 0.7);
    reportLidPrefix(lid);

    const license = (await readFile(__filename, "utf8")).split("import ", 1)[0];
    const data = `${license}// Generated by scripts/stone-piles/generate.ts. Do not edit by hand.

/** Each stone: [x, y, z, qx, qy, qz, qw], relative to the vessel's base centre, in room units. */
${serialize("bowlStonePile", bowl)}
${serialize("lidStonePile", lid)}
`;
    const filepath = resolve(__dirname, "../../src/Goban/Three/stonePiles.ts");
    await writeFile(filepath, await format(data, { ...(await resolveConfig(filepath)), filepath }));
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
