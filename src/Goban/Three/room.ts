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
    type BufferGeometry,
    type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ThreeBoardStyle } from "../ThreeConfig";
import {
    bowlHeightRatio,
    crownHeight,
    floorBoardFeet,
    roomLayout,
    type Bounds,
} from "./projection";

/** Stones stack at their own thickness; the pile layouts were tuned for 0.25-high stones. */
const stackScale = crownHeight / 0.25;
import type { JGOFClock } from "../../engine";
import { RoomClock } from "./roomClock";
import {
    contactTexture,
    latticeTexture,
    shojiTexture,
    tatamiTexture,
    tileTexture,
} from "./roomTextures";

// At the scale of a full-size goban, 34 units is about 74 cm.
const tableHeight = 34;
const tableLegInset = 0.8;
const bowlFootRatio = 0.44;
const lidFootRatio = 0.51;

function pilePositions(
    rings: readonly (readonly [number, number, number])[],
    rotation = 0,
): number[][] {
    const positions = [[0, 0, 0]];
    for (const [count, radius, lift] of rings) {
        for (let i = 0; i < count; i++) {
            const angle = rotation + ((i + (lift ? 0.5 : 0)) * Math.PI * 2) / count;
            positions.push([radius * Math.cos(angle), lift, radius * Math.sin(angle)]);
        }
    }
    return positions;
}

const capturePile = pilePositions([
    [7, 0.61, 0],
    [5, 0.41, 0.21 * stackScale],
]);
// Stagger the layers so the gaps between stones reveal more stones below.
const bowlLayers = [
    [
        [6, 0.24],
        [10, 0.46],
    ],
    [
        [6, 0.26],
        [13, 0.54],
    ],
    [
        [6, 0.26],
        [15, 0.59],
    ],
    [
        [6, 0.25],
        [8, 0.45],
        [11, 0.64],
    ],
    [
        [6, 0.25],
        [9, 0.47],
        [14, 0.69],
    ],
    [
        [6, 0.26],
        [11, 0.51],
        [15, 0.72],
    ],
    [
        [6, 0.25],
        [11, 0.5],
        [15, 0.72],
    ],
];
// Thicker stones need fewer layers to fill the bowl to the same height.
const bowlLayerCount = Math.floor((bowlLayers.length - 1) / stackScale) + 1;
const bowlPile = bowlLayers.slice(0, bowlLayerCount).flatMap((rings, layer) =>
    pilePositions(
        rings.map(([count, radius]) => [count, radius, 0]),
        layer * 0.71,
    ).map(([x, y, z], index) => [
        x,
        y + (layer * 0.273 + 0.022 * Math.sin(index * 2.4)) * stackScale,
        z,
    ]),
);

function rectangleDistance(x: number, z: number, width: number, depth: number): number {
    const dx = Math.abs(x) - width / 2;
    const dz = Math.abs(z) - depth / 2;
    return Math.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(0, Math.max(dx, dz));
}

function shadeSurface(
    geometry: BufferGeometry,
    illumination: (x: number, y: number, z: number) => number,
): void {
    const positions = geometry.getAttribute("position");
    const colors: number[] = [];
    for (let i = 0; i < positions.count; i++) {
        const light = illumination(positions.getX(i), positions.getY(i), positions.getZ(i));
        colors.push(light, light, light);
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
}

export class RoomScene extends Group {
    public readonly shadowExtent: number;
    public readonly shadowDepth: number;
    private readonly clock?: RoomClock;
    private readonly geometries: BufferGeometry[] = [];
    private readonly materials: (MeshStandardMaterial | MeshBasicMaterial)[];
    private readonly lids: InstancedMesh[] = [];
    private readonly textures: Texture[] = [];

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
            this.addTatamiRoom(furnitureWidth, furnitureDepth, width, depth, vesselAmbient);
        } else {
            this.addScholarRoom(furnitureWidth, furnitureDepth, wood);
            this.addTableContacts(furnitureWidth, furnitureDepth, (x, z) => {
                const edge = rectangleDistance(x, z, width, depth);
                const board = 0.18 + 0.82 * MathUtils.smoothstep(edge, -0.24, 0.72);
                return Math.min(board, vesselAmbient(x, z));
            });
            this.clock = new RoomClock(-side);
            this.add(this.clock);
        }

        const bowl = this.vessel(
            radius,
            [
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
            ],
            bowlHeightRatio / 0.78,
        );
        const lid = this.vessel(radius, [
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
        ]);
        // Outside, light grows towards the rim. Inside, a static occlusion gradient darkens the
        // wall with depth below the rim, so the bowl reads as a deep cavity.
        const bowlProfileLength = 14;
        const bowlInnerStart = 8;
        const rimHeight = 0.78 * radius * (bowlHeightRatio / 0.78);
        const innerFloor = 0.25 * radius * (bowlHeightRatio / 0.78);
        const bowlPositions = bowl.getAttribute("position");
        const bowlColors: number[] = [];
        for (let i = 0; i < bowlPositions.count; i++) {
            const y = bowlPositions.getY(i);
            const outer = 0.5 + 0.5 * MathUtils.smoothstep(y, radius * 0.12, radius * 0.94);
            const depth = (rimHeight - y) / (rimHeight - innerFloor);
            const light =
                i % bowlProfileLength >= bowlInnerStart
                    ? 0.95 - 0.9 * MathUtils.smoothstep(depth, 0.02, 0.85)
                    : outer;
            bowlColors.push(light, light, light);
        }
        bowl.setAttribute("color", new Float32BufferAttribute(bowlColors, 3));
        shadeSurface(
            lid,
            (_x, y) => 0.61 + 0.39 * MathUtils.smoothstep(y, radius * 0.07, radius * 0.29),
        );
        for (const color of [0, 1] as const) {
            const direction = color === 0 ? 1 : -1;
            const bowlX = direction * side;
            const bowlZ = direction * separation;
            this.place(bowl, vessels, bowlX, 0, bowlZ);
            this.place(lid, vessels, bowlX, 0, -bowlZ);
            this.pile(bowlStones, materials[color], bowlX, 0.48 * radius, bowlZ, radius, bowlPile);
            const captures = this.pile(
                stones,
                materials[color === 0 ? 1 : 0],
                bowlX,
                0.165 * radius,
                -bowlZ,
                1.65,
                capturePile,
            );
            captures.count = 0;
            this.lids.push(captures);
        }
    }

    private addTatamiRoom(
        furnitureWidth: number,
        furnitureDepth: number,
        boardWidth: number,
        boardDepth: number,
        vesselAmbient: (x: number, z: number) => number,
    ): void {
        const span = Math.max(boardWidth, boardDepth);
        // A 90 cm mat spans roughly twice a full-size goban across its short side.
        const matSpan = 3 * 40;
        const wallDistance = boardDepth / 2 + Math.max(boardDepth * 0.85, 8);
        const floorWidth = furnitureWidth * 3;
        const frontDepth = furnitureDepth * 1.6;
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
            const wallContact = 1 - 0.43 * Math.exp(-(roomZ + wallDistance) / 1.8);
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
            return 0.85 * falloff * (1 - 0.64 * Math.exp(-distanceFromFloor / 2.4));
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
    ): void {
        const shade = (_x: number, y: number) =>
            0.62 * (1 - 0.55 * Math.exp(-(y + wallHeight / 2) / 2.4));
        const wall = (span: number) => {
            const geometry = this.keep(new PlaneGeometry(span, wallHeight, 8, 48));
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

    private addScholarRoom(width: number, depth: number, wood: Texture): void {
        const floorHeight = -tableHeight;
        this.addTable(width, depth, floorHeight, wood);
        const wallDistance = depth / 2 + 30;
        const floorWidth = width * 3;
        const frontDepth = depth * 1.8 + tableHeight * 0.68;
        const floorDepth = frontDepth + wallDistance;
        const floorCenter = (frontDepth - wallDistance) / 2;
        const tile = tileTexture(floorWidth / 44, floorDepth / 44);
        tile.offset.y -= floorCenter / 44;
        const lattice = latticeTexture();
        this.textures.push(tile, lattice);
        const floor = new MeshStandardMaterial({ map: tile, roughness: 0.86, vertexColors: true });
        const plaster = new MeshStandardMaterial({
            color: "#c5bba6",
            roughness: 1,
            vertexColors: true,
        });
        const trim = new MeshStandardMaterial({ color: "#50392e", roughness: 0.81, map: wood });
        const panel = new MeshStandardMaterial({ map: lattice, roughness: 0.92 });
        this.materials.push(floor, plaster, trim, panel);

        const slab = this.keep(
            new PlaneGeometry(floorWidth, floorDepth, 76, 82).rotateX(-Math.PI / 2),
        );
        shadeSurface(slab, (x, _y, z) => {
            const roomZ = z + floorCenter;
            const lateral = x / width + 0.36;
            const forward = roomZ / depth + 0.13;
            const footDistance = Math.hypot(
                Math.abs(x) - (width / 2 - tableLegInset),
                Math.abs(roomZ) - (depth / 2 - tableLegInset),
            );
            const footAmbient = 0.3 + 0.7 * MathUtils.smoothstep(footDistance, 0.4, 2.1);
            const edge = rectangleDistance(x, roomZ, width, depth);
            const tableAmbient = 0.73 + 0.27 * MathUtils.smoothstep(edge, -4, 7);
            return (
                Math.min(footAmbient, tableAmbient) *
                ((0.56 + 0.39 * Math.exp(-2 * (lateral * lateral + forward * forward))) *
                    (1 - 0.36 * Math.exp(-(roomZ + wallDistance) / 2.2)))
            );
        });
        this.place(slab, floor, 0, floorHeight, floorCenter).castShadow = false;

        const wallHeight = 106;
        const wall = this.keep(new PlaneGeometry(floorWidth, wallHeight, 24, 24));
        shadeSurface(wall, (x, y) => {
            const lateral = x / width + 0.48;
            const clearance = y + wallHeight / 2;
            return (
                (0.48 + 0.32 * Math.exp(-1.5 * lateral * lateral)) *
                (1 - 0.45 * Math.exp(-clearance / 2.4))
            );
        });
        this.place(wall, plaster, 0, floorHeight + wallHeight / 2, -wallDistance).castShadow =
            false;
        this.encloseRoom(
            floorHeight,
            floorWidth,
            floorDepth,
            floorCenter,
            wallHeight,
            () => plaster,
        );
        this.place(
            this.keep(new BoxGeometry(floorWidth, 1.15, 0.28)),
            trim,
            0,
            floorHeight + 0.575,
            -wallDistance + 0.14,
        ).castShadow = false;
        const panelWidth = 26;
        const panelHeight = 21;
        const panelX = width * 0.22;
        const panelY = floorHeight + 13 + panelHeight / 2;
        const frame = this.keep(
            new RoundedBoxGeometry(panelWidth + 0.95, panelHeight + 0.95, 0.58, 2, 0.14),
        );
        this.place(frame, trim, panelX, panelY, -wallDistance + 0.2).castShadow = false;
        this.place(
            this.keep(new PlaneGeometry(panelWidth, panelHeight)),
            panel,
            panelX,
            panelY,
            -wallDistance + 0.51,
        ).castShadow = false;
    }

    private addTableContacts(
        width: number,
        depth: number,
        ambient: (x: number, z: number) => number,
    ): void {
        // Keep the contact layer inside the flat part of the table's bevel.
        const inset = 0.34;
        const map = contactTexture(width - inset, depth - inset, ambient);
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
        this.lids[0].count = Math.min(black, capturePile.length);
        this.lids[1].count = Math.min(white, capturePile.length);
        return this.lids.map((lid) => lid.count).join(",");
    }

    private pile(
        geometry: BufferGeometry,
        material: MeshStandardMaterial,
        x: number,
        y: number,
        z: number,
        radius: number,
        positions: readonly (readonly number[])[],
    ): InstancedMesh {
        const pile = new InstancedMesh(geometry, material, positions.length);
        const stone = new Object3D();
        pile.frustumCulled = false;
        pile.castShadow = pile.receiveShadow = true;
        positions.forEach(([dx, lift, dz], index) => {
            stone.position.set(x + dx * radius, y + lift, z + dz * radius);
            stone.rotation.set(index % 3 === 0 ? 0.12 : 0, index * 2.4, index % 2 ? 0.06 : 0);
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
        material: MeshStandardMaterial,
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
