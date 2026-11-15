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
    CanvasTexture,
    CircleGeometry,
    Color,
    DirectionalLight,
    Group,
    InstancedMesh,
    LatheGeometry,
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
    WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { NativeOverlay } from "../NativeTransport";
import {
    boardMargin,
    boardThickness,
    contains,
    crownHeight,
    stoneBase,
    stoneRadius,
    type Bounds,
    type Point,
} from "./projection";
import type { BoardProjection } from "./projection";

import { lightingPresets, type LightingPreferences } from "./lighting";
import type { Appearance } from "./appearance";

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
    gradient.addColorStop(0, "rgba(255,255,255,0.64)");
    gradient.addColorStop(0.66, "rgba(255,255,255,0.47)");
    gradient.addColorStop(0.84, "rgba(255,255,255,0.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

function stoneGeometry(): LatheGeometry {
    const profile: Vector2[] = [];
    for (let n = 0; n <= 20; n++) {
        const theta = (n * Math.PI) / 20;
        profile.push(
            new Vector2(
                stoneRadius * Math.sin(theta),
                stoneBase + ((crownHeight - stoneBase) * (1 - Math.cos(theta))) / 2,
            ),
        );
    }
    return new LatheGeometry(profile, 32);
}

interface Stone {
    point: Point;
    color: 1 | 2;
    alpha: number;
}

export class BoardScene {
    public readonly renderer: WebGLRenderer;
    private readonly scene = new Scene();
    public readonly annotations = new Group();
    private readonly geometry = stoneGeometry();
    private readonly wood = woodTexture();
    private readonly ambient = new AmbientLight();
    private readonly key = new DirectionalLight();
    private readonly fillLight = new DirectionalLight();
    private readonly surfaceMaterial = new MeshStandardMaterial({
        map: this.wood,
        roughness: 0.72,
    });
    private readonly edgeMaterial = new MeshStandardMaterial({
        map: this.wood,
        color: "#9b785e",
        roughness: 0.76,
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
        this.renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.setClearColor(0x000000, 0);
        this.scene.add(
            this.ambient,
            this.key,
            this.fillLight,
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
    }

    public setLighting(settings: LightingPreferences): void {
        const preset = lightingPresets[settings.preset];
        const azimuth = (settings.azimuth * Math.PI) / 180;
        const radius = settings.preset === "directional" ? 11 : 7;
        this.ambient.color.set("#fffdf8");
        this.ambient.intensity = preset.ambient * settings.intensity;
        this.key.color.set(preset.tint);
        this.key.intensity = preset.key * settings.intensity;
        this.key.position.set(radius * Math.cos(azimuth), 12, radius * Math.sin(azimuth));
        this.fillLight.color.set("#e3ecff");
        this.fillLight.intensity = preset.fill * settings.intensity;
        this.fillLight.position.set(-this.key.position.x, 7, -this.key.position.z);
        const shift = settings.preset === "directional" ? 0.15 : 0.095;
        this.shadowOffset = { x: -Math.cos(azimuth) * shift, y: -Math.sin(azimuth) * shift };
        this.shadowStrength = preset.shadow * Math.min(1, settings.intensity);
        this.updateShadows();
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

    public rebuild(bounds: Bounds): void {
        for (const old of [...this.board.children]) {
            if (old instanceof Mesh) {
                old.geometry.dispose();
            }
            this.board.remove(old);
        }
        const width = bounds.right - bounds.left + 2 * boardMargin;
        const height = bounds.bottom - bounds.top + 2 * boardMargin;
        const slab = new Mesh(
            new RoundedBoxGeometry(width, boardThickness, height, 2, 0.055),
            this.edgeMaterial,
        );
        const surface = new Mesh(
            new PlaneGeometry(width - 0.108, height - 0.108).rotateX(-Math.PI / 2),
            this.surfaceMaterial,
        );
        const x = (bounds.left + bounds.right) / 2;
        const y = (bounds.top + bounds.bottom) / 2;
        slab.position.set(x, -boardThickness / 2 - 0.003, y);
        surface.position.set(x, 0, y);
        this.board.add(slab, surface);
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

    public draw(projection: BoardProjection): void {
        this.renderer.render(this.scene, projection.camera);
    }

    public dispose(): void {
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
