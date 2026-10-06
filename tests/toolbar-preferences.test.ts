import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOLBAR_PREFERENCES,
  moveToolbarGroup,
  normalizeToolbarPreferences,
} from '../src/renderer/toolbar-preferences';

describe('toolbar preferences', () => {
  it('shows every group by default', () => {
    expect(DEFAULT_TOOLBAR_PREFERENCES.visible).toContain('paste');
    expect(DEFAULT_TOOLBAR_PREFERENCES.visible).toContain('layout');
  });

  it('repairs stale settings and clamps heading sizes', () => {
    const preferences = normalizeToolbarPreferences({
      order: ['layout', 'layout', 'unknown'],
      visible: ['layout', 'unknown'],
      expanded: false,
      headingSizes: { title: 200, h1: 7, h2: 19, h3: 'bad' },
    });
    expect(preferences.order[0]).toBe('layout');
    expect(new Set(preferences.order).size).toBe(DEFAULT_TOOLBAR_PREFERENCES.order.length);
    expect(preferences.visible).toEqual(['layout']);
    expect(preferences.expanded).toBe(false);
    expect(preferences.headingSizes).toEqual({ title: 96, h1: 8, h2: 19, h3: 14 });
  });

  it('moves chunks without losing any groups', () => {
    const moved = moveToolbarGroup(DEFAULT_TOOLBAR_PREFERENCES.order, 'layout', 'type');
    expect(moved.indexOf('layout')).toBe(moved.indexOf('type') - 1);
    expect(new Set(moved)).toEqual(new Set(DEFAULT_TOOLBAR_PREFERENCES.order));
  });
});
