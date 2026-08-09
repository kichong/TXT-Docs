import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { exportDocx } from '../src/main/docx/exporter';
import { importDocx } from '../src/main/docx/importer';
import { createBlankDocument, type DocumentSource, type EditorDocumentV1, type JSONContent } from '../src/shared/types';

const source: DocumentSource = {
  id: 'fixture',
  displayName: 'fixture.docx',
  format: 'docx',
  readOnly: false,
  legacyImported: false,
};

function descendants(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(descendants)];
}

describe('DOCX adapter', () => {
  it('round-trips the supported semantic structure and formatting', async () => {
    const document: EditorDocumentV1 = {
      ...createBlankDocument('Round trip'),
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1, textAlign: 'center' },
            content: [{ type: 'text', text: 'Round trip', marks: [{ type: 'textStyle', attrs: { fontSize: '18pt' } }] }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Formatted text',
                marks: [
                  { type: 'bold' },
                  { type: 'underline' },
                  { type: 'textStyle', attrs: { color: '#336699', fontFamily: 'Arial', fontSize: '14pt' } },
                ],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'image',
                attrs: {
                  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                  width: 64,
                  height: 64,
                  alt: 'Fixture image',
                },
              },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'First bullet' }] },
                  {
                    type: 'orderedList',
                    content: [
                      {
                        type: 'listItem',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested number' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A1' }] }] },
                  { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B1' }] }] },
                ],
              },
            ],
          },
          { type: 'pageBreak' },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second page' }] },
        ],
      },
    };

    const bytes = await exportDocx(document);
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const imported = await importDocx(bytes, source);
    const nodes = descendants(imported.content);
    expect(nodes.some((node) => node.type === 'heading' && node.attrs?.level === 1)).toBe(true);
    const headingText = nodes.find((node) => node.text === 'Round trip');
    expect(headingText?.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.fontSize).toBe('18pt');
    expect(nodes.some((node) => node.type === 'bulletList')).toBe(true);
    expect(nodes.some((node) => node.type === 'orderedList')).toBe(true);
    expect(nodes.some((node) => node.type === 'table')).toBe(true);
    expect(nodes.some((node) => node.type === 'pageBreak')).toBe(true);
    expect(nodes.some((node) => node.type === 'image' && String(node.attrs?.src).startsWith('data:image/png;base64,'))).toBe(true);
    const formatted = nodes.find((node) => node.text === 'Formatted text');
    expect(formatted?.marks?.some((mark) => mark.type === 'bold')).toBe(true);
    expect(formatted?.marks?.some((mark) => mark.type === 'underline')).toBe(true);
    expect(formatted?.marks?.find((mark) => mark.type === 'textStyle')?.attrs).toMatchObject({
      color: '#336699',
      fontFamily: 'Arial',
      fontSize: '14pt',
    });
  });

  it('imports inherited document defaults for source font, size, color, and spacing', async () => {
    const document = createBlankDocument('Inherited formatting');
    document.content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Default styled text' }] }],
    };
    const imported = await importDocx(await exportDocx(document), source);
    const nodes = descendants(imported.content);
    const text = nodes.find((node) => node.text === 'Default styled text');
    expect(text?.marks?.find((mark) => mark.type === 'textStyle')?.attrs).toMatchObject({
      color: '#202124',
      fontFamily: 'Aptos',
      fontSize: '11pt',
    });
    const paragraph = nodes.find((node) => node.type === 'paragraph');
    expect(paragraph?.attrs).toMatchObject({ lineHeight: '1.15', spacingAfterPt: 8 });
  });

  it('rejects corrupt or encrypted input cleanly', async () => {
    await expect(importDocx(new TextEncoder().encode('not a docx'), source)).rejects.toThrow(
      /not a readable DOCX package/iu,
    );
  });

  it('reports unsupported Word features before overwrite', async () => {
    const bytes = await exportDocx(createBlankDocument('Compatibility'));
    const zip = await JSZip.loadAsync(bytes);
    zip.file('word/comments.xml', '<w:comments xmlns:w="urn:test"></w:comments>');
    zip.file('word/vbaProject.bin', new Uint8Array([1, 2, 3]));
    const imported = await importDocx(await zip.generateAsync({ type: 'uint8array' }), source);
    const codes = imported.compatibilityIssues.map((issue) => issue.code);
    expect(codes).toContain('comments');
    expect(codes).toContain('macros');
  });
});
