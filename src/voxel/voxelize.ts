/**
 * Sprite → voxels.
 *
 * A sprite is a flat picture, so depth has to be invented. Each opaque pixel becomes a column of
 * voxels whose thickness grows with its distance from the silhouette's edge: the outline stays thin,
 * the middle of the body bulges, and a thin limb stays thin because nothing in it is far from an edge.
 * This is "inflation", the same idea sketch-to-3D tools use, done here on a pixel grid.
 */

/** RGBA pixels, row-major from the top-left (the layout of `ImageData`). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface VoxelModel {
  count: number;
  /** Voxel centres, xyz. Y is up, centred on x/z, standing on y = 0 (the bottom row's centre is 0.5). */
  positions: Float32Array;
  /** sRGB 0–1, with ambient occlusion baked in. */
  colors: Float32Array;
  /** Extents in voxels. */
  width: number;
  height: number;
  depth: number;
  /** Opaque sprite pixels it was built from. */
  pixels: number;
}

export interface VoxelOptions {
  /** 0 = flat (one layer), 1 = fully rounded. */
  inflate: number;
  /** Pixels with alpha below this are empty. Sprites are 0 or 255, so anything in between works. */
  alphaThreshold?: number;
}

/** Half-thickness, in voxels, of a pixel `dist` pixels from the nearest empty one, at full inflation. */
const DEPTH = 3;

export function halfThickness(dist: number, inflate: number): number {
  // sqrt gives a dome: steep at the outline, flat across the middle. Edge pixels have dist = 1.
  return Math.round(inflate * DEPTH * Math.sqrt(Math.max(0, dist - 0.5)));
}

/** Bounding box of pixels with alpha ≥ threshold, or null for an empty image. */
export function opaqueBounds(px: Pixels, threshold = 128): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (px.data[(y * px.width + x) * 4 + 3] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------
// Euclidean distance transform
// ---------------------------------------------------------------------------

const FAR = 1e20;

/**
 * Felzenszwalb & Huttenlocher's 1D squared distance transform: the lower envelope of the parabolas
 * rooted at each cell, built left to right in one pass. `f` holds 0 for "source" cells and FAR
 * elsewhere; `d` receives squared distances. Linear time.
 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Exact Euclidean distance from every cell to the nearest empty cell (mask = 0). The 2D transform
 * separates: run the 1D one down every column, then along every row of the result. The grid must
 * contain at least one empty cell.
 */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? FAR : 0;

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Voxelize
// ---------------------------------------------------------------------------

/** Ambient occlusion from how many of the 26 neighbours are solid: creases darken, ridges stay bright. */
function occlusion(solidNeighbours: number): number {
  return Math.min(1, Math.max(0.62, 1.2 - solidNeighbours * 0.022));
}

export function voxelize(px: Pixels, opts: VoxelOptions): VoxelModel {
  const threshold = opts.alphaThreshold ?? 128;
  const box = opaqueBounds(px, threshold);
  if (!box) {
    return { count: 0, positions: new Float32Array(), colors: new Float32Array(), width: 0, height: 0, depth: 0, pixels: 0 };
  }

  // Crop with a one-pixel empty border, so the distance transform sees the edge of the image as empty.
  const W = box.w + 2;
  const H = box.h + 2;
  const mask = new Uint8Array(W * H);
  let pixels = 0;
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      if (px.data[((box.y + y) * px.width + box.x + x) * 4 + 3] >= threshold) {
        mask[(y + 1) * W + x + 1] = 1;
        pixels++;
      }
    }
  }

  const dist = distanceTransform(mask, W, H);
  // Half-thickness per column; -1 = no column.
  const half = new Int16Array(W * H).fill(-1);
  let maxHalf = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    half[i] = halfThickness(dist[i], opts.inflate);
    if (half[i] > maxHalf) maxHalf = half[i];
  }

  const columnHalf = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : half[y * W + x]);
  const solid = (x: number, y: number, z: number) => columnHalf(x, y) >= Math.abs(z);

  const positions: number[] = [];
  const colors: number[] = [];
  for (let y = 1; y <= box.h; y++) {
    for (let x = 1; x <= box.w; x++) {
      const h = half[y * W + x];
      if (h < 0) continue;
      const src = ((box.y + y - 1) * px.width + box.x + x - 1) * 4;
      const r = px.data[src] / 255;
      const g = px.data[src + 1] / 255;
      const b = px.data[src + 2] / 255;
      // `|| 0` turns the -0 of a flat column (z = -h with h = 0) into 0.
      for (let z = -h || 0; z <= h; z++) {
        const az = Math.abs(z);
        // Keep only voxels with an exposed face. The inside of the body would never be seen, and
        // dropping it cuts the count by 3–5×.
        const exposed =
          az === h ||
          columnHalf(x - 1, y) < az ||
          columnHalf(x + 1, y) < az ||
          columnHalf(x, y - 1) < az ||
          columnHalf(x, y + 1) < az;
        if (!exposed) continue;

        let n = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) if ((dx || dy || dz) && solid(x + dx, y + dy, z + dz)) n++;
        const ao = occlusion(n);

        positions.push(x - 1 - (box.w - 1) / 2, box.h - y + 0.5, z);
        colors.push(r * ao, g * ao, b * ao);
      }
    }
  }

  return {
    count: positions.length / 3,
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    width: box.w,
    height: box.h,
    depth: maxHalf * 2 + 1,
    pixels,
  };
}
