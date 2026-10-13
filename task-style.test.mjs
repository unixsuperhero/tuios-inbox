import { expect, test } from 'bun:test';
import { parseStyleOverrides, styleChoices, taskStyle } from './public/task-style.js';

test('independent overrides validate supplied fields and reset without changing assignment', () => {
  expect(parseStyleOverrides({ theme: 'sage', icon: 'compass', color: '#9BD4BD' })).toEqual({ theme: 'sage', icon: 'compass', color: '#9bd4bd' });
  expect(parseStyleOverrides({ icon: '' })).toEqual({ icon: null });
  expect(parseStyleOverrides({ color: '' })).toEqual({ color: null });
  expect(() => parseStyleOverrides({ theme: 'sage', icon: '<svg/>' })).toThrow('Unknown style icon');
  expect(() => parseStyleOverrides({ color: 'red; background:url(x)' })).toThrow('six-digit hex');
  const original = taskStyle({ seed: 27 });
  const themed = taskStyle({ seed: 27, theme: 'sage', icon: 'compass', color: '#112233' });
  expect(themed).toMatchObject({ color: '#112233', iconId: 'compass', iconLabel: 'Compass' });
  expect(taskStyle({ seed: 27, ...parseStyleOverrides({ theme: '', icon: '', color: '' }) })).toEqual(original);
  expect(themed.signature).not.toBe(original.signature);
});

test('seeds give stable identities while unknown owners remain neutral', () => {
  expect(taskStyle(null)).toMatchObject({ color: '#a7adb5', iconId: 'unassigned', iconLabel: 'No task' });
  expect(taskStyle({ seed: 27, title: 'renamed', parent_id: 'elsewhere' })).toEqual(taskStyle({ seed: 27 }));
  const choices = styleChoices(); choices.icons[0].id = 'user-markup';
  expect(taskStyle({ seed: 1 }).iconId).toBe('compass');
  expect(taskStyle({ seed: 1, icon: '<script>alert(1)</script>' }).iconSvg).not.toContain('<script');
});
