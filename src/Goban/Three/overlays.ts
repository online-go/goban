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

import { Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Texture, type Group } from "three";
import type {
    NativeGhost,
    NativeLastMove,
    NativeOverlay,
    NativePenMark,
    NativeShape,
} from "../NativeTransport";
import type { BoardViewState } from "../BoardView";
import { contains, crownHeight, type BoardProjection, type Point } from "./projection";

type Attributes = Record<string, string | number>;
const unit = 96;
const boardInk = 0.013;
const stoneInk = crownHeight + 0.002;
const rankDigits = "〇一二三四五六七八九";

function numericRank(rank: number): string {
    if (rank < 10) {
        return rankDigits[rank];
    }
    const tens = Math.floor(rank / 10);
    return (tens > 1 ? rankDigits[tens] : "") + "十" + (rank % 10 ? rankDigits[rank % 10] : "");
}

function svg(tag: string, attributes: Attributes, text?: string): SVGElement {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function glyph(
    kind: NativeShape["kind"],
    x: number,
    y: number,
    size: number,
    attrs: Attributes,
): SVGElement {
    if (kind === "circle") {
        return svg("circle", { cx: x, cy: y, r: size, ...attrs });
    }
    if (kind === "square") {
        return svg("rect", {
            x: x - size,
            y: y - size,
            width: 2 * size,
            height: 2 * size,
            ...attrs,
        });
    }
    const d =
        kind === "triangle"
            ? `M ${x},${y - size} L ${x + size},${y + 0.7 * size} H ${x - size} Z`
            : `M ${x - size},${y - size} l ${2 * size},${2 * size} M ${x + size},${y - size} l ${-2 * size},${2 * size}`;
    return svg("path", { d, ...attrs });
}

function inkMesh(elevation: number, order: number): Mesh<PlaneGeometry, MeshBasicMaterial> {
    const mesh = new Mesh(
        new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
    );
    mesh.renderOrder = order;
    mesh.position.y = elevation;
    mesh.visible = false;
    return mesh;
}

export class BoardOverlays {
    private readonly surface = inkMesh(boardInk, 3.5);
    private readonly crowns = inkMesh(stoneInk, 6);
    private readonly hover = inkMesh(stoneInk + 0.001, 7);
    private revision = 0;
    private hoverRevision = 0;
    private hoverKey = "";
    private hoverReady = false;

    public constructor(
        private readonly inspection: HTMLDivElement | undefined,
        group: Group,
    ) {
        group.add(this.surface, this.crowns, this.hover);
    }

    private texture(image: HTMLImageElement | HTMLCanvasElement): Texture {
        const texture = new Texture(image);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return texture;
    }

    private async raster(artwork: SVGElement): Promise<HTMLImageElement> {
        artwork.setAttribute("font-family", "Verdana, Arial, sans-serif");
        artwork.setAttribute("font-weight", "700");
        const data = new XMLSerializer().serializeToString(artwork);
        const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
        const image = new Image();
        try {
            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = reject;
                image.src = url;
            });
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    public reset(): void {
        this.revision++;
        this.hoverRevision++;
        this.surface.visible = false;
        this.crowns.visible = false;
        this.hover.visible = false;
        this.inspection?.replaceChildren();
    }

    public dispose(): void {
        this.reset();
        for (const mesh of [this.surface, this.crowns, this.hover]) {
            mesh.geometry.dispose();
            mesh.material.map?.dispose();
            mesh.material.dispose();
            mesh.removeFromParent();
        }
    }

    public async redraw(
        projection: BoardProjection,
        fixture: BoardViewState,
        axisColor: string,
        overlays: NativeOverlay[],
        last: NativeLastMove | null,
        pen: NativePenMark[],
    ): Promise<void> {
        const revision = ++this.revision;
        const { bounds } = projection;
        const origin = { x: bounds.left - 1.5, y: bounds.top - 1.5 };
        const local = (point: Point) => ({
            x: (point.x - origin.x) * unit,
            y: (point.y - origin.y) * unit,
        });
        const width = (bounds.right - bounds.left + 3) * unit;
        const height = (bounds.bottom - bounds.top + 3) * unit;
        const surfaceSvg = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}` });
        const crownSvg = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}` });

        const surface = document.createDocumentFragment();
        const crowns = document.createDocumentFragment();
        const label = (point: Point, text: string) => {
            surface.append(
                svg(
                    "text",
                    {
                        ...local(point),
                        "class": "axis",
                        "fill": axisColor,
                        "text-anchor": "middle",
                        "dominant-baseline": "central",
                        "font-size": Math.min(
                            unit * 0.37,
                            (15 * unit) / projection.cellSize(point),
                        ),
                    },
                    text,
                ),
            );
        };
        for (let x = bounds.left; x <= bounds.right; x++) {
            const file =
                fixture.labelSystem === "1-1"
                    ? String(x + 1)
                    : fixture.prettyCoordinates(x, 0).replace(/\d+$/, "");
            if (fixture.labels.top) {
                label({ x, y: bounds.top - 0.99 }, file);
            }
            if (fixture.labels.bottom) {
                label({ x, y: bounds.bottom + 0.99 }, file);
            }
        }
        for (let y = bounds.top; y <= bounds.bottom; y++) {
            const rank =
                fixture.labelSystem === "1-1" ? numericRank(y + 1) : String(fixture.height - y);
            if (fixture.labels.left) {
                label({ x: bounds.left - 0.99, y }, rank);
            }
            if (fixture.labels.right) {
                label({ x: bounds.right + 0.99, y }, rank);
            }
        }

        const ink = svg("g", {});
        for (const overlay of overlays) {
            if (!contains(bounds, overlay)) {
                continue;
            }
            const real = fixture.stoneAt(overlay);
            const onStone = !!(real || overlay.stone);
            const { x, y } = local(overlay);
            const key = `${overlay.x},${overlay.y}`;
            const group = svg("g", {
                "data-mark": key,
                "data-anchor": onStone ? "crown" : "surface",
            });

            if (overlay.ownership) {
                ink.append(
                    glyph("square", x, y, unit * overlay.ownership.size, {
                        "data-cell": key,
                        "data-kind": "ownership",
                        "fill": overlay.ownership.color === 1 ? "#232a25" : "#fff4dd",
                        "opacity": 0.8,
                    }),
                );
            }
            if (overlay.territory) {
                ink.append(
                    glyph("square", x, y, unit * 0.15, {
                        "data-cell": key,
                        "data-kind": "territory",
                        "fill": overlay.territory.fill ?? "none",
                        "stroke": overlay.territory.stroke,
                        "stroke-width": unit * 0.03,
                    }),
                );
            }
            if (overlay.ring) {
                group.append(
                    glyph("circle", x, y, unit * 0.38, {
                        "fill": "none",
                        "stroke": overlay.ring.borderColor,
                        "stroke-width": unit * 0.035,
                    }),
                );
            }
            if (overlay.xmark) {
                group.append(
                    glyph("cross", x, y, unit * 0.29, {
                        "data-kind": "removal",
                        "fill": "none",
                        "stroke": overlay.xmark.color,
                        "opacity": overlay.xmark.alpha,
                        "stroke-width": unit * 0.1,
                    }),
                );
            }
            for (const mark of overlay.shapes ?? []) {
                group.append(
                    glyph(mark.kind, x, y + mark.dy * unit, unit * 0.24 * mark.scale, {
                        "data-kind": mark.kind,
                        "fill": "none",
                        "stroke": mark.color,
                        "opacity": mark.alpha,
                        "stroke-width": unit * 0.055,
                        "stroke-linejoin": "round",
                    }),
                );
            }
            if (overlay.badge) {
                group.append(
                    glyph("triangle", x, y + 0.3 * unit, 0.15 * unit, {
                        "data-kind": "quality",
                        "fill": overlay.badge.color,
                        "stroke": "#292a25",
                        "stroke-width": unit * 0.035,
                    }),
                );
            }
            for (const text of overlay.texts ?? []) {
                const font =
                    Math.min(
                        text.maxHeight * 1.12,
                        text.maxWidth / (0.57 * Math.max(1, text.value.length)),
                    ) * unit;
                group.append(
                    svg(
                        "text",
                        {
                            "data-kind": "label",
                            x,
                            "y": y + text.dy * unit,
                            "class": "mark-text",
                            "text-anchor": "middle",
                            "dominant-baseline": "central",
                            "fill": text.color,
                            "opacity": text.alpha,
                            "font-size": font,
                            "paint-order": "stroke",
                            "stroke": text.color === "#fff9ef" ? "#161512" : "#fff8e9",
                            "stroke-width": unit * 0.021,
                            "stroke-opacity": 0.68,
                        },
                        text.value,
                    ),
                );
            }
            if (group.childElementCount) {
                (onStone ? crowns : ink).append(group);
            }
        }

        if (last && contains(bounds, last)) {
            const { x, y } = local(last);
            const attrs = {
                "data-last": `${last.x},${last.y}`,
                "fill": "none",
                "stroke": last.color,
                "opacity": last.alpha,
                "stroke-width": unit * 0.06,
            };
            const onStone = fixture.stoneAt(last);
            (onStone ? crowns : ink).append(
                last.style === "circle"
                    ? glyph("circle", x, y, unit * last.radius, attrs)
                    : svg("path", {
                          d: `M${x - unit * 0.2} ${y}h${unit * 0.4} M${x} ${y - unit * 0.2}v${unit * 0.4}`,
                          ...attrs,
                      }),
            );
        }

        const clip = svg("clipPath", { id: "board-pen-clip" });
        clip.append(
            svg("rect", {
                ...local({ x: bounds.left - 0.5, y: bounds.top - 0.5 }),
                width: (bounds.right - bounds.left + 1) * unit,
                height: (bounds.bottom - bounds.top + 1) * unit,
            }),
        );
        const strokes = svg("g", { "clip-path": "url(#board-pen-clip)" });
        for (const stroke of pen) {
            const points = [];
            for (let i = 0; i + 1 < stroke.points.length; i += 2) {
                const { x, y } = local({ x: stroke.points[i], y: stroke.points[i + 1] });
                points.push(`${x},${y}`);
            }
            strokes.append(
                svg("polyline", {
                    "data-kind": "pen",
                    "points": points.join(" "),
                    "stroke": stroke.color,
                    "stroke-width": unit * 0.085,
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "fill": "none",
                }),
            );
        }
        ink.append(strokes);
        surfaceSvg.append(surface, clip, ink);
        crownSvg.append(crowns);
        const images = await Promise.all([this.raster(surfaceSvg), this.raster(crownSvg)]);
        if (revision !== this.revision) {
            return;
        }
        this.inspection?.replaceChildren(surfaceSvg, crownSvg);
        for (const [index, mesh] of [this.surface, this.crowns].entries()) {
            mesh.material.map?.dispose();
            mesh.material.map = this.texture(images[index]);
            mesh.material.needsUpdate = true;
            mesh.position.x = origin.x + width / (2 * unit);
            mesh.position.z = origin.y + height / (2 * unit);
            mesh.scale.set(width / unit, 1, height / unit);
            mesh.visible = true;
            const artwork = index === 0 ? surfaceSvg : crownSvg;
            artwork.setAttribute("data-elevation", String(mesh.position.y));
            artwork.setAttribute("data-origin-x", String(origin.x));
            artwork.setAttribute("data-origin-y", String(origin.y));
            artwork.setAttribute("data-unit", String(unit));
        }
    }

    public preview(
        point: Point | null,
        ghost: NativeGhost | null,
        occupied: boolean,
        ready: () => void,
    ): void {
        if (!point || !ghost) {
            this.hover.visible = false;
            return;
        }
        const raised = occupied || !!ghost.stone;
        this.hover.position.set(point.x, (raised ? stoneInk : boardInk) + 0.001, point.y);
        const key = JSON.stringify([
            ghost.stone,
            ghost.shapes,
            ghost.texts,
            ghost.xmark,
            ghost.territory,
            occupied,
        ]);
        if (key === this.hoverKey) {
            this.hover.visible = this.hoverReady;
            return;
        }
        this.hoverKey = key;
        this.hoverReady = false;
        this.hover.visible = false;
        const revision = ++this.hoverRevision;
        const center = unit / 2;
        const art = svg("svg", { width: unit, height: unit, viewBox: `0 0 ${unit} ${unit}` });
        if (ghost.stone && !occupied) {
            art.append(
                glyph("circle", center, center, unit * 0.27, {
                    "fill": "none",
                    "stroke": "#83e0c8",
                    "stroke-width": unit * 0.05,
                    "stroke-dasharray": `${unit * 0.08} ${unit * 0.055}`,
                }),
            );
        }
        for (const mark of ghost.shapes ?? []) {
            art.append(
                glyph(mark.kind, center, center + mark.dy * unit, unit * 0.24 * mark.scale, {
                    "fill": "none",
                    "stroke": mark.color,
                    "opacity": mark.alpha,
                    "stroke-width": unit * 0.055,
                }),
            );
        }
        for (const text of ghost.texts ?? []) {
            art.append(
                svg(
                    "text",
                    {
                        "x": center,
                        "y": center + text.dy * unit,
                        "fill": text.color,
                        "opacity": text.alpha,
                        "text-anchor": "middle",
                        "dominant-baseline": "central",
                        "font-size":
                            Math.min(
                                text.maxHeight,
                                text.maxWidth / (0.57 * Math.max(1, text.value.length)),
                            ) * unit,
                    },
                    text.value,
                ),
            );
        }
        if (ghost.xmark) {
            art.append(
                glyph("cross", center, center, unit * 0.29, {
                    "stroke": ghost.xmark.color,
                    "opacity": occupied ? 1 : ghost.xmark.alpha,
                    "stroke-width": unit * 0.09,
                }),
            );
        }
        if (ghost.territory) {
            art.append(
                glyph("square", center, center, unit * 0.15, {
                    "fill": ghost.territory.fill ?? "none",
                    "stroke": ghost.territory.stroke,
                    "stroke-width": unit * 0.03,
                }),
            );
        }
        if (!art.childElementCount) {
            return;
        }
        void this.raster(art)
            .then((image) => {
                if (revision === this.hoverRevision) {
                    this.hover.material.map?.dispose();
                    this.hover.material.map = this.texture(image);
                    this.hover.material.needsUpdate = true;
                    this.hoverReady = true;
                    ready();
                }
            })
            .catch(() => {
                // A failed hover preview should not interrupt an otherwise visible board.
            });
    }
}
