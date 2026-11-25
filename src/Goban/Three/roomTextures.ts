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

const textureCanvases = new Map<string, HTMLCanvasElement>();
const canvasCacheLimit = 32;
const shojiPanels = 4;

export function cachedTextureCanvas(key: string, draw: () => HTMLCanvasElement): HTMLCanvasElement {
    let canvas = textureCanvases.get(key);
    if (!canvas) {
        canvas = draw();
        if (textureCanvases.size >= canvasCacheLimit) {
            const oldest = textureCanvases.keys().next();
            if (!oldest.done) {
                textureCanvases.delete(oldest.value);
            }
        }
        textureCanvases.set(key, canvas);
    }
    return canvas;
}

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

function roomTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number) {
    const texture = new CanvasTexture(canvas);
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
    ambientInputs: readonly number[],
): CanvasTexture {
    const key = ["contactTexture", width, depth, ...ambientInputs].join("/");
    const canvas = cachedTextureCanvas(key, () => drawContact(width, depth, ambient));
    const texture = new CanvasTexture(canvas);
    texture.anisotropy = 4;
    return texture;
}

function drawContact(
    width: number,
    depth: number,
    ambient: (x: number, z: number) => number,
): HTMLCanvasElement {
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
    return context.canvas;
}

export function tatamiTexture(repeatX: number, repeatY: number): CanvasTexture {
    return roomTexture(cachedTextureCanvas("tatamiTexture", drawTatami), repeatX, repeatY);
}

function drawTatami(): HTMLCanvasElement {
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
    return floor.canvas;
}

/** Deterministic hash in [0, 1) for repeatable texture variation. */
function hash(n: number): number {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
}

/** Adds fine multiplicative grain to the whole canvas. */
function addGrain(context: CanvasRenderingContext2D, amount: number, seed: number): void {
    const { width, height } = context.canvas;
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let y = 0; y < height; y++) {
        // Long fibres plus per-pixel speckle.
        const row = Math.sin(y * 0.73 + seed) * 0.4;
        for (let x = 0; x < width; x++) {
            const fibre = Math.sin(x * 0.051 + y * 0.31 + seed) * Math.sin(y * 1.7 + x * 0.013);
            const speckle = hash(x * 7.31 + y * 131.7 + seed) - 0.5;
            const tone = 1 + amount * (0.55 * fibre + 0.8 * speckle + row * 0.3);
            const index = (y * width + x) * 4;
            data[index] = Math.min(255, data[index] * tone);
            data[index + 1] = Math.min(255, data[index + 1] * tone);
            data[index + 2] = Math.min(255, data[index + 2] * tone);
        }
    }
    context.putImageData(image, 0, 0);
}

/** Wooden bar with a lit top-left edge and a shaded bottom-right edge, for drawn depth. */
function bar(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    castShadow = true,
): void {
    const edge = Math.min(2, width, height);
    if (castShadow) {
        context.fillStyle = "rgba(60,40,20,0.16)";
        context.fillRect(x + 3, y + 3, width, height);
    }
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    context.fillStyle = "rgba(255,240,215,0.28)";
    context.fillRect(x, y, width, edge);
    context.fillRect(x, y, edge, height);
    context.fillStyle = "rgba(40,25,10,0.3)";
    context.fillRect(x, y + height - edge, width, edge);
    context.fillRect(x + width - edge, y, edge, height);
}

/**
 * Four shoji panels at about 12 texels per world unit: backlit paper with fibre and a
 * per-panel tone, a shaded kumiko lattice, the frame and a wooden kick panel.
 */
export function shojiTexture(panelCount: number): CanvasTexture {
    const canvas = cachedTextureCanvas("shojiTexture", drawShoji);
    return roomTexture(canvas, panelCount / shojiPanels, 1);
}

function drawShoji(): HTMLCanvasElement {
    const panelWidth = 512;
    const height = 1024;
    const context = canvasContext(panelWidth * shojiPanels, height);
    const stile = 22;
    const topRail = 26;
    const kick = 150;
    const kumiko = 7;
    const lattice = "#a07a54";
    const frame = "#8c6a4a";
    for (let p = 0; p < shojiPanels; p++) {
        const x0 = p * panelWidth;
        const tone = (hash(p + 3) - 0.5) * 14;
        const glow = context.createLinearGradient(0, 0, 0, height - kick);
        glow.addColorStop(0, `rgb(${244 + tone},${238 + tone},${222 + tone})`);
        glow.addColorStop(0.6, `rgb(${232 + tone},${224 + tone},${204 + tone})`);
        glow.addColorStop(1, `rgb(${214 + tone},${204 + tone},${182 + tone})`);
        context.fillStyle = glow;
        context.fillRect(x0, 0, panelWidth, height - kick);
        // Faint seams where paper sheets overlap.
        context.fillStyle = "rgba(150,130,100,0.08)";
        for (let y = topRail + 120; y < height - kick; y += 180) {
            context.fillRect(x0, y, panelWidth, 3);
        }

        const innerLeft = x0 + stile;
        const innerWidth = panelWidth - 2 * stile;
        const innerBottom = height - kick - 14;
        const columns = 4;
        for (let c = 1; c < columns; c++) {
            const x = innerLeft + (c * innerWidth) / columns - kumiko / 2;
            bar(context, x, topRail, kumiko, innerBottom - topRail, lattice);
        }
        const rows = 8;
        for (let r = 1; r < rows; r++) {
            const y = topRail + (r * (innerBottom - topRail)) / rows - kumiko / 2;
            bar(context, innerLeft, y, innerWidth, kumiko, lattice);
        }

        // Kick panel with its own grain.
        const kickTop = height - kick;
        const board = context.createLinearGradient(0, kickTop, 0, height);
        board.addColorStop(0, "#8a6646");
        board.addColorStop(1, "#6d4f36");
        context.fillStyle = board;
        context.fillRect(x0, kickTop, panelWidth, kick);
        context.strokeStyle = "rgba(60,38,20,0.22)";
        context.lineWidth = 1.5;
        for (let g = 0; g < 14; g++) {
            const y = kickTop + 12 + g * 9 + hash(p * 31 + g) * 6;
            context.beginPath();
            context.moveTo(x0, y);
            for (let x = 0; x <= panelWidth; x += 32) {
                context.lineTo(x0 + x, y + Math.sin(x * 0.02 + g + p) * 2.5);
            }
            context.stroke();
        }

        bar(context, x0, 0, panelWidth, topRail, frame, false);
        bar(context, x0, innerBottom, panelWidth, 14, frame);
        bar(context, x0, 0, stile, height, frame, false);
        bar(context, x0 + panelWidth - stile, 0, stile, height, frame, false);
        // Recessed finger pull on the leading stile.
        context.fillStyle = "rgba(40,25,12,0.45)";
        context.fillRect(x0 + panelWidth - stile - 2, height * 0.5, 6, 46);
    }
    addGrain(context, 0.05, 1.3);
    return context.canvas;
}

/** Light oak-look vinyl planks for a tournament hall floor. */
export function hallFloorTexture(repeatX: number, repeatY: number): CanvasTexture {
    return roomTexture(cachedTextureCanvas("hallFloorTexture", drawHallFloor), repeatX, repeatY);
}

function drawHallFloor(): HTMLCanvasElement {
    const size = 1024;
    const context = canvasContext(size, size);
    const planks = 4;
    const plankWidth = size / planks;
    for (let column = 0; column < planks; column++) {
        let y = -hash(column) * size;
        let n = 0;
        while (y < size) {
            const length = size * (0.55 + 0.4 * hash(column * 17 + n));
            const tone = (hash(column * 5 + n * 11) - 0.5) * 22;
            context.fillStyle = `rgb(${200 + tone},${178 + tone},${142 + tone})`;
            context.fillRect(column * plankWidth, y, plankWidth, length);
            context.strokeStyle = "rgba(120,90,55,0.2)";
            context.lineWidth = 1.2;
            for (let g = 0; g < 16; g++) {
                const gx =
                    column * plankWidth + 8 + hash(column * 3 + n * 7 + g) * (plankWidth - 16);
                context.beginPath();
                context.moveTo(gx, y);
                for (let s = 0; s <= length; s += 40) {
                    context.lineTo(gx + Math.sin(s * 0.015 + g) * 3, y + s);
                }
                context.stroke();
            }
            context.fillStyle = "rgba(90,65,40,0.45)";
            context.fillRect(column * plankWidth, y, plankWidth, 2);
            y += length;
            n++;
        }
        context.fillStyle = "rgba(90,65,40,0.5)";
        context.fillRect(column * plankWidth, 0, 2, size);
    }
    addGrain(context, 0.04, 4.1);
    return context.canvas;
}

/** A bright window: daylight sky over distant greenery, with frame and mullions. */
export function windowTexture(): CanvasTexture {
    return roomTexture(cachedTextureCanvas("windowTexture", drawWindow), 1, 1);
}

function drawWindow(): HTMLCanvasElement {
    const width = 512;
    const height = 640;
    const context = canvasContext(width, height);
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#dfeaf2");
    sky.addColorStop(0.55, "#eef3f4");
    sky.addColorStop(0.7, "#c9d6c0");
    sky.addColorStop(1, "#9fb39a");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(110,140,105,0.55)";
    for (let i = 0; i < 40; i++) {
        context.beginPath();
        context.arc(
            hash(i) * width,
            height * 0.72 + hash(i + 9) * 40,
            30 + hash(i + 50) * 50,
            0,
            Math.PI * 2,
        );
        context.fill();
    }
    context.fillStyle = "#d8d8d4";
    context.fillRect(0, 0, width, 18);
    context.fillRect(0, height - 18, width, 18);
    context.fillRect(0, 0, 18, height);
    context.fillRect(width - 18, 0, 18, height);
    context.fillRect(width / 2 - 6, 0, 12, height);
    context.fillRect(0, height * 0.38, width, 10);
    return context.canvas;
}

/** A small goban with a mid-game position, for background tournament tables. */
export function miniBoardTexture(seed: number): CanvasTexture {
    const canvas = cachedTextureCanvas(`miniBoardTexture/${seed}`, () => drawMiniBoard(seed));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function drawMiniBoard(seed: number): HTMLCanvasElement {
    const size = 256;
    const context = canvasContext(size, size);
    context.fillStyle = "#dcb675";
    context.fillRect(0, 0, size, size);
    const margin = 14;
    const step = (size - 2 * margin) / 18;
    context.strokeStyle = "rgba(40,30,20,0.75)";
    context.lineWidth = 1;
    for (let i = 0; i < 19; i++) {
        const p = margin + i * step;
        context.beginPath();
        context.moveTo(margin, p);
        context.lineTo(size - margin, p);
        context.moveTo(p, margin);
        context.lineTo(p, size - margin);
        context.stroke();
    }
    for (let i = 0; i < 60; i++) {
        const x = Math.floor(hash(seed * 97 + i) * 19);
        const y = Math.floor(hash(seed * 53 + i * 3.1) * 19);
        context.fillStyle = i % 2 ? "#f2f0ea" : "#1d1d1f";
        context.beginPath();
        context.arc(margin + x * step, margin + y * step, step * 0.46, 0, Math.PI * 2);
        context.fill();
    }
    return context.canvas;
}

/** Trowelled clay plaster: soft mottling, fine sand and a few straw fibres. */
export function plasterTexture(repeatX: number, repeatY: number): CanvasTexture {
    return roomTexture(cachedTextureCanvas("plasterTexture", drawPlaster), repeatX, repeatY);
}

function drawPlaster(): HTMLCanvasElement {
    const size = 512;
    const context = canvasContext(size, size);
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // Tileable low-frequency mottling from whole-period sines.
            const u = (x / size) * Math.PI * 2;
            const v = (y / size) * Math.PI * 2;
            const mottle =
                0.5 * Math.sin(u * 2 + Math.sin(v * 3) * 0.8) +
                0.35 * Math.sin(v * 2 + Math.sin(u * 5) * 0.6) +
                0.2 * Math.sin((u + v) * 7);
            const sand = hash(x * 3.7 + y * 191.3) - 0.5;
            const tone = 10 * mottle + 14 * sand;
            const index = (y * size + x) * 4;
            image.data[index] = 214 + tone;
            image.data[index + 1] = 199 + tone;
            image.data[index + 2] = 170 + tone * 0.9;
            image.data[index + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    context.strokeStyle = "rgba(150,118,70,0.35)";
    context.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
        const x = hash(i * 2.1) * size;
        const y = hash(i * 5.3 + 1) * size;
        const angle = hash(i * 9.7) * Math.PI * 2;
        const length = 4 + hash(i * 1.3) * 10;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        context.stroke();
    }
    return context.canvas;
}

/** Layered ink-wash mountain ridges for a sumi-e scroll, back to front. */
function inkRidges(
    context: CanvasRenderingContext2D,
    left: number,
    width: number,
    top: number,
    bottom: number,
): void {
    const layers = 4;
    for (let layer = 0; layer < layers; layer++) {
        const base = top + (bottom - top) * (0.3 + layer * 0.17);
        const peak = base - (bottom - top) * (0.32 - layer * 0.05);
        const alpha = 0.12 + layer * 0.12;
        const wash = context.createLinearGradient(0, peak, 0, base + 60);
        wash.addColorStop(0, `rgba(28,26,24,${alpha})`);
        wash.addColorStop(0.55, `rgba(28,26,24,${alpha * 0.55})`);
        wash.addColorStop(1, "rgba(28,26,24,0)");
        context.fillStyle = wash;
        context.beginPath();
        context.moveTo(left, base + 60);
        const steps = 48;
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const crest =
                Math.exp(-(((t - 0.3 - layer * 0.12) / 0.16) ** 2)) +
                0.6 * Math.exp(-(((t - 0.72 + layer * 0.05) / 0.12) ** 2)) +
                0.08 * Math.sin(t * 40 + layer);
            context.lineTo(left + t * width, base - (base - peak) * crest);
        }
        context.lineTo(left + width, base + 60);
        context.closePath();
        context.fill();
    }
}

/** A hanging scroll: brocade mounting around a sumi-e landscape with a pine and a seal. */
export function scrollTexture(): CanvasTexture {
    const canvas = cachedTextureCanvas("scrollTexture", drawScroll);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function drawScroll(): HTMLCanvasElement {
    const width = 384;
    const height = 1152;
    const context = canvasContext(width, height);
    const cloth = context.createLinearGradient(0, 0, width, 0);
    cloth.addColorStop(0, "#3f4a3b");
    cloth.addColorStop(0.5, "#56624f");
    cloth.addColorStop(1, "#3f4a3b");
    context.fillStyle = cloth;
    context.fillRect(0, 0, width, height);
    // Gold bands and the wooden roller ends.
    context.fillStyle = "#9c8858";
    context.fillRect(0, 120, width, 14);
    context.fillRect(0, height - 190, width, 14);
    context.fillStyle = "#2c211a";
    context.fillRect(0, 0, width, 16);
    context.fillRect(0, height - 24, width, 24);

    const left = 44;
    const top = 150;
    const paperWidth = width - 88;
    const paperHeight = height - 360;
    const paper = context.createLinearGradient(0, top, 0, top + paperHeight);
    paper.addColorStop(0, "#efe6cf");
    paper.addColorStop(1, "#e2d6b8");
    context.fillStyle = paper;
    context.fillRect(left, top, paperWidth, paperHeight);
    context.save();
    context.beginPath();
    context.rect(left, top, paperWidth, paperHeight);
    context.clip();
    inkRidges(context, left, paperWidth, top + paperHeight * 0.28, top + paperHeight * 0.95);

    // A leaning pine in the foreground: trunk, then clustered needle pads.
    context.strokeStyle = "rgba(24,22,20,0.85)";
    context.lineCap = "round";
    context.lineWidth = 7;
    const trunkX = left + paperWidth * 0.28;
    const trunkY = top + paperHeight * 0.96;
    context.beginPath();
    context.moveTo(trunkX, trunkY);
    context.bezierCurveTo(
        trunkX + 10,
        trunkY - 140,
        trunkX + 70,
        trunkY - 210,
        trunkX + 120,
        trunkY - 300,
    );
    context.stroke();
    context.lineWidth = 1.4;
    for (let pad = 0; pad < 6; pad++) {
        const t = 0.35 + pad * 0.12;
        const cx = trunkX + 120 * t + (pad % 2 ? 26 : -18);
        const cy = trunkY - 300 * t;
        for (let n = 0; n < 26; n++) {
            const angle = -Math.PI * (0.15 + 0.7 * hash(pad * 40 + n));
            const length = 12 + hash(pad * 13 + n) * 18;
            context.beginPath();
            context.moveTo(cx, cy);
            context.lineTo(cx + Math.cos(angle) * length * 1.6, cy + Math.sin(angle) * length);
            context.stroke();
        }
    }
    // A few birds far away.
    context.lineWidth = 1.6;
    for (let b = 0; b < 3; b++) {
        const bx = left + paperWidth * (0.6 + b * 0.08);
        const by = top + paperHeight * (0.12 + b * 0.03);
        context.beginPath();
        context.moveTo(bx - 7, by);
        context.quadraticCurveTo(bx - 3, by - 5, bx, by);
        context.quadraticCurveTo(bx + 3, by - 5, bx + 7, by);
        context.stroke();
    }
    context.restore();
    // Artist's seal.
    context.fillStyle = "#a8332a";
    context.fillRect(left + paperWidth - 46, top + paperHeight - 70, 20, 24);
    addGrain(context, 0.05, 2.2);
    return context.canvas;
}

/** Soft round contact shadow: dark in the middle, fading to clear at the rim. */
export function contactShadowTexture(): CanvasTexture {
    return new CanvasTexture(cachedTextureCanvas("contactShadowTexture", drawContactShadow));
}

function drawContactShadow(): HTMLCanvasElement {
    const size = 64;
    const context = canvasContext(size, size);
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(0,0,0,0.85)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.6)");
    gradient.addColorStop(0.75, "rgba(0,0,0,0.18)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return context.canvas;
}
