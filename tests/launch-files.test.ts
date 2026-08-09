import { describe, expect, it } from 'vitest';
import { findLaunchDocumentPath, isSupportedDocumentPath } from '../src/main/launch-files';

describe('command-line document activation', () => {
  it('finds supported Open with paths without treating Electron arguments as files', () => {
    expect(findLaunchDocumentPath(['.', '--inspect=0', 'C:\\Docs\\meeting notes.docx'], 'C:\\App'))
      .toBe('C:\\Docs\\meeting notes.docx');
    expect(findLaunchDocumentPath(['.', 'draft.md'], 'C:\\Docs')).toBe('C:\\Docs\\draft.md');
  });

  it('rejects unsupported launch files', () => {
    expect(isSupportedDocumentPath('picture.png')).toBe(false);
    expect(findLaunchDocumentPath(['TXT Docs.exe', 'picture.png'])).toBeNull();
  });
});
