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
    /** Field of view along the shorter viewport dimension, before fitting. */
    fieldOfView?: number;
    /** Minimum orbit distance in multiples of the longer visible grid span. */
    distanceScale?: number;
}

export const angles = [0, 15, 25, 35] as const;
export const crownHeight = 0.25;
export const stoneBase = 0.012;
export const stoneRadius = 0.47;
export const boardThickness = 0.36;
export const boardMargin = 1.17;
const frameLimit = 0.92;
const frameMargin = 1.27;

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

    public constructor(bounds: Bounds, options: CameraOptions = {}) {
        this.bounds = bounds;
        this.fieldOfView = options.fieldOfView ?? 34;
        this.distanceScale = options.distanceScale ?? 1.65;
    }

    public fit(width: number, height: number, tilt: (typeof angles)[number]): void {
        this.width = width;
        this.height = height;
        const radians = (tilt * Math.PI) / 180;
        const sin = Math.sin(radians);
        const cos = Math.cos(radians);
        const { left, top, right, bottom } = this.bounds;
        const centerX = (left + right) / 2;
        const centerY = (top + bottom) / 2;
        const halfX = (right - left) / 2 + frameMargin;
        const halfY = (bottom - top) / 2 + frameMargin;
        const camera = this.camera;
        camera.fov = this.fieldOfView;
        camera.aspect = width / height;
        camera.zoom = Math.min(1, camera.aspect);
        const tanY = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
        const tanX = tanY * camera.aspect;

        let distance = Math.max(halfX, halfY) * 2 * this.distanceScale;
        // Fit the slab, crown and coordinate gutters. Camera depth varies by row.
        for (const row of [-halfY, halfY]) {
            for (const elevation of [-boardThickness - 0.003, crownHeight]) {
                const forward = row * sin + elevation * cos;
                const vertical = elevation * sin - row * cos;
                distance = Math.max(
                    distance,
                    forward + Math.max(halfX / tanX, Math.abs(vertical) / tanY) / frameLimit,
                );
            }
        }
        camera.near = 0.1;
        camera.far = distance + Math.hypot(halfX, halfY) * 2 + 10;
        camera.position.set(centerX, distance * cos, centerY + distance * sin);
        camera.up.set(0, sin, -cos);
        camera.lookAt(centerX, 0, centerY);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    public project(point: Point, elevation = 0): Point {
        const projected = world(point, elevation).project(this.camera);
        return {
            x: ((projected.x + 1) * this.width) / 2,
            y: ((1 - projected.y) * this.height) / 2,
        };
    }

    public cellSize(point: Point, elevation = 0): number {
        const left = this.project({ x: point.x - 0.5, y: point.y }, elevation);
        const right = this.project({ x: point.x + 0.5, y: point.y }, elevation);
        return right.x - left.x;
    }

    public unproject(point: Point): Point | null {
        this.pointer.set((2 * point.x) / this.width - 1, 1 - (2 * point.y) / this.height);
        this.ray.setFromCamera(this.pointer, this.camera);
        const hit = this.ray.ray.intersectPlane(this.plane, this.planeHit);
        return hit ? { x: hit.x, y: hit.z } : null;
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
            .sub(world(point, stoneBase + halfHeight))
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
