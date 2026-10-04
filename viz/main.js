// main.js - the spatial inbox. Live data from /api/state, two scenes over one model, a DOM panel
// for reading and acting. The renderer, loop and disposal wiring come from the 3dviz scaffold.
import * as THREE from 'three';
import { api } from './api.js';
import { buildModel, readLastSeen, writeLastSeen, fmtAgo, fmtTime } from './model.js';
import { createPanel } from './panel.js';
import { installViewer } from './viewer-contract.js';
import { createCameraRig } from './rigs/camera-orbit-follow.js';
import { createStudioRig } from './rigs/lighting-studio.js';
import { createPostStack } from './rigs/post-stack.js';
import { createPicker, createSelectionMarker, PALETTE } from './scenes/shared.js';
import { createPedestals } from './scenes/pedestals.js';
import { createRiver } from './scenes/river.js';

// Source: knowledge.lighting-mood-dark-studio-product, scaled from a 2.8 m product set to a 12 m
// floor: panel sizes and distance x4, intensities kept. No bloom: labels must stay crisp.
export const LOOK = {
  toneMapping: 'ACESFilmicToneMapping', exposure: 1.25,
  background: PALETTE.white,
  camera: { fovDeg: 38, minPolarDeg: 12, maxPolarDeg: 86, minDistM: 1.2, maxDistM: 60 },
  studio: { subject: [0, 0.6, 0], distance: 11, environmentIntensity: 0.18,
    key: { color: '#ffffff', intensity: 11, width: 5, height: 7, elevationDeg: 42, azimuthDeg: 315 },
    fill: { color: '#eaf0ff', intensity: 4.5, width: 8, height: 5, elevationDeg: 18, azimuthDeg: 60 },
    rim: { color: '#ffffff', intensity: 5, width: 1.6, height: 6, elevationDeg: 25, azimuthDeg: 170 },
    contact: { color: '#ffffff', intensity: 0.5, mapSize: 2048, bias: -0.0001, normalBias: 0.02, extent: 16 } },
  post: { enabled: true, vignette: 0.28 }
};
// What the visual channels encode. Rendered into #legend so the mapping is declared, not implied.
const LEGEND = {
  pedestals: [['Stack height', 'unread finished work'], ['Lime card', 'finished, unread'], ['Rose / amber tint', 'failed / partial'], ['Grey plate', 'reviewed'], ['Green orb', 'in progress'], ['Amber flag', 'agent needs you'], ['Spot brightness', 'how much waits']],
  river: [['Left → right', 'older → now'], ['Floating lime slab', 'finished, unread'], ['Flat slab', 'reviewed'], ['Green at the wall', 'in progress'], ['Amber plane', 'when you left'], ['Amber flag', 'agent needs you']]
};

const canvas = document.querySelector('#world'), viewport = canvas.parentElement;
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch (cause) {
  const box = document.querySelector('#error'); box.hidden = false; box.textContent = 'This view needs WebGL.'; throw cause;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE[LOOK.toneMapping]; renderer.toneMappingExposure = LOOK.exposure;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene(); scene.background = new THREE.Color(LOOK.background);
const camera = new THREE.PerspectiveCamera(LOOK.camera.fovDeg, 1, 0.05, 400);
const studio = createStudioRig(scene, renderer, LOOK.studio);
let loop = null; const invalidate = () => loop?.invalidate();
const VIEWS = { overview: { position: [8, 6, 12], target: [0, 0.9, 0] } };
const rig = createCameraRig({ camera, canvas, views: VIEWS, invalidate, limits: { minPolarDeg: LOOK.camera.minPolarDeg, maxPolarDeg: LOOK.camera.maxPolarDeg, minDist: LOOK.camera.minDistM, maxDist: LOOK.camera.maxDistM } });
const post = LOOK.post.enabled ? createPostStack({ renderer, scene, camera, vignette: LOOK.post.vignette, toneMapping: { mode: 'ACESFilmic', exposure: LOOK.exposure } }) : null;
const marker = createSelectionMarker(); scene.add(marker);
const picker = createPicker({ camera, canvas });

function createRenderLoop({ draw, fps = 60 }) {
  let pending = null, previous = null, lastRender = null, active = true, drawing = false, dirty = false;
  const step = 1000 / fps;
  function frame(timestamp) {
    pending = null; if (!active) return;
    const elapsed = previous === null ? step : timestamp - previous;
    if (lastRender !== null && timestamp - lastRender < step) { pending = requestAnimationFrame(frame); return; }
    previous = timestamp; lastRender = timestamp; dirty = false; drawing = true;
    let moving = false; try { moving = draw(Math.min(elapsed / 1000, 0.05), timestamp / 1000); } finally { drawing = false; }
    if (active && (moving || dirty)) pending = requestAnimationFrame(frame); else previous = null;
  }
  const self = {
    invalidate() { dirty = true; if (active && !drawing && pending === null) pending = requestAnimationFrame(frame); },
    setActive(v) { active = v; if (active) return self.invalidate(); if (pending !== null) cancelAnimationFrame(pending); pending = previous = lastRender = null; },
    dispose() { active = false; if (pending !== null) cancelAnimationFrame(pending); pending = null; }
  };
  return self;
}

// ---- state ----
const params = new URLSearchParams(location.search);
let model = null, world = null, sceneName = params.get('scene') === 'river' ? 'river' : 'pedestals', hours = params.has('hours') ? Number(params.get('hours')) : 24, selectedId = params.get('item'), hovered = null;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
const since = readLastSeen();
const panel = createPanel(document.querySelector('#panel'), {
  onSelect: item => selectItem(item, true),
  onChanged: () => refresh()
});

function build() {
  if (world) world.dispose(); picker.clear();
  world = sceneName === 'river' ? createRiver({ scene, model, picker, hours }) : createPedestals({ scene, model, picker });
  Object.keys(VIEWS).forEach(k => delete VIEWS[k]); Object.assign(VIEWS, world.views);
  renderViewButtons(); placeMarker(); renderLegend(); invalidate();
}
function placeMarker() {
  const at = selectedId && world?.focusOf.get(selectedId);
  marker.visible = Boolean(at);
  if (at) { marker.position.copy(at); marker.scale.set(0.62, sceneName === 'river' ? 0.22 : 0.09, 0.5); }
}
function selectItem(item, fly) {
  selectedId = item ? item.id : null; panel.select(item); placeMarker();
  const at = selectedId && world.focusOf.get(selectedId);
  if (fly && at) rig.focus([at.x, at.y, at.z], sceneName === 'river' ? 3.2 : 2.6);
  invalidate();
}
function headline() {
  const n = model.away.length, b = model.blocked.length;
  document.querySelector('#headline').textContent = n ? `${n} finished while you were away` : 'Nothing new finished while you were away';
  document.querySelector('#since').textContent = (since ? `since ${fmtTime(since)} · ${fmtAgo(since, model.now)}` : 'first visit: everything unread counts') + (b ? ` · ${b} waiting for you` : '');
}
async function refresh() {
  try { model = buildModel(await api.state(), { since }); } catch (e) { const box = document.querySelector('#error'); box.hidden = false; box.textContent = `Could not reach the inbox server: ${e.message}`; return; }
  document.querySelector('#error').hidden = true;
  headline(); panel.setModel(model);
  // Rebuild geometry under the same camera; the selection follows its id.
  build();
}
function renderLegend() {
  document.querySelector('#legend').innerHTML = LEGEND[sceneName].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
function renderViewButtons() {
  if (window.__viewer) window.__viewer.views = Object.keys(VIEWS); // the contract was installed before the scene named its views
  const nav = document.querySelector('#views'); nav.innerHTML = '';
  for (const name of Object.keys(VIEWS)) { const b = document.createElement('button'); b.type = 'button'; b.id = `view-${name}`; b.textContent = name; b.addEventListener('click', () => window.__viewer.setView(name)); nav.append(b); }
}

// ---- interaction ----
const tooltip = document.querySelector('#tooltip');
let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointermove', e => {
  const hit = picker.hit(e); hovered = hit?.record || null;
  canvas.style.cursor = hovered ? 'pointer' : '';
  if (!hovered) { tooltip.hidden = true; return; }
  const r = hovered, text = r.kind === 'item' ? `${r.item.title.slice(0, 120)}<span class="meta">${r.item.type} · ${r.item.status} · ${r.item.agentName || r.item.harness || ''} · ${fmtAgo(r.item.t, model.now)}</span>`
    : r.kind === 'agent' ? `${r.agent.name}<span class="meta">${r.agent.harness} · ${r.agent.state.replace('_', ' ')}</span>`
    : r.kind === 'reviewed' ? `${r.items.length} reviewed in ${r.task.title}` : `${r.task.title}<span class="meta">${r.task.away} to review · ${r.task.working} working</span>`;
  tooltip.innerHTML = text; tooltip.hidden = false;
  const box = viewport.getBoundingClientRect(); tooltip.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 330)}px`; tooltip.style.top = `${e.clientY - box.top + 14}px`;
});
canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // a drag is an orbit, not a click
  const hit = picker.hit(e); if (!hit) return;
  const r = hit.record;
  if (r.kind === 'item') selectItem(r.item, true);
  else if (r.kind === 'agent') { const item = model.items.filter(i => i.agentId === r.agent.id).sort((a, b) => b.t - a.t)[0]; if (item) selectItem(item, true); else rig.focus(world.focusOf.get(`agent:${r.agent.id}`).toArray(), 2.2); }
  else if (r.kind === 'reviewed') { selectItem(r.items[r.items.length - 1], true); }
  else { const at = world.focusOf.get(`task:${r.task.id}`); rig.focus([at.x, at.y, at.z], 4.5); }
});
addEventListener('keydown', e => { if (e.key === 'Escape' && selectedId) selectItem(null, false); });
document.querySelector('#scenes').addEventListener('click', e => {
  const b = e.target.closest('button[data-scene]'); if (!b || b.dataset.scene === sceneName) return;
  sceneName = b.dataset.scene;
  for (const x of e.currentTarget.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  document.querySelector('#windows').hidden = sceneName !== 'river';
  build(); rig.reset();
});
document.querySelector('#windows').addEventListener('click', e => {
  const b = e.target.closest('button[data-hours]'); if (!b) return; hours = Number(b.dataset.hours);
  for (const x of e.currentTarget.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  build();
});
const control = document.querySelector('#control');
control.addEventListener('click', () => { paused = !paused; control.textContent = paused ? 'Resume motion' : 'Pause motion'; control.setAttribute('aria-pressed', String(paused)); invalidate(); });
document.querySelector('#reset').addEventListener('click', () => rig.reset());

// ---- loop ----
loop = createRenderLoop({ draw(dt, time) {
  const moving = world ? world.update(paused ? 0 : dt, paused ? 0 : time) && !paused : false;
  const cameraChanged = rig.update(dt);
  if (post) post.render(dt); else renderer.render(scene, camera);
  viewer.markReady();
  return moving || cameraChanged;
} });
const viewer = installViewer({ camera, controls: rig.controls, views: VIEWS, setView: rig.setView, invalidate });
new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect(); if (!width || !height) return;
  renderer.setSize(width, height, false); post?.setSize(width, height);
  camera.aspect = width / height; camera.updateProjectionMatrix(); invalidate();
}).observe(viewport);
document.addEventListener('visibilitychange', () => { loop.setActive(!document.hidden); if (document.hidden) writeLastSeen(); });
addEventListener('pagehide', () => { writeLastSeen(); stop(); loop.dispose(); post?.dispose(); rig.dispose(); studio.dispose(); world?.dispose(); renderer.dispose(); }, { once: true });

for (const x of document.querySelectorAll('#scenes button')) x.setAttribute('aria-pressed', String(x.dataset.scene === sceneName));
for (const x of document.querySelectorAll('#windows button')) x.setAttribute('aria-pressed', String(Number(x.dataset.hours) === hours));
document.querySelector('#windows').hidden = sceneName !== 'river';
const stop = api.events(refresh);
await refresh();
if (selectedId) { const item = model.items.find(i => i.id === selectedId); if (item) selectItem(item, false); else selectedId = null; }
rig.reset(); viewport.setAttribute('aria-busy', 'false'); loop.setActive(!document.hidden);
