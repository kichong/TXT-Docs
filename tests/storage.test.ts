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
  it('reopens only the selected update document, once, across an app restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'txt-docs-update-'));
    cleanup.push(directory);
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const selectedPath = join(directory, 'selected.txt');
    const recentPath = join(directory, 'recent.txt');
    await storage.atomicWrite(selectedPath, Buffer.from('selected'));
    await storage.atomicWrite(recentPath, Buffer.from('recent'));
    const source = await storage.createSource(selectedPath);
    await storage.remember(recentPath);
    await storage.prepareUpdateResume(source.id, '0.3.8');

    const restarted = new LocalDocumentStorage(directory);
    expect(await restarted.consumeUpdateResume('0.3.8')).toBe(selectedPath);
    expect(await restarted.consumeUpdateResume('0.3.8')).toBeNull();
  });

  it('starts blank after updating from a blank document or an unsuccessful update', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'txt-docs-update-blank-'));
    cleanup.push(directory);
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const path = join(directory, 'previous.txt');
    await storage.atomicWrite(path, Buffer.from('previous'));
    const source = await storage.createSource(path);
    await storage.prepareUpdateResume(source.id, '0.3.8');
    await storage.prepareUpdateResume(null, '0.3.8');
    expect(await storage.consumeUpdateResume('0.3.8')).toBeNull();

    await storage.prepareUpdateResume(source.id, '0.3.8');
    expect(await storage.consumeUpdateResume('0.3.7')).toBeNull();
    expect(await storage.consumeUpdateResume('0.3.8')).toBeNull();

    await storage.prepareUpdateResume(source.id, '0.3.8');
    await storage.clearUpdateResume();
    expect(await storage.consumeUpdateResume('0.3.8')).toBeNull();
  });

  it('handles missing files and malformed restore state without retrying on later launches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'txt-docs-update-missing-'));
    cleanup.push(directory);
    const storage = new LocalDocumentStorage(directory);
    await storage.initialize();
    const source = await storage.createSource(join(directory, 'missing.txt'));
    await storage.prepareUpdateResume(source.id, '0.3.8');
    expect(await storage.consumeUpdateResume('0.3.8')).toBeNull();
    await storage.atomicWrite(join(directory, 'update-resume.json'), Buffer.from('{invalid'));
    expect(await storage.consumeUpdateResume('0.3.8')).toBeNull();
    await expect(storage.prepareUpdateResume('unknown-source', '0.3.8')).rejects.toThrow();
  });

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
