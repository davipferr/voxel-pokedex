/**
 * PokéAPI: https://pokeapi.co/docs/v2
 *
 * Free, keyless and CORS-enabled, and so are the sprites and cries on raw.githubusercontent.com, which
 * is what lets the canvas read sprite pixels. The fair-use policy asks clients to cache, so every
 * response is memoised for the session (and the browser's HTTP cache does the rest).
 */

const API = 'https://pokeapi.co/api/v2';
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

export const TYPE_COLORS: Record<string, string> = {
  normal: '#a8a77a',
  fire: '#ee8130',
  water: '#6390f0',
  electric: '#f7d02c',
  grass: '#7ac74c',
  ice: '#96d9d6',
  fighting: '#c22e28',
  poison: '#a33ea1',
  ground: '#e2bf65',
  flying: '#a98ff3',
  psychic: '#f95587',
  bug: '#a6b91a',
  rock: '#b6a136',
  ghost: '#735797',
  dragon: '#6f35fc',
  dark: '#705746',
  steel: '#b7b7ce',
  fairy: '#d685ad',
};

export interface SpeciesRef {
  id: number;
  /** API name, e.g. "mr-mime". */
  slug: string;
}

export interface Stat {
  name: string;
  value: number;
}

export interface Pokemon {
  id: number;
  slug: string;
  /** Decimetres. */
  height: number;
  /** Hectograms. */
  weight: number;
  types: string[];
  stats: Stat[];
  sprites: RawSprites;
  cry: string | null;
}

export interface Species {
  id: number;
  name: string;
  genus: string;
  flavor: string;
  evolutionChain: string | null;
  legendary: boolean;
  mythical: boolean;
}

/** The parts of the `sprites` object we read. Every leaf may be null. */
export interface RawSprites {
  front_default: string | null;
  front_shiny: string | null;
  versions?: Record<string, Record<string, Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<unknown>>();

/** Memoised GET. A failed request is forgotten, so the next attempt retries. */
function get<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`PokéAPI ${r.status} for ${url.replace(API, '')}`);
      return r.json() as Promise<T>;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** Trailing number of a resource URL: ".../pokemon-species/25/" → 25. */
export function idFromUrl(url: string): number {
  const m = /\/(\d+)\/?$/.exec(url);
  return m ? Number(m[1]) : NaN;
}

interface NamedResource {
  name: string;
  url: string;
}

/** All species in National Dex order (1025 as of Gen IX). */
export async function speciesList(): Promise<SpeciesRef[]> {
  const r = await get<{ results: NamedResource[] }>(`${API}/pokemon-species?limit=2000`);
  return r.results.map((s) => ({ id: idFromUrl(s.url), slug: s.name })).sort((a, b) => a.id - b.id);
}

interface RawPokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  types: { slot: number; type: NamedResource }[];
  stats: { base_stat: number; stat: NamedResource }[];
  sprites: RawSprites;
  cries?: { latest: string | null; legacy: string | null };
}

/** The default form of a species (`/pokemon/{id}` for id ≤ 1025). */
export async function pokemon(id: number): Promise<Pokemon> {
  const p = await get<RawPokemon>(`${API}/pokemon/${id}`);
  return {
    id: p.id,
    slug: p.name,
    height: p.height,
    weight: p.weight,
    types: p.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
    stats: p.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })),
    sprites: p.sprites,
    cry: p.cries?.latest ?? p.cries?.legacy ?? null,
  };
}

interface RawSpecies {
  id: number;
  names: { name: string; language: NamedResource }[];
  genera: { genus: string; language: NamedResource }[];
  flavor_text_entries: { flavor_text: string; language: NamedResource }[];
  evolution_chain: { url: string } | null;
  is_legendary: boolean;
  is_mythical: boolean;
}

const english = <T extends { language: NamedResource }>(list: T[]) => list.filter((e) => e.language.name === 'en');

export async function species(id: number): Promise<Species> {
  const s = await get<RawSpecies>(`${API}/pokemon-species/${id}`);
  const flavors = english(s.flavor_text_entries);
  return {
    id: s.id,
    name: english(s.names)[0]?.name ?? '',
    genus: english(s.genera)[0]?.genus ?? '',
    // Entries are oldest first; the newest one is written in modern style.
    flavor: flavors.length ? cleanFlavor(flavors[flavors.length - 1].flavor_text) : '',
    evolutionChain: s.evolution_chain?.url ?? null,
    legendary: s.is_legendary,
    mythical: s.is_mythical,
  };
}

interface RawChainLink {
  species: NamedResource;
  evolves_to: RawChainLink[];
}

/**
 * An evolution chain as stages: `[[Eevee], [Vaporeon, Jolteon, …]]`. Branches at the same depth share
 * a stage, which is how the games draw it.
 */
export function chainStages(root: RawChainLink): SpeciesRef[][] {
  const stages: SpeciesRef[][] = [];
  const walk = (link: RawChainLink, depth: number) => {
    (stages[depth] ??= []).push({ id: idFromUrl(link.species.url), slug: link.species.name });
    for (const next of link.evolves_to) walk(next, depth + 1);
  };
  walk(root, 0);
  return stages;
}

export async function evolutionChain(url: string): Promise<SpeciesRef[][]> {
  const c = await get<{ chain: RawChainLink }>(url);
  return chainStages(c.chain);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Flavor text keeps the line breaks of the game's text box: `\n` and form feeds, and a soft hyphen
 * where a word was split across lines. Older entries also spell it "POKéMON".
 */
export function cleanFlavor(text: string): string {
  return text
    .replace(/­\s*/g, '')
    .replace(/-\s*[\n\f]\s*/g, '-')
    .replace(/[\s\f]+/g, ' ')
    .replace(/POKéMON/g, 'Pokémon')
    .trim();
}

/** Readable name from an API slug, for lists where the species name isn't loaded yet. */
export function displaySlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const dexNumber = (id: number) => `#${String(id).padStart(4, '0')}`;

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

export type SpriteStyle = 'modern' | 'gen1' | 'gen2' | 'gen3' | 'gen4' | 'gen5';

/** Where each style lives in `sprites.versions`, and which keys hold the plain and shiny fronts. */
const STYLES: Record<Exclude<SpriteStyle, 'modern'>, { path: [string, string]; front: string; shiny: string | null }> = {
  // Red/Blue's `front_default` has a white background; the `_transparent` variant doesn't.
  gen1: { path: ['generation-i', 'red-blue'], front: 'front_transparent', shiny: null },
  gen2: { path: ['generation-ii', 'crystal'], front: 'front_transparent', shiny: 'front_shiny_transparent' },
  gen3: { path: ['generation-iii', 'emerald'], front: 'front_default', shiny: 'front_shiny' },
  gen4: { path: ['generation-iv', 'platinum'], front: 'front_default', shiny: 'front_shiny' },
  gen5: { path: ['generation-v', 'black-white'], front: 'front_default', shiny: 'front_shiny' },
};

export const STYLE_LABELS: Record<SpriteStyle, string> = {
  modern: 'Modern',
  gen1: 'Gen I · Red/Blue',
  gen2: 'Gen II · Crystal',
  gen3: 'Gen III · Emerald',
  gen4: 'Gen IV · Platinum',
  gen5: 'Gen V · Black/White',
};

export interface SpriteChoice {
  url: string;
  /** What was actually used, which differs from the request when it had to fall back. */
  style: SpriteStyle;
  shiny: boolean;
}

/**
 * The front sprite for a style. A Pokémon newer than the style's games falls back to the modern
 * sprite, and a style without shinies (Gen I) falls back to the plain one.
 */
export function pickSprite(sprites: RawSprites, style: SpriteStyle, shiny: boolean): SpriteChoice | null {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  if (style !== 'modern') {
    const def = STYLES[style];
    const game = sprites.versions?.[def.path[0]]?.[def.path[1]];
    const plain = str(game?.[def.front]);
    const shinyUrl = def.shiny ? str(game?.[def.shiny]) : null;
    if (shiny && shinyUrl) return { url: shinyUrl, style, shiny: true };
    if (plain) return { url: plain, style, shiny: false };
  }
  const shinyUrl = str(sprites.front_shiny);
  if (shiny && shinyUrl) return { url: shinyUrl, style: 'modern', shiny: true };
  const plain = str(sprites.front_default);
  return plain ? { url: plain, style: 'modern', shiny: false } : null;
}

/** Small icon by number, without fetching the Pokémon first. */
export const iconUrl = (id: number) => `${SPRITES}/${id}.png`;
