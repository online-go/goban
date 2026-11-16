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

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

function canvasContext(width: number, height: number): CanvasRenderingContext2D {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas 2D unavailable");
    }
    return context;
}

function roomTexture(context: CanvasRenderingContext2D, repeatX: number, repeatY: number) {
    const texture = new CanvasTexture(context.canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.offset.set((1 - repeatX) / 2, (1 - repeatY) / 2);
    texture.anisotropy = 4;
    return texture;
}

export function contactTexture(
    width: number,
    depth: number,
    ambient: (x: number, z: number) => number,
): CanvasTexture {
    const context = canvasContext(320, 192);
    const image = context.createImageData(context.canvas.width, context.canvas.height);
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const worldX = ((x + 0.5) / image.width - 0.5) * width;
            const worldZ = ((y + 0.5) / image.height - 0.5) * depth;
            image.data[4 * (y * image.width + x) + 3] = Math.round(
                255 * (1 - ambient(worldX, worldZ)),
            );
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new CanvasTexture(context.canvas);
    texture.anisotropy = 4;
    return texture;
}

export function tatamiTexture(repeatX: number, repeatY: number): CanvasTexture {
    const unit = 384;
    const floor = canvasContext(3 * unit, 3 * unit);
    const mat = canvasContext(2 * unit, unit);
    const weave = mat.createImageData(mat.canvas.width, mat.canvas.height);
    for (let y = 0; y < weave.height; y++) {
        for (let x = 0; x < weave.width; x++) {
            const strands = y % 3 === 0 ? -5 : 2;
            const stitch = (Math.floor(x / 6) + Math.floor(y / 3)) % 2 === 0 ? 3 : -3;
            const grain = 3 * Math.sin(y * 2.37) + 2 * Math.sin(x * 0.17 + y * 2.7);
            const tone = strands + stitch + grain;
            const pixel = (y * weave.width + x) * 4;
            weave.data[pixel] = 150 + tone;
            weave.data[pixel + 1] = 148 + tone;
            weave.data[pixel + 2] = 107 + tone;
            weave.data[pixel + 3] = 255;
        }
    }
    mat.putImageData(weave, 0, 0);
    const layout = [
        [0, 0, 2, 1],
        [2, 0, 1, 2],
        [1, 2, 2, 1],
        [0, 1, 1, 2],
        [1, 1, 1, 1],
    ];
    for (const [column, row, width, height] of layout) {
        floor.save();
        floor.translate(column * unit, row * unit);
        if (width < height) {
            floor.translate(unit, 0);
            floor.rotate(Math.PI / 2);
        }
        const length = Math.max(width, height) * unit;
        floor.drawImage(mat.canvas, 0, 0, length, unit, 0, 0, length, unit);
        floor.fillStyle = "#4b4b3d";
        floor.fillRect(0, 0, length, 6);
        floor.fillRect(0, unit - 6, length, 6);
        floor.fillStyle = "#777653";
        floor.fillRect(0, 0, 1, unit);
        floor.fillRect(length - 1, 0, 1, unit);
        floor.restore();
    }
    return roomTexture(floor, repeatX, repeatY);
}

export function shojiTexture(panelCount: number): CanvasTexture {
    const width = 160;
    const height = 400;
    const wall = canvasContext(width, height);
    const paper = wall.createLinearGradient(0, 0, width, height);
    paper.addColorStop(0, "#e5dac4");
    paper.addColorStop(1, "#c8bba1");
    wall.fillStyle = paper;
    wall.fillRect(0, 0, width, height);
    wall.fillStyle = "#8a6a4d";
    for (const x of [0, 52, 105, 153]) {
        wall.fillRect(x, 0, x === 0 || x === 153 ? 7 : 3, height);
    }
    for (let y = 52; y < height - 48; y += 48) {
        wall.fillRect(0, y, width, 3);
    }
    wall.fillStyle = "#6e533e";
    wall.fillRect(0, 0, width, 9);
    wall.fillRect(0, height - 19, width, 19);
    return roomTexture(wall, panelCount, 1);
}

export function tileTexture(repeatX: number, repeatY: number): CanvasTexture {
    const unit = 96;
    const context = canvasContext(4 * unit, 4 * unit);
    context.fillStyle = "#41474b";
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    const tile = context.createImageData(unit - 2, unit - 2);
    for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
            const tileTone = 4.5 * Math.sin(column * 7.4 + row * 4.7);
            for (let y = 0; y < tile.height; y++) {
                for (let x = 0; x < tile.width; x++) {
                    const grain =
                        2 * Math.sin(x * 0.25 + y * 0.37) + 1.5 * Math.sin(x * 2.71 + y * 6.37);
                    const bevel = x < 2 || y < 2 ? 7 : 0;
                    const tone = tileTone + grain + bevel;
                    const index = (y * tile.width + x) * 4;
                    tile.data[index] = 94 + tone;
                    tile.data[index + 1] = 103 + tone;
                    tile.data[index + 2] = 109 + tone;
                    tile.data[index + 3] = 255;
                }
            }
            context.putImageData(tile, column * unit + 1, row * unit + 1);
        }
    }
    return roomTexture(context, repeatX, repeatY);
}

export function latticeTexture(): CanvasTexture {
    const width = 448;
    const height = 352;
    const context = canvasContext(width, height);
    const light = context.createLinearGradient(0, 0, width, height);
    light.addColorStop(0, "#a3a58e");
    light.addColorStop(0.55, "#838f83");
    light.addColorStop(1, "#646f68");
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#534237";
    context.lineWidth = 14;
    context.strokeRect(7, 7, width - 14, height - 14);
    context.lineWidth = 6;
    for (let x = 56; x < width; x += 112) {
        for (let y = 48; y < height; y += 64) {
            context.beginPath();
            context.moveTo(x - 49, y);
            context.lineTo(x - 19, y);
            context.lineTo(x - 19, y - 18);
            context.lineTo(x + 19, y - 18);
            context.lineTo(x + 19, y);
            context.lineTo(x + 49, y);
            context.moveTo(x - 19, y);
            context.lineTo(x - 19, y + 18);
            context.lineTo(x + 19, y + 18);
            context.lineTo(x + 19, y);
            context.stroke();
        }
    }
    context.fillStyle = "#4c382f";
    for (let x = 112; x < width; x += 112) {
        context.fillRect(x - 4, 0, 8, height);
    }
    return roomTexture(context, 1, 1);
}
