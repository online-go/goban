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

export const lightingPresets = {
    studio: { ambient: 1.1, key: 1.8, fill: 0.55, tint: "#fffaf3", azimuth: -132, shadow: 0.76 },
    daylight: { ambient: 0.88, key: 2.25, fill: 0.4, tint: "#ffd4a0", azimuth: -115, shadow: 0.87 },
    directional: { ambient: 0.72, key: 2.5, fill: 0.65, tint: "#f4f7ff", azimuth: 155, shadow: 1 },
    analysis: { ambient: 1.95, key: 0.5, fill: 0.27, tint: "#ffffff", azimuth: -132, shadow: 0.42 },
} as const;
export type LightingPreset = keyof typeof lightingPresets;

export interface LightingPreferences {
    preset: LightingPreset;
    azimuth: number;
    intensity: number;
}
