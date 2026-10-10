import { describe, expect, it } from 'vitest';

import { chainStages, cleanFlavor, displaySlug, idFromUrl, pickSprite, type RawSprites } from './data/pokeapi';
import { planTransition, restingPlan, sampleAt, seed, snapshotOf, spatialOrder, spring, type Snapshot } from './scene/morph';
import { normalize, resolveQuery } from './ui/search';
import { distanceTransform, halfThickness, opaqueBounds, voxelize, type Pixels } from './voxel/voxelize';

/** An RGBA image from rows of characters: '.' is transparent, any other letter is an opaque colour. */
function sprite(rows: string[], palette: Record<string, [number, number, number]> = {}): Pixels {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const [r, g, b] = palette[ch] ?? [255, 0, 0];
      data.set([r, g, b, 255], (y * width + x) * 4);
    }),
  );
  return { width, height, data };
}

/** Seeded PRNG (mulberry32), so planning is deterministic in tests. */
function rng(seedValue: number) {
  let a = seedValue;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const keyOf = (s: Snapshot, i: number) => `${s.positions[i * 3]},${s.positions[i * 3 + 1]},${s.positions[i * 3 + 2]}`;

// ---------------------------------------------------------------------------

describe('distance transform', () => {
  it('matches brute force', () => {
    const w = 9;
    const h = 7;
    const mask = new Uint8Array(w * h);
    // An irregular blob, empty around the edges.
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if ((x * 7 + y * 3) % 5 !== 0) mask[y * w + x] = 1;
    const d = distanceTransform(mask, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = Infinity;
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) if (!mask[yy * w + xx]) best = Math.min(best, Math.hypot(x - xx, y - yy));
        expect(d[y * w + x]).toBeCloseTo(best, 5);
      }
    }
  });

  it('is zero on empty cells', () => {
    const d = distanceTransform(new Uint8Array(4), 2, 2);
    expect([...d]).toEqual([0, 0, 0, 0]);
  });
});

describe('voxelize', () => {
  it('finds the opaque bounds', () => {
    expect(opaqueBounds(sprite(['....', '.xx.', '.x..', '....']))).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    expect(opaqueBounds(sprite(['..', '..']))).toBeNull();
  });

  it('makes one voxel per pixel when flat', () => {
    const m = voxelize(sprite(['.xx.', 'xxxx', '.xx.']), { inflate: 0 });
    expect(m.count).toBe(8);
    expect(m.pixels).toBe(8);
    expect(m.depth).toBe(1);
    expect(m.width).toBe(4);
    expect(m.height).toBe(3);
    for (let i = 0; i < m.count; i++) expect(m.positions[i * 3 + 2]).toBe(0);
  });

  it('stands on y = 0, centred on x, with the image the right way up', () => {
    const m = voxelize(sprite(['x..', 'xxx'], { x: [255, 255, 255] }), { inflate: 0 });
    const ys = [...Array(m.count)].map((_, i) => m.positions[i * 3 + 1]);
    expect(Math.min(...ys)).toBe(0.5);
    // The lone top pixel is on the left.
    const topIndex = ys.indexOf(1.5);
    expect(m.positions[topIndex * 3]).toBe(-1);
  });

  it('keeps the pixel colours', () => {
    const m = voxelize(sprite(['a'], { a: [255, 128, 0] }), { inflate: 0 });
    // A lone voxel has no neighbours, so no occlusion.
    expect(m.colors[0]).toBeCloseTo(1);
    expect(m.colors[1]).toBeCloseTo(128 / 255);
    expect(m.colors[2]).toBeCloseTo(0);
  });

  it('is thicker in the middle than at the edge, and symmetric front to back', () => {
    const rows = Array.from({ length: 15 }, () => 'x'.repeat(15));
    const m = voxelize(sprite(rows), { inflate: 1 });
    let centre = 0;
    let corner = 0;
    let front = 0;
    let back = 0;
    for (let i = 0; i < m.count; i++) {
      const [x, y, z] = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      if (x === 0 && y === 7.5) centre = Math.max(centre, z);
      if (x === -7 && y === 0.5) corner = Math.max(corner, z);
      if (z > 0) front++;
      if (z < 0) back++;
    }
    expect(centre).toBe(halfThickness(8, 1));
    expect(corner).toBe(halfThickness(1, 1));
    expect(centre).toBeGreaterThan(corner);
    expect(front).toBe(back);
    expect(m.depth).toBe(centre * 2 + 1);
  });

  it('hollows out the inside', () => {
    const rows = Array.from({ length: 15 }, () => 'x'.repeat(15));
    const m = voxelize(sprite(rows), { inflate: 1 });
    const set = new Set([...Array(m.count)].map((_, i) => `${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`));
    // The centre column's middle voxel is buried.
    expect(set.has('0,7.5,0')).toBe(false);
    expect(set.has(`0,7.5,${halfThickness(8, 1)}`)).toBe(true);
  });

  it('half-thickness grows with distance and inflation', () => {
    expect(halfThickness(1, 0)).toBe(0);
    expect(halfThickness(9, 1)).toBeGreaterThan(halfThickness(2, 1));
    expect(halfThickness(9, 1.5)).toBeGreaterThan(halfThickness(9, 1));
  });
});

describe('spring', () => {
  it('starts at 0, ends at exactly 1, and overshoots in between', () => {
    expect(spring(0)).toBe(0);
    expect(spring(1)).toBe(1);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, spring(t));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.25);
    expect(Math.abs(spring(0.999) - 1)).toBeLessThan(0.01);
  });
});

describe('transition planning', () => {
  const model = (n: number, colour = 1): Snapshot =>
    snapshotOf({
      count: n,
      positions: Float32Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? Math.floor(i / 3) : (i * 7) % 5)),
      colors: new Float32Array(n * 3).fill(colour),
    });

  for (const [n, m] of [
    [10, 10],
    [4, 13],
    [13, 4],
    [1, 50],
  ]) {
    it(`uses every voxel of both sides (${n} → ${m})`, () => {
      const a = model(n);
      const b = model(m);
      const plan = planTransition(a, b, 'morph', rng(1));
      expect(plan.count).toBe(Math.max(n, m));
      // Each target voxel is landed on by exactly one visible voxel.
      const landed = new Map<string, number>();
      for (let i = 0; i < plan.count; i++) {
        if (plan.scale[i * 2 + 1] === 0) continue;
        const k = `${plan.to[i * 3]},${plan.to[i * 3 + 1]},${plan.to[i * 3 + 2]}`;
        landed.set(k, (landed.get(k) ?? 0) + 1);
      }
      expect(landed.size).toBe(m);
      expect([...landed.values()].every((c) => c === 1)).toBe(true);
      // And each source voxel leaves visibly exactly once.
      expect([...plan.scale].filter((_, i) => i % 2 === 0 && plan.scale[i] === 1).length).toBe(n);
    });
  }

  it('ends exactly at the target, whatever the mode', () => {
    const b = model(20, 0.5);
    for (const mode of ['explode', 'morph', 'recolor'] as const) {
      const plan = planTransition(model(30), b, mode, rng(7));
      const end = sampleAt(plan, plan.end + 1);
      expect(end.count).toBe(20);
      const want = new Set([...Array(20)].map((_, i) => keyOf(b, i)));
      const got = new Set([...Array(end.count)].map((_, i) => keyOf(end, i)));
      expect(got).toEqual(want);
      expect([...end.colors].every((c) => Math.abs(c - 0.5) < 1e-6)).toBe(true);
    }
  });

  it('starts exactly at the source', () => {
    const a = model(12);
    const plan = planTransition(a, model(30), 'explode', rng(3));
    const start = sampleAt(plan, 0);
    expect(start.count).toBe(12);
    expect(new Set([...Array(12)].map((_, i) => keyOf(start, i)))).toEqual(new Set([...Array(12)].map((_, i) => keyOf(a, i))));
  });

  it('keeps every voxel in place when only the colour changes', () => {
    const a = model(25, 0.2);
    const b = model(25, 0.9);
    const plan = planTransition(a, b, 'recolor', rng(5));
    for (let i = 0; i < plan.count; i++) {
      for (let k = 0; k < 3; k++) expect(plan.from[i * 3 + k]).toBe(plan.to[i * 3 + k]);
    }
    // Mid-way, positions haven't moved.
    const mid = sampleAt(plan, 0.4);
    for (let i = 0; i < mid.count; i++) expect(keyOf(mid, i)).toBe(keyOf(a, spatialOrder(a)[i]));
  });

  it('grows the first model out of a single seed', () => {
    const plan = planTransition(seed(0, 0.5, 0), model(8), 'explode', rng(2));
    expect(sampleAt(plan, 0).count).toBe(0);
    expect(sampleAt(plan, plan.end).count).toBe(8);
  });

  it('a resting plan holds still', () => {
    const b = model(9);
    const plan = restingPlan(b);
    const s = sampleAt(plan, 0);
    for (let i = 0; i < 9; i++) expect(keyOf(s, i)).toBe(keyOf(b, i));
  });
});

describe('PokéAPI helpers', () => {
  it('reads ids from resource URLs', () => {
    expect(idFromUrl('https://pokeapi.co/api/v2/pokemon-species/25/')).toBe(25);
    expect(idFromUrl('https://pokeapi.co/api/v2/evolution-chain/10')).toBe(10);
  });

  it('cleans flavor text', () => {
    expect(cleanFlavor('This clever\nforest-\ndweller roasts\fberries.')).toBe('This clever forest-dweller roasts berries.');
    expect(cleanFlavor('A strange­\nly shaped POKéMON.')).toBe('A strangely shaped Pokémon.');
  });

  it('formats slugs', () => {
    expect(displaySlug('mr-mime')).toBe('Mr Mime');
    expect(displaySlug('pikachu')).toBe('Pikachu');
  });

  it('flattens evolution chains into stages', () => {
    type Link = { species: { name: string; url: string }; evolves_to: Link[] };
    const link = (id: number, name: string, next: Link[] = []): Link => ({
      species: { name, url: `https://pokeapi.co/api/v2/pokemon-species/${id}/` },
      evolves_to: next,
    });
    const eevee = link(133, 'eevee', [link(134, 'vaporeon'), link(135, 'jolteon'), link(136, 'flareon')]);
    expect(chainStages(eevee).map((s) => s.map((r) => r.id))).toEqual([[133], [134, 135, 136]]);
  });

  const sprites: RawSprites = {
    front_default: 'modern.png',
    front_shiny: 'modern-shiny.png',
    versions: {
      'generation-i': { 'red-blue': { front_default: 'white-bg.png', front_transparent: 'gen1.png' } },
      'generation-v': { 'black-white': { front_default: 'gen5.png', front_shiny: null } },
    },
  };

  it('picks sprites, falling back to what exists', () => {
    expect(pickSprite(sprites, 'modern', true)).toEqual({ url: 'modern-shiny.png', style: 'modern', shiny: true });
    expect(pickSprite(sprites, 'gen1', false)).toEqual({ url: 'gen1.png', style: 'gen1', shiny: false });
    // Gen I has no shinies: same style, plain sprite.
    expect(pickSprite(sprites, 'gen1', true)).toEqual({ url: 'gen1.png', style: 'gen1', shiny: false });
    expect(pickSprite(sprites, 'gen5', true)).toEqual({ url: 'gen5.png', style: 'gen5', shiny: false });
    // No Gen III sprite at all: modern.
    expect(pickSprite(sprites, 'gen3', false)).toEqual({ url: 'modern.png', style: 'modern', shiny: false });
    expect(pickSprite({ front_default: null, front_shiny: null }, 'modern', false)).toBeNull();
  });
});

describe('search', () => {
  const list = [
    { id: 25, slug: 'pikachu' },
    { id: 26, slug: 'raichu' },
    { id: 29, slug: 'nidoran-f' },
    { id: 122, slug: 'mr-mime' },
    { id: 669, slug: 'flabebe' },
  ];

  it('normalizes names into slugs', () => {
    expect(normalize('Mr. Mime')).toBe('mr-mime');
    expect(normalize('Flabébé')).toBe('flabebe');
    expect(normalize('Nidoran♀')).toBe('nidoran-f');
  });

  it('resolves numbers and names', () => {
    expect(resolveQuery('25', list)).toBe(25);
    expect(resolveQuery('#025', list)).toBe(25);
    expect(resolveQuery('999', list)).toBeNull();
    expect(resolveQuery('Mr. Mime', list)).toBe(122);
    expect(resolveQuery('Flabébé', list)).toBe(669);
    expect(resolveQuery('Nidoran♀', list)).toBe(29);
    expect(resolveQuery('rai', list)).toBe(26);
    expect(resolveQuery('chu', list)).toBe(25);
    expect(resolveQuery('zzz', list)).toBeNull();
    expect(resolveQuery('  ', list)).toBeNull();
  });
});
