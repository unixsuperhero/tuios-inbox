import { taskStyle } from '/task-style.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appearance = task => taskStyle(task ? task.style || { seed: task.style_seed, theme: task.style_theme, icon: task.style_icon, color: task.style_color } : null);

export function styleAttrs(task) {
  const style = appearance(task);
  return `data-task-style="${esc(task?.id || '')}" data-task-style-key="${esc(style.signature)}"`;
}

export function taskMark(task) {
  const style = appearance(task);
  const label = task ? `${task.title || 'Task'} · ${style.iconLabel}` : 'No task';
  return `<span class="task-mark" ${styleAttrs(task)} role="img" aria-label="${esc(label)}">${style.iconSvg}</span>`;
}

export function applyTaskStyles(root, tasks) {
  if (!root) return;
  const byId = tasks instanceof Map ? tasks : new Map((tasks || []).map(task => [task.id, task]));
  const nodes = [...root.querySelectorAll('[data-task-style]')];
  if (root.matches?.('[data-task-style]')) nodes.unshift(root);
  for (const node of nodes) {
    const style = appearance(byId.get(node.dataset.taskStyle) || null);
    node.style.setProperty('--task-color', style.color);
    node.style.setProperty('--task-surface', style.surface);
    node.style.setProperty('--task-border', style.border);
  }
}
