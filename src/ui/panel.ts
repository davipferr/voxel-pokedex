import {
  STYLE_LABELS,
  TYPE_COLORS,
  dexNumber,
  displaySlug,
  iconUrl,
  type Pokemon,
  type Species,
  type SpeciesRef,
  type SpriteChoice,
} from '../data/pokeapi';
import type { VoxelModel } from '../voxel/voxelize';

const STAT_LABELS: Record<string, string> = {
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense': 'Sp. Def',
  speed: 'Speed',
};

/** Above this a bar is full. Only a handful of Pokémon go higher (Blissey's HP is 255). */
const STAT_MAX = 200;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The Pokédex entry on the left. */
export class Panel {
  constructor(
    private readonly root: HTMLElement,
    private readonly onPick: (id: number) => void,
  ) {}

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  render(p: Pokemon, s: Species): void {
    this.q('#dex-number').textContent = dexNumber(p.id);
    this.q('#name').textContent = s.name || displaySlug(p.slug);
    this.q('#genus').textContent = s.genus;

    const badges = p.types.map((t) => {
      const b = el('span', 'type', t);
      b.style.setProperty('--c', TYPE_COLORS[t] ?? '#888');
      return b;
    });
    if (s.mythical) badges.push(el('span', 'tag', 'Mythical'));
    else if (s.legendary) badges.push(el('span', 'tag', 'Legendary'));
    this.q('#types').replaceChildren(...badges);

    this.q('#flavor').textContent = s.flavor;
    this.q('#height').textContent = `${(p.height / 10).toFixed(1)} m`;
    this.q('#weight').textContent = `${(p.weight / 10).toFixed(1)} kg`;

    const total = p.stats.reduce((sum, st) => sum + st.value, 0);
    const rows = p.stats.map((st) => {
      const row = el('div', 'stat');
      const bar = el('span', 'bar');
      const fill = el('span', 'fill');
      fill.style.width = `${Math.min(100, (st.value / STAT_MAX) * 100)}%`;
      // Red → yellow → green, like the games' summary screens.
      fill.style.setProperty('--hue', String(Math.min(130, st.value * 0.9)));
      bar.append(fill);
      row.append(el('span', 'label', STAT_LABELS[st.name] ?? st.name), el('span', 'value mono', String(st.value)), bar);
      return row;
    });
    const sum = el('div', 'stat total');
    sum.append(el('span', 'label', 'Total'), el('span', 'value mono', String(total)));
    this.q('#stats').replaceChildren(...rows, sum);
  }

  chain(stages: SpeciesRef[][] | null, current: number): void {
    const root = this.q('#evolution');
    if (!stages || (stages.length === 1 && stages[0].length === 1)) {
      root.replaceChildren(el('p', 'muted small', 'Does not evolve.'));
      return;
    }
    const parts: HTMLElement[] = [];
    stages.forEach((stage, i) => {
      if (i > 0) parts.push(el('span', 'arrow', '›'));
      const col = el('div', 'stage');
      for (const ref of stage) {
        const b = el('button', ref.id === current ? 'evo current' : 'evo');
        b.title = `${displaySlug(ref.slug)} ${dexNumber(ref.id)}`;
        const img = el('img');
        img.src = iconUrl(ref.id);
        img.alt = '';
        img.loading = 'lazy';
        b.append(img, el('span', '', displaySlug(ref.slug)));
        b.addEventListener('click', () => this.onPick(ref.id));
        col.append(b);
      }
      parts.push(col);
    });
    root.replaceChildren(...parts);
  }

  voxels(model: VoxelModel, sprite: SpriteChoice): void {
    this.q('#voxel-info').textContent =
      `${model.count.toLocaleString('en-US')} voxels from ${model.pixels.toLocaleString('en-US')} pixels · ` +
      `${model.width}×${model.height}×${model.depth} · ${STYLE_LABELS[sprite.style]}${sprite.shiny ? ' ✨' : ''}`;
  }
}
