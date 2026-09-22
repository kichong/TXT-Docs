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

function nodeText(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(nodeText).join('');
}

describe('DOCX adapter', () => {
  it('preserves paragraph spacing and default heading fonts across repeated saves', async () => {
    let document = createBlankDocument('Formatting');
    document.content = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, lineHeight: '1.5' }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', attrs: { lineHeight: '2' }, content: [{ type: 'text', text: 'Body' }] },
    ] };
    for (let pass = 0; pass < 2; pass += 1) {
      const result = await importDocx(await exportDocx(document), source);
      document = result;
      const nodes = descendants(document.content);
      expect(nodes.find((node) => node.type === 'heading')?.attrs?.lineHeight).toBe('1.5');
      expect(nodes.find((node) => node.type === 'paragraph')?.attrs?.lineHeight).toBe('2');
      const heading = nodes.find((node) => node.text === 'Heading');
      expect(heading?.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.fontFamily).toBe('Cambria');
    }
  });

  it('round-trips the supported semantic structure and formatting', async () => {
    const blank = createBlankDocument('Round trip');
    const document: EditorDocumentV1 = {
      ...blank,
      page: {
        ...blank.page,
        columns: 2,
        columnGapIn: 0.4,
      },
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
              { type: 'text', text: 'Before ' },
              { type: 'text', text: 'linked', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
              { type: 'text', text: ' after' },
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
    expect(imported.page).toMatchObject({ columns: 2, columnGapIn: 0.4 });
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
    const linkedParagraph = nodes.find(
      (node) => node.type === 'paragraph' && node.content?.some((child) => child.text === 'linked'),
    );
    expect(linkedParagraph?.content?.map((child) => child.text ?? '').join('')).toBe('Before linked after');
  });

  it('keeps content after self-closing Word paragraphs', async () => {
    const bytes = await exportDocx(createBlankDocument('Self-closing paragraphs'));
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file('word/document.xml')!.async('text');
    zip.file(
      'word/document.xml',
      documentXml.replace(
        /<w:body>/u,
        '<w:body><w:p/><w:p><w:r><w:t>Content after an empty paragraph</w:t></w:r></w:p>',
      ),
    );

    const imported = await importDocx(await zip.generateAsync({ type: 'uint8array' }), source);
    const nodes = descendants(imported.content);
    expect(nodes.some((node) => node.text === 'Content after an empty paragraph')).toBe(true);
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

  it('preserves continuous sections, unequal columns, and leading tab indents', async () => {
    const document = createBlankDocument('Sectioned resume');
    const left = Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      attrs: index === 1 ? { tabIndentIn: 0.5 } : {},
      content: [{ type: 'text', text: `Left detail ${index + 1}` }],
    }));
    const right = Array.from({ length: 4 }, (_, index) => ({
      type: 'paragraph',
      attrs: { textAlign: 'right' },
      content: [{ type: 'text', text: `Role ${index + 1}` }],
    }));
    document.content = {
      type: 'doc',
      content: [
        {
          type: 'documentSection',
          attrs: { columns: 1, columnGapIn: 0.5, continuous: false, explicitColumns: false },
          content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Resume header' }] }],
        },
        {
          type: 'documentSection',
          attrs: {
            columns: 2,
            columnGapIn: 0,
            columnWidthsIn: [4, 2.5],
            continuous: true,
            explicitColumns: true,
          },
          content: [
            { type: 'documentColumn', content: left },
            { type: 'documentColumn', content: right },
          ],
        },
      ],
    };

    const bytes = await exportDocx(document);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('text');
    expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
    expect(xml).toContain('<w:type w:val="continuous"/>');
    expect(xml).toContain('<w:col w:w="5760"');
    expect(xml).toContain('<w:col w:w="3600"');

    const imported = await importDocx(bytes, source);
    expect(imported.page.columns).toBe(1);
    const sections = imported.content.content ?? [];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ type: 'documentSection', attrs: { columns: 1 } });
    expect(sections[1]).toMatchObject({
      type: 'documentSection',
      attrs: {
        columns: 2,
        columnWidthsIn: [4, 2.5],
        continuous: true,
        explicitColumns: true,
      },
    });
    expect(sections[1].content?.map((node) => node.type)).toEqual(['documentColumn', 'documentColumn']);
    const nodes = descendants(imported.content);
    expect(nodes.find((node) => nodeText(node) === 'Left detail 2')?.attrs?.tabIndentIn).toBe(0.5);
    expect(imported.compatibilityIssues.map((issue) => issue.code)).not.toContain('uneven-columns');
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
    expect(codes).not.toContain('comments');
    expect(codes).toContain('macros');
  });

  it('round-trips editable Word comments and their text anchors', async () => {
    const document = createBlankDocument('Comments');
    document.comments = [{ id: 'review-1', body: 'Clarify this sentence.', author: 'Reviewer', createdAt: '2026-09-08T12:00:00.000Z' }];
    document.content = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Please ' },
          { type: 'text', text: 'review this', marks: [{ type: 'commentAnchor', attrs: { commentId: 'review-1' } }] },
          { type: 'text', text: ' today.' },
        ],
      }],
    };

    const imported = await importDocx(await exportDocx(document), source);
    expect(imported.comments).toHaveLength(1);
    expect(imported.comments[0]).toMatchObject({ body: 'Clarify this sentence.', author: 'Reviewer' });
    const anchored = descendants(imported.content).find((node) => node.text === 'review this');
    expect(anchored?.marks?.find((mark) => mark.type === 'commentAnchor')?.attrs?.commentId).toBe('0');
    expect(imported.compatibilityIssues.map((issue) => issue.code)).not.toContain('comments');
  });
});
