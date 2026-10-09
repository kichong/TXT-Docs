import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LocalDocumentStorage } from '../src/main/storage';
import { createBlankDocument } from '../src/shared/types';

it('clears recovery after a pending write and preserves the order of later writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'txt-recovery-order-'));
  try {
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const write = storage.atomicWrite.bind(storage);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(storage, 'atomicWrite').mockImplementationOnce(async (path, bytes) => {
      await blocked;
      await write(path, bytes);
    });
    const pending = storage.writeRecovery(createBlankDocument('Old'), 'first');
    const cleared = storage.clearRecovery('first');
    release();
    await Promise.all([pending, cleared]);
    expect(await storage.readRecovery('first')).toBeNull();
    await Promise.all([
      storage.writeRecovery(createBlankDocument('Earlier'), 'first'),
      storage.writeRecovery(createBlankDocument('Latest'), 'first'),
    ]);
    expect((await storage.readRecovery('first'))?.document.title).toBe('Latest');
    vi.spyOn(storage, 'atomicWrite').mockRejectedValueOnce(new Error('Write failed'));
    await expect(storage.writeRecovery(createBlankDocument(), 'first')).rejects.toThrow('Write failed');
    await storage.clearRecovery('first');
    expect(await storage.readRecovery('first')).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('keeps each window recovery independent and discovers drafts after restart, including legacy recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'txt-window-recovery-'));
  try {
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const first = { ...createBlankDocument(), title: 'First' };
    const second = { ...createBlankDocument(), title: 'Second' };
    await storage.writeRecovery(first, 'first');
    await storage.writeRecovery(second, 'second');
    await storage.writeRecovery(createBlankDocument());
    const restarted = new LocalDocumentStorage(directory);
    await restarted.initialize();
    expect((await restarted.getRecoveryKeys()).sort()).toEqual(['first', 'legacy', 'second']);
    expect(await restarted.readRecovery('first')).toEqual({ document: first, savedAt: expect.any(String) });
    await restarted.clearRecovery('first');
    expect(await restarted.readRecovery('first')).toBeNull();
    expect(await restarted.readRecovery('second')).toEqual({ document: second, savedAt: expect.any(String) });
    expect(await restarted.readRecovery('legacy')).not.toBeNull();
    expect(await restarted.readRecovery('fresh-window')).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('keeps both recent files when different windows remember files simultaneously', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'txt-window-recent-'));
  try {
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    await Promise.all([storage.remember(join(directory, 'first.txt')), storage.remember(join(directory, 'second.txt'))]);
    const restarted = new LocalDocumentStorage(directory);
    await restarted.initialize();
    expect((await restarted.getRecentFiles()).map((file) => file.displayName).sort()).toEqual(['first.txt', 'second.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
