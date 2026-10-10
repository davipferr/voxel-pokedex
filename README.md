# Voxel Pokédex

Every Pokémon sprite, rebuilt in 3D voxels. Each opaque pixel becomes a column of cubes, puffed out so the
body is round and the limbs stay thin. Switching Pokémon makes the cubes explode and reassemble into the
next one. Built with **TypeScript + Vite + Three.js** on **[PokéAPI](https://pokeapi.co)** (free, no key,
CORS-enabled, and so are its sprites).

```bash
npm install
npm run dev
```

`npm test` runs the unit tests. `npm run build` type-checks and builds to `dist/`, which deploys to GitHub
Pages through [.github/workflows/ci.yml](.github/workflows/ci.yml). Enable Pages with source "GitHub Actions"
in the repo settings.

## Controls

| | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next in National Dex order |
| <kbd>R</kbd> | Random Pokémon |
| <kbd>S</kbd> | Shiny on / off |
| <kbd>B</kbd> | Burst: explode and reassemble the current one |
| <kbd>A</kbd> | Turntable on / off |
| <kbd>/</kbd> | Search (name or number) |
| <kbd>F</kbd> | Fullscreen |
| Click | Poke the Pokémon: a ripple runs through the voxels, and it cries |

The URL keeps the Pokémon (`#25`, or `#pikachu`), so links are shareable. Settings (sprite style from
Gen I to Gen V, transition, inflation) are in the ⚙ panel.

## How it works

| Piece | File | Notes |
|---|---|---|
| PokéAPI client | [src/data/pokeapi.ts](src/data/pokeapi.ts) | `/pokemon/{id}` for types, stats, sprites and cry; `/pokemon-species/{id}` for the name, genus, Pokédex entry and evolution chain. Memoised, as the fair-use policy asks. Older sprite sets don't cover newer Pokémon (Emerald stops at #386), and Red/Blue has no shinies, so `pickSprite` falls back and the UI says so. Red/Blue's `front_default` has a white background, so it uses `front_transparent`. |
| Pixels | [src/voxel/image.ts](src/voxel/image.ts) | `crossOrigin = "anonymous"` on the `<img>`, or the canvas is tainted and `getImageData` throws. |
| Inflation | [src/voxel/voxelize.ts](src/voxel/voxelize.ts) | An exact **Euclidean distance transform** (Felzenszwalb–Huttenlocher, linear time, run down columns then along rows) gives each pixel its distance to the outline. The column's half-thickness is `3·√(d − ½)` times the inflation, which gives a dome: steep at the edge, flat across the middle. A thin arm has no pixel far from an edge, so it stays thin. |
| Hollowing, AO | [src/voxel/voxelize.ts](src/voxel/voxelize.ts) | Only voxels with an exposed face are kept (3–5× fewer). Each voxel's colour is darkened by how many of its 26 neighbours are solid, which is cheap baked ambient occlusion: creases go dark, ridges stay bright. |
| Transition plan | [src/scene/morph.ts](src/scene/morph.ts) | Both models are put in the same order (shuffled for *explode*, rows bottom-to-top for *morph*) and walked in step, so the i-th quantile of one meets the i-th quantile of the other. When the counts differ, the smaller side is reused, and each reuse starts or ends at scale 0, so voxels split off from or merge into a neighbour. Each pair gets a curved path (a quadratic Bézier with a scattered control point), a delay and a tumble. |
| GPU animation | [src/scene/voxels.ts](src/scene/voxels.ts) | One `InstancedMesh` of cubes. The plan goes up once, as instanced attributes. The vertex shader evaluates every flight from a single `uTime` uniform, so the CPU does nothing per frame. The shader is injected into `MeshStandardMaterial` with `onBeforeCompile`, so lighting, shadows (through a patched `customDepthMaterial`) and picking still come from three.js. The instance matrix holds each voxel's *resting* place, so raycasting works once it lands. |
| Spring easing | [src/scene/morph.ts](src/scene/morph.ts) | The path is driven by the step response of an underdamped spring (ζ = 0.55), which overshoots ~13% and settles. It's written twice, in TypeScript and GLSL. The TypeScript copy is how an interrupted transition knows where every voxel is, so the next one starts from there. |
| Voxel look | [src/scene/voxels.ts](src/scene/voxels.ts) | The fragment shader darkens each cube towards its edges (where the two largest of its local coordinates both near ±0.5), so a flat patch of one colour still reads as blocks. |
| Poke | [src/scene/voxels.ts](src/scene/voxels.ts) | A ray picks the voxel; the shader pushes voxels out from the hit point with a damped sine that arrives later the further away they are. |
| Framing | [src/main.ts](src/main.ts) | The camera eases to fit each model, and `setViewOffset` shifts the picture so the model is centred in the space the panel leaves free. |
