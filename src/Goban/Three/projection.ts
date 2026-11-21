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

import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { ThreeBoardStyle } from "../ThreeConfig";

export interface Point {
    x: number;
    y: number;
}

export interface Bounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface CameraOptions {
    boardStyle?: ThreeBoardStyle;
    room?: boolean;
    /** Field of view along the shorter viewport dimension, before fitting. */
    fieldOfView?: number;
    /** Minimum orbit distance in multiples of the longer visible grid span. */
    distanceScale?: number;
    /** Camera orbit around the board in degrees. */
    rotation?: number;
    /** Mirror the board left to right; ignored with a room. */
    mirror?: boolean;
    /** Share of the viewport the fitted board may fill (default 0.92). */
    frameLimit?: number;
}

export const angles = [0, 15, 25, 35] as const;
/** Stone top above the board: about 42% of the diameter, like a size 32-34 stone. */
export const crownHeight = 0.395;
export const stoneBase = 0.003;
export const stoneRadius = 0.47;
const tabletopThickness = 0.36;
export const boardMargin = 1.17;
const defaultFrameLimit = 0.94;
const frameMargin = 1.27;
/** Grid framing margin past the outer lines: an edge stone plus a sliver of wood. */
const gridMargin = 0.62;
/** Height of a lid's stone pile above the floor, in bowl radii. */
const lidCentreHeightRatio = 0.2;

export function boardDimensions(bounds: Bounds, style: ThreeBoardStyle = "tabletop") {
    const width = bounds.right - bounds.left + 2 * boardMargin;
    const depth = bounds.bottom - bounds.top + 2 * boardMargin;
    const shortest = Math.min(width, depth);
    return {
        width,
        depth,
        thickness: style === "floor" ? shortest * 0.22 : tabletopThickness,
        legHeight: style === "floor" ? shortest * 0.15 : 0,
    };
}

export function floorBoardFeet(width: number, depth: number) {
    const radius = Math.min(width, depth) * 0.058;
    return { radius, x: width / 2 - radius * 1.22, z: depth / 2 - radius * 1.22 };
}

export const bowlHeightRatio = 1.08;

export function roomLayout(bounds: Bounds, style: ThreeBoardStyle = "tabletop") {
    const { width, depth, thickness, legHeight } = boardDimensions(bounds, style);
    // Room props use the same physical scale at every board size.
    const radius = 3.45;
    const tabletop = style === "tabletop";
    const side = width / 2 + radius + 0.34 + (thickness + legHeight) * 0.27;
    const separation = radius * (tabletop ? 1.66 : 1.24);
    return {
        tabletop,
        furnitureWidth: Math.max(width, 2 * (side + radius)) + (tabletop ? 7.4 : 1.4),
        furnitureDepth: Math.max(depth, 2 * (separation + radius)) + (tabletop ? 9.4 : 1.4),
        width,
        depth,
        radius,
        x: (bounds.left + bounds.right) / 2,
        z: (bounds.top + bounds.bottom) / 2,
        side,
        separation,
        surface: -thickness - legHeight - 0.003,
    };
}

export function contains(bounds: Bounds, { x, y }: Point): boolean {
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

export function world(point: Point, height = 0): Vector3 {
    return new Vector3(point.x, height, point.y);
}

/** All viewport dimensions and pointer positions are CSS pixels. */
export class BoardProjection {
    public stoneScale = 1;
    public readonly camera = new PerspectiveCamera();
    private readonly ray = new Raycaster();
    private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
    private readonly planeHit = new Vector3();
    private readonly pointer = new Vector2();
    private width = 1;
    private height = 1;

    public readonly bounds: Bounds;
    private readonly fieldOfView: number;
    private readonly distanceScale: number;
    private readonly frameLimit: number;
    private readonly room?: ReturnType<typeof roomLayout>;
    public readonly rotation: number;
    public readonly mirror: boolean;
    public readonly mirrorX: number;

    public constructor(bounds: Bounds, options: CameraOptions = {}) {
        this.bounds = bounds;
        this.room = options.room ? roomLayout(bounds, options.boardStyle) : undefined;
        this.rotation = options.rotation ?? 0;
        this.mirror = !this.room && !!options.mirror;
        this.mirrorX = bounds.left + bounds.right;
        this.fieldOfView = options.fieldOfView ?? 34;
        this.distanceScale = options.distanceScale ?? 1.3;
        this.frameLimit = options.frameLimit ?? defaultFrameLimit;
    }

    /** Camera distance in use after the last fit. */
    public distance = 0;
    /** Distance the last fit computed to frame the board, before any override. */
    public fittedDistance = 0;

    /**
     * Frame the board. `chooseDistance` may replace the fitted distance, e.g. to hold the
     * camera steady while orbiting; it receives the fitted value.
     */
    public fit(
        width: number,
        height: number,
        tilt: number,
        chooseDistance?: (fitted: number) => number,
    ): void {
        this.width = width;
        this.height = height;
        const radians = (tilt * Math.PI) / 180;
        const sin = Math.sin(radians);
        const cos = Math.cos(radians);
        const { left, top, right, bottom } = this.bounds;
        const centerX = (left + right) / 2;
        const centerY = (top + bottom) / 2;
        const room = this.room;
        const yaw = (this.rotation * Math.PI) / 180;
        const absCosYaw = Math.abs(Math.cos(yaw));
        const absSinYaw = Math.abs(Math.sin(yaw));
        const spanX = (right - left) / 2 + frameMargin;
        const spanY = (bottom - top) / 2 + frameMargin;
        // Seen from the side, the board's depth runs across the screen.
        const halfX = spanX * absCosYaw + spanY * absSinYaw;
        const halfY = spanX * absSinYaw + spanY * absCosYaw;
        const camera = this.camera;
        camera.fov = this.fieldOfView;
        camera.aspect = width / height;
        camera.zoom = Math.min(1, camera.aspect);
        const tanY = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
        const tanX = tanY * camera.aspect;

        // Frame only the playing grid and its edge stones. The wooden board, its underside,
        // feet and the room may be cropped at some angles; the grid itself never is.
        const gridX = (right - left) / 2 + gridMargin;
        const gridY = (bottom - top) / 2 + gridMargin;
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        // The distance floor limits perspective distortion on a close camera.
        let distance = Math.max(gridX, gridY) * 2 * this.distanceScale;
        /** Keep a point (relative to the board centre) inside the frame. */
        const keep = (dx: number, dy: number, elevation: number) => {
            // In camera terms: across the screen, and along the view towards the camera.
            const across = dx * cosYaw - dy * sinYaw;
            const row = dx * sinYaw + dy * cosYaw;
            const forward = row * sin + elevation * cos;
            const vertical = elevation * sin - row * cos;
            distance = Math.max(
                distance,
                forward +
                    Math.max(Math.abs(across) / tanX, Math.abs(vertical) / tanY) / this.frameLimit,
            );
        };
        for (const dx of [-gridX, gridX]) {
            for (const dy of [-gridY, gridY]) {
                keep(dx, dy, 0);
                keep(dx, dy, crownHeight);
            }
        }
        if (room) {
            // Captured stones are counted in the lids, so keep each lid's centre in view: about
            // half of every lid stays visible while the bowls themselves may be cropped.
            const lidTop = room.surface + room.radius * lidCentreHeightRatio;
            for (const direction of [-1, 1]) {
                keep(direction * room.side, -direction * room.separation, lidTop);
            }
        }
        this.fittedDistance = distance;
        if (chooseDistance) {
            distance = chooseDistance(distance);
        }
        this.distance = distance;
        // Keep depth precision for the closely spaced board face and slab.
        camera.near = 1;
        // A room reaches its enclosing walls in every direction, including far corners.
        camera.far = distance + (room ? 320 : Math.hypot(halfX, halfY) * 2 + 10);
        camera.position.set(
            centerX + distance * sin * Math.sin(yaw),
            distance * cos,
            centerY + distance * sin * Math.cos(yaw),
        );
        camera.up.set(-cos * Math.sin(yaw), sin, -cos * Math.cos(yaw));
        camera.lookAt(centerX, 0, centerY);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    /** Board point to world position, after the optional left-right mirror. */
    public toWorld(point: Point, height = 0): Vector3 {
        return world(this.mirror ? { x: this.mirrorX - point.x, y: point.y } : point, height);
    }

    public project(point: Point, elevation = 0): Point {
        const projected = this.toWorld(point, elevation).project(this.camera);
        return {
            x: ((projected.x + 1) * this.width) / 2,
            y: ((1 - projected.y) * this.height) / 2,
        };
    }

    public cellSize(point: Point, elevation = 0): number {
        const left = this.project({ x: point.x - 0.5, y: point.y }, elevation);
        const right = this.project({ x: point.x + 0.5, y: point.y }, elevation);
        // On-screen length, so a mirrored or rotated camera still gets a positive size.
        return Math.hypot(right.x - left.x, right.y - left.y);
    }

    public unproject(point: Point): Point | null {
        this.pointer.set((2 * point.x) / this.width - 1, 1 - (2 * point.y) / this.height);
        this.ray.setFromCamera(this.pointer, this.camera);
        const hit = this.ray.ray.intersectPlane(this.plane, this.planeHit);
        return hit ? { x: this.mirror ? this.mirrorX - hit.x : hit.x, y: hit.z } : null;
    }

    public pick(point: Point, occupied?: (point: Point) => boolean, antiSlip = true): Point | null {
        if (point.x < 0 || point.y < 0 || point.x >= this.width || point.y >= this.height) {
            return null;
        }
        const board = this.unproject(point);
        if (!board) {
            return null;
        }
        const cell = { x: Math.floor(board.x + 0.5), y: Math.floor(board.y + 0.5) };

        if (occupied) {
            // A raised stone can project past its board-plane hit area. Find the
            // nearest stone along the ray before applying the empty-cell dead band.
            let best: Point | null = null;
            let distance = Infinity;
            for (let y = cell.y - 1; y <= cell.y + 1; y++) {
                for (let x = cell.x - 1; x <= cell.x + 1; x++) {
                    const candidate = { x, y };
                    if (!contains(this.bounds, candidate) || !occupied(candidate)) {
                        continue;
                    }
                    const hit = this.stoneDistance(candidate);
                    if (hit < distance) {
                        best = candidate;
                        distance = hit;
                    }
                }
            }
            if (best) {
                return best;
            }
        }
        // Match goban's 0.1-cell anti-slip margin at each empty cell boundary.
        return contains(this.bounds, cell) &&
            (!antiSlip || (Math.abs(board.x - cell.x) < 0.4 && Math.abs(board.y - cell.y) < 0.4))
            ? cell
            : null;
    }

    private stoneDistance(point: Point): number {
        // The mesh is lathed from the same oblate ellipsoid. Scale its axes
        // to intersect a unit sphere while preserving the world ray parameter.
        const halfHeight = (crownHeight - stoneBase) / 2;
        const inverseAxes = new Vector3(
            1 / (stoneRadius * this.stoneScale),
            1 / halfHeight,
            1 / (stoneRadius * this.stoneScale),
        );
        const origin = this.ray.ray.origin
            .clone()
            .sub(this.toWorld(point, stoneBase + halfHeight))
            .multiply(inverseAxes);
        const direction = this.ray.ray.direction.clone().multiply(inverseAxes);
        const a = direction.lengthSq();
        const b = origin.dot(direction);
        const discriminant = b * b - a * (origin.lengthSq() - 1);
        if (discriminant < 0) {
            return Infinity;
        }
        const hit = (-b - Math.sqrt(discriminant)) / a;
        return hit >= 0 ? hit : Infinity;
    }
}
