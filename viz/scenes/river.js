// river.js - Time river. Time runs left to right and ends at the "now" wall. Each task is a lane.
// Every record is a slab at the moment it last changed; unread finished work floats above the lane
// and glows, reviewed work lies flat on it. A translucent amber plane marks when you last looked,
// so everything between it and the wall is what happened while you were away.
import * as THREE from 'three';
import { MATERIALS, PALETTE, itemMaterial, agentMaterial, makeLabel } from './shared.js';

const LANE = 1.5, LENGTH = 22, SLAB = { w: 0.11, h: 0.05, d: 0.55 };

export function createRiver({ scene, model, picker, hours = 24 }) {
  const group = new THREE.Group(); scene.add(group);
  const now = model.now;
  const oldest = model.items.reduce((m, i) => Math.min(m, i.t), now);
  const windowMs = hours > 0 ? hours * 3600e3 : Math.max(3600e3, now - oldest);
  const xOf = t => -Math.min(1, Math.max(0, (now - t) / windowMs)) * LENGTH;
  const items = model.items.filter(i => now - i.t <= windowMs || i.working);
  const lanes = model.tasks.filter(t => items.some(i => i.taskId === t.id) || t.agents.some(a => a.state === 'working' || a.state === 'needs_input'));
  const zOf = new Map(lanes.map((t, i) => [t.id, (i - (lanes.length - 1) / 2) * LANE]));
  const depth = Math.max(LANE, lanes.length * LANE), pulsing = [], focusOf = new Map();
  const slabGeometry = new THREE.BoxGeometry(SLAB.w, SLAB.h, SLAB.d);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 30, depth + 30), MATERIALS.floor());
  floor.rotation.x = -Math.PI / 2; floor.position.set(-LENGTH / 2 + 2, -0.01, 0); floor.receiveShadow = true; group.add(floor);

  // Lanes and their names sit to the right of now, where the eye arrives.
  lanes.forEach(task => {
    const z = zOf.get(task.id);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(LENGTH + 0.6, LANE - 0.18), MATERIALS.pedestal());
    strip.rotation.x = -Math.PI / 2; strip.position.set(-LENGTH / 2 + 0.3, 0, z); strip.receiveShadow = true; group.add(strip);
    picker.register(strip, () => ({ kind: 'task', task }));
    const label = makeLabel(task.title, { size: 0.11, weight: 600, maxWidth: 3.4, align: 'left' });
    label.rotation.x = -Math.PI / 2; label.position.set(0.7, 0.01, z - 0.18); group.add(label);
    const count = task.away ? `${task.away} to review` : task.working ? 'working' : 'quiet';
    const sub = makeLabel(count, { size: 0.07, color: task.away ? PALETTE.accent : PALETTE.dataInk, font: 'mono', align: 'left' });
    sub.rotation.x = -Math.PI / 2; sub.position.set(0.7, 0.01, z + 0.12); group.add(sub);
    focusOf.set(`task:${task.id}`, new THREE.Vector3(-1.5, 0.4, z));
    // Live agents stand at the wall in their lane; a blocked one carries the amber flag.
    task.agents.filter(a => a.state === 'working' || a.state === 'needs_input' || a.state === 'errored').slice(0, 6).forEach((agent, i) => {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 12), agentMaterial(agent));
      body.position.set(0.35, 0.15, z - 0.45 + i * 0.18); body.castShadow = true; group.add(body);
      picker.register(body, () => ({ kind: 'agent', agent })); focusOf.set(`agent:${agent.id}`, body.position.clone());
      if (agent.state === 'working') pulsing.push({ mesh: body, phase: i, still: true });
      if (agent.state === 'needs_input') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.1, 8), MATERIALS.idle()); pole.position.set(0.35, 0.55, body.position.z); group.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), MATERIALS.needsInput()); flag.position.set(0.5, 1.0, body.position.z); group.add(flag);
        picker.register(flag, () => ({ kind: 'agent', agent }));
      }
    });
  });

  // Slabs: one instanced mesh per material class so each class keeps its honest colour.
  const classes = new Map();
  for (const item of items) {
    if (!zOf.has(item.taskId)) continue;
    const material = itemMaterial(item), list = classes.get(material) || []; list.push(item); classes.set(material, list);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (const [material, list] of classes) {
    const mesh = new THREE.InstancedMesh(slabGeometry, material, list.length);
    list.forEach((item, i) => {
      const lift = item.working ? 0.45 : item.unread && item.finished ? 0.7 : SLAB.h / 2;
      p.set(item.working ? 0.05 : xOf(item.t), lift, zOf.get(item.taskId) + (item.type === 'turn' ? -0.08 : 0.12));
      s.set(1, item.unread && item.finished ? 2.2 : 1, item.type === 'turn' ? 1 : 0.6);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      focusOf.set(item.id, p.clone());
    });
    mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    picker.register(mesh, hit => ({ kind: 'item', item: list[hit.instanceId] }));
    if (material === MATERIALS.working()) list.forEach((_, i) => pulsing.push({ mesh, instanced: true, phase: i }));
  }

  // The now wall, and the moment you left. Everything between them is the answer.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(depth + 0.6, 0.6), new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  wall.rotation.y = Math.PI / 2; wall.position.set(0, 0.3, 0); group.add(wall);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, depth + 0.6), MATERIALS.unreadCard()); sill.position.set(0, 0.015, 0); group.add(sill);
  const nowTag = makeLabel('now', { size: 0.09, color: PALETTE.accent, font: 'mono' }); nowTag.position.set(0, 1.25, -depth / 2 - 0.2); group.add(nowTag);
  if (model.since && now - model.since <= windowMs) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(depth + 0.6, 1.0), new THREE.MeshBasicMaterial({ color: PALETTE.warning, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    plane.rotation.y = Math.PI / 2; plane.position.set(xOf(model.since), 0.5, 0); group.add(plane);
    const tag = makeLabel('you left', { size: 0.08, color: PALETTE.warning, font: 'mono' }); tag.position.set(xOf(model.since), 1.15, -depth / 2 - 0.2); group.add(tag);
  }
  // Time ticks along the near edge: hourly under a day, daily beyond.
  const stepMs = windowMs <= 36 * 3600e3 ? 3600e3 : 86400e3, ticks = Math.floor(windowMs / stepMs);
  for (let k = 1; k <= ticks && k <= 30; k++) {
    const x = xOf(now - k * stepMs), tick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.5), MATERIALS.readCard());
    tick.position.set(x, 0.005, depth / 2 + 0.5); group.add(tick);
    if (k % (ticks > 14 ? 2 : 1) === 0) { const t = makeLabel(stepMs === 3600e3 ? `-${k}h` : `-${k}d`, { size: 0.16, color: PALETTE.dataInk, font: 'mono' }); t.rotation.x = -Math.PI / 2; t.position.set(x, 0.01, depth / 2 + 1.15); group.add(t); }
  }

  const span = Math.max(LENGTH, depth);
  return {
    group, focusOf, extent: span,
    views: {
      overview: { position: [-LENGTH * 0.4, 8.5, depth / 2 + 13], target: [-LENGTH * 0.42, 0, 0] },
      now: { position: [3.5, 3.2, depth / 2 + 5.5], target: [-2.5, 0.3, 0] },
      upstream: { position: [-LENGTH - 3, 2.4, depth / 2 + 4], target: [-LENGTH * 0.55, 0.3, 0] }
    },
    update(dt, time) {
      for (const pz of pulsing) {
        const k = 0.5 + 0.5 * Math.sin(time * 2.2 + pz.phase);
        if (pz.instanced) continue; // instanced working slabs share a material; the agents carry the pulse
        pz.mesh.material.emissiveIntensity = 0.35 + 0.6 * k;
      }
      return pulsing.some(pz => !pz.instanced);
    },
    dispose() { group.traverse(o => { if (o.geometry && o.geometry !== slabGeometry) o.geometry.dispose(); }); slabGeometry.dispose(); scene.remove(group); }
  };
}
