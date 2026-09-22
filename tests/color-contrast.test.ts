import { describe, expect, it } from 'vitest';
import {
  accessibleTextPreviews,
  contrastRatio,
  highlightForeground,
} from '../src/renderer/color-contrast';

describe('editor color contrast', () => {
  it('keeps document text readable on both paper themes', () => {
    const colors = ['#202124', '#5f6368', '#d93025', '#e37400', '#188038', '#1a73e8', '#7b1fa2', '#ffffff'];
    for (const color of colors) {
      const previews = accessibleTextPreviews(color);
      expect(contrastRatio(previews.light, '#fffefb')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(previews.dark, '#24272c')).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps saved default ink identical to unmarked editor text', () => {
    expect(accessibleTextPreviews('#202124')).toEqual({ light: '#202124', dark: '#f8f9fb' });
  });

  it('chooses a readable foreground for every built-in highlight', () => {
    const highlights = ['#fff176', '#ffcc80', '#ff8a80', '#c5e1a5', '#80deea', '#90caf9', '#ce93d8', '#e0e0e0'];
    for (const highlight of highlights) {
      expect(contrastRatio(highlightForeground(highlight), highlight)).toBeGreaterThanOrEqual(4.5);
    }
    expect(highlightForeground('#fff176')).toBe('#202124');
  });
});
