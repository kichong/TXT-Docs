import type { JSONContent } from './types';

function inlineText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'image') return node.attrs?.alt ? `[${String(node.attrs.alt)}]` : '';
  return (node.content ?? []).map(inlineText).join('');
}

function listLines(node: JSONContent, depth = 0): string[] {
  const ordered = node.type === 'orderedList';
  return (node.content ?? []).flatMap((item, index) => {
    const blocks = item.content ?? [];
    const first = blocks.find((block) => block.type === 'paragraph' || block.type === 'heading');
    const prefix = ordered ? `${Math.max(1, Math.trunc(Number(node.attrs?.start) || 1)) + index}. ` : '- ';
    const indentation = '  '.repeat(depth);
    const lines = [`${indentation}${prefix}${first ? inlineText(first) : ''}`];
    for (const child of blocks) {
      if (child === first) continue;
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(...listLines(child, depth + 1));
      } else {
        lines.push(`${indentation}  ${inlineText(child)}`);
      }
    }
    return lines;
  });
}

function blockLines(node: JSONContent): string[] {
  if (node.type === 'paragraph' || node.type === 'heading') return [inlineText(node)];
  if (node.type === 'bulletList' || node.type === 'orderedList') return listLines(node);
  if (node.type === 'pageBreak') return ['\f'];
  if (node.type === 'table') {
    return (node.content ?? []).map((row) =>
      (row.content ?? []).map((cell) => inlineText(cell)).join('\t'),
    );
  }
  return (node.content ?? []).flatMap(blockLines);
}

export function contentToPlainText(content: JSONContent): string {
  return blockLines(content).join('\n');
}

export function plainTextToContent(text: string): JSONContent {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : undefined,
    })),
  };
}
