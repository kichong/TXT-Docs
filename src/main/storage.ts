import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type {
  DocumentFormat,
  DocumentSource,
  EditorDocumentV1,
  RecentFile,
  RecoveryDraft,
} from '../shared/types';

interface PersistedRecentFile extends RecentFile {
  path: string;
}

interface PersistedState {
  recentFiles: PersistedRecentFile[];
}

export class LocalDocumentStorage {
  private readonly statePath: string;
  private readonly recoveryPath: string;
  private readonly sources = new Map<string, string>();

  constructor(private readonly appDataPath: string) {
    this.statePath = join(appDataPath, 'state.json');
    this.recoveryPath = join(appDataPath, 'recovery.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.appDataPath, { recursive: true });
  }

  private async readState(): Promise<PersistedState> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8')) as PersistedState;
      return { recentFiles: Array.isArray(value.recentFiles) ? value.recentFiles.slice(0, 8) : [] };
    } catch {
      return { recentFiles: [] };
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    await this.atomicWrite(this.statePath, Buffer.from(JSON.stringify(state, null, 2), 'utf8'));
  }

  private persistentId(path: string): string {
    return createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 20);
  }

  async createSource(path: string, format?: DocumentFormat, legacyImported = false): Promise<DocumentSource> {
    const id = this.persistentId(path);
    this.sources.set(id, path);
    let readOnly = false;
    try {
      await access(path, constants.W_OK);
    } catch {
      readOnly = true;
    }
    return {
      id,
      displayName: basename(path),
      format:
        format ??
        (extname(path).toLowerCase() === '.doc'
          ? 'doc-import'
          : extname(path).toLowerCase() === '.txt'
            ? 'txt'
            : ['.md', '.markdown'].includes(extname(path).toLowerCase())
              ? 'md'
              : 'docx'),
      readOnly,
      legacyImported,
    };
  }

  resolveSource(id: string): string | undefined {
    return this.sources.get(id);
  }

  async prepareUpdateResume(sourceId: string | null, version: string): Promise<void> {
    const path = sourceId === null ? null : this.resolveSource(sourceId);
    if (path === undefined) throw new Error('The current document is no longer available.');
    await this.atomicWrite(
      join(this.appDataPath, 'update-resume.json'),
      Buffer.from(JSON.stringify({ path, version }), 'utf8'),
    );
  }

  async clearUpdateResume(): Promise<void> {
    await unlink(join(this.appDataPath, 'update-resume.json')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async consumeUpdateResume(version: string): Promise<string | null> {
    let resume: { path?: unknown; version?: unknown } | null = null;
    try {
      resume = JSON.parse(await readFile(join(this.appDataPath, 'update-resume.json'), 'utf8'));
    } catch {
      // Missing or malformed restore state should leave the normal blank start intact.
    }
    await this.clearUpdateResume();
    if (resume?.version !== version || typeof resume.path !== 'string') return null;
    try {
      await access(resume.path, constants.R_OK);
      return resume.path;
    } catch {
      return null;
    }
  }

  async getRecentFiles(): Promise<RecentFile[]> {
    const state = await this.readState();
    for (const item of state.recentFiles) this.sources.set(item.id, item.path);
    return state.recentFiles.map(({ id, displayName, lastOpenedAt }) => ({ id, displayName, lastOpenedAt }));
  }

  async getRecentPath(id: string): Promise<string | undefined> {
    const state = await this.readState();
    const match = state.recentFiles.find((item) => item.id === id);
    if (match) this.sources.set(match.id, match.path);
    return match?.path;
  }

  async remember(path: string): Promise<RecentFile[]> {
    const state = await this.readState();
    const id = this.persistentId(path);
    const next: PersistedRecentFile = {
      id,
      path,
      displayName: basename(path),
      lastOpenedAt: new Date().toISOString(),
    };
    state.recentFiles = [next, ...state.recentFiles.filter((item) => item.id !== id)].slice(0, 8);
    this.sources.set(id, path);
    await this.writeState(state);
    return state.recentFiles.map(({ path: _path, ...item }) => item);
  }

  async atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    const backup = join(dirname(path), `.${basename(path)}.${randomUUID()}.bak`);
    let backupCreated = false;
    try {
      await writeFile(temporary, bytes);
      try {
        await rename(temporary, path);
      } catch (initialError) {
        const code = (initialError as NodeJS.ErrnoException).code;
        if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EACCES') throw initialError;

        try {
          await rename(path, backup);
          backupCreated = true;
        } catch (replaceError) {
          const replaceCode = (replaceError as NodeJS.ErrnoException).code;
          if (replaceCode === 'EPERM' || replaceCode === 'EACCES') {
            throw new Error(
              `TXT Docs could not replace "${basename(path)}". Close the file in Word or another application, then try Save again.`,
            );
          }
          throw replaceError;
        }

        try {
          await rename(temporary, path);
        } catch (replacementError) {
          await rename(backup, path).catch(() => undefined);
          backupCreated = false;
          throw replacementError;
        }
        await unlink(backup);
        backupCreated = false;
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (backupCreated) {
        await rename(backup, path).catch(() => undefined);
      }
      throw error;
    }
  }

  async writeRecovery(document: EditorDocumentV1): Promise<void> {
    const draft: RecoveryDraft = { document, savedAt: new Date().toISOString() };
    await this.atomicWrite(this.recoveryPath, Buffer.from(JSON.stringify(draft), 'utf8'));
  }

  async readRecovery(): Promise<RecoveryDraft | null> {
    try {
      return JSON.parse(await readFile(this.recoveryPath, 'utf8')) as RecoveryDraft;
    } catch {
      return null;
    }
  }

  async clearRecovery(): Promise<void> {
    await unlink(this.recoveryPath).catch(() => undefined);
  }
}
