import { describe, expect, it } from 'vitest';
import type { AppUpdateState } from '../src/shared/types';
import { presentUpdate } from '../src/shared/updates';

function state(patch: Partial<AppUpdateState>): AppUpdateState {
  return {
    currentVersion: '0.3.0',
    phase: 'idle',
    canCheck: true,
    ...patch,
  };
}

describe('update presentation', () => {
  it('offers a download when a newer version is available', () => {
    const presentation = presentUpdate(state({ phase: 'available', availableVersion: '0.4.0' }));
    expect(presentation.action).toBe('download');
    expect(presentation.detail).toContain('v0.4.0');
    expect(presentation.important).toBe(true);
  });

  it('reports download progress and offers restart when ready', () => {
    expect(
      presentUpdate(state({ phase: 'downloading', availableVersion: '0.4.0', downloadPercent: 41.6 })).actionLabel,
    ).toBe('Downloading 42%');
    expect(presentUpdate(state({ phase: 'downloaded', availableVersion: '0.4.0' })).action).toBe('install');
  });

  it('keeps retry and installed-build states explicit', () => {
    expect(presentUpdate(state({ phase: 'error', message: 'Network unavailable.' })).action).toBe('check');
    expect(presentUpdate(state({ phase: 'unavailable', canCheck: false })).action).toBeNull();
    expect(presentUpdate(state({ phase: 'up-to-date' })).detail).toContain('v0.3.0');
  });
});
