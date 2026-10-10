import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  STYLE_LABELS,
  TYPE_COLORS,
  evolutionChain,
  pickSprite,
  pokemon,
  species as fetchSpecies,
  speciesList,
  type Pokemon,
  type Species,
  type SpeciesRef,
  type SpriteChoice,
  type SpriteStyle,
} from './data/pokeapi';
import type { TransitionMode } from './scene/morph';
import { VoxelCloud } from './scene/voxels';
import { Panel } from './ui/panel';
import { bindSearch, resolveQuery } from './ui/search';
import { bindSettings, loadSettings } from './ui/settings';
import { createToast } from './ui/toast';
import { loadPixels } from './voxel/image';
import { voxelize, type Pixels, type VoxelModel } from './voxel/voxelize';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
// A soft studio environment for the reflections; the lights below do the real work.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 1, 3000);
camera.position.set(40, 60, 190);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 30, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 25;
controls.maxDistance = 700;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.autoRotateSpeed = 1.4;

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(70, 140, 90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target);
// A coloured light from behind picks out the silhouette in the type colour.
const rim = new THREE.DirectionalLight(0xffffff, 1.6);
rim.position.set(-90, 50, -120);
scene.add(rim);

// Pedestal: a dark disc with a thin glowing band, scaled to the model.
const pedestal = new THREE.Group();
const top = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 1, 96),
  new THREE.MeshStandardMaterial({ color: 0x1c1b26, roughness: 0.85 }),
);
top.position.y = -0.5;
top.receiveShadow = true;
const bandMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, emissiveIntensity: 1.4, roughness: 0.6 });
const band = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.25, 96, 1, true), bandMaterial);
band.position.y = -0.12;
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(1.02, 1.1, 4, 96),
  new THREE.MeshStandardMaterial({ color: 0x121118, roughness: 0.9 }),
);
base.position.y = -3;
pedestal.add(top, band, base);
pedestal.scale.set(40, 1, 40);
scene.add(pedestal);

const cloud = new VoxelCloud();
scene.add(cloud.mesh);

// ---------------------------------------------------------------------------
// Camera framing
// ---------------------------------------------------------------------------

const frameGoal = { target: new THREE.Vector3(0, 30, 0), distance: 190, radius: 40, active: false };

/** Eases the camera to fit `model`, keeping the angle it's looking from. */
function frame(model: VoxelModel): void {
  const r = 0.5 * Math.hypot(model.width, model.height, model.depth);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  // The tighter of the vertical and horizontal fields of view decides the distance.
  const half = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect)) / 2;
  frameGoal.target.set(0, model.height * 0.45, 0);
  frameGoal.distance = THREE.MathUtils.clamp((r / Math.sin(half)) * 1.08, controls.minDistance, controls.maxDistance);
  frameGoal.radius = Math.max(model.width, model.depth) / 2 + 7;
  frameGoal.active = true;

  // The shadow camera only needs to cover the model and its pedestal.
  const s = Math.max(r, frameGoal.radius) * 1.3;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -s;
  cam.right = cam.top = s;
  cam.near = 1;
  cam.far = 500;
  cam.updateProjectionMatrix();
  sun.target.position.set(0, model.height / 2, 0);
}
controls.addEventListener('start', () => (frameGoal.active = false));

const tmp = new THREE.Vector3();
function updateFraming(dt: number): void {
  const k = 1 - Math.exp(-dt * 3.2);
  const pr = THREE.MathUtils.lerp(pedestal.scale.x, frameGoal.radius, k);
  pedestal.scale.set(pr, 1, pr);
  if (!frameGoal.active) return;
  controls.target.lerp(frameGoal.target, k);
  const dir = tmp.subVectors(camera.position, controls.target);
  const dist = THREE.MathUtils.lerp(dir.length(), frameGoal.distance, k);
  camera.position.copy(controls.target).addScaledVector(dir.normalize(), dist);
  if (Math.abs(dist - frameGoal.distance) < 0.5 && controls.target.distanceTo(frameGoal.target) < 0.1) frameGoal.active = false;
}

/** Shifts the picture away from the Pokédex panel, so the model is centred in the free space. */
function updateViewOffset(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dex = $('dex');
  const r = dex.getBoundingClientRect();
  let x = 0;
  let y = 0;
  if (w > 760) x = -(r.right + 8) / 2;
  else y = (h - r.top + 8) / 2;
  camera.setViewOffset(w, h, x, y, w, h);
  document.documentElement.style.setProperty('--dex-space', `${w > 760 ? r.width + 16 : 0}px`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const settings = loadSettings();
const toast = createToast($('toast'));

let list: SpeciesRef[] = [];
let maxId = 1025;

interface Current {
  id: number;
  pokemon: Pokemon;
  species: Species;
  sprite: SpriteChoice;
  pixels: Pixels;
  model: VoxelModel;
}
let current: Current | null = null;
let token = 0;

const panel = new Panel($('dex'), (id) => void go(id));

const typeColor = new THREE.Color();
function applyType(types: string[]): void {
  const primary = TYPE_COLORS[types[0]] ?? '#888888';
  document.documentElement.style.setProperty('--type', primary);
  typeColor.set(primary);
  rim.color.copy(typeColor);
  bandMaterial.emissive.copy(typeColor);
}

let cry: HTMLAudioElement | null = null;
function playCry(): void {
  // Browsers block sound until the visitor has interacted with the page.
  if (!settings.cries || !current?.pokemon.cry || !navigator.userActivation?.hasBeenActive) return;
  cry?.pause();
  cry = new Audio(current.pokemon.cry);
  cry.volume = 0.3;
  cry.play().catch(() => {});
}

const wrapId = (id: number) => ((((id - 1) % maxId) + maxId) % maxId) + 1;

/**
 * Shows Pokémon `id`. Without a mode, the transition is a recolour when only the colours can have
 * changed (same Pokémon, same sprite set: the shiny toggle), and the chosen transition otherwise.
 */
async function go(id: number, mode?: TransitionMode): Promise<void> {
  id = wrapId(id);
  const mine = ++token;
  $('loading').hidden = false;
  try {
    const [p, s] = await Promise.all([pokemon(id), fetchSpecies(id)]);
    if (mine !== token) return;
    const sprite = pickSprite(p.sprites, settings.style, settings.shiny);
    if (!sprite) throw new Error(`There's no sprite for ${s.name || p.slug}.`);
    const pixels = await loadPixels(sprite.url);
    if (mine !== token) return;
    const model = voxelize(pixels, { inflate: settings.inflate });
    if (!model.count) throw new Error(`The sprite for ${s.name} is empty.`);

    const recolor = current?.id === id && current.sprite.style === sprite.style;
    const isNew = current?.id !== id;
    cloud.show(model, mode ?? (recolor ? 'recolor' : settings.transition));
    current = { id, pokemon: p, species: s, sprite, pixels, model };

    panel.render(p, s);
    panel.voxels(model, sprite);
    applyType(p.types);
    frame(model);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    document.title = `${s.name} · Voxel Pokédex`;

    if (sprite.style !== settings.style) {
      toast(`${STYLE_LABELS[settings.style]} has no sprite for ${s.name}, so this is the modern one.`);
    } else if (settings.shiny && !sprite.shiny) {
      toast(`${STYLE_LABELS[sprite.style]} has no shiny sprites.`);
    }
    if (isNew) {
      playCry();
      panel.chain(null, id);
      if (s.evolutionChain) {
        evolutionChain(s.evolutionChain)
          .then((stages) => current?.id === id && panel.chain(stages, id))
          .catch(() => {});
      }
      prefetch(id);
    }
  } catch (err) {
    if (mine === token) toast(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    if (mine === token) $('loading').hidden = true;
  }
}

/** Warms the caches for the neighbours, so ← and → are instant. */
function prefetch(id: number): void {
  for (const n of [wrapId(id + 1), wrapId(id - 1)]) {
    pokemon(n)
      .then((p) => {
        const s = pickSprite(p.sprites, settings.style, settings.shiny);
        return s && loadPixels(s.url);
      })
      .catch(() => {});
  }
}

/** Rebuilds the current Pokémon from the pixels already loaded (the inflation slider). */
function revoxelize(): void {
  if (!current) return;
  const model = voxelize(current.pixels, { inflate: settings.inflate });
  cloud.show(model, 'morph');
  current.model = model;
  panel.voxels(model, current.sprite);
  frame(model);
}

const randomId = () => 1 + Math.floor(Math.random() * maxId);

function idFromHash(): number | null {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return null;
  if (/^\d+$/.test(h)) return Number(h);
  return list.length ? resolveQuery(h, list) : null;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const styleSelect = $<HTMLSelectElement>('style');
for (const [value, label] of Object.entries(STYLE_LABELS) as [SpriteStyle, string][]) {
  styleSelect.append(new Option(label, value));
}

const syncSettings = bindSettings($('settings'), settings, (key) => {
  if (key === 'autoRotate') controls.autoRotate = settings.autoRotate;
  else if (key === 'inflate') revoxelize();
  else if (key === 'shiny' && current) void go(current.id);
  else if (key === 'style' && current) void go(current.id, 'morph');
});
controls.autoRotate = settings.autoRotate;

const fillSearch = bindSearch($<HTMLFormElement>('search-form'), $<HTMLInputElement>('search'), $<HTMLDataListElement>('species-names'), (q) => {
  const id = resolveQuery(q, list);
  if (id) void go(id);
  else if (q.trim()) toast(`No Pokémon matches “${q.trim()}”.`);
});

$('prev').addEventListener('click', () => current && void go(current.id - 1));
$('next').addEventListener('click', () => current && void go(current.id + 1));
$('random').addEventListener('click', () => void go(randomId()));
$('burst').addEventListener('click', () => current && cloud.show(current.model, 'explode'));
$('settings-toggle').addEventListener('click', () => ($('settings').hidden = !$('settings').hidden));
$('fullscreen').addEventListener('click', toggleFullscreen);
$('collapse').addEventListener('click', () => {
  const collapsed = $('dex').classList.toggle('collapsed');
  $('collapse').textContent = collapsed ? '+' : '–';
  updateViewOffset();
});

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}

window.addEventListener('hashchange', () => {
  const id = idFromHash();
  if (id && id !== current?.id) void go(id);
});

window.addEventListener('keydown', (e) => {
  const t = e.target;
  if ((t instanceof Element && t.matches('input:not([type=checkbox]):not([type=range]), select, textarea')) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' && current) void go(current.id - 1);
  else if (k === 'arrowright' && current) void go(current.id + 1);
  else if (k === 'r') void go(randomId());
  else if (k === 'b' && current) cloud.show(current.model, 'explode');
  else if (k === 's') {
    settings.shiny = !settings.shiny;
    syncSettings();
    if (current) void go(current.id);
  } else if (k === 'a') {
    settings.autoRotate = controls.autoRotate = !settings.autoRotate;
    syncSettings();
  } else if (k === 'f') toggleFullscreen();
  else if (k === '/') $('search').focus();
  else return;
  e.preventDefault();
});

// Poke: a click (not a drag) on the model.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayFrom(e: PointerEvent): THREE.Raycaster {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}
let down: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 500;
  down = null;
  if (!click) return;
  const hit = cloud.pick(rayFrom(e));
  if (hit) {
    cloud.poke(hit);
    playCry();
  }
});
// Hover: at most one raycast per frame, and none while dragging.
let hover: PointerEvent | null = null;
canvas.addEventListener('pointermove', (e) => (hover = e.buttons ? null : e));
canvas.addEventListener('pointerleave', () => {
  hover = null;
  canvas.classList.remove('pointer');
});

function onResize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateViewOffset();
}
window.addEventListener('resize', onResize);
new ResizeObserver(updateViewOffset).observe($('dex'));
onResize();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

speciesList()
  .then((l) => {
    list = l;
    maxId = l.length ? l[l.length - 1].id : maxId;
    fillSearch(l);
    // A name in the URL (#pikachu) needs the list to resolve.
    if (!current && token === 0) void go(idFromHash() ?? 25);
  })
  .catch(() => toast('Could not load the Pokémon list. Search by number still works.', 'error'));

const initial = decodeURIComponent(location.hash.slice(1));
if (!initial || /^\d+$/.test(initial)) void go(initial ? Number(initial) : 25);

function tick(dt: number): void {
  cloud.update(dt);
  updateFraming(dt);
  controls.update(dt);
  if (hover) {
    canvas.classList.toggle('pointer', cloud.pick(rayFrom(hover)) !== null);
    hover = null;
  }
  renderer.render(scene, camera);
}

const timer = new THREE.Timer();
timer.connect(document);
renderer.setAnimationLoop((time) => {
  timer.update(time);
  // Clamped so a backgrounded tab doesn't jump the animations on return.
  tick(Math.min(timer.getDelta(), 0.05));
});

// Dev only: lets a test harness step frames by hand (a hidden tab gets no animation frames).
if (import.meta.env.DEV) Object.assign(window, { __dbg: { tick, cloud, camera } });
