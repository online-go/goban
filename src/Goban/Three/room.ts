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

import {
    BoxGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    Group,
    InstancedMesh,
    LatheGeometry,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    Vector2,
    Vector3,
    type BufferGeometry,
    type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ThreeBoardStyle } from "../ThreeConfig";
import { bowlHeightRatio, floorBoardFeet, roomLayout, type Bounds } from "./projection";

import type { JGOFClock } from "../../engine";
import { RoomClock } from "./roomClock";
import {
    contactShadowTexture,
    contactTexture,
    hallFloorTexture,
    miniBoardTexture,
    plasterTexture,
    scrollTexture,
    shojiTexture,
    tatamiTexture,
    windowTexture,
} from "./roomTextures";
import { bowlStonePile, lidStonePile } from "./stonePiles";

// At the scale of a full-size goban, 34 units is about 74 cm.
const tableHeight = 34;
const tableLegInset = 0.8;

/** Instance position, with an optional turn about the vertical axis. */
type Placement = readonly [number, number, number, number?];

/** Deterministic hash in [0, 1) for repeatable furniture variation. */
/**
 * Ambient occlusion for a wall plane centred on its local origin: dark into the floor, softer
 * into the side corners and under the ceiling.
 */
function wallOcclusion(x: number, y: number, span: number, height: number): number {
    const floor = 1 - 0.68 * Math.exp(-(y + height / 2) / 6);
    const corner = 1 - 0.5 * Math.exp(-(span / 2 - Math.abs(x)) / 9);
    const ceiling = 1 - 0.35 * Math.exp(-(height / 2 - y) / 12);
    return floor * corner * ceiling;
}

function noise(n: number): number {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
}

const bowlFootRatio = 0.44;
const lidFootRatio = 0.51;

export const bowlHeightScale = bowlHeightRatio / 0.78;
export const bowlProfile = [
    [0, 0],
    [bowlFootRatio, 0],
    [0.59, 0.05],
    [0.76, 0.22],
    [0.9, 0.42],
    [0.99, 0.68],
    [1, 0.75],
    [0.97, 0.78],
    [0.91, 0.77],
    [0.88, 0.69],
    [0.81, 0.51],
    [0.72, 0.36],
    [0.58, 0.25],
    [0, 0.25],
] as const;
export const lidProfile = [
    [0, 0],
    [lidFootRatio, 0],
    [0.73, 0.06],
    [0.92, 0.18],
    [1, 0.29],
    [0.98, 0.33],
    [0.89, 0.32],
    [0.79, 0.23],
    [0.61, 0.16],
    [0, 0.16],
] as const;

/**
 * A stone pile turned half way about the vertical axis, so the overflow on the table lies on the
 * far side of the other player's lid too.
 */
function halfTurn(stones: readonly (readonly number[])[]): number[][] {
    return stones.map(([x, y, z, qx, qy, qz, qw]) => [-x, y, -z, qz, qw, -qx, -qy]);
}

function rectangleDistance(x: number, z: number, width: number, depth: number): number {
    const dx = Math.abs(x) - width / 2;
    const dz = Math.abs(z) - depth / 2;
    return Math.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(0, Math.max(dx, dz));
}

function shadeSurface<T extends BufferGeometry>(
    geometry: T,
    illumination: (x: number, y: number, z: number) => number,
): T {
    const positions = geometry.getAttribute("position");
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
        const light = illumination(positions.getX(i), positions.getY(i), positions.getZ(i));
        colors.push(light, light, light);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return geometry;
}

export class RoomScene extends Group {
    public readonly shadowExtent: number;
    public readonly shadowDepth: number;
    private readonly clock?: RoomClock;
    private readonly geometries: BufferGeometry[] = [];
    private readonly materials: (MeshStandardMaterial | MeshBasicMaterial)[];
    private readonly lids: InstancedMesh[] = [];
    /** Each player's bowl; the last stones dropped in are on top and taken first. */
    private readonly bowls: InstancedMesh[] = [];
    /** Each bowl's own geometry, so its inside can lighten as it empties. */
    private readonly bowlVessels: BufferGeometry[] = [];
    /** Per bowl vertex: the full occlusion inside a filled bowl, 0 on the outside. */
    private bowlOcclusion: number[] = [];
    /** Per bowl vertex: the light without occlusion. */
    private bowlLight: number[] = [];
    /** Contact shadows under captured stones, shown in step with each lid's stone count. */
    private readonly lidShadows: InstancedMesh[] = [];
    private readonly textures: Texture[] = [];
    /** Solid fixtures on each wall, with the wall's position and inward normal. */
    private readonly fixtures: { group: Group; x: number; z: number; nx: number; nz: number }[] =
        [];

    /** A group for one wall's fixtures, hidden whenever the camera is near or behind it. */
    private wallFixtures(wall: { x: number; z: number; nx: number; nz: number }): Group {
        const group = new Group();
        this.add(group);
        this.fixtures.push({ group, x: wall.x, z: wall.z, nx: wall.nx, nz: wall.nz });
        return group;
    }

    /**
     * Walls are culled from behind, but posts, beams and skirting are solid. Hide those on any
     * wall the camera is close to or outside of, so they never block the view of the board.
     */
    public updateCamera(camera: Vector3): void {
        const x = camera.x - this.position.x;
        const z = camera.z - this.position.z;
        for (const fixture of this.fixtures) {
            fixture.group.visible = (x - fixture.x) * fixture.nx + (z - fixture.z) * fixture.nz > 6;
        }
    }

    public constructor(
        bounds: Bounds,
        style: ThreeBoardStyle,
        wood: Texture,
        stones: BufferGeometry,
        bowlStones: BufferGeometry,
        materials: readonly [MeshStandardMaterial, MeshStandardMaterial],
    ) {
        super();
        this.keep(bowlStones);
        const {
            x,
            z,
            width,
            depth,
            radius,
            side,
            separation,
            surface,
            furnitureWidth,
            furnitureDepth,
        } = roomLayout(bounds, style);
        this.position.set(x, surface, z);
        const floorDepth = style === "floor" ? 0 : tableHeight;
        this.shadowExtent =
            Math.hypot(furnitureWidth / 2, furnitureDepth / 2) + 5 + floorDepth * 0.58;
        this.shadowDepth = 68 + floorDepth * 1.35;
        const vessels = new MeshStandardMaterial({
            map: wood,
            color: "#774831",
            roughness: 0.62,
            vertexColors: true,
        });
        const vesselAmbient = (x: number, z: number) => {
            const dx = Math.abs(x) - side;
            const row = x < 0 ? -z : z;
            const bowlDistance = Math.hypot(dx, row - separation);
            const lidDistance = Math.hypot(dx, row + separation);
            const bowl = MathUtils.smoothstep(bowlDistance, radius * bowlFootRatio, radius * 1.21);
            const lid = MathUtils.smoothstep(lidDistance, radius * lidFootRatio, radius * 1.11);
            return 0.12 + 0.88 * Math.min(bowl, lid);
        };
        this.materials = [vessels];
        if (style === "floor") {
            this.addTatamiRoom(furnitureWidth, furnitureDepth, width, depth, vesselAmbient, wood);
        } else {
            this.addTournamentHall(furnitureWidth, furnitureDepth, wood);
            this.addTableContacts(
                furnitureWidth,
                furnitureDepth,
                (x, z) => {
                    const edge = rectangleDistance(x, z, width, depth);
                    const board = 0.18 + 0.82 * MathUtils.smoothstep(edge, -0.24, 0.72);
                    return Math.min(board, vesselAmbient(x, z));
                },
                [width, depth, side, separation, radius],
            );
            this.clock = new RoomClock(-side);
            this.add(this.clock);
        }

        const bowl = this.vessel(radius, bowlProfile, bowlHeightScale);
        const lid = this.vessel(radius, lidProfile);
        // Outside, light grows towards the rim. Inside, an occlusion gradient darkens the wall
        // with depth below the rim, so the bowl reads as a deep cavity. It fades to a tenth as
        // the bowl empties (see updateBowls).
        const bowlProfileLength = bowlProfile.length;
        const bowlInnerStart = 8;
        const rimHeight = 0.78 * radius * bowlHeightScale;
        const innerFloor = 0.25 * radius * bowlHeightScale;
        const bowlPositions = bowl.getAttribute("position");
        for (let i = 0; i < bowlPositions.count; i++) {
            const y = bowlPositions.getY(i);
            const outer = 0.5 + 0.5 * MathUtils.smoothstep(y, radius * 0.12, radius * 0.94);
            const depth = (rimHeight - y) / (rimHeight - innerFloor);
            const inside = i % bowlProfileLength >= bowlInnerStart;
            this.bowlLight.push(inside ? 0.95 : outer);
            this.bowlOcclusion.push(inside ? 0.9 * MathUtils.smoothstep(depth, 0.02, 0.85) : 0);
        }
        shadeSurface(
            lid,
            (_x, y) => 0.61 + 0.39 * MathUtils.smoothstep(y, radius * 0.07, radius * 0.29),
        );
        for (const color of [0, 1] as const) {
            const direction = color === 0 ? 1 : -1;
            const bowlX = direction * side;
            const bowlZ = direction * separation;
            const bowlVessel = this.keep(bowl.clone());
            this.bowlVessels.push(bowlVessel);
            this.shadeBowl(bowlVessel, 1);
            this.place(bowlVessel, vessels, bowlX, 0, bowlZ);
            this.place(lid, vessels, bowlX, 0, -bowlZ);
            this.bowls.push(
                this.pile(bowlStones, materials[color], bowlX, 0, bowlZ, bowlStonePile),
            );
            const lidPile = color === 0 ? lidStonePile : halfTurn(lidStonePile);
            const captures = this.pile(
                stones,
                materials[color === 0 ? 1 : 0],
                bowlX,
                0,
                -bowlZ,
                lidPile,
            );
            captures.count = 0;
            this.lids.push(captures);
            const contacts = this.contactShadows(bowlX, 0, -bowlZ, lidPile);
            contacts.count = 0;
            this.lidShadows.push(contacts);
        }
    }

    private addTatamiRoom(
        furnitureWidth: number,
        furnitureDepth: number,
        boardWidth: number,
        boardDepth: number,
        vesselAmbient: (x: number, z: number) => number,
        wood: Texture,
    ): void {
        const span = Math.max(boardWidth, boardDepth);
        // A 90 cm mat spans roughly twice a full-size goban across its short side.
        const matSpan = 3 * 40;
        // Deep enough that an orbiting camera normally stays inside the room.
        const wallDistance = Math.max(boardDepth / 2 + Math.max(boardDepth * 0.85, 8), 62);
        const floorWidth = furnitureWidth * 3;
        const frontDepth = Math.max(furnitureDepth * 1.6, 62);
        const floorDepth = frontDepth + wallDistance;
        const floorCenter = (frontDepth - wallDistance) / 2;
        const tatami = tatamiTexture(floorWidth / matSpan, floorDepth / matSpan);
        tatami.offset.x += 0.045;
        tatami.offset.y -= floorCenter / matSpan;
        // Standard 85 cm × 175 cm sliding panels at the same scale as the matting.
        const shoji = shojiTexture(floorWidth / 39);
        this.textures.push(tatami, shoji);
        const floor = new MeshStandardMaterial({ map: tatami, roughness: 1, vertexColors: true });
        const wall = new MeshStandardMaterial({ map: shoji, roughness: 1, vertexColors: true });
        this.materials.push(floor, wall);

        const floorGeometry = this.keep(
            new PlaneGeometry(floorWidth, floorDepth, 88, 76).rotateX(-Math.PI / 2),
        );
        const feet = floorBoardFeet(boardWidth, boardDepth);
        // Bake ambient falloff and contact occlusion into the floor mesh.
        shadeSurface(floorGeometry, (x, _y, z) => {
            const roomZ = z + floorCenter;
            const u = x / span + 0.4;
            const v = roomZ / span + 0.32;
            const falloff = 0.48 + 0.52 * Math.exp(-1.3 * (u * u + v * v));
            // Occlusion along every wall, strongest in the corners where two walls meet.
            const backGap = roomZ + wallDistance;
            const frontGap = frontDepth - roomZ;
            const sideGap = floorWidth / 2 - Math.abs(x);
            const wallContact =
                (1 - 0.66 * Math.exp(-Math.min(backGap, frontGap) / 7)) *
                (1 - 0.66 * Math.exp(-sideGap / 7));
            const edgeDistance = rectangleDistance(x, roomZ, boardWidth, boardDepth);
            const slabAmbient = 0.08 + 0.92 * MathUtils.smoothstep(edgeDistance, -1.4, 2.5);
            const footDistance = Math.hypot(Math.abs(x) - feet.x, Math.abs(roomZ) - feet.z);
            const footAmbient =
                0.22 +
                0.78 * MathUtils.smoothstep(footDistance, 0.35 * feet.radius, 1.9 * feet.radius);
            return (
                0.85 *
                falloff *
                wallContact *
                Math.min(slabAmbient, footAmbient, vesselAmbient(x, roomZ))
            );
        });
        this.place(floorGeometry, floor, 0, 0, floorCenter).castShadow = false;

        const wallHeight = 80;
        const wallGeometry = this.keep(new PlaneGeometry(floorWidth, wallHeight, 32, 64));
        shadeSurface(wallGeometry, (x, y) => {
            const distanceFromFloor = y + wallHeight / 2;
            const lateral = x / span + 0.6;
            const falloff = 0.5 + 0.5 * Math.exp(-0.7 * lateral * lateral);
            const contact = 1 - 0.35 * Math.exp(-distanceFromFloor / 1.6);
            return 0.85 * falloff * contact * wallOcclusion(x, y, floorWidth, wallHeight);
        });
        this.place(wallGeometry, wall, 0, wallHeight / 2, -wallDistance).castShadow = false;
        this.encloseRoom(0, floorWidth, floorDepth, floorCenter, wallHeight, (span) => {
            const panels = shojiTexture(span / 39);
            this.textures.push(panels);
            const material = new MeshStandardMaterial({
                map: panels,
                roughness: 1,
                vertexColors: true,
            });
            this.materials.push(material);
            return material;
        });
        this.addTatamiJoinery(floorWidth, floorDepth, floorCenter, wallDistance, wallHeight, wood);
    }

    /**
     * Real depth for the tatami room: posts between pairs of shoji, a lintel above and a sill
     * below them, and one plaster bay on the back wall with a hanging scroll.
     */
    private addTatamiJoinery(
        floorWidth: number,
        floorDepth: number,
        floorCenter: number,
        wallDistance: number,
        wallHeight: number,
        wood: Texture,
    ): void {
        const timber = new MeshStandardMaterial({
            map: wood,
            color: "#8d6a4b",
            roughness: 0.66,
            vertexColors: true,
        });
        const clay = plasterTexture(1.6, 2);
        this.textures.push(clay);
        const plaster = new MeshStandardMaterial({ map: clay, roughness: 1, vertexColors: true });
        const scroll = scrollTexture();
        const hanging = new MeshStandardMaterial({ map: scroll, roughness: 0.9 });
        this.textures.push(scroll);
        this.materials.push(timber, plaster, hanging);

        const post = 3.2;
        const lintel = 3.4;
        const frontZ = floorCenter + floorDepth / 2;
        // Each wall: centre, inward normal, length and which axis it runs along.
        const walls = [
            { x: 0, z: -wallDistance, nx: 0, nz: 1, length: floorWidth },
            { x: 0, z: frontZ, nx: 0, nz: -1, length: floorWidth },
            { x: -floorWidth / 2, z: floorCenter, nx: 1, nz: 0, length: floorDepth },
            { x: floorWidth / 2, z: floorCenter, nx: -1, nz: 0, length: floorDepth },
        ];
        const postGeometry = this.keep(new BoxGeometry(post, wallHeight, post, 1, 40, 1));
        const lintelY = wallHeight / 2 - 9;
        shadeSurface(postGeometry, (_x, y) => {
            // Darker into the floor and where the post meets the lintel.
            const floorGap = y + wallHeight / 2;
            const lintelGap = Math.abs(y - lintelY);
            return (
                0.85 *
                (1 - 0.5 * Math.exp(-floorGap / 3.5)) *
                (1 - 0.3 * Math.exp(-lintelGap / 2.5))
            );
        });
        for (const wall of walls) {
            const fixtures = this.wallFixtures(wall);
            const alongX = wall.nz !== 0;
            const beam = this.keep(
                alongX
                    ? new BoxGeometry(wall.length, lintel, 2.4)
                    : new BoxGeometry(2.4, lintel, wall.length),
            );
            const sill = this.keep(
                alongX
                    ? new BoxGeometry(wall.length, 0.9, 3)
                    : new BoxGeometry(3, 0.9, wall.length),
            );
            // The lintel sits in the wall's upper shade; the sill lies in the floor corner.
            shadeSurface(beam, () => 0.72);
            shadeSurface(sill, () => 0.55);
            const inset = 1.1;
            const bx = wall.x + wall.nx * inset;
            const bz = wall.z + wall.nz * inset;
            fixtures.add(this.place(beam, timber, bx, wallHeight - 9, bz));
            fixtures.add(this.place(sill, timber, bx, 0.45, bz));
            // Posts every two panels, aligned with the panel seams of the centred texture.
            const half = wall.length / 2;
            for (let along = -Math.floor(half / 78) * 78; along <= half; along += 78) {
                const px = alongX ? wall.x + along : bx;
                const pz = alongX ? bz : wall.z + along;
                fixtures.add(this.place(postGeometry, timber, px, wallHeight / 2, pz));
            }
            fixtures.traverse((mesh) => (mesh.castShadow = false));
        }

        // A tokonoma alcove, two panels wide, left of centre on the back wall: plaster back
        // with a scroll, a raised platform, plaster side walls, a dropped beam framing the
        // opening, a natural-wood corner post and a small vase.
        const bayWidth = 78 - post;
        const bayHeight = wallHeight - 9 - lintel / 2;
        const alcove = this.wallFixtures({ x: 0, z: -wallDistance, nx: 0, nz: 1 });
        const backZ = -wallDistance + 0.35;
        const alcoveDepth = 13;
        const alcoveFront = -wallDistance + alcoveDepth;
        const opening = 60;
        const platform = 2.4;
        const centreX = -39;
        const bay = this.keep(new PlaneGeometry(bayWidth, bayHeight, 30, 40));
        shadeSurface(bay, (x, y) => {
            // Deep in the alcove: darker overall, into the corners and under the beam.
            const floorGap = y + bayHeight / 2 - platform;
            const beamGap = opening - (y + bayHeight / 2);
            const sideGap = bayWidth / 2 - Math.abs(x);
            const recess =
                (1 - 0.5 * Math.exp(-Math.max(0, floorGap) / 4)) *
                (1 - 0.45 * Math.exp(-Math.max(0, beamGap) / 7)) *
                (1 - 0.45 * Math.exp(-sideGap / 5));
            return 0.72 * recess;
        });
        alcove.add(this.place(bay, plaster, centreX, bayHeight / 2, backZ));
        alcove.add(
            this.place(
                this.keep(new PlaneGeometry(14, 42)),
                hanging,
                centreX,
                platform + 31,
                backZ + 0.1,
            ),
        );

        // The platform fits between the alcove's side walls rather than running through them.
        const cheekWidth = 1.6;
        const platformWidth = bayWidth - 2 * cheekWidth;
        // The vase stands a fifth of the way in from the left, on the platform's centre line.
        const vaseOffset = -bayWidth * 0.2;
        const platformGeometry = this.keep(
            new BoxGeometry(platformWidth, platform, alcoveDepth, 40, 1, 10),
        );
        shadeSurface(platformGeometry, (x, y, z) => {
            if (y < 0) {
                return 0.45;
            }
            const depth = 0.62 + 0.3 * MathUtils.smoothstep(z, -alcoveDepth / 2, alcoveDepth / 2);
            const ends = 1 - 0.4 * Math.exp(-(platformWidth / 2 - Math.abs(x)) / 2.5);
            const vaseContact = 1 - 0.55 * Math.exp(-Math.hypot(x - vaseOffset, z) / 2.6);
            return depth * ends * vaseContact;
        });
        alcove.add(
            this.place(
                platformGeometry,
                timber,
                centreX,
                platform / 2,
                -wallDistance + alcoveDepth / 2,
            ),
        );

        // Side walls of the alcove, shaded deeper towards the back.
        const cheek = this.keep(new BoxGeometry(cheekWidth, bayHeight, alcoveDepth, 1, 24, 8));
        shadeSurface(cheek, (_x, y, z) => {
            const depth = MathUtils.smoothstep(z, -alcoveDepth / 2, alcoveDepth / 2);
            const floor = 1 - 0.5 * Math.exp(-(y + bayHeight / 2) / 5);
            return (0.5 + 0.35 * depth) * floor;
        });
        for (const side of [-1, 1]) {
            alcove.add(
                this.place(
                    cheek,
                    plaster,
                    centreX + side * (bayWidth / 2 - cheekWidth / 2),
                    bayHeight / 2,
                    -wallDistance + alcoveDepth / 2,
                ),
            );
        }

        // Dropped beam across the opening, with plaster filling up to the lintel.
        const dropped = this.keep(new BoxGeometry(bayWidth, 3.2, 1.8));
        shadeSurface(dropped, (_x, y) => (y < 0 ? 0.5 : 0.78));
        alcove.add(this.place(dropped, timber, centreX, opening + 1.6, alcoveFront));
        const fillHeight = bayHeight - opening - 3.2;
        if (fillHeight > 0) {
            const fill = this.keep(new BoxGeometry(bayWidth, fillHeight, 1.2, 8, 6, 1));
            shadeSurface(fill, (_x, y) => 0.7 * (1 - 0.35 * Math.exp(-(fillHeight / 2 - y) / 3)));
            alcove.add(
                this.place(fill, plaster, centreX, opening + 3.2 + fillHeight / 2, alcoveFront),
            );
        }

        // Natural-wood corner post on the open side, nearest the room's centre.
        const naturalWood = new MeshStandardMaterial({
            map: wood,
            color: "#b08a62",
            roughness: 0.55,
            vertexColors: true,
        });
        this.materials.push(naturalWood);
        // A cylinder's texture seam faces +z; turn it to face the alcove's back wall.
        const cornerPost = this.keep(
            new CylinderGeometry(1.9, 2.1, bayHeight, 14, 30).rotateY(Math.PI),
        );
        shadeSurface(cornerPost, (_x, y) => 0.88 * (1 - 0.45 * Math.exp(-(y + bayHeight / 2) / 4)));
        alcove.add(
            this.place(
                cornerPost,
                naturalWood,
                centreX + bayWidth / 2 - 1.2,
                bayHeight / 2,
                alcoveFront,
            ),
        );

        // A small ceramic vase with a bare branch.
        const ceramic = new MeshStandardMaterial({
            color: "#5d6b6a",
            roughness: 0.35,
            vertexColors: true,
        });
        this.materials.push(ceramic);
        const vase = this.keep(
            new LatheGeometry(
                [
                    [0, 0],
                    [1.4, 0],
                    [2.1, 1.6],
                    [2.0, 3.6],
                    [1.0, 5.6],
                    [0.8, 6.8],
                    [1.1, 7.2],
                    [0, 7.2],
                ].map(([r, h]) => new Vector2(r, h)),
                20,
            ),
        );
        // Darker at the foot and on the side facing the alcove's back wall.
        shadeSurface(vase, (_x, y, z) => {
            const foot = 1 - 0.5 * Math.exp(-y / 1.2);
            const facing = 0.72 + 0.28 * MathUtils.smoothstep(z, -2.1, 2.1);
            return 0.95 * foot * facing;
        });
        const vaseX = centreX + vaseOffset;
        const vaseZ = -wallDistance + alcoveDepth * 0.5;
        alcove.add(this.place(vase, ceramic, vaseX, platform, vaseZ));
        const branch = this.keep(new CylinderGeometry(0.12, 0.25, 16, 6).translate(0, 8, 0));
        const twig = this.place(branch, timber, vaseX, platform + 6.8, vaseZ);
        twig.rotation.set(0.15, 0, -0.35);
        alcove.add(twig);
        alcove.traverse((mesh) => (mesh.castShadow = false));
    }

    /**
     * Close the room with front and side walls around the floor so an orbiting camera never
     * looks out into empty space. The walls face inwards: if the camera ends up outside one,
     * that wall is back-face culled and acts as a cutaway instead of hiding the board.
     */
    private encloseRoom(
        floorY: number,
        floorWidth: number,
        floorDepth: number,
        floorCenter: number,
        wallHeight: number,
        material: (span: number) => MeshStandardMaterial,
        brightness = 0.62,
    ): void {
        const wall = (span: number) => {
            const shade = (x: number, y: number) =>
                brightness * wallOcclusion(x, y, span, wallHeight);
            const geometry = this.keep(new PlaneGeometry(span, wallHeight, 40, 48));
            shadeSurface(geometry, shade);
            return geometry;
        };
        const y = floorY + wallHeight / 2;
        const front = wall(floorWidth).rotateY(Math.PI);
        this.place(front, material(floorWidth), 0, y, floorCenter + floorDepth / 2).castShadow =
            false;
        const sideMaterial = material(floorDepth);
        for (const direction of [-1, 1]) {
            // Plane normals start at +z; turn each side wall to face the room centre.
            const side = wall(floorDepth).rotateY((-direction * Math.PI) / 2);
            this.place(
                side,
                sideMaterial,
                (direction * floorWidth) / 2,
                y,
                floorCenter,
            ).castShadow = false;
        }
    }

    /**
     * A bright tournament hall: light plank floor, off-white walls with a row of windows, and
     * rows of tables with games in progress around the player's own table.
     */
    private addTournamentHall(width: number, depth: number, wood: Texture): void {
        const floorHeight = -tableHeight;
        this.addTable(width, depth, floorHeight, wood);
        const columnStep = width + 16;
        const rowStep = depth + 46;
        const halfWidth = Math.max(width * 3.4, 150);
        const floorWidth = halfWidth * 2;
        const wallDistance = Math.max(rowStep * 2.4, 120);
        const floorDepth = wallDistance * 2;
        const floorCenter = 0;
        const tableColumns = Math.floor((halfWidth - width / 2 - 12) / columnStep);
        const tableRows = Math.floor((wallDistance - depth / 2 - 26) / rowStep);
        const tile = 44;
        const planks = hallFloorTexture(floorWidth / tile, floorDepth / tile);
        const windows = windowTexture();
        this.textures.push(planks, windows);
        const floor = new MeshStandardMaterial({
            map: planks,
            roughness: 0.62,
            vertexColors: true,
        });
        const paint = new MeshStandardMaterial({
            color: "#ece8df",
            roughness: 0.95,
            vertexColors: true,
        });
        const skirting = new MeshStandardMaterial({ map: wood, color: "#b89a74", roughness: 0.7 });
        const glass = new MeshBasicMaterial({ map: windows });
        this.materials.push(floor, paint, skirting, glass);

        const slab = this.keep(
            new PlaneGeometry(floorWidth, floorDepth, 96, 96).rotateX(-Math.PI / 2),
        );
        shadeSurface(slab, (x, _y, z) => {
            const footDistance = Math.hypot(
                Math.abs(x) - (width / 2 - tableLegInset),
                Math.abs(z) - (depth / 2 - tableLegInset),
            );
            const footAmbient = 0.3 + 0.7 * MathUtils.smoothstep(footDistance, 0.4, 2.1);
            const edge = rectangleDistance(x, z, width, depth);
            const tableAmbient = 0.73 + 0.27 * MathUtils.smoothstep(edge, -4, 7);
            const u = x / halfWidth;
            const v = z / wallDistance;
            const hall = 0.74 + 0.2 * Math.exp(-1.5 * (u * u + v * v));
            const wallGap = Math.min(halfWidth - Math.abs(x), wallDistance - Math.abs(z));
            const wallContact = 1 - 0.62 * Math.exp(-wallGap / 7);
            // Occlusion under the nearest neighbouring table and around its chairs.
            const column = Math.round(x / columnStep);
            const row = Math.round(z / rowStep);
            let neighbour = 1;
            if (
                (row !== 0 || column !== 0) &&
                Math.abs(column) <= tableColumns &&
                Math.abs(row) <= tableRows
            ) {
                const tx = x - column * columnStep;
                const tz = z - row * rowStep;
                const under =
                    0.42 +
                    0.58 * MathUtils.smoothstep(rectangleDistance(tx, tz, width, depth), -6, 7);
                const chairs =
                    0.78 +
                    0.22 *
                        MathUtils.smoothstep(
                            rectangleDistance(tx, tz, width * 0.5, depth + 34),
                            -3,
                            5,
                        );
                neighbour = under * chairs;
            }
            return Math.min(footAmbient, tableAmbient) * hall * wallContact * neighbour;
        });
        this.place(slab, floor, 0, floorHeight, floorCenter).castShadow = false;

        const wallHeight = 110;
        const back = this.keep(new PlaneGeometry(floorWidth, wallHeight, 48, 48));
        shadeSurface(back, (x, y) => 0.88 * wallOcclusion(x, y, floorWidth, wallHeight));
        this.place(back, paint, 0, floorHeight + wallHeight / 2, -wallDistance).castShadow = false;
        this.encloseRoom(
            floorHeight,
            floorWidth,
            floorDepth,
            floorCenter,
            wallHeight,
            () => paint,
            0.84,
        );

        // Skirting boards along every wall.
        const along = this.keep(new BoxGeometry(floorWidth, 2.4, 0.5));
        const across = this.keep(new BoxGeometry(0.5, 2.4, floorDepth));
        for (const direction of [-1, 1]) {
            const z = direction * wallDistance;
            const x = direction * halfWidth;
            const end = this.wallFixtures({ x: 0, z, nx: 0, nz: -direction });
            const side = this.wallFixtures({ x, z: 0, nx: -direction, nz: 0 });
            end.add(this.place(along, skirting, 0, floorHeight + 1.2, z - direction * 0.25));
            side.add(this.place(across, skirting, x - direction * 0.25, floorHeight + 1.2, 0));
            end.traverse((mesh) => (mesh.castShadow = false));
            side.traverse((mesh) => (mesh.castShadow = false));
        }

        // A row of daylight windows down one side of the hall.
        const pane = this.keep(new PlaneGeometry(44, 56).rotateY(-Math.PI / 2));
        for (let z = -wallDistance + 40; z <= wallDistance - 40; z += 64) {
            this.place(pane, glass, halfWidth - 0.3, floorHeight + 66, z).castShadow = false;
        }

        this.addTournamentTables(
            width,
            depth,
            floorHeight,
            columnStep,
            rowStep,
            halfWidth,
            wallDistance,
            wood,
        );
    }

    /** Neighbouring tournament tables with boards, bowls, clocks and chairs. */
    private addTournamentTables(
        width: number,
        depth: number,
        floorHeight: number,
        columnStep: number,
        rowStep: number,
        halfWidth: number,
        wallDistance: number,
        wood: Texture,
    ): void {
        const tableTop: Placement[] = [];
        const legs: Placement[] = [];
        const boards: Placement[][] = [[], [], []];
        const bowls: Placement[] = [];
        const clocks: Placement[] = [];
        const seats: Placement[] = [];
        const backs: Placement[] = [];
        const chairLegs: Placement[] = [];
        const columns = Math.floor((halfWidth - width / 2 - 12) / columnStep);
        const rows = Math.floor((wallDistance - depth / 2 - 26) / rowStep);
        const legX = width / 2 - tableLegInset;
        const legZ = depth / 2 - tableLegInset;
        const legHeight = -floorHeight - 0.5;
        const seatHeight = floorHeight + 18;
        for (let row = -rows; row <= rows; row++) {
            for (let column = -columns; column <= columns; column++) {
                if (row === 0 && column === 0) {
                    continue;
                }
                const x = column * columnStep;
                const z = row * rowStep;
                const seed = row * 31 + column * 7;
                tableTop.push([x, -0.31, z]);
                for (const dx of [-1, 1]) {
                    for (const dz of [-1, 1]) {
                        legs.push([x + dx * legX, floorHeight + legHeight / 2, z + dz * legZ]);
                    }
                }
                if (noise(seed) > 0.18) {
                    const turn = noise(seed + 1) * 0.12 - 0.06;
                    boards[Math.floor(noise(seed + 2) * 3)].push([x, 0.75, z, turn]);
                    bowls.push([x - 15, 1.6, z + 7], [x - 15, 1.6, z - 7]);
                    clocks.push([x + 15.5, 1.75, z, Math.PI / 2 + turn]);
                }
                for (const side of [-1, 1]) {
                    if (noise(seed + side * 5) < 0.25) {
                        continue;
                    }
                    const cz = z + side * (depth / 2 + 9 + noise(seed + side) * 3);
                    const cx = x + (noise(seed + side * 9) - 0.5) * 4;
                    seats.push([cx, seatHeight, cz]);
                    backs.push([cx, seatHeight + 9, cz + side * 7]);
                    for (const lx of [-6, 6]) {
                        for (const lz of [-6, 6]) {
                            chairLegs.push([cx + lx, floorHeight + 9, cz + lz]);
                        }
                    }
                }
            }
        }

        const table = new MeshStandardMaterial({
            map: wood,
            color: "#d2b48c",
            roughness: 0.7,
            vertexColors: true,
        });
        const metal = new MeshStandardMaterial({
            color: "#5f646b",
            roughness: 0.45,
            metalness: 0.5,
        });
        const boardSide = new MeshStandardMaterial({ color: "#c49a5c", roughness: 0.7 });
        const bowl = new MeshStandardMaterial({ color: "#6a3a22", roughness: 0.45 });
        const clock = new MeshStandardMaterial({ color: "#26282b", roughness: 0.5 });
        const chair = new MeshStandardMaterial({
            color: "#4b5662",
            roughness: 0.75,
            vertexColors: true,
        });
        const seatGeometry = this.keep(new BoxGeometry(15, 1.5, 15, 8, 1, 8));
        // Seats are lit on top and dark underneath, darkest towards the backrest.
        shadeSurface(seatGeometry, (_x, y, z) =>
            y < 0 ? 0.35 : 0.95 - 0.25 * MathUtils.smoothstep(Math.abs(z), 4, 7.5),
        );
        const backGeometry = this.keep(new BoxGeometry(15, 17, 1.4, 6, 12, 1));
        // Backrests darken towards the seat and along their edges.
        shadeSurface(
            backGeometry,
            (x, y) =>
                (0.55 + 0.4 * MathUtils.smoothstep(y, -8.5, 6)) *
                (1 - 0.25 * Math.exp(-(7.5 - Math.abs(x)) / 1.5)),
        );
        this.materials.push(table, metal, boardSide, bowl, clock, chair);

        this.instances(
            shadeSurface(this.keep(new RoundedBoxGeometry(width, 0.62, depth, 2, 0.17)), (_x, y) =>
                y < 0 ? 0.4 : 0.95,
            ),
            table,
            tableTop,
        );
        this.instances(this.keep(new BoxGeometry(1.2, legHeight, 1.2)), metal, legs);
        const boardGeometry = this.keep(new BoxGeometry(21.5, 1.5, 23));
        boards.forEach((placements, variant) => {
            const map = miniBoardTexture(variant + 1);
            this.textures.push(map);
            const top = new MeshStandardMaterial({ map, roughness: 0.6 });
            this.materials.push(top);
            // Box faces: +x, -x, +y (top), -y, +z, -z.
            this.instances(
                boardGeometry,
                [boardSide, boardSide, top, boardSide, boardSide, boardSide],
                placements,
            );
        });
        this.instances(this.keep(new CylinderGeometry(2.6, 2.1, 3.2, 20)), bowl, bowls);
        this.instances(this.keep(new BoxGeometry(9, 3.5, 4.5)), clock, clocks);
        this.instances(seatGeometry, chair, seats);
        this.instances(backGeometry, chair, backs);
        this.instances(this.keep(new BoxGeometry(0.9, 18, 0.9)), metal, chairLegs);
    }

    private instances(
        geometry: BufferGeometry,
        material: MeshStandardMaterial | MeshStandardMaterial[],
        placements: readonly Placement[],
    ): void {
        if (!placements.length) {
            return;
        }
        const mesh = new InstancedMesh(geometry, material, placements.length);
        const transform = new Object3D();
        placements.forEach(([x, y, z, rotation = 0], index) => {
            transform.position.set(x, y, z);
            transform.rotation.set(0, rotation, 0);
            transform.updateMatrix();
            mesh.setMatrixAt(index, transform.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.add(mesh);
    }

    private addTableContacts(
        width: number,
        depth: number,
        ambient: (x: number, z: number) => number,
        ambientInputs: readonly number[],
    ): void {
        // Keep the contact layer inside the flat part of the table's bevel.
        const inset = 0.34;
        const map = contactTexture(width - inset, depth - inset, ambient, ambientInputs);
        this.textures.push(map);
        const material = new MeshBasicMaterial({ map, transparent: true, depthWrite: false });
        this.materials.push(material);
        const plane = this.keep(
            new PlaneGeometry(width - inset, depth - inset).rotateX(-Math.PI / 2),
        );
        const contacts = new Mesh(plane, material);
        contacts.position.y = 0.006;
        this.add(contacts);
    }

    private addTable(width: number, depth: number, floorHeight: number, wood: Texture): void {
        const table = new MeshStandardMaterial({ map: wood, color: "#825d49", roughness: 0.76 });
        this.materials.push(table);
        this.place(
            this.keep(new RoundedBoxGeometry(width, 0.62, depth, 2, 0.17)),
            table,
            0,
            -0.31,
            0,
        );
        const railHeight = 0.97;
        const longRail = this.keep(new RoundedBoxGeometry(width - 1.6, railHeight, 0.38, 2, 0.08));
        const endRail = this.keep(new RoundedBoxGeometry(0.38, railHeight, depth - 1.6, 2, 0.08));
        for (const side of [-1, 1]) {
            this.place(longRail, table, 0, -1.05, side * (depth / 2 - tableLegInset));
            this.place(endRail, table, side * (width / 2 - tableLegInset), -1.05, 0);
        }
        const legHeight = -floorHeight - 0.5;
        const leg = this.keep(new RoundedBoxGeometry(1.42, legHeight, 1.42, 2, 0.1));
        for (const dx of [-1, 1]) {
            for (const dz of [-1, 1]) {
                this.place(
                    leg,
                    table,
                    dx * (width / 2 - tableLegInset),
                    floorHeight + legHeight / 2,
                    dz * (depth / 2 - tableLegInset),
                );
            }
        }
    }

    public updateClock(clock: JGOFClock | null): string | undefined {
        return this.clock?.update(clock);
    }

    public updateCaptures(black: number, white: number): string {
        this.lids[0].count = Math.min(black, lidStonePile.length);
        this.lids[1].count = Math.min(white, lidStonePile.length);
        this.lidShadows[0].count = this.lids[0].count;
        this.lidShadows[1].count = this.lids[1].count;
        return this.lids.map((lid) => lid.count).join(",");
    }

    /** Take one stone from a player's bowl for each stone they have played. */
    public updateBowls(black: number, white: number): string {
        [black, white].forEach((played, i) => {
            const count = Math.max(0, bowlStonePile.length - played);
            if (count !== this.bowls[i].count) {
                this.bowls[i].count = count;
                this.shadeBowl(this.bowlVessels[i], count / bowlStonePile.length);
            }
        });
        return this.bowls.map((bowl) => bowl.count).join(",");
    }

    /** The cavity's occlusion scales with how full the bowl is, down to a 10% baseline. */
    private shadeBowl(geometry: BufferGeometry, fill: number): void {
        const strength = 0.1 + 0.9 * fill;
        let colors = geometry.getAttribute("color");
        if (!colors) {
            colors = new Float32BufferAttribute(this.bowlLight.length * 3, 3);
            geometry.setAttribute("color", colors);
        }
        this.bowlLight.forEach((light, i) => {
            const value = light - this.bowlOcclusion[i] * strength;
            colors.setXYZ(i, value, value, value);
        });
        colors.needsUpdate = true;
    }

    /**
     * A soft shadow disk under each stone of a pile, in the same instance order so a shared
     * count shows the right ones.
     */
    private contactShadows(
        x: number,
        y: number,
        z: number,
        positions: readonly (readonly number[])[],
    ): InstancedMesh {
        const map = contactShadowTexture();
        this.textures.push(map);
        const material = new MeshBasicMaterial({
            map,
            transparent: true,
            depthWrite: false,
            opacity: 0.7,
        });
        this.materials.push(material);
        const disk = this.keep(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
        const mesh = new InstancedMesh(disk, material, positions.length);
        const transform = new Object3D();
        transform.scale.setScalar(1.3);
        positions.forEach(([dx, dy, dz], index) => {
            transform.position.set(x + dx, y + dy + 0.02, z + dz);
            transform.updateMatrix();
            mesh.setMatrixAt(index, transform.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.renderOrder = 1;
        this.add(mesh);
        return mesh;
    }

    private pile(
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
        x: number,
        y: number,
        z: number,
        positions: readonly (readonly number[])[],
    ): InstancedMesh {
        const pile = new InstancedMesh(geometry, material, positions.length);
        const stone = new Object3D();
        pile.frustumCulled = false;
        pile.castShadow = pile.receiveShadow = true;
        positions.forEach(([dx, dy, dz, qx, qy, qz, qw], index) => {
            stone.position.set(x + dx, y + dy, z + dz);
            stone.quaternion.set(qx, qy, qz, qw);
            stone.updateMatrix();
            pile.setMatrixAt(index, stone.matrix);
        });
        pile.instanceMatrix.needsUpdate = true;
        this.add(pile);
        return pile;
    }

    private vessel(
        radius: number,
        profile: ReadonlyArray<readonly [number, number]>,
        heightScale = 1,
    ) {
        return this.keep(
            new LatheGeometry(
                profile.map(([r, h]) => new Vector2(r * radius, h * radius * heightScale)),
                32,
            ),
        );
    }

    private keep<T extends BufferGeometry>(geometry: T): T {
        this.geometries.push(geometry);
        return geometry;
    }

    private place(
        geometry: BufferGeometry,
        material: MeshStandardMaterial | MeshBasicMaterial,
        x: number,
        y: number,
        z: number,
    ): Mesh {
        const mesh = new Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.castShadow = mesh.receiveShadow = true;
        this.add(mesh);
        return mesh;
    }

    public dispose(): void {
        for (const child of this.children) {
            if (child instanceof InstancedMesh) {
                child.dispose();
            }
        }
        for (const geometry of this.geometries) {
            geometry.dispose();
        }
        for (const material of this.materials) {
            material.dispose();
        }
        for (const texture of this.textures) {
            texture.dispose();
        }
        this.clock?.dispose();
        this.removeFromParent();
    }
}
