import { describe, expect, it } from 'vitest';
import { editorDocumentSchema, saveRequestSchema } from '../src/shared/schemas';
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
});
