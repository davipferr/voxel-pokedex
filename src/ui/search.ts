import { displaySlug, type SpeciesRef } from '../data/pokeapi';

/** Lowercase, no accents, words joined by "-": the shape of an API slug ("Flabébé" → "flabebe"). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A National Dex number ("25", "#025") or a name. An exact name wins, then the first name that starts
 * with the query, then the first that contains it.
 */
export function resolveQuery(query: string, list: SpeciesRef[]): number | null {
  const q = query.trim();
  if (!q) return null;
  const num = /^#?0*(\d+)$/.exec(q);
  if (num) {
    const id = Number(num[1]);
    return list.some((s) => s.id === id) ? id : null;
  }
  const slug = normalize(q);
  if (!slug) return null;
  return (
    list.find((s) => s.slug === slug)?.id ??
    list.find((s) => s.slug.startsWith(slug))?.id ??
    list.find((s) => s.slug.includes(slug))?.id ??
    null
  );
}

/** Search box with name suggestions from a `<datalist>`. */
export function bindSearch(form: HTMLFormElement, input: HTMLInputElement, datalist: HTMLDataListElement, onGo: (query: string) => void) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onGo(input.value);
    input.select();
  });
  // Picking a suggestion fills the box with the option's full value, with no keypress; go straight away.
  input.addEventListener('input', (e) => {
    if (!(e instanceof InputEvent) || e.inputType === 'insertReplacementText') {
      if ([...datalist.options].some((o) => o.value === input.value)) onGo(input.value);
    }
  });
  return (list: SpeciesRef[]) => {
    datalist.replaceChildren(
      ...list.map((s) => {
        const o = document.createElement('option');
        o.value = displaySlug(s.slug);
        o.label = `#${s.id}`;
        return o;
      }),
    );
  };
}
