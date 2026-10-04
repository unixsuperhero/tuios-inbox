// shared.js - palette, material cache, canvas labels and a picker. Colors are DESIGN.md tokens so
// the canvas and the DOM panel agree about what lime, amber and rose mean.
import * as THREE from 'three';

export const PALETTE = {
  paper: '#15181e', white: '#20252d', raised: '#2c333d', line: '#444d59', controlLine: '#697382',
  ink: '#edf1f7', muted: '#b6beca', dataInk: '#c8dae3', accent: '#b9d776', accentSoft: '#303a28',
  warning: '#edce91', danger: '#ffd0d8', success: '#b4d3bc', unreadBorder: '#81965c'
};

const materials = new Map();
export function materialFor({ color, roughness = 0.6, metalness = 0.05, emissive = '#000000', emissiveIntensity = 0, opacity = 1 }) {
  const key = [color, roughness, metalness, emissive, emissiveIntensity, opacity].join('|');
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity, transparent: opacity < 1, opacity }));
  return materials.get(key);
}
export const MATERIALS = {
  floor: () => materialFor({ color: PALETTE.paper, roughness: 0.92 }),
  pedestal: () => materialFor({ color: PALETTE.raised, roughness: 0.35, metalness: 0.1 }),
  readCard: () => materialFor({ color: '#5c6672', roughness: 0.7 }),
  unreadCard: () => materialFor({ color: PALETTE.accent, roughness: 0.5, emissive: PALETTE.accent, emissiveIntensity: 0.55 }),
  failedCard: () => materialFor({ color: '#8a5a62', roughness: 0.7 }),
  warnCard: () => materialFor({ color: '#8c7a4a', roughness: 0.7 }),
  working: () => materialFor({ color: PALETTE.success, roughness: 0.4, emissive: PALETTE.success, emissiveIntensity: 0.6 }),
  needsInput: () => materialFor({ color: PALETTE.warning, roughness: 0.4, emissive: PALETTE.warning, emissiveIntensity: 0.9 }),
  errored: () => materialFor({ color: PALETTE.danger, roughness: 0.5, emissive: PALETTE.danger, emissiveIntensity: 0.4 }),
  idle: () => materialFor({ color: '#4a535f', roughness: 0.8 }),
  offline: () => materialFor({ color: '#2f363f', roughness: 0.9 })
};
/** Status is a data encoding (knowledge.reasoning-visual-channel-legend): the same mapping is in main.js's LEGEND. */
export function itemMaterial(item) {
  if (item.working) return MATERIALS.working();
  if (item.unread && item.finished) return MATERIALS.unreadCard();
  if (item.status === 'failed') return MATERIALS.failedCard();
  if (['partial', 'uncertain', 'snapshot'].includes(item.status)) return MATERIALS.warnCard();
  return MATERIALS.readCard();
}
export function agentMaterial(agent) {
  return ({ working: MATERIALS.working, needs_input: MATERIALS.needsInput, errored: MATERIALS.errored, done: MATERIALS.idle, idle: MATERIALS.idle }[agent.state] || MATERIALS.offline)();
}

// Labels are canvas textures on unlit planes: tone mapping and lights never touch them, so the
// text stays the color the token says. `size` is the cap height in metres.
const labelCache = new Map();
export function makeLabel(text, { size = 0.08, color = PALETTE.ink, font = 'sans', weight = 400, maxWidth = 3.2, align = 'center' } = {}) {
  const key = [text, size, color, font, weight, maxWidth].join('|');
  let entry = labelCache.get(key);
  if (!entry) {
    const px = 48, pad = 10, family = font === 'mono' ? "ui-monospace, 'SFMono-Regular', Consolas, monospace" : 'Arial, Helvetica, sans-serif';
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    context.font = `${weight} ${px}px ${family}`;
    const maxPx = maxWidth / size * px;
    let shown = text; while (shown.length > 4 && context.measureText(shown).width > maxPx) shown = shown.slice(0, -2).trimEnd() + '…';
    const width = Math.ceil(context.measureText(shown).width) + pad * 2, height = px + pad * 2;
    canvas.width = width; canvas.height = height;
    context.font = `${weight} ${px}px ${family}`; context.textBaseline = 'middle'; context.textAlign = 'left';
    context.fillStyle = color; context.fillText(shown, pad, height / 2);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    entry = { texture, width: width / px * size, height: height / px * size };
    labelCache.set(key, entry);
  }
  const material = new THREE.MeshBasicMaterial({ map: entry.texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(entry.width, entry.height), material);
  if (align === 'left') mesh.geometry.translate(entry.width / 2, 0, 0);
  if (align === 'right') mesh.geometry.translate(-entry.width / 2, 0, 0);
  mesh.renderOrder = 2;
  return mesh;
}

/** Raycast picking. register(object, resolve) where resolve(intersection) returns the record hit. */
export function createPicker({ camera, canvas }) {
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), targets = new Map();
  return {
    register(object, resolve) { targets.set(object, resolve); },
    clear() { targets.clear(); },
    hit(event) {
      const r = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...targets.keys()], false);
      for (const hit of hits) { const record = targets.get(hit.object)?.(hit); if (record) return { record, point: hit.point, object: hit.object }; }
      return null;
    }
  };
}

/** A lime wire box that sits around whatever is selected. */
export function createSelectionMarker() {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: PALETTE.accent, toneMapped: false }));
  edges.visible = false; edges.renderOrder = 3;
  return edges;
}

export function disposeGroup(group) {
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.map && o.material.map.image instanceof HTMLCanvasElement) { /* cached label textures stay */ } });
  group.parent?.remove(group);
}

/** mulberry32: the same model draws the same frame, so a live refresh never reshuffles the stacks. */
export function seeded(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashSeed = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
