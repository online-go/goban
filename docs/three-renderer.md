# Optional 3D browser renderer

The standard `createGoban(config, data?)` and `setGobanRenderer("canvas" | "svg")` APIs remain synchronous. Canvas is still the default. The Node engine export is independent of browser renderers.

```ts
import { enableThreeGoban, SVGRenderer } from "goban";

const goban = new SVGRenderer({ board_div: host, interactive: true, square_size: 26 });
const three = await enableThreeGoban(goban, {
    tilt: 25,
    lighting: { preset: "studio" },
    onFallback: (error) => {
        console.warn("Using the SVG board", error);
        refreshRendererControl();
    },
});

three.configure({ tilt: 35, lighting: { preset: "daylight" } });
three.disable(); // immediately shows SVG
three.enable(); // tries a new WebGL context
goban.destroy(); // releases either presentation and the game
```

Use `createThreeGoban({ ...config, three: options }, data?)` to create a new SVG-backed game and request 3D in the same call. Both APIs resolve to a `ThreeRenderer` handle with the same `goban` and an `active` getter. Existing Canvas consumers continue to use Canvas. A consumer that needs live renderer switching starts that board with SVG, so it can keep the same browser input owner and engine throughout. An import failure leaves SVG active. Call `enableThreeGoban` again to retry loading after an import failure. After GPU loss use the handle's `enable()` to try a fresh context. Hosts can leave SVG active after repeated failures. The opt-in API does not persist user preferences.

## Options

| Field | Behavior |
| --- | --- |
| `boardStyle` | `tabletop` or `floor`. Defaults to `tabletop`. |
| `room` | Optional shaded room with bowls and capture lids. The tabletop style uses a hardwood table, ceramic tile floor and Suzhou-inspired lattice. The traditional goban and its bowls stand on a tatami floor with a shōji backdrop. The lid piles follow the selected move and show up to 13 stones per player. Defaults to off. |
| `tilt` | North-up presets of 0°, 15°, 25°, or 35°. Defaults to 15° for tabletop and 35° for floor. |
| `fieldOfView` | Perspective field of view in degrees. Defaults to 34°. |
| `distanceScale` | Minimum camera distance relative to the visible board span. Defaults to 1.65. |
| `lighting` | Independent studio, daylight, directional, or analysis preset. Optional azimuth in degrees and intensity from 0 to 2. |
| `maxPixelRatio` | Maximum WebGL drawing-buffer scale. Defaults to 1.75. |
| `onFallback` | Reports loading, activation, drawing, or context-loss failures after SVG is available. |
| `annotationInspection` | Optional hidden SVG artwork sink supplied when enabling or creating the view. Intended for verification. |

`configure` merges top-level fields. A supplied lighting object replaces the previous lighting object. Resolve board theme, separate black and white stone themes, custom colors, stone scale and shadow strength through the existing goban theme callbacks. Theme notifications update the current scene. Board image URLs require cross-origin permission from their hosts. Unavailable textures use the procedural surface. Image-based stone themes use their corresponding native material and finish. Custom stone image URLs do not replace the physical stones. The maximum supported board is 25 × 25.

## Rendering and input ownership

`SVGRenderer` owns the game engine, connectivity, board layout, move tree and browser input. An alternate `BoardView` supplies the visible board, picking, pen coordinates, drawing invalidation and resource cleanup. The `BoardViewState` snapshot calls the existing `NativeSpec` functions for rendered move, ghost, score and overlay decisions. The native transport retains its existing behavior. WebGL uses the same perspective camera to draw stone geometry, project SVG-derived textures on board and crown planes, and pick intersections. The SVG board stops redrawing while the alternate board is active. Move-tree and interface rendering remain independent.

The browser package emits deferred JavaScript chunks. Static hosting must serve them alongside the entry bundle and allow blob image URLs for rasterizing annotation artwork. Bundlers that consume goban source need to resolve the pinned Three.js dependency. Code using only Canvas or SVG does not initialize Three.js.

See the frontend repository's 3D Goban spike results for launch and verification details. Live OGS game integration and physical iPhone Safari validation remain separate milestones.

## Room clock and seating

The tabletop room clock mirrors the existing game clock events and highlights the player to move. Its two displays are blank when there is no game clock. It is a read-only part of the scene.

Follow-up: rotate the bowl and capture-lid positions 180° for a player seated as White so their supply bowl and capture lid occupy the near-side positions. Spectator and review views should keep the standard orientation.
