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
    CanvasTexture,
    Group,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    SRGBColorSpace,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { JGOFClock } from "../../engine";

function remainingTime(clock: JGOFClock | null, color: "black" | "white"): string {
    if (!clock) {
        return "–:––";
    }
    const player = color === "black" ? clock.black_clock : clock.white_clock;
    const time =
        clock.start_mode && clock.current_player === color
            ? (clock.start_time_left ?? 0)
            : player.main_time > 0
              ? player.main_time
              : (player.block_time_left ?? player.period_time_left ?? 0);
    const seconds = Math.max(0, Math.ceil(time / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    if (minutes < 60) {
        return minutes + ":" + remainder;
    }
    return Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0") + ":" + remainder;
}

export class RoomClock extends Group {
    private readonly body = new RoundedBoxGeometry(6.4, 0.93, 2.48, 2, 0.18);
    private readonly face = new PlaneGeometry(5.93, 2.02).rotateX(-Math.PI / 2);
    private readonly caseMaterial = new MeshStandardMaterial({ color: "#303738", roughness: 0.56 });
    private readonly faceMaterial = new MeshBasicMaterial();
    private readonly context: CanvasRenderingContext2D;
    private readonly texture: CanvasTexture;
    private display = "";

    public constructor(x: number) {
        super();
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas 2D unavailable");
        }
        this.context = context;
        this.texture = new CanvasTexture(canvas);
        this.texture.colorSpace = SRGBColorSpace;
        this.faceMaterial.map = this.texture;
        const body = new Mesh(this.body, this.caseMaterial);
        body.position.y = 0.465;
        body.castShadow = body.receiveShadow = true;
        const face = new Mesh(this.face, this.faceMaterial);
        face.position.y = 0.935;
        this.position.x = x;
        this.add(body, face);
    }

    public update(clock: JGOFClock | null): string | undefined {
        const black = remainingTime(clock, "black");
        const white = remainingTime(clock, "white");
        const turn = clock && !clock.pause_state ? clock.current_player : "";
        const display = [black, white, turn].join(",");
        if (display === this.display) {
            return undefined;
        }
        this.display = display;
        const context = this.context;
        context.fillStyle = "#282e2d";
        context.fillRect(0, 0, 384, 128);
        context.textAlign = "center";
        context.textBaseline = "middle";
        for (const [color, time, center] of [
            ["black", black, 98],
            ["white", white, 286],
        ] as const) {
            context.fillStyle = turn === color ? "#d5ddbb" : "#acb89e";
            context.fillRect(center - 86, 27, 172, 89);
            context.fillStyle = color === "black" ? "#161a19" : "#f5efe0";
            context.beginPath();
            context.arc(center, 14, 8, 0, 2 * Math.PI);
            context.fill();
            context.fillStyle = "#202819";
            context.font = (time.length > 6 ? "30" : "42") + "px monospace";
            context.fillText(time, center, 73, 158);
        }
        this.texture.needsUpdate = true;
        return display;
    }

    public dispose(): void {
        this.body.dispose();
        this.face.dispose();
        this.caseMaterial.dispose();
        this.faceMaterial.dispose();
        this.texture.dispose();
    }
}
