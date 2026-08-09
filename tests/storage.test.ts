import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalDocumentStorage } from '../src/main/storage';
import { createBlankDocument } from '../src/shared/types';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('local document storage', () => {
  it('writes files atomically and persists recovery drafts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'txt-docs-test-'));
    cleanup.push(directory);
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();

    const output = join(directory, 'example.docx');
    await storage.atomicWrite(output, new TextEncoder().encode('example'));
    expect(await readFile(output, 'utf8')).toBe('example');
    await storage.atomicWrite(output, new TextEncoder().encode('updated'));
    expect(await readFile(output, 'utf8')).toBe('updated');

    const document = createBlankDocument('Recovered');
    await storage.writeRecovery(document);
    expect((await storage.readRecovery())?.document.title).toBe('Recovered');
    await storage.clearRecovery();
    expect(await storage.readRecovery()).toBeNull();
  });

  it('keeps recent files bounded and opaque to the renderer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'txt-docs-recent-'));
    cleanup.push(directory);
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const path = join(directory, 'sample.docx');
    await storage.atomicWrite(path, new Uint8Array());
    const recent = await storage.remember(path);

    expect(recent).toHaveLength(1);
    expect(recent[0].displayName).toBe('sample.docx');
    expect(recent[0]).not.toHaveProperty('path');
    expect(await storage.getRecentPath(recent[0].id)).toBe(path);
  });
});
