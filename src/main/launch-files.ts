import { extname, resolve } from 'node:path';

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['.docx', '.doc', '.txt', '.md', '.markdown']);

export function isSupportedDocumentPath(path: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase());
}

export function findLaunchDocumentPath(commandLine: string[], workingDirectory = process.cwd()): string | null {
  for (const argument of commandLine) {
    if (!argument || argument.startsWith('-') || !isSupportedDocumentPath(argument)) continue;
    return resolve(workingDirectory, argument);
  }
  return null;
}
