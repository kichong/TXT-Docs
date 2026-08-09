import { describe, expect, it } from 'vitest';
import { appUpdateStateSchema, editorDocumentSchema, saveRequestSchema } from '../src/shared/schemas';
import { createBlankDocument } from '../src/shared/types';

describe('IPC schemas', () => {
  it('accepts a valid v1 document and save request', () => {
    const document = createBlankDocument();
    expect(editorDocumentSchema.parse(document)).toMatchObject({ schemaVersion: 1 });
    expect(saveRequestSchema.parse({ document })).toHaveProperty('document');
  });

  it('rejects unknown schema versions and unsafe page values', () => {
    const document = createBlankDocument();
    expect(() => editorDocumentSchema.parse({ ...document, schemaVersion: 2 })).toThrow();
    expect(() =>
      editorDocumentSchema.parse({
        ...document,
        page: { ...document.page, marginsIn: { ...document.page.marginsIn, left: 99 } },
      }),
    ).toThrow();
  });

  it('accepts plain text and Markdown document sources', () => {
    const document = createBlankDocument();
    for (const format of ['txt', 'md'] as const) {
      expect(
        editorDocumentSchema.parse({
          ...document,
          source: {
            id: `source-${format}`,
            displayName: `sample.${format}`,
            format,
            readOnly: false,
            legacyImported: false,
          },
        }),
      ).toHaveProperty('source.format', format);
    }
  });

  it('validates update state received across the preload boundary', () => {
    expect(
      appUpdateStateSchema.parse({
        currentVersion: '0.3.0',
        phase: 'available',
        canCheck: true,
        availableVersion: '0.4.0',
        downloadPercent: 0,
      }),
    ).toHaveProperty('availableVersion', '0.4.0');
    expect(() =>
      appUpdateStateSchema.parse({
        currentVersion: '0.3.0',
        phase: 'downloading',
        canCheck: true,
        downloadPercent: 101,
      }),
    ).toThrow();
  });
});
