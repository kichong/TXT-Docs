import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ConverterStatus } from '../shared/types';

const execFileAsync = promisify(execFile);

const commonPaths = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

export function findLibreOffice(): string | null {
  for (const candidate of commonPaths) {
    if (existsSync(candidate)) return candidate;
  }
  for (const directory of (process.env.PATH ?? '').split(';')) {
    const candidate = join(directory, 'soffice.exe');
    if (directory && existsSync(candidate)) return candidate;
  }
  return null;
}

export function getLegacyConverterStatus(): ConverterStatus {
  const executable = findLibreOffice();
  return {
    available: Boolean(executable),
    name: 'LibreOffice',
    detail: executable
      ? 'Legacy .doc files can be converted and imported. They must be saved as .docx.'
      : 'Install LibreOffice to import legacy .doc files. TXT Docs never overwrites the original .doc.',
  };
}

export async function convertLegacyDoc(path: string): Promise<Uint8Array> {
  const executable = findLibreOffice();
  if (!executable) {
    throw new Error('Legacy .doc import requires LibreOffice. Install LibreOffice, then try again.');
  }
  const tempDirectory = await mkdtemp(join(tmpdir(), 'txt-docs-convert-'));
  try {
    await execFileAsync(
      executable,
      ['--headless', '--convert-to', 'docx', '--outdir', tempDirectory, path],
      { windowsHide: true, timeout: 60_000 },
    );
    const converted = join(tempDirectory, `${basename(path, extname(path))}.docx`);
    return new Uint8Array(await readFile(converted));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`LibreOffice could not convert this .doc file. ${detail}`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
