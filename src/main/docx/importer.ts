import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import {
  DEFAULT_PAGE_SETTINGS,
  type CompatibilityIssue,
  type DocumentSource,
  type EditorDocumentV1,
  type JSONContent,
  type JSONMark,
  type PageSettings,
} from '../../shared/types';

type XmlNode = Record<string, any>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: false,
});

const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  preserveOrder: true,
  trimValues: false,
});

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const attr = (node: any, name: string): string | undefined => {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const value = node[name] ?? node.val ?? node.value;
  return value === undefined ? undefined : String(value);
};

const textValue = (value: any): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(value['#text'] ?? '');
};

const basenameWithoutExtension = (fileName: string): string =>
  fileName.replace(/\.[^.]+$/u, '') || 'Untitled document';

function parsePageSettings(documentXml: string): PageSettings {
  const data = parser.parse(documentXml);
  const section = data?.document?.body?.sectPr;
  const margins = section?.pgMar;
  const inches = (value: unknown, fallback: number) => {
    const twips = Number(value);
    return Number.isFinite(twips) ? Math.max(0, Math.min(4, twips / 1440)) : fallback;
  };
  const requestedColumns = Number(attr(section?.cols, 'num') ?? 1);
  return {
    ...DEFAULT_PAGE_SETTINGS,
    columns: Number.isFinite(requestedColumns)
      ? Math.max(1, Math.min(8, Math.round(requestedColumns)))
      : DEFAULT_PAGE_SETTINGS.columns,
    columnGapIn: inches(attr(section?.cols, 'space'), DEFAULT_PAGE_SETTINGS.columnGapIn),
    marginsIn: {
      top: inches(attr(margins, 'top'), DEFAULT_PAGE_SETTINGS.marginsIn.top),
      right: inches(attr(margins, 'right'), DEFAULT_PAGE_SETTINGS.marginsIn.right),
      bottom: inches(attr(margins, 'bottom'), DEFAULT_PAGE_SETTINGS.marginsIn.bottom),
      left: inches(attr(margins, 'left'), DEFAULT_PAGE_SETTINGS.marginsIn.left),
    },
  };
}

interface SectionSpec {
  columns: number;
  columnGapIn: number;
  columnWidthsIn?: number[];
  continuous: boolean;
}

function parseSectionSpec(section: XmlNode | undefined): SectionSpec {
  const requestedColumns = Number(attr(section?.cols, 'num') ?? 1);
  const columns = Number.isFinite(requestedColumns)
    ? Math.max(1, Math.min(8, Math.round(requestedColumns)))
    : 1;
  const requestedGap = Number(attr(section?.cols, 'space'));
  const columnGapIn = Number.isFinite(requestedGap)
    ? Math.max(0, Math.min(4, requestedGap / 1440))
    : DEFAULT_PAGE_SETTINGS.columnGapIn;
  const widths = asArray(section?.cols?.col)
    .map((column) => Number(attr(column, 'w')) / 1440)
    .filter((width) => Number.isFinite(width) && width > 0);
  const equalWidth = attr(section?.cols, 'equalWidth');
  return {
    columns,
    columnGapIn,
    columnWidthsIn: widths.length === columns && !['1', 'true', 'on'].includes(String(equalWidth).toLowerCase())
      ? widths
      : undefined,
    continuous: attr(section?.type, 'val') === 'continuous',
  };
}

interface StyleInfo {
  id: string;
  name?: string;
  basedOn?: string;
  paragraph?: XmlNode;
  run?: XmlNode;
}

interface StyleCatalog {
  items: Map<string, StyleInfo>;
  defaultParagraphStyleId?: string;
  defaultParagraph: XmlNode;
  defaultRun: XmlNode;
}

interface ThemeFonts {
  major?: string;
  minor?: string;
}

interface ImportContext {
  zip: JSZip;
  styles: StyleCatalog;
  themeFonts: ThemeFonts;
  relationships: Map<string, string>;
  numbering: Map<string, Map<number, 'bullet' | 'ordered' | 'unsupported'>>;
  media: Map<string, string>;
}

function parseStyles(xml?: string): StyleCatalog {
  const items = new Map<string, StyleInfo>();
  if (!xml) return { items, defaultParagraph: {}, defaultRun: {} };
  const data = parser.parse(xml);
  let defaultParagraphStyleId: string | undefined;
  for (const style of asArray(data?.styles?.style)) {
    const id = attr(style, 'styleId');
    if (!id) continue;
    items.set(id, {
      id,
      name: attr(style.name, 'val'),
      basedOn: attr(style.basedOn, 'val'),
      paragraph: style.pPr,
      run: style.rPr,
    });
    if (attr(style, 'type') === 'paragraph' && booleanProperty(style.default)) {
      defaultParagraphStyleId = id;
    }
  }
  return {
    items,
    defaultParagraphStyleId,
    defaultParagraph: data?.styles?.docDefaults?.pPrDefault?.pPr ?? {},
    defaultRun: data?.styles?.docDefaults?.rPrDefault?.rPr ?? {},
  };
}

function mergeStyleChain(
  styles: StyleCatalog,
  styleId: string | undefined,
  property: 'paragraph' | 'run',
  seen = new Set<string>(),
): XmlNode {
  if (!styleId || seen.has(styleId)) return {};
  seen.add(styleId);
  const style = styles.items.get(styleId);
  if (!style) return {};
  return {
    ...mergeStyleChain(styles, style.basedOn, property, seen),
    ...(style[property] ?? {}),
  };
}

function mergeProperties(
  styles: StyleCatalog,
  styleId: string | undefined,
  property: 'paragraph' | 'run',
): XmlNode {
  const resolvedStyleId = styleId ?? styles.defaultParagraphStyleId;
  return {
    ...(property === 'paragraph' ? styles.defaultParagraph : styles.defaultRun),
    ...mergeStyleChain(styles, resolvedStyleId, property),
  };
}

function parseThemeFonts(xml?: string): ThemeFonts {
  if (!xml) return {};
  const data = parser.parse(xml);
  const scheme = data?.theme?.themeElements?.fontScheme;
  return {
    major: attr(scheme?.majorFont?.latin, 'typeface'),
    minor: attr(scheme?.minorFont?.latin, 'typeface'),
  };
}

function parseRelationships(xml?: string): Map<string, string> {
  const relationships = new Map<string, string>();
  if (!xml) return relationships;
  const data = parser.parse(xml);
  for (const relationship of asArray(data?.Relationships?.Relationship)) {
    const id = attr(relationship, 'Id');
    const target = attr(relationship, 'Target');
    if (id && target) relationships.set(id, target);
  }
  return relationships;
}

function parseNumbering(xml?: string): Map<string, Map<number, 'bullet' | 'ordered' | 'unsupported'>> {
  const result = new Map<string, Map<number, 'bullet' | 'ordered' | 'unsupported'>>();
  if (!xml) return result;
  const data = parser.parse(xml);
  const abstract = new Map<string, Map<number, 'bullet' | 'ordered' | 'unsupported'>>();

  for (const definition of asArray(data?.numbering?.abstractNum)) {
    const id = attr(definition, 'abstractNumId');
    if (!id) continue;
    const levels = new Map<number, 'bullet' | 'ordered' | 'unsupported'>();
    for (const level of asArray(definition.lvl)) {
      const levelNumber = Number(attr(level, 'ilvl') ?? 0);
      const format = attr(level.numFmt, 'val') ?? 'decimal';
      levels.set(
        levelNumber,
        format === 'bullet'
          ? 'bullet'
          : ['decimal', 'lowerLetter', 'upperLetter', 'lowerRoman', 'upperRoman'].includes(format)
            ? 'ordered'
            : 'unsupported',
      );
    }
    abstract.set(id, levels);
  }

  for (const number of asArray(data?.numbering?.num)) {
    const id = attr(number, 'numId');
    const abstractId = attr(number.abstractNumId, 'val');
    if (id && abstractId && abstract.has(abstractId)) {
      result.set(id, abstract.get(abstractId)!);
    }
  }
  return result;
}

function resolveStyleName(context: ImportContext, styleId?: string): string | undefined {
  const resolved = styleId ?? context.styles.defaultParagraphStyleId;
  return resolved ? context.styles.items.get(resolved)?.name : undefined;
}

function booleanProperty(value: any): boolean {
  if (value === undefined || value === null) return false;
  const explicit = attr(value, 'val');
  return explicit === undefined || !['0', 'false', 'off', 'none'].includes(explicit.toLowerCase());
}

function runMarks(rPr: XmlNode | undefined, themeFonts: ThemeFonts): JSONMark[] {
  if (!rPr) return [];
  const marks: JSONMark[] = [];
  if (booleanProperty(rPr.b)) marks.push({ type: 'bold' });
  if (booleanProperty(rPr.i)) marks.push({ type: 'italic' });
  if (rPr.u && attr(rPr.u, 'val') !== 'none') marks.push({ type: 'underline' });
  if (booleanProperty(rPr.strike) || booleanProperty(rPr.dstrike)) marks.push({ type: 'strike' });

  const vertical = attr(rPr.vertAlign, 'val');
  if (vertical === 'subscript') marks.push({ type: 'subscript' });
  if (vertical === 'superscript') marks.push({ type: 'superscript' });

  const color = attr(rPr.color, 'val');
  const size = Number(attr(rPr.sz, 'val'));
  const themeFont = attr(rPr.rFonts, 'asciiTheme') ?? attr(rPr.rFonts, 'hAnsiTheme');
  const font = attr(rPr.rFonts, 'ascii')
    ?? attr(rPr.rFonts, 'hAnsi')
    ?? (themeFont?.toLowerCase().includes('major') ? themeFonts.major : themeFonts.minor);
  const textStyle: Record<string, unknown> = {};
  if (color && color !== 'auto') textStyle.color = `#${color}`;
  if (Number.isFinite(size) && size > 0) textStyle.fontSize = `${size / 2}pt`;
  if (font) textStyle.fontFamily = font;
  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });

  const highlight = attr(rPr.highlight, 'val');
  if (highlight && highlight !== 'none') {
    const highlightMap: Record<string, string> = {
      yellow: '#fff176',
      green: '#81c784',
      cyan: '#80deea',
      magenta: '#f48fb1',
      blue: '#90caf9',
      red: '#ef9a9a',
      darkBlue: '#5c6bc0',
      darkCyan: '#26a69a',
      darkGreen: '#388e3c',
      darkMagenta: '#ab47bc',
      darkRed: '#d32f2f',
      darkYellow: '#f9a825',
      lightGray: '#e0e0e0',
      darkGray: '#757575',
      black: '#212121',
      white: '#ffffff',
    };
    marks.push({ type: 'highlight', attrs: { color: highlightMap[highlight] ?? '#fff176' } });
  }
  return marks;
}

async function relationshipImage(context: ImportContext, relationshipId: string): Promise<string | null> {
  if (context.media.has(relationshipId)) return context.media.get(relationshipId)!;
  const target = context.relationships.get(relationshipId);
  if (!target || target.includes('://')) return null;
  const normalized = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//u, '')}`;
  const file = context.zip.file(normalized.replace(/\\/gu, '/'));
  if (!file) return null;
  const bytes = await file.async('base64');
  const extension = normalized.split('.').pop()?.toLowerCase();
  const mime =
    extension === 'png'
      ? 'image/png'
      : extension === 'gif'
        ? 'image/gif'
        : extension === 'svg'
          ? 'image/svg+xml'
          : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${bytes}`;
  context.media.set(relationshipId, dataUrl);
  return dataUrl;
}

async function runsFromContainer(
  container: XmlNode,
  context: ImportContext,
  inheritedRun: XmlNode,
  linkHref?: string,
  orderedChildren?: XmlNode[],
): Promise<{ content: JSONContent[]; hasPageBreak: boolean }> {
  const content: JSONContent[] = [];
  let hasPageBreak = false;
  const runs = asArray(container?.r);
  const hyperlinks = asArray(container?.hyperlink);

  const appendRun = async (run: XmlNode) => {
    const styleId = attr(run.rPr?.rStyle, 'val');
    const styleRun = mergeProperties(context.styles, styleId, 'run');
    const properties = { ...inheritedRun, ...styleRun, ...(run.rPr ?? {}) };
    const marks = runMarks(properties, context.themeFonts);
    if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
    const pieces: string[] = [];
    if (run.tab !== undefined) pieces.push(...asArray(run.tab).map(() => '\t'));
    pieces.push(...asArray(run.t).map(textValue));
    for (const br of asArray(run.br)) {
      if (attr(br, 'type') === 'page') hasPageBreak = true;
      else pieces.push('\n');
    }
    const text = pieces.join('');
    if (text) content.push({ type: 'text', text, marks: marks.length ? marks : undefined });

    const drawings = [...asArray(run.drawing), ...asArray(run.pict)];
    for (const drawing of drawings) {
      const blip = drawing?.inline?.graphic?.graphicData?.pic?.blipFill?.blip
        ?? drawing?.anchor?.graphic?.graphicData?.pic?.blipFill?.blip
        ?? drawing?.shape?.imagedata;
      const embed = attr(blip, 'embed') ?? attr(blip, 'id');
      if (!embed) continue;
      const src = await relationshipImage(context, embed);
      if (!src) continue;
      const extent = drawing?.inline?.extent ?? drawing?.anchor?.extent;
      const width = Math.max(32, Math.round(Number(attr(extent, 'cx') ?? 1828800) / 9525));
      const height = Math.max(32, Math.round(Number(attr(extent, 'cy') ?? 1371600) / 9525));
      content.push({ type: 'image', attrs: { src, width, height, alt: '' } });
    }
  };

  const appendHyperlink = async (hyperlink: XmlNode, ordered?: XmlNode[]) => {
    const relationId = attr(hyperlink, 'id');
    const href = relationId ? context.relationships.get(relationId) : attr(hyperlink, 'anchor');
    const linked = await runsFromContainer(hyperlink, context, inheritedRun, href, ordered);
    content.push(...linked.content);
    hasPageBreak ||= linked.hasPageBreak;
  };

  if (orderedChildren) {
    let runIndex = 0;
    let hyperlinkIndex = 0;
    for (const child of orderedChildren) {
      if (child.r !== undefined && runIndex < runs.length) {
        await appendRun(runs[runIndex]);
        runIndex += 1;
      } else if (child.hyperlink !== undefined && hyperlinkIndex < hyperlinks.length) {
        await appendHyperlink(hyperlinks[hyperlinkIndex], asArray(child.hyperlink));
        hyperlinkIndex += 1;
      }
    }
    while (runIndex < runs.length) {
      await appendRun(runs[runIndex]);
      runIndex += 1;
    }
    while (hyperlinkIndex < hyperlinks.length) {
      await appendHyperlink(hyperlinks[hyperlinkIndex]);
      hyperlinkIndex += 1;
    }
  } else {
    for (const run of runs) await appendRun(run);
    for (const hyperlink of hyperlinks) await appendHyperlink(hyperlink);
  }
  return { content, hasPageBreak };
}

interface ParagraphResult {
  node: JSONContent;
  list?: { id: string; level: number; kind: 'bullet' | 'ordered' };
  pageBreakAfter: boolean;
}

async function importParagraph(
  paragraph: XmlNode,
  context: ImportContext,
  orderedChildren?: XmlNode[],
): Promise<ParagraphResult> {
  const styleId = attr(paragraph.pPr?.pStyle, 'val');
  const styleName = resolveStyleName(context, styleId);
  const styleParagraph = mergeProperties(context.styles, styleId, 'paragraph');
  const styleRun = mergeProperties(context.styles, styleId, 'run');
  const pPr = { ...styleParagraph, ...(paragraph.pPr ?? {}) };
  const inheritedRun = { ...styleRun, ...(pPr.rPr ?? {}) };
  const { content, hasPageBreak } = await runsFromContainer(paragraph, context, inheritedRun, undefined, orderedChildren);

  const headingMatch = styleName?.match(/^Heading\s*([1-6])$/iu);
  const alignment = attr(pPr.jc, 'val');
  const leftIndent = Number(attr(pPr.ind, 'left') ?? 0);
  const line = Number(attr(pPr.spacing, 'line') ?? 0);
  const spacingBefore = Number(attr(pPr.spacing, 'before'));
  const spacingAfter = Number(attr(pPr.spacing, 'after'));
  const attrs: Record<string, unknown> = {};
  let leadingTabs = 0;
  for (const child of content) {
    if (child.type !== 'text' || !child.text) break;
    const match = child.text.match(/^\t+/u);
    if (!match) break;
    leadingTabs += match[0].length;
    child.text = child.text.slice(match[0].length);
    if (child.text) break;
  }
  while (content[0]?.type === 'text' && content[0].text === '') content.shift();
  if (leadingTabs > 0) attrs.tabIndentIn = Math.min(4, leadingTabs * 0.5);
  if (alignment && ['left', 'center', 'right', 'both', 'justify'].includes(alignment)) {
    attrs.textAlign = alignment === 'both' ? 'justify' : alignment;
  }
  if (leftIndent > 0) attrs.indent = Math.min(8, Math.max(1, Math.round(leftIndent / 360)));
  attrs.lineHeight = line > 0 ? String(Math.round((line / 240) * 100) / 100) : '1';
  attrs.spacingBeforePt = Number.isFinite(spacingBefore) && spacingBefore >= 0 ? spacingBefore / 20 : 0;
  attrs.spacingAfterPt = Number.isFinite(spacingAfter) && spacingAfter >= 0 ? spacingAfter / 20 : 0;
  if (styleName?.toLowerCase() === 'no spacing') attrs.paragraphStyle = 'no-spacing';
  if (styleName?.toLowerCase() === 'title') attrs.paragraphStyle = 'title';

  const node: JSONContent = headingMatch
    ? { type: 'heading', attrs: { ...attrs, level: Number(headingMatch[1]) }, content }
    : { type: 'paragraph', attrs, content };

  const numId = attr(pPr.numPr?.numId, 'val');
  const level = Number(attr(pPr.numPr?.ilvl, 'val') ?? 0);
  const kind = numId ? context.numbering.get(numId)?.get(level) : undefined;
  return {
    node,
    list:
      numId && (kind === 'bullet' || kind === 'ordered')
        ? { id: numId, level, kind }
        : undefined,
    pageBreakAfter: hasPageBreak,
  };
}

function appendListParagraph(
  output: JSONContent[],
  paragraph: ParagraphResult,
  stack: Array<{ level: number; list: JSONContent; lastItem?: JSONContent; kind: 'bullet' | 'ordered'; id: string }>,
): void {
  const list = paragraph.list!;
  while (
    stack.length &&
    (stack[stack.length - 1].level > list.level
      || stack[stack.length - 1].kind !== list.kind
      || stack[stack.length - 1].id !== list.id)
  ) {
    stack.pop();
  }

  if (!stack.length || stack[stack.length - 1].level < list.level) {
    const nested: JSONContent = { type: list.kind === 'bullet' ? 'bulletList' : 'orderedList', content: [] };
    const parent = stack[stack.length - 1];
    if (parent?.lastItem) {
      parent.lastItem.content ??= [];
      parent.lastItem.content.push(nested);
    } else {
      output.push(nested);
    }
    stack.push({ level: list.level, list: nested, kind: list.kind, id: list.id });
  }

  const current = stack[stack.length - 1];
  const item: JSONContent = { type: 'listItem', content: [paragraph.node] };
  current.list.content ??= [];
  current.list.content.push(item);
  current.lastItem = item;
}

async function importTable(table: XmlNode, context: ImportContext): Promise<JSONContent> {
  const rows: JSONContent[] = [];
  for (const row of asArray(table.tr)) {
    const cells: JSONContent[] = [];
    for (const cell of asArray(row.tc)) {
      const cellContent: JSONContent[] = [];
      for (const paragraph of asArray(cell.p)) {
        cellContent.push((await importParagraph(paragraph, context)).node);
      }
      if (!cellContent.length) cellContent.push({ type: 'paragraph' });
      cells.push({ type: 'tableCell', content: cellContent });
    }
    rows.push({ type: 'tableRow', content: cells });
  }
  return { type: 'table', content: rows };
}

function detectCompatibility(zip: JSZip, documentXml: string, numberingXml?: string): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const add = (code: string, title: string, detail: string) => {
    if (!issues.some((issue) => issue.code === code)) {
      issues.push({ code, severity: 'warning', title, detail });
    }
  };
  const files = Object.keys(zip.files);
  if (files.some((name) => /vbaProject\.bin$/iu.test(name))) {
    add('macros', 'Macros are not preserved', 'VBA macros will be removed if this file is saved from TXT Docs.');
  }
  if (files.some((name) => /word\/comments.*\.xml$/iu.test(name))) {
    add('comments', 'Comments are not preserved', 'Review comments will be removed if this file is saved from TXT Docs.');
  }
  if (files.some((name) => /word\/header\d*\.xml$/iu.test(name) || /word\/footer\d*\.xml$/iu.test(name))) {
    add('headers-footers', 'Headers or footers are not preserved', 'Advanced page furniture is deferred.');
  }
  const checks: Array<[RegExp, string, string, string]> = [
    [/<w:(ins|del)\b/iu, 'tracked-changes', 'Tracked changes are flattened', 'Revisions are not retained as revisions.'],
    [/<w:sdt\b/iu, 'content-controls', 'Content controls are not preserved', 'Form controls are imported as visible content only.'],
    [/<m:oMath/iu, 'equations', 'Equations are not preserved', 'Office Math objects are outside the v1 model.'],
    [/<w:altChunk\b/iu, 'embedded-content', 'Embedded content is not preserved', 'Alternate content parts are unsupported.'],
    [/<wp:anchor\b/iu, 'floating-objects', 'Floating objects may move', 'Floating images are converted to inline images.'],
    [/<w:cols\b[^>]*w:equalWidth="?(?:0|false|off)/iu, 'uneven-columns', 'Uneven columns are simplified', 'TXT Docs preserves the column count and gap using equal-width columns.'],
    [/<w:cols\b[^>]*>(?:(?!<\/w:cols>)[^])*?<w:col\b/iu, 'uneven-columns', 'Uneven columns are simplified', 'TXT Docs preserves the column count and gap using equal-width columns.'],
  ];
  for (const [pattern, code, title, detail] of checks) {
    if (pattern.test(documentXml)) add(code, title, detail);
  }
  if (numberingXml && /<w:numFmt\b[^>]*w:val="(?!bullet|decimal|lowerLetter|upperLetter|lowerRoman|upperRoman)[^"]+"/iu.test(numberingXml)) {
    add('custom-numbering', 'Some numbering is simplified', 'Unsupported numbering formats become standard numbering.');
  }
  return issues;
}

function extractBodyBlocks(xml: string): Array<{ type: 'p' | 'tbl'; xml: string }> {
  const bodyStartTag = xml.match(/<w:body\b[^>]*>/iu);
  if (bodyStartTag?.index === undefined) return [];
  const start = bodyStartTag.index + bodyStartTag[0].length;
  const end = xml.indexOf('</w:body>', start);
  if (end < 0) return [];
  const body = xml.slice(start, end);
  const blocks: Array<{ type: 'p' | 'tbl'; xml: string }> = [];
  let cursor = 0;

  while (cursor < body.length) {
    const next = /<w:(p|tbl)(?=\s|>)[^>]*>/giu;
    next.lastIndex = cursor;
    const match = next.exec(body);
    if (!match || match.index === undefined) break;
    const type = match[1] as 'p' | 'tbl';
    const blockStart = match.index;
    if (type === 'p') {
      if (match[0].endsWith('/>')) {
        blocks.push({ type, xml: match[0] });
        cursor = next.lastIndex;
        continue;
      }
      const close = body.indexOf('</w:p>', next.lastIndex);
      if (close < 0) break;
      const blockEnd = close + '</w:p>'.length;
      blocks.push({ type, xml: body.slice(blockStart, blockEnd) });
      cursor = blockEnd;
      continue;
    }

    const tokenPattern = /<w:tbl(?=\s|>)|<\/w:tbl>/giu;
    tokenPattern.lastIndex = blockStart;
    let depth = 0;
    let blockEnd = -1;
    for (let token = tokenPattern.exec(body); token; token = tokenPattern.exec(body)) {
      if (token[0].startsWith('</')) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        blockEnd = tokenPattern.lastIndex;
        break;
      }
    }
    if (blockEnd < 0) break;
    blocks.push({ type, xml: body.slice(blockStart, blockEnd) });
    cursor = blockEnd;
  }
  return blocks;
}

function nodeText(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(nodeText).join('');
}

function unevenColumnSplit(nodes: JSONContent[], columns: number): number | null {
  if (columns !== 2 || nodes.length < 8) return null;
  const minimum = Math.max(2, Math.floor(nodes.length * 0.25));
  for (let index = minimum; index < nodes.length - 2; index += 1) {
    const node = nodes[index];
    if (!nodeText(node).trim() || node.attrs?.textAlign !== 'right') continue;
    const following = nodes
      .slice(index)
      .filter((candidate) => nodeText(candidate).trim())
      .slice(0, 4);
    if (following.length < 3 || following.some((candidate) => candidate.attrs?.textAlign !== 'right')) continue;
    const preceding = nodes
      .slice(0, index)
      .filter((candidate) => nodeText(candidate).trim())
      .slice(-6);
    if (preceding.filter((candidate) => candidate.attrs?.textAlign === 'right').length > 1) continue;
    let split = index;
    while (split > 0 && !nodeText(nodes[split - 1]).trim() && nodes[split - 1].attrs?.textAlign === 'right') {
      split -= 1;
    }
    return split;
  }
  return null;
}

function sectionNode(nodes: JSONContent[], spec: SectionSpec): JSONContent {
  const attrs: Record<string, unknown> = {
    columns: spec.columns,
    columnGapIn: spec.columnGapIn,
    continuous: spec.continuous,
    explicitColumns: false,
  };
  let content = nodes.length ? nodes : [{ type: 'paragraph' }];
  if (spec.columnWidthsIn) {
    attrs.columnWidthsIn = spec.columnWidthsIn;
    const split = unevenColumnSplit(content, spec.columns);
    if (split !== null) {
      attrs.explicitColumns = true;
      content = [
        { type: 'documentColumn', content: content.slice(0, split) },
        { type: 'documentColumn', content: content.slice(split) },
      ];
    }
  }
  return { type: 'documentSection', attrs, content };
}

export async function importDocx(
  bytes: Uint8Array,
  source: DocumentSource,
): Promise<EditorDocumentV1> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('This file is not a readable DOCX package. It may be corrupted or password-protected.');
  }

  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('The DOCX package does not contain word/document.xml.');
  const documentXml = await documentFile.async('text');
  const [stylesXml, relationshipsXml, numberingXml, themeXml] = await Promise.all([
    zip.file('word/styles.xml')?.async('text'),
    zip.file('word/_rels/document.xml.rels')?.async('text'),
    zip.file('word/numbering.xml')?.async('text'),
    zip.file('word/theme/theme1.xml')?.async('text'),
  ]);

  const context: ImportContext = {
    zip,
    styles: parseStyles(stylesXml),
    themeFonts: parseThemeFonts(themeXml),
    relationships: parseRelationships(relationshipsXml),
    numbering: parseNumbering(numberingXml),
    media: new Map(),
  };
  let content: JSONContent[] = [];
  const sectionSegments: Array<{ nodes: JSONContent[]; spec: SectionSpec }> = [];
  const listStack: Array<{
    level: number;
    list: JSONContent;
    lastItem?: JSONContent;
    kind: 'bullet' | 'ordered';
    id: string;
  }> = [];

  const blocks = extractBodyBlocks(documentXml);
  if (!blocks.length && !/<w:body\b/iu.test(documentXml)) {
    throw new Error('The DOCX document body could not be read.');
  }
  for (const block of blocks) {
    const parsed = parser.parse(block.xml);
    if (block.type === 'tbl') {
      listStack.length = 0;
      content.push(await importTable(parsed.tbl, context));
      continue;
    }
    const ordered = orderedParser.parse(block.xml);
    const imported = await importParagraph(parsed.p, context, asArray(ordered?.[0]?.p));
    if (imported.list) appendListParagraph(content, imported, listStack);
    else {
      listStack.length = 0;
      content.push(imported.node);
    }
    if (imported.pageBreakAfter) {
      listStack.length = 0;
      content.push({ type: 'pageBreak' });
    }
    if (parsed.p?.pPr?.sectPr) {
      sectionSegments.push({ nodes: content, spec: parseSectionSpec(parsed.p.pPr.sectPr) });
      content = [];
      listStack.length = 0;
    }
  }
  const parsedDocument = parser.parse(documentXml);
  if (sectionSegments.length) {
    sectionSegments.push({
      nodes: content,
      spec: parseSectionSpec(parsedDocument?.document?.body?.sectPr),
    });
    content = sectionSegments.map((section) => sectionNode(section.nodes, section.spec));
  }
  if (!content.length) content.push({ type: 'paragraph' });

  const compatibilityIssues = detectCompatibility(zip, documentXml, numberingXml);
  const unevenSections = sectionSegments.filter((section) => section.spec.columnWidthsIn);
  const unevenColumnsPreserved = unevenSections.length > 0
    && unevenSections.every((section) => {
      const node = sectionNode(section.nodes, section.spec);
      return node.attrs?.explicitColumns === true;
    });

  return {
    schemaVersion: 1,
    title: basenameWithoutExtension(source.displayName),
    source,
    page: sectionSegments.length
      ? { ...parsePageSettings(documentXml), columns: 1 }
      : parsePageSettings(documentXml),
    compatibilityIssues: unevenColumnsPreserved
      ? compatibilityIssues.filter((issue) => issue.code !== 'uneven-columns')
      : compatibilityIssues,
    content: { type: 'doc', content },
  };
}
