import {
  AlignmentType,
  BorderStyle,
  Column,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  SectionType,
  UnderlineType,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import type { EditorDocumentV1, JSONContent, JSONMark } from '../../shared/types';

const alignmentMap: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function markOf(node: JSONContent, type: string): JSONMark | undefined {
  return node.marks?.find((mark) => mark.type === type);
}

function sanitizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.replace(/^#/u, '');
  return /^[0-9a-f]{6}$/iu.test(hex) ? hex.toUpperCase() : undefined;
}

function textRunOptions(node: JSONContent): IRunOptions {
  const textStyle = markOf(node, 'textStyle')?.attrs ?? {};
  const fontSize = Number.parseFloat(String(textStyle.fontSize ?? ''));
  const color = sanitizeHex(textStyle.color);
  const highlight = sanitizeHex(markOf(node, 'highlight')?.attrs?.color);
  return {
    text: node.text ?? '',
    bold: Boolean(markOf(node, 'bold')),
    italics: Boolean(markOf(node, 'italic')),
    strike: Boolean(markOf(node, 'strike')),
    superScript: Boolean(markOf(node, 'superscript')),
    subScript: Boolean(markOf(node, 'subscript')),
    underline: markOf(node, 'underline') ? { type: UnderlineType.SINGLE } : undefined,
    color,
    size: Number.isFinite(fontSize) && fontSize > 0 ? Math.round(fontSize * 2) : undefined,
    font:
      typeof textStyle.fontFamily === 'string' && textStyle.fontFamily
        ? textStyle.fontFamily
        : undefined,
    shading: highlight ? { type: 'clear', fill: highlight, color: 'auto' } : undefined,
  };
}

function dataUrlToImage(src: string): { data: Uint8Array; type: 'png' | 'jpg' | 'gif' } | null {
  const match = src.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/isu);
  if (!match) return null;
  const type = match[1].toLowerCase();
  return {
    data: Uint8Array.from(Buffer.from(match[2], 'base64')),
    type: type === 'jpeg' ? 'jpg' : (type as 'png' | 'jpg' | 'gif'),
  };
}

type ExportInline = TextRun | ExternalHyperlink | ImageRun | PageBreak | CommentRangeStart | CommentRangeEnd | CommentReference;

function paragraphChildren(node: JSONContent, commentIds: Map<string, number>): ExportInline[] {
  const children: ExportInline[] = [];
  const tabIndentIn = Number(node.attrs?.tabIndentIn);
  if (Number.isFinite(tabIndentIn) && tabIndentIn > 0) {
    children.push(new TextRun({ text: '\t'.repeat(Math.max(1, Math.round(tabIndentIn / 0.5))) }));
  }
  let activeComment: string | undefined;
  for (const child of node.content ?? []) {
    const commentId = String(markOf(child, 'commentAnchor')?.attrs?.commentId ?? '');
    if (activeComment && activeComment !== commentId) {
      const numericId = commentIds.get(activeComment);
      if (numericId !== undefined) children.push(new CommentRangeEnd(numericId), new CommentReference(numericId));
      activeComment = undefined;
    }
    if (commentId && commentId !== activeComment) {
      const numericId = commentIds.get(commentId);
      if (numericId !== undefined) {
        children.push(new CommentRangeStart(numericId));
        activeComment = commentId;
      }
    }
    if (child.type === 'text') {
      const link = markOf(child, 'link');
      const run = new TextRun(textRunOptions(child));
      const href = link?.attrs?.href;
      if (typeof href === 'string' && /^(https?:|mailto:)/iu.test(href)) {
        children.push(new ExternalHyperlink({ link: href, children: [run] }));
      } else {
        children.push(run);
      }
    } else if (child.type === 'hardBreak') {
      children.push(new TextRun({ text: '', break: 1 }));
    } else if (child.type === 'image') {
      const source = typeof child.attrs?.src === 'string' ? dataUrlToImage(child.attrs.src) : null;
      if (!source) continue;
      children.push(
        new ImageRun({
          data: source.data,
          type: source.type,
          transformation: {
            width: Math.max(24, Number(child.attrs?.width ?? 320)),
            height: Math.max(24, Number(child.attrs?.height ?? 220)),
          },
          altText: {
            title: String(child.attrs?.title ?? ''),
            description: String(child.attrs?.alt ?? ''),
            name: String(child.attrs?.alt ?? 'Image'),
          },
        }),
      );
    }
  }
  if (activeComment) {
    const numericId = commentIds.get(activeComment);
    if (numericId !== undefined) children.push(new CommentRangeEnd(numericId), new CommentReference(numericId));
  }
  return children.length ? children : [new TextRun('')];
}

function paragraphOptions(
  node: JSONContent,
  commentIds: Map<string, number>,
  numbering?: { reference: string; level: number },
): IParagraphOptions {
  const attrs = node.attrs ?? {};
  const optionalNumber = (value: unknown): number =>
    value === null || value === undefined || value === '' ? Number.NaN : Number(value);
  const pointSpacing = typeof attrs.lineHeight === 'string' && /^\d+(?:\.\d+)?pt$/u.test(attrs.lineHeight);
  const lineHeight = pointSpacing ? Number(String(attrs.lineHeight).slice(0, -2)) : optionalNumber(attrs.lineHeight);
  const indent = Number(attrs.indent);
  const spacingBeforePt = optionalNumber(attrs.spacingBeforePt);
  const spacingAfterPt = optionalNumber(attrs.spacingAfterPt);
  const textAlign = typeof attrs.textAlign === 'string' ? alignmentMap[attrs.textAlign] : undefined;
  const hasSpacing = (Number.isFinite(lineHeight) && lineHeight > 0)
    || (Number.isFinite(spacingBeforePt) && spacingBeforePt >= 0)
    || (Number.isFinite(spacingAfterPt) && spacingAfterPt >= 0);
  return {
    children: paragraphChildren(node, commentIds),
    alignment: textAlign,
    keepNext: node.type === 'heading',
    heading:
      node.type === 'heading'
        ? headingMap[Number(attrs.level ?? 1)] ?? HeadingLevel.HEADING_1
        : undefined,
    style:
      attrs.paragraphStyle === 'no-spacing'
        ? 'NoSpacing'
        : attrs.paragraphStyle === 'title'
          ? 'Title'
          : undefined,
    spacing: hasSpacing
      ? {
          line: Number.isFinite(lineHeight) && lineHeight > 0 ? Math.round(lineHeight * (pointSpacing ? 20 : 240)) : undefined,
          lineRule: pointSpacing ? (attrs.lineSpacingRule === 'atLeast' ? LineRuleType.AT_LEAST : LineRuleType.EXACT) : LineRuleType.AUTO,
          before: Number.isFinite(spacingBeforePt) && spacingBeforePt >= 0 ? Math.round(spacingBeforePt * 20) : undefined,
          after: Number.isFinite(spacingAfterPt) && spacingAfterPt >= 0 ? Math.round(spacingAfterPt * 20) : undefined,
        }
      : undefined,
    indent: Number.isFinite(indent) && indent > 0
        ? { left: Math.round(indent * 360) }
        : undefined,
    numbering,
  };
}

function exportParagraph(node: JSONContent, commentIds: Map<string, number>, numbering?: { reference: string; level: number }): Paragraph {
  return new Paragraph(paragraphOptions(node, commentIds, numbering));
}

function exportTable(node: JSONContent, commentIds: Map<string, number>, numbering: NumberingDefinitions): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map(
          (cell) =>
            new TableCell({
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 100, right: 120, bottom: 100, left: 120 },
              children: exportNodes(cell.content ?? [], commentIds, numbering),
            }),
        ),
      }),
  );
  return new Table({
    rows: rows.length ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })],
    width: { size: 9360, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D8DADF' },
    },
  });
}

type ExportedBlock = Paragraph | Table;
type NumberingDefinitions = Array<{ reference: string; levels: ReturnType<typeof numberingLevels> }>;

function exportList(node: JSONContent, commentIds: Map<string, number>, numbering: NumberingDefinitions, level = 0): ExportedBlock[] {
  const output: ExportedBlock[] = [];
  const reference = `txt-docs-list-${numbering.length}`;
  const start = Math.max(1, Math.trunc(Number(node.attrs?.start) || 1));
  numbering.push({ reference, levels: numberingLevels(node.type === 'bulletList' ? 'bullet' : 'ordered', level, start) });
  for (const item of node.content ?? []) {
    let wroteParagraph = false;
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph' || child.type === 'heading') {
        output.push(exportParagraph(child, commentIds, { reference, level }));
        wroteParagraph = true;
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        output.push(...exportList(child, commentIds, numbering, Math.min(8, level + 1)));
      } else if (child.type === 'table') {
        output.push(exportTable(child, commentIds, numbering));
      }
    }
    if (!wroteParagraph) output.push(exportParagraph({ type: 'paragraph' }, commentIds, { reference, level }));
  }
  return output;
}

function exportNodes(nodes: JSONContent[], commentIds: Map<string, number>, numbering: NumberingDefinitions): ExportedBlock[] {
  const blocks: ExportedBlock[] = [];
  for (const node of nodes) {
    if (node.type === 'paragraph' || node.type === 'heading') blocks.push(exportParagraph(node, commentIds));
    else if (node.type === 'bulletList' || node.type === 'orderedList') blocks.push(...exportList(node, commentIds, numbering));
    else if (node.type === 'table') blocks.push(exportTable(node, commentIds, numbering));
    else if (node.type === 'image') {
      blocks.push(exportParagraph({ type: 'paragraph', content: [node] }, commentIds));
    } else if (node.type === 'pageBreak') {
      blocks.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (node.type === 'horizontalRule') {
      blocks.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B7BAC2', space: 6 } },
        }),
      );
    }
  }
  return blocks.length ? blocks : [new Paragraph('')];
}

function exportBlocks(document: EditorDocumentV1, commentIds: Map<string, number>, numbering: NumberingDefinitions): ExportedBlock[] {
  return exportNodes(document.content.content ?? [], commentIds, numbering);
}

function sectionChildren(node: JSONContent): JSONContent[] {
  const children: JSONContent[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'documentColumn') children.push(...(child.content ?? []));
    else children.push(child);
  }
  return children;
}

function numberingLevels(kind: 'bullet' | 'ordered', targetLevel = 0, start = 1) {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    start: level === targetLevel ? start : 1,
    format: kind === 'bullet' ? LevelFormat.BULLET : [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
    text: kind === 'bullet' ? ['•', '◦', '▪'][level % 3] : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: {
          left: 720 + level * 360,
          hanging: 360,
        },
      },
    },
  }));
}

export async function exportDocx(document: EditorDocumentV1): Promise<Buffer> {
  const commentIds = new Map((document.comments ?? []).map((comment, index) => [comment.id, index]));
  const numbering: NumberingDefinitions = [];
  const pageProperties = {
    size: { width: 12240, height: 15840 },
    margin: {
      top: Math.round(document.page.marginsIn.top * 1440),
      right: Math.round(document.page.marginsIn.right * 1440),
      bottom: Math.round(document.page.marginsIn.bottom * 1440),
      left: Math.round(document.page.marginsIn.left * 1440),
    },
  };
  const sectionNodes = (document.content.content ?? []).filter((node) => node.type === 'documentSection');
  const sections = sectionNodes.length
    ? sectionNodes.map((node, index) => {
        const columns = Math.max(1, Math.min(8, Math.round(Number(node.attrs?.columns) || 1)));
        const gap = Math.max(0, Number(node.attrs?.columnGapIn) || 0);
        const widths = Array.isArray(node.attrs?.columnWidthsIn)
          ? node.attrs.columnWidthsIn.map(Number).filter((width) => Number.isFinite(width) && width > 0)
          : [];
        return {
          properties: {
            type: index > 0 && node.attrs?.continuous ? SectionType.CONTINUOUS : undefined,
            column: {
              count: columns,
              space: Math.round(gap * 1440),
              equalWidth: widths.length !== columns,
              children: widths.length === columns
                ? widths.map((width, columnIndex) => new Column({
                    width: Math.round(width * 1440),
                    space: columnIndex < widths.length - 1 ? Math.round(gap * 1440) : 0,
                  }))
                : undefined,
            },
            page: pageProperties,
          },
          children: exportNodes(sectionChildren(node), commentIds, numbering),
        };
      })
    : [
        {
          properties: {
            column: {
              count: Math.max(1, Math.min(8, Math.round(document.page.columns ?? 1))),
              space: Math.round((document.page.columnGapIn ?? 0.5) * 1440),
              equalWidth: true,
            },
            page: pageProperties,
          },
          children: exportBlocks(document, commentIds, numbering),
        },
      ];
  const docx = new Document({
    creator: 'TXT Docs',
    title: document.title,
    description: 'Created with TXT Docs',
    comments: {
      children: (document.comments ?? []).map((comment, index) => ({
        id: index,
        author: comment.author || 'TXT Docs User',
        initials: '',
        date: comment.createdAt ? new Date(comment.createdAt) : new Date(),
        children: [new Paragraph({ children: [new TextRun(comment.body)] })],
      })),
    },
    styles: {
      default: {
        heading1: { run: { font: 'Cambria', size: 48, color: '202124', bold: true } },
        heading2: { run: { font: 'Cambria', size: 36, color: '202124', bold: true } },
        heading3: { run: { font: 'Cambria', size: 28, color: '202124', bold: true } },
        title: { run: { font: 'Cambria', size: 56, color: '202124' } },
        document: {
          run: { font: 'Times New Roman', size: 24, color: '202124' },
          paragraph: { spacing: { after: 0, line: 240 } },
        },
      },
      paragraphStyles: [
        {
          id: 'NoSpacing',
          name: 'No Spacing',
          basedOn: 'Normal',
          next: 'NoSpacing',
          quickFormat: true,
          paragraph: { spacing: { before: 0, after: 0, line: 240 } },
        },
      ],
    },
    numbering: {
      config: numbering,
    },
    sections,
  });
  return Packer.toBuffer(docx);
}
