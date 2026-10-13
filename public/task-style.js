const themes = Object.freeze([
  { id: 'sage', label: 'Sage', color: '#53e6a3' },
  { id: 'sky', label: 'Sky', color: '#59caff' },
  { id: 'lavender', label: 'Lavender', color: '#b99aff' },
  { id: 'rose', label: 'Rose', color: '#ff80ab' },
  { id: 'sand', label: 'Sand', color: '#f4cf62' },
]);
const icons = Object.freeze([
  { id: 'compass', label: 'Compass', shape: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>' },
  { id: 'leaf', label: 'Leaf', shape: '<path d="M19 5C8 3 3 9 6 16s14 2 13-11Z M6 18 16 8"/>' },
  { id: 'orbit', label: 'Orbit', shape: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>' },
  { id: 'diamond', label: 'Diamond', shape: '<path d="m12 3 9 9-9 9-9-9Z M3 12h18 M12 3v18"/>' },
  { id: 'flag', label: 'Flag', shape: '<path d="M5 21V4c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>' },
  { id: 'mountain', label: 'Mountain', shape: '<path d="m2 20 7-13 4 7 3-5 6 11Z M6 13l3 2 3-2"/>' },
  { id: 'spark', label: 'Spark', shape: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>' },
  { id: 'anchor', label: 'Anchor', shape: '<circle cx="12" cy="5" r="3"/><path d="M12 8v13 M5 11H2c0 6 4 10 10 10s10-4 10-10h-3 M8 12h8"/>' },
]);
// Assignment order stays fixed when more override choices are added.
const automaticIcons = Object.freeze(['compass', 'leaf', 'orbit', 'diamond', 'flag', 'mountain', 'spark', 'anchor']);
export function styleChoices() {
  return { themes: themes.map(({ id, label }) => ({ id, label })), icons: icons.map(({ id, label }) => ({ id, label })) };
}
export function parseStyleOverrides(input = {}) {
  const patch = {};
  for (const field of ['theme', 'icon', 'color']) {
    if (!Object.hasOwn(input, field)) continue;
    const value = input[field];
    if (value === '' || value === null) { patch[field] = null; continue; }
    if (typeof value !== 'string') throw new Error(`Style ${field} must be text or empty`);
    if (field === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Style color must be a six-digit hex color such as #9bd4bd');
      patch.color = value.toLowerCase();
    } else {
      if (!(field === 'theme' ? themes : icons).some(choice => choice.id === value)) throw new Error(`Unknown style ${field}: ${value}`);
      patch[field] = value;
    }
  }
  return patch;
}
export function taskStyle(style) {
  const seed = style?.seed ?? style?.style_seed;
  const assigned = Number.isSafeInteger(seed) && seed > 0;
  const theme = themes.find(t => t.id === (style?.theme ?? style?.style_theme));
  const custom = style?.color ?? style?.style_color;
  const color = /^#[0-9a-f]{6}$/i.test(custom || '') ? custom.toLowerCase() : theme?.color || (assigned ? `hsl(${((seed * 137.50776405003785) % 360).toFixed(3)} 78% 72%)` : '#a7adb5');
  const icon = icons.find(i => i.id === (style?.icon ?? style?.style_icon)) || (assigned ? icons.find(i => i.id === automaticIcons[(seed - 1) % automaticIcons.length]) : null);
  const shape = icon?.shape || '<circle cx="12" cy="12" r="5"/>';
  return {
    color, surface: `color-mix(in srgb, ${color} 9%, transparent)`, border: `color-mix(in srgb, ${color} 32%, transparent)`,
    iconId: icon?.id || 'unassigned', iconLabel: icon?.label || 'No task',
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`,
    signature: `${assigned ? seed : 'none'}:${theme?.id || ''}:${icon?.id || ''}:${color}`,
  };
}
