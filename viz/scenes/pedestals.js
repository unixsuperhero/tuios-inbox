// pedestals.js - Studio pedestals. One pedestal per task under its own spot. Unread finished work
// stacks as cards: the height of the stack is the backlog, and the spot over it brightens with it.
// Reviewed work is a thin plate under the stack. Agents stand on a ring around the base, coloured
// by execution state; a pane waiting for a human raises an amber flag.
import * as THREE from 'three';
import { MATERIALS, PALETTE, itemMaterial, agentMaterial, makeLabel, seeded, hashSeed } from './shared.js';

const SPACING = 2.6, PEDESTAL_R = 0.55, PEDESTAL_H = 0.5;
const CARD = { w: 0.5, h: 0.028, d: 0.36, gap: 0.012 }, MAX_STACK = 40;

export function createPedestals({ scene, model, picker }) {
  const group = new THREE.Group(); scene.add(group);
  const pulsing = [], spots = [];
  const n = model.tasks.length, x0 = -((n - 1) * SPACING) / 2;
  const cardGeometry = new THREE.BoxGeometry(CARD.w, CARD.h, CARD.d);
  const focusOf = new Map(); // record id -> world position

  // Floor: a 1 m grid is the scale cue. The pedestal is 0.5 m tall, a card is the size of a paperback.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(Math.max(8, n * SPACING), 64), MATERIALS.floor());
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  const grid = new THREE.GridHelper(Math.max(8, n * SPACING) * 2, Math.max(8, n * SPACING) * 2, PALETTE.line, '#2a3038');
  grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.35; group.add(grid);

  model.tasks.forEach((task, index) => {
    const x = x0 + index * SPACING, random = seeded(hashSeed(task.id));
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R * 1.06, PEDESTAL_H, 48), MATERIALS.pedestal());
    pedestal.position.set(x, PEDESTAL_H / 2, 0); pedestal.castShadow = pedestal.receiveShadow = true; group.add(pedestal);
    picker.register(pedestal, () => ({ kind: 'task', task }));
    focusOf.set(`task:${task.id}`, new THREE.Vector3(x, PEDESTAL_H + 0.4, 0));

    let top = PEDESTAL_H;
    // Reviewed plate: thickness is the count, capped so an old task does not become a tower of the past.
    const reviewed = task.items.filter(i => i.finished && !i.unread);
    if (reviewed.length) {
      const thickness = Math.min(0.24, 0.006 * reviewed.length + 0.01);
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R * 0.82, PEDESTAL_R * 0.82, thickness, 48), MATERIALS.readCard());
      plate.position.set(x, top + thickness / 2, 0); plate.castShadow = plate.receiveShadow = true; group.add(plate);
      picker.register(plate, () => ({ kind: 'reviewed', task, items: reviewed }));
      top += thickness;
    }
    // Unread stack: one instanced mesh per pedestal, each card a hit target for the panel.
    const unread = task.items.filter(i => i.finished && i.unread).sort((a, b) => a.t - b.t);
    const shown = unread.slice(-MAX_STACK);
    if (shown.length) {
      const stack = new THREE.InstancedMesh(cardGeometry, MATERIALS.unreadCard(), shown.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      shown.forEach((item, i) => {
        const y = top + CARD.h / 2 + i * (CARD.h + CARD.gap);
        p.set(x + (random() - 0.5) * 0.03, y, (random() - 0.5) * 0.03);
        q.setFromEuler(new THREE.Euler(0, (random() - 0.5) * 0.16, 0));
        stack.setMatrixAt(i, m.compose(p, q, s));
        // Tint failed and partial results so the stack is honest about what is in it.
        stack.setColorAt(i, new THREE.Color(item.status === 'failed' ? '#f0b0bc' : ['partial', 'uncertain', 'snapshot'].includes(item.status) ? '#f0dca0' : '#ffffff'));
        focusOf.set(item.id, new THREE.Vector3(x, y, 0));
      });
      stack.castShadow = stack.receiveShadow = true; group.add(stack);
      picker.register(stack, hit => ({ kind: 'item', item: shown[hit.instanceId] }));
      top += shown.length * (CARD.h + CARD.gap);
      if (unread.length > shown.length) { const more = makeLabel(`+${unread.length - shown.length} more`, { size: 0.05, color: PALETTE.dataInk, font: 'mono' }); more.position.set(x + CARD.w / 2 + 0.25, top - 0.05, 0); group.add(more); }
    }
    // Work in progress hovers above the stack and breathes; it is the only motion a still inbox has.
    const working = task.items.filter(i => i.working);
    working.forEach((item, i) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), MATERIALS.working().clone());
      orb.position.set(x + (i - (working.length - 1) / 2) * 0.22, top + 0.35, 0); group.add(orb);
      pulsing.push({ mesh: orb, base: orb.position.y, phase: i * 1.3 });
      picker.register(orb, () => ({ kind: 'item', item })); focusOf.set(item.id, orb.position.clone());
    });

    // Labels: title in sans, the count in mono. Height follows the stack so a tall backlog is still named.
    const title = makeLabel(task.title, { size: 0.14, weight: 600, maxWidth: 2.4 });
    title.position.set(x, top + 0.75 + (working.length ? 0.2 : 0), 0); group.add(title);
    const count = task.away ? `${task.away} to review` : task.unread ? `${task.unread} unread` : reviewed.length ? `${reviewed.length} reviewed` : 'quiet';
    const sub = makeLabel(count, { size: 0.09, color: task.away ? PALETTE.accent : PALETTE.dataInk, font: 'mono' });
    sub.position.set(x, title.position.y - 0.2, 0); group.add(sub);

    // Agents on a ring. A flag means a human is needed and is the tallest thing on the pedestal.
    const ring = 0.9, agents = task.agents.filter(a => a.kind === 'agent' || a.state !== 'idle').slice(0, 12);
    agents.forEach((agent, i) => {
      const angle = Math.PI * 0.15 + (i / Math.max(agents.length, 1)) * Math.PI * 1.7;
      const ax = x + Math.cos(angle) * ring, az = Math.sin(angle) * ring;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.18, 4, 12), agentMaterial(agent));
      body.position.set(ax, 0.18, az); body.castShadow = true; group.add(body);
      picker.register(body, () => ({ kind: 'agent', agent })); focusOf.set(`agent:${agent.id}`, body.position.clone());
      if (agent.state === 'working') pulsing.push({ mesh: body, base: body.position.y, phase: i, still: true });
      if (agent.state === 'needs_input') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), MATERIALS.idle()); pole.position.set(ax, 0.75, az); group.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), MATERIALS.needsInput()); flag.position.set(ax + 0.17, 1.4, az); group.add(flag);
        const tag = makeLabel(`${agent.name} needs you`, { size: 0.05, color: PALETTE.warning }); tag.position.set(ax, 1.62, az); group.add(tag);
        picker.register(flag, () => ({ kind: 'agent', agent }));
      }
      const name = makeLabel(agent.name, { size: 0.06, color: PALETTE.muted, maxWidth: 0.9 }); name.position.set(ax, 0.46, az); group.add(name);
    });

    // The spot is the urgency channel: a dark pedestal is a quiet task.
    const spot = new THREE.SpotLight('#fff6e0', 0, 9, 0.42, 0.6, 1.2);
    spot.position.set(x, 4.2, 0.6); spot.target.position.set(x, PEDESTAL_H, 0); spot.castShadow = false; group.add(spot, spot.target);
    spot.userData.goal = task.needsInput ? 110 : task.away ? 40 + 70 * Math.min(1, task.away / 8) : task.working ? 24 : 9;
    spot.intensity = spot.userData.goal; spots.push(spot);
  });

  const extent = Math.max(6, n * SPACING * 0.8);
  return {
    group, focusOf, extent,
    views: {
      overview: { position: [extent * 0.3, extent * 0.62, extent * 1.45], target: [0, 0.7, 0] },
      front: { position: [0, 1.5, extent * 1.5], target: [0, 0.8, 0] },
      flags: { position: [-extent * 0.9, 1.3, extent * 0.7], target: [0, 0.9, 0] }
    },
    /** @returns {boolean} true while something visibly moves. */
    update(dt, time) {
      for (const p of pulsing) {
        const k = 0.5 + 0.5 * Math.sin(time * 2.2 + p.phase);
        p.mesh.material.emissiveIntensity = 0.35 + 0.6 * k;
        if (!p.still) p.mesh.position.y = p.base + 0.05 * Math.sin(time * 1.4 + p.phase);
      }
      return pulsing.length > 0;
    },
    dispose() { group.traverse(o => { if (o.geometry && o.geometry !== cardGeometry) o.geometry.dispose(); }); cardGeometry.dispose(); scene.remove(group); }
  };
}
