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
    AmbientLight,
    BufferAttribute,
    type BufferGeometry,
    CanvasTexture,
    CircleGeometry,
    Color,
    DirectionalLight,
    Group,
    InstancedMesh,
    LatheGeometry,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PlaneGeometry,
    Scene,
    SRGBColorSpace,
    TextureLoader,
    type Texture,
    Vector2,
    Vector3,
    WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { JGOFClock } from "../../engine";
import type { NativeOverlay } from "../NativeTransport";
import type { ThreeBoardStyle } from "../ThreeConfig";
import {
    boardDimensions,
    contains,
    crownHeight,
    floorBoardFeet,
    stoneBase,
    stoneRadius,
    type Bounds,
    type Point,
} from "./projection";
import type { BoardProjection } from "./projection";

import { lightingPresets, type LightingPreferences } from "./lighting";
import type { Appearance } from "./appearance";
import { RoomScene } from "./room";

const initialCapacity = 25 * 25;

function woodTexture(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas 2D unavailable");
    }
    const image = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const u = x / canvas.width;
            const v = y / canvas.height;
            const bend = v + 0.011 * Math.sin(9 * u + 5 * v) + 0.006 * Math.cos(18 * u - 13 * v);
            const grain =
                Math.sin(240 * bend + 2 * Math.sin(57 * bend)) +
                0.65 * Math.sin(660 * bend + 4 * Math.sin(31 * v + u)) +
                1.3 * Math.sin(35 * bend) +
                0.18 * Math.sin(1759 * bend + 8 * u);
            const bands = Math.cos(20 * v + 1.2 * Math.sin(4 * u)) + 0.7 * Math.sin(5.7 * v + u);
            const offset = (y * canvas.width + x) * 4;
            image.data[offset] = 199 + 4 * grain + 5 * bands;
            image.data[offset + 1] = 151 + 5 * grain + 8 * bands;
            image.data[offset + 2] = 94 + 4 * grain + 7 * bands;
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function shadowTexture(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas 2D unavailable");
    }
    const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
    // A dense core where the stone meets the wood keeps it from looking like it floats.
    gradient.addColorStop(0, "rgba(255,255,255,0.86)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.7)");
    gradient.addColorStop(0.66, "rgba(255,255,255,0.47)");
    gradient.addColorStop(0.84, "rgba(255,255,255,0.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

/** Faces on a floor goban foot's top block, and lobes on its bulb: eight, for luck. */
const footSides = 8;

/**
 * Side profile of a floor goban's foot, traced from photos of loose kaya legs: a lobed bulb
 * on the floor, a narrow waist, and an octagonal block under the board whose underside curves
 * in to the waist. Radii are relative to the widest point, heights to the leg height.
 */
const footProfile = [
    [0, 0],
    [0.72, 0],
    [0.88, 0.03],
    [0.97, 0.1],
    [1, 0.2],
    [0.95, 0.31],
    [0.8, 0.4],
    [0.6, 0.47],
    [0.5, 0.52],
    [0.52, 0.57],
    [0.64, 0.62],
    [0.82, 0.66],
    [0.95, 0.71],
    [1, 0.78],
    [1, 0.94],
    [0.97, 1],
    [0, 1],
];

/** How strongly the bulb's lobes show at relative height `h`: on the bulb, not the waist. */
function footLobeWeight(h: number): number {
    return MathUtils.smoothstep(h, 0, 0.08) * (1 - MathUtils.smoothstep(h, 0.4, 0.5));
}

/** How octagonal the foot is at relative height `h`: the block under the board. */
function footBlockWeight(h: number): number {
    return MathUtils.smoothstep(h, 0.6, 0.7);
}

/** 0 at a lobe's crest, 1 at the bottom of the groove between two lobes. */
function footGroove(angle: number): number {
    return (1 - Math.abs(Math.cos((footSides / 2) * angle))) ** 1.5;
}

/** Radius of a regular octagon relative to its corners; faces centred on the lobes. */
function footOctagon(angle: number): number {
    const step = (Math.PI * 2) / footSides;
    const offset = angle - step * Math.round(angle / step);
    return Math.cos(step / 2) / Math.cos(offset);
}

/**
 * A floor goban's foot: the traced profile turned on a lathe, then pressed into lobes with
 * concave grooves on the bulb and into an octagon on the block. A face points along each diagonal.
 */
function footGeometry(radius: number, legHeight: number): LatheGeometry {
    const profile = footProfile.map(([r, h]) => new Vector2(r * radius, h * legHeight));
    const segments = 64;
    const geometry = new LatheGeometry(profile, segments);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const h = positions.getY(i) / legHeight;
        const angle = Math.atan2(x, z);
        const lobes = 1 - 0.22 * footLobeWeight(h) * footGroove(angle);
        // Octagon faces dish in slightly, like the carved blocks in photos.
        const dished = footOctagon(angle) * (1 - 0.04 * (1 - footGroove(angle)));
        const block = MathUtils.lerp(1, dished, footBlockWeight(h));
        const scale = lobes * block;
        positions.setXYZ(i, x * scale, positions.getY(i), z * scale);
    }
    geometry.computeVertexNormals();
    // The lathe repeats its first column as its last; share their normals so no seam shows.
    const normals = geometry.getAttribute("normal");
    const rows = profile.length;
    for (let i = 0; i < rows; i++) {
        const last = segments * rows + i;
        const n = new Vector3()
            .fromBufferAttribute(normals, i)
            .add(new Vector3().fromBufferAttribute(normals, last))
            .normalize();
        normals.setXYZ(i, n.x, n.y, n.z);
        normals.setXYZ(last, n.x, n.y, n.z);
    }
    return geometry;
}

/**
 * Bakes occlusion into a floor goban's foot. The side facing out from under the board still
 * catches light; it darkens where the foot meets the board and the floor, on the side facing
 * in under the board, under the block's overhang and in the grooves between lobes.
 * `dx`/`dz` give the corner.
 */
function shadeFoot(geometry: BufferGeometry, legHeight: number, dx: number, dz: number): void {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const radial = Math.hypot(x, z);
        // 1 on the side facing out from under the board, 0 facing its centre.
        const outward = radial > 1e-6 ? 0.5 + (0.5 * (x * dx + z * dz)) / (radial * Math.SQRT2) : 0;
        const underBoard = 1 - 0.55 * Math.exp(-(legHeight - y) / (0.18 * legHeight));
        const onFloor = 1 - 0.5 * Math.exp(-y / (0.22 * legHeight));
        const groove = radial > 1e-6 ? footGroove(Math.atan2(x, z)) : 0;
        const inGroove = 1 - 0.32 * footLobeWeight(y / legHeight) * groove;
        const overhang = 1 - 0.35 * Math.max(0, -normals.getY(i));
        const light = (0.6 + 0.25 * outward) * underBoard * onFloor * inGroove * overhang;
        colors.fill(light, i * 3, i * 3 + 3);
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

/** Bakes floor contact occlusion into vertex colours; `floorOffset` lifts local y to height above the floor. */
function occludeNearFloor(
    geometry: BufferGeometry,
    floorOffset: number,
    strength: number,
    falloff: number,
): void {
    const positions = geometry.getAttribute("position");
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
        const height = Math.max(0, positions.getY(i) + floorOffset);
        colors.fill(1 - strength * Math.exp(-height / falloff), i * 3, i * 3 + 3);
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

function stoneGeometry(sides = 32, steps = 20): LatheGeometry {
    const profile: Vector2[] = [];
    for (let n = 0; n <= steps; n++) {
        const theta = (n * Math.PI) / steps;
        profile.push(
            new Vector2(
                stoneRadius * Math.sin(theta),
                stoneBase + ((crownHeight - stoneBase) * (1 - Math.cos(theta))) / 2,
            ),
        );
    }
    return new LatheGeometry(profile, sides);
}

interface Stone {
    point: Point;
    color: 1 | 2;
    alpha: number;
}

export class BoardScene {
    public readonly renderer: WebGLRenderer;
    private readonly scene = new Scene();
    private room?: RoomScene;
    public readonly annotations = new Group();
    private readonly geometry = stoneGeometry();
    private readonly wood = woodTexture();
    private readonly ambient = new AmbientLight();
    private readonly key = new DirectionalLight();
    private readonly keyOffset = new Vector3();
    private readonly fillLight = new DirectionalLight();
    private readonly surfaceMaterial = new MeshStandardMaterial({
        map: this.wood,
        roughness: 0.72,
    });
    private readonly edgeMaterial = new MeshStandardMaterial({
        map: this.wood,
        color: "#9b785e",
        roughness: 0.76,
        vertexColors: true,
    });
    private boardTexture?: Texture;
    private textureUrl = "";
    private textureRevision = 0;
    private textureFailure = false;
    private appearance?: Appearance;
    private stoneScale = 1;
    private shadowPoints: Point[] = [];
    private shadowStrength = 0.8;
    private shadowOffset = { x: 0.07, y: 0.08 };
    private readonly shadowMap = shadowTexture();
    private readonly plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    private readonly disk = new CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    private readonly transform = new Object3D();
    private readonly renderSize = new Vector2();
    /** Everything placed in board coordinates; mirrored as a whole for a left-right flip. */
    private readonly boardSpace = new Group();
    private readonly board = new Group();
    private readonly grid = new Group();
    private readonly effects = new Group();
    private readonly materials = [
        new MeshStandardMaterial({ color: "#222427", roughness: 0.28, metalness: 0.04 }),
        new MeshStandardMaterial({ color: "#ded6c4", roughness: 0.33 }),
    ] as const;
    private readonly stones = this.materials.map(
        (material) => new InstancedMesh(this.geometry, material, initialCapacity),
    );
    private readonly ghostMaterials = this.materials.map((material) => {
        const ghost = material.clone();
        ghost.transparent = true;
        ghost.depthWrite = false;
        ghost.opacity = 0.55;
        return ghost;
    });
    private readonly hover = new Mesh(this.geometry, this.ghostMaterials[0]);
    private readonly translucent = new Group();
    private readonly shadowMaterial = new MeshBasicMaterial({
        map: this.shadowMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
    });
    private readonly shadows = new InstancedMesh(this.plane, this.shadowMaterial, initialCapacity);

    public constructor(public readonly canvas: HTMLCanvasElement) {
        const context = canvas.getContext("webgl2", { antialias: true, alpha: true });
        if (!context) {
            throw new Error("WebGL 2 unavailable");
        }
        let renderer: WebGLRenderer | undefined;
        try {
            this.renderer = renderer = new WebGLRenderer({
                canvas,
                context,
                antialias: true,
                alpha: true,
            });
            this.renderer.outputColorSpace = SRGBColorSpace;
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.shadowMap.autoUpdate = false;
            this.key.shadow.mapSize.setScalar(1024);
            this.key.shadow.radius = 8;
            this.key.shadow.bias = -0.00015;
            this.key.shadow.normalBias = 0.025;
            this.scene.add(
                this.ambient,
                this.key,
                this.key.target,
                this.fillLight,
                this.boardSpace,
            );
            this.boardSpace.add(
                this.board,
                this.grid,
                this.effects,
                this.annotations,
                this.shadows,
                ...this.stones,
                this.translucent,
                this.hover,
            );
            this.hover.visible = false;
            this.hover.renderOrder = 5;
            for (const batch of [...this.stones, this.shadows]) {
                batch.count = 0;
                batch.frustumCulled = false;
            }
        } catch (error) {
            try {
                renderer?.dispose();
            } finally {
                context.getExtension("WEBGL_lose_context")?.loseContext();
            }
            throw error;
        }
    }

    public setLighting(settings: LightingPreferences): void {
        const preset = lightingPresets[settings.preset];
        const azimuth = (settings.azimuth * Math.PI) / 180;
        const radius = settings.preset === "directional" ? 11 : 7;
        this.ambient.color.set("#fffdf8");
        this.ambient.intensity = preset.ambient * settings.intensity;
        this.key.color.set(preset.tint);
        this.key.intensity = preset.key * settings.intensity;
        this.keyOffset.set(radius * Math.cos(azimuth), 12, radius * Math.sin(azimuth));
        this.key.shadow.intensity = Math.min(1, preset.shadow * 1.32);
        this.positionKeyLight();
        this.fillLight.color.set("#e3ecff");
        this.fillLight.intensity = preset.fill * settings.intensity;
        this.fillLight.position.set(-this.keyOffset.x, 7, -this.keyOffset.z);
        const shift = settings.preset === "directional" ? 0.15 : 0.095;
        this.shadowOffset = { x: -Math.cos(azimuth) * shift, y: -Math.sin(azimuth) * shift };
        this.shadowStrength = preset.shadow * Math.min(1, settings.intensity);
        this.updateShadows();
    }

    private positionKeyLight(): void {
        const room = this.room;
        this.key.target.position.copy(room?.position ?? this.scene.position);
        this.key.position.copy(this.keyOffset).multiplyScalar(room ? 2.5 : 1);
        this.key.position.add(this.key.target.position);
        this.renderer.shadowMap.needsUpdate = !!room;
    }

    public applyTheme(appearance: Appearance, ready: () => void): void {
        this.appearance = appearance;
        this.stoneScale = appearance.scale;
        for (const [index, stone] of appearance.stones.entries()) {
            for (const material of [this.materials[index], this.ghostMaterials[index]]) {
                material.color.set(stone.color);
                material.roughness = stone.roughness;
            }
        }
        this.hover.scale.set(this.stoneScale, 1, this.stoneScale);
        this.surfaceMaterial.roughness = appearance.board.roughness;
        this.edgeMaterial.roughness = appearance.board.roughness;
        const url = appearance.board.url;
        if (url !== this.textureUrl) {
            this.textureUrl = url;
            this.textureFailure = false;
            const revision = ++this.textureRevision;
            this.boardTexture?.dispose();
            this.boardTexture = undefined;
            if (url) {
                new TextureLoader().setCrossOrigin("anonymous").load(
                    url,
                    (texture) => {
                        if (revision !== this.textureRevision) {
                            texture.dispose();
                            return;
                        }
                        texture.colorSpace = SRGBColorSpace;
                        texture.anisotropy = Math.min(
                            8,
                            this.renderer.capabilities.getMaxAnisotropy(),
                        );
                        this.boardTexture = texture;
                        this.applyBoardSurface();
                        ready();
                    },
                    undefined,
                    () => {
                        if (revision === this.textureRevision) {
                            this.textureFailure = true;
                            this.applyBoardSurface();
                            ready();
                        }
                    },
                );
            }
        }
        this.applyBoardSurface();
        this.shadowMaterial.color.set(appearance.board.shadow);
        this.updateShadows();
    }

    private applyBoardSurface(): void {
        const board = this.appearance?.board;
        if (!board) {
            return;
        }
        const map = this.boardTexture ?? (this.textureUrl.endsWith("/kaya.jpg") ? this.wood : null);
        for (const material of [this.surfaceMaterial, this.edgeMaterial]) {
            const hadMap = !!material.map;
            material.map = map;
            material.color.set(map ? "#ffffff" : board.color);
            if (material === this.edgeMaterial) {
                material.color.multiplyScalar(0.68);
            }
            if (hadMap !== !!map) {
                material.needsUpdate = true;
            }
        }
        this.canvas.dataset.boardTexture = this.boardTexture
            ? "ready"
            : this.textureFailure
              ? "fallback"
              : this.textureUrl
                ? "loading"
                : "color";
    }

    private updateShadows(): void {
        const style = this.appearance?.shadow ?? "default";
        const strength = {
            none: 0,
            low: 0.33,
            mid: 0.68,
            high: 1.4,
            default: 1.15,
            custom: 1,
            anime: 0.78,
        }[style];
        // Preserve the original Studio default even when the key light grows stronger.
        const opacityLimit = style === "default" ? 1.15 * lightingPresets.studio.shadow : 1;
        this.shadowMaterial.opacity = Math.min(opacityLimit, strength * this.shadowStrength);
        this.shadows.visible = strength > 0;
        const spread = style === "high" ? 1.3 : 1;
        this.canvas.dataset.shadowOpacity = String(this.shadowMaterial.opacity);
        this.canvas.dataset.shadowSpread = String(spread);
        this.shadowPoints.forEach((point, index) => {
            this.shadows.setMatrixAt(
                index,
                this.matrix(
                    point.x + this.shadowOffset.x,
                    0.01,
                    point.y + this.shadowOffset.y,
                    1.26 * this.stoneScale * spread,
                    1.14 * this.stoneScale * spread,
                ).matrix,
            );
        });
        this.shadows.instanceMatrix.needsUpdate = true;
    }

    public resize(width: number, height: number, dpr: number): void {
        const previous = this.renderer.getSize(this.renderSize);
        if (
            this.renderer.getPixelRatio() === dpr &&
            previous.x === width &&
            previous.y === height
        ) {
            return;
        }
        this.renderer.setDrawingBufferSize(width, height, dpr);
    }

    public rebuild(bounds: Bounds, style: ThreeBoardStyle, showRoom: boolean): void {
        this.room?.dispose();
        delete this.canvas.dataset.lidStones;
        delete this.canvas.dataset.roomClock;
        this.room = showRoom
            ? new RoomScene(
                  bounds,
                  style,
                  this.wood,
                  this.geometry,
                  stoneGeometry(20, 9),
                  this.materials,
              )
            : undefined;
        if (this.room) {
            this.scene.add(this.room);
            const camera = this.key.shadow.camera;
            const extent = this.room.shadowExtent;
            camera.left = camera.bottom = -extent;
            camera.right = camera.top = extent;
            camera.far = this.room.shadowDepth;
            camera.updateProjectionMatrix();
        } else if (this.key.shadow.map) {
            this.key.shadow.dispose();
            this.key.shadow.map = null;
        }
        this.key.castShadow = this.renderer.shadowMap.enabled = showRoom;
        this.positionKeyLight();
        for (const old of [...this.board.children]) {
            if (old instanceof Mesh) {
                old.geometry.dispose();
            }
            this.board.remove(old);
        }
        const { width, depth, thickness, legHeight } = boardDimensions(bounds, style);
        const slab = new Mesh(
            new RoundedBoxGeometry(width, thickness, depth, 2, 0.055),
            this.edgeMaterial,
        );
        const surface = new Mesh(
            new PlaneGeometry(width - 0.108, depth - 0.108).rotateX(-Math.PI / 2),
            this.surfaceMaterial,
        );
        const x = (bounds.left + bounds.right) / 2;
        const y = (bounds.top + bounds.bottom) / 2;
        slab.position.set(x, -thickness / 2 - 0.003, y);
        surface.position.set(x, 0, y);
        slab.castShadow = slab.receiveShadow = showRoom;
        this.board.add(slab, surface);
        // Ambient occlusion: a floor goban's sides darken towards the shadowed gap above the floor.
        occludeNearFloor(slab.geometry, thickness / 2, legHeight ? 0.5 : 0, thickness * 0.4);
        if (!legHeight) {
            return;
        }
        const feet = floorBoardFeet(width, depth);
        for (const dx of [-1, 1]) {
            for (const dz of [-1, 1]) {
                const geometry = footGeometry(feet.radius, legHeight);
                shadeFoot(geometry, legHeight, dx, dz);
                const foot = new Mesh(geometry, this.edgeMaterial);
                foot.position.set(x + dx * feet.x, -thickness - legHeight - 0.003, y + dz * feet.z);
                foot.castShadow = foot.receiveShadow = showRoom;
                this.board.add(foot);
            }
        }
    }

    /** Reflect the board group across x = mirrorX / 2 (the board's vertical centre line). */
    public setMirror(mirror: boolean, mirrorX: number): void {
        this.boardSpace.scale.x = mirror ? -1 : 1;
        this.boardSpace.position.x = mirror ? mirrorX : 0;
        this.renderer.shadowMap.needsUpdate = true;
    }

    public update(
        bounds: Bounds,
        size: number,
        overlays: NativeOverlay[],
        readStone: (point: Point) => 0 | 1 | 2,
        height = size,
    ): void {
        this.clear(this.grid);
        this.clear(this.effects);
        this.clear(this.translucent);
        const byPoint = new Map(overlays.map((overlay) => [overlay.y * size + overlay.x, overlay]));
        const stones: Stone[] = [];
        const lineCells: Object3D[][] = [[], []];
        const dotCells: Point[] = [];
        const hoshi =
            size !== height
                ? []
                : size === 19
                  ? [3, 9, 15]
                  : size === 13
                    ? [3, 6, 9]
                    : size === 9
                      ? [2, 4, 6]
                      : [];

        for (let y = bounds.top; y <= bounds.bottom; y++) {
            for (let x = bounds.left; x <= bounds.right; x++) {
                const overlay = byPoint.get(y * size + x);
                const loX = x === 0 ? x : x - 0.5;
                const hiX = x === size - 1 ? x : x + 0.5;
                const loY = y === 0 ? y : y - 0.5;
                const hiY = y === height - 1 ? y : y + 0.5;
                const lines = lineCells[overlay?.fadedGrid ? 1 : 0];
                lines.push(this.matrix((loX + hiX) / 2, 0.004, y, hiX - loX, 0.028));
                lines.push(this.matrix(x, 0.004, (loY + hiY) / 2, 0.028, hiY - loY));
                if (
                    hoshi.includes(x) &&
                    hoshi.includes(y) &&
                    (size === 19 || (x === hoshi[1]) === (y === hoshi[1]))
                ) {
                    dotCells.push({ x, y });
                }

                const real = readStone({ x, y });
                const color = real || overlay?.stone?.color;
                if (color) {
                    stones.push({
                        point: { x, y },
                        color,
                        alpha: real ? (overlay?.stoneAlpha ?? 1) : (overlay?.stone?.alpha ?? 1),
                    });
                }
            }
        }
        lineCells.forEach((lines, index) => {
            const material = new MeshBasicMaterial({
                color: index
                    ? (this.appearance?.board.faded ?? "#9d764c")
                    : (this.appearance?.board.line ?? "#614426"),
            });
            const linesMesh = new InstancedMesh(this.plane, material, lines.length);
            lines.forEach((line, i) => linesMesh.setMatrixAt(i, line.matrix));
            this.grid.add(linesMesh);
        });
        const dots = new InstancedMesh(
            this.disk,
            new MeshBasicMaterial({ color: this.appearance?.board.star ?? "#614426" }),
            dotCells.length,
        );
        dotCells.forEach(({ x, y }, index) => {
            dots.setMatrixAt(index, this.matrix(x, 0.005, y, 0.075, 0.075).matrix);
        });
        this.grid.add(dots);

        for (const overlay of overlays) {
            if (!contains(bounds, overlay)) {
                continue;
            }
            for (const square of overlay.squares ?? []) {
                this.fill(overlay, this.plane, square.color, square.alpha, square.size * 2, 0.006);
            }
            if (overlay.circle) {
                this.fill(overlay, this.disk, overlay.circle.borderColor, 1, 0.525, 0.007);
                this.fill(
                    overlay,
                    this.disk,
                    overlay.circle.color,
                    1,
                    0.525 * (1 - overlay.circle.borderWidth),
                    0.008,
                );
            }
        }

        const counts = [0, 0];
        stones.forEach(({ point, color, alpha }) => {
            this.transform.position.set(point.x, 0, point.y);
            this.transform.scale.set(this.stoneScale, 1, this.stoneScale);
            this.transform.updateMatrix();
            if (alpha < 1) {
                const material = this.ghostMaterials[color - 1].clone();
                material.opacity = alpha;
                const mesh = new Mesh(this.geometry, material);
                mesh.position.copy(this.transform.position);
                mesh.scale.copy(this.transform.scale);
                mesh.renderOrder = 4;
                this.translucent.add(mesh);
            } else {
                this.stones[color - 1].setMatrixAt(counts[color - 1]++, this.transform.matrix);
            }
        });
        this.shadowPoints = stones.map(({ point }) => point);
        this.shadows.count = stones.length;
        this.updateShadows();
        this.shadows.renderOrder = 3;
        this.shadows.instanceMatrix.needsUpdate = true;
        this.stones.forEach((batch, index) => {
            batch.count = counts[index];
            batch.instanceMatrix.needsUpdate = true;
        });
    }

    public preview(point: Point | null, stone?: { color: 1 | 2; alpha: number }): void {
        this.hover.visible = point !== null && stone !== undefined;
        if (point && stone) {
            this.hover.position.set(point.x, 0, point.y);
            this.hover.material = this.ghostMaterials[stone.color - 1];
            this.hover.material.opacity = stone.alpha;
        }
    }

    public updateClock(clock: JGOFClock | null): boolean {
        const display = this.room?.updateClock(clock);
        if (display === undefined) {
            return false;
        }
        this.canvas.dataset.roomClock = display;
        return true;
    }

    public updateCaptures(black: number, white: number): void {
        if (this.room) {
            const counts = this.room.updateCaptures(black, white);
            if (counts !== this.canvas.dataset.lidStones) {
                this.canvas.dataset.lidStones = counts;
                this.renderer.shadowMap.needsUpdate = true;
            }
        }
    }

    public draw(projection: BoardProjection): void {
        this.room?.updateCamera(projection.camera.position);
        this.renderer.render(this.scene, projection.camera);
    }

    public dispose(): void {
        this.room?.dispose();
        this.clear(this.grid);
        this.clear(this.effects);
        this.clear(this.translucent);
        for (const surface of this.board.children) {
            if (surface instanceof Mesh) {
                surface.geometry.dispose();
            }
        }
        for (const batch of [...this.stones, this.shadows]) {
            batch.dispose();
        }
        for (const material of [...this.materials, ...this.ghostMaterials, this.shadowMaterial]) {
            material.dispose();
        }
        for (const geometry of [this.geometry, this.plane, this.disk]) {
            geometry.dispose();
        }
        this.textureRevision++;
        this.boardTexture?.dispose();
        this.edgeMaterial.dispose();
        this.surfaceMaterial.dispose();
        this.wood.dispose();
        this.shadowMap.dispose();
        this.key.shadow.dispose();
        this.renderer.dispose();
    }

    private matrix(x: number, elevation: number, y: number, sx: number, sy: number): Object3D {
        const object = new Object3D();
        object.position.set(x, elevation, y);
        object.scale.set(sx, 1, sy);
        object.updateMatrix();
        return object;
    }

    private fill(
        { x, y }: Point,
        geometry: PlaneGeometry | CircleGeometry,
        color: string,
        alpha: number,
        scale: number,
        elevation: number,
    ): void {
        const mesh = new Mesh(
            geometry,
            new MeshBasicMaterial({
                color: new Color(color),
                opacity: alpha,
                transparent: alpha < 1,
                depthWrite: alpha === 1,
            }),
        );
        mesh.position.set(x, elevation, y);
        mesh.scale.set(scale, 1, scale);
        mesh.renderOrder = 2;
        this.effects.add(mesh);
    }

    private clear(group: Group): void {
        for (const item of group.children) {
            if (item instanceof InstancedMesh) {
                item.dispose();
            }
            if (item instanceof Mesh) {
                item.material.dispose();
            }
        }
        group.clear();
    }
}
