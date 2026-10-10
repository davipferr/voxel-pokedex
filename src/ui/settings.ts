/**
 * User settings, bound to `[data-setting]` inputs and remembered in localStorage (a per-viewer
 * convenience: it can be missing or throw in private mode, and the defaults apply then).
 */

import type { SpriteStyle } from '../data/pokeapi';
import type { TransitionMode } from '../scene/morph';

export interface Settings {
  style: SpriteStyle;
  shiny: boolean;
  transition: Exclude<TransitionMode, 'recolor'>;
  inflate: number;
  autoRotate: boolean;
  cries: boolean;
}

export const DEFAULTS: Settings = {
  style: 'modern',
  shiny: false,
  transition: 'explode',
  inflate: 1,
  autoRotate: true,
  cries: true,
};

const KEY = 'voxel-pokedex:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

type Input = HTMLInputElement | HTMLSelectElement;

/**
 * Two-way binds inputs with `data-setting="key"` to `settings`; calls `onChange` after each edit.
 * Returns `sync`, which pushes `settings` back into the inputs after a change made in code.
 */
export function bindSettings(root: ParentNode, settings: Settings, onChange: (key: keyof Settings) => void) {
  const inputs = [...root.querySelectorAll<Input>('[data-setting]')];
  const sync = () => {
    for (const input of inputs) {
      const key = input.dataset.setting as keyof Settings;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = settings[key] as boolean;
      else input.value = String(settings[key]);
    }
  };
  for (const input of inputs) {
    // Sliders fire `input` continuously while dragging; re-voxelizing on every step would restart
    // the transition dozens of times, so they report on release.
    const event = input instanceof HTMLInputElement && input.type === 'range' ? 'change' : 'input';
    input.addEventListener(event, () => {
      const key = input.dataset.setting as keyof Settings;
      const s = settings as unknown as Record<string, unknown>;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') s[key] = input.checked;
      else if (input instanceof HTMLInputElement && input.type === 'range') s[key] = Number(input.value);
      else s[key] = input.value;
      saveSettings(settings);
      onChange(key);
    });
  }
  sync();
  return sync;
}
