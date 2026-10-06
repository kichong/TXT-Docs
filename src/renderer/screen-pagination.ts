import { Extension } from '@tiptap/core';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { PageSettings } from '../shared/types';

const PAGE_HEIGHT = 1056;
const PAGE_GAP = 24;

interface Line { position: number; top: number; bottom: number; left: number }

// Measure a clean copy so screen decorations never influence the next layout.
function measure(view: EditorView, paper: HTMLElement) {
  const copy = paper.cloneNode(true) as HTMLElement;
  const originals = [paper, ...paper.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  const elements = new Map<Element, HTMLElement>();
  originals.forEach((element, index) => elements.set(element, copies[index] as HTMLElement));
  const textCopies = new Map<globalThis.Node, globalThis.Node>();
  const originalWalker = window.document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
  const copyWalker = window.document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let original = originalWalker.nextNode(); original; original = originalWalker.nextNode()) {
    const text = copyWalker.nextNode();
    if (text) textCopies.set(original, text);
  }
  copy.querySelectorAll('[data-screen-pagination]').forEach((element) => {
    (element as HTMLElement).style.removeProperty('padding-top');
    (element as HTMLElement).style.removeProperty('height');
    (element as HTMLElement).style.removeProperty('column-fill');
  });
  copy.querySelectorAll('.screen-page-gap').forEach((element) => element.remove());
  copy.style.cssText += ';position:absolute;left:-100000px;top:0;height:auto;visibility:hidden;pointer-events:none;';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  const root = elements.get(view.dom)!;
  root.style.height = '';
  root.style.columnFill = '';
  paper.parentElement!.append(copy);
  const scale = copy.getBoundingClientRect().width / copy.offsetWidth || 1;
  const origin = copy.getBoundingClientRect();
  const rect = (element: Element) => {
    const bounds = elements.get(element)!.getBoundingClientRect();
    return { top: (bounds.top - origin.top) / scale, bottom: (bounds.bottom - origin.top) / scale, left: (bounds.left - origin.left) / scale, width: bounds.width / scale, height: bounds.height / scale };
  };
  const lines = (node: DocumentNode, position: number): Line[] => {
    const result: Line[] = [];
    node.descendants((child, offset) => {
      if (!child.isText) return;
      const start = position + 1 + offset;
      let consumed = 0;
      while (consumed < child.text!.length) {
        // Enter the text by one character so a zero-width page widget at its
        // boundary cannot resolve to the paragraph element instead of the text.
        const dom = view.domAtPos(start + consumed + 1, -1);
        const textOffset = dom.offset - 1;
        const text = textCopies.get(dom.node);
        if (!text || text.nodeType !== Node.TEXT_NODE || textOffset < 0) break;
        const range = window.document.createRange();
        const length = Math.min(child.text!.length - consumed, (text.textContent?.length ?? 0) - textOffset);
        if (length <= 0) break;
        range.setStart(text, textOffset);
        range.setEnd(text, textOffset + length);
        const rectangles = Array.from(range.getClientRects());
        const textStyle = window.getComputedStyle(text.parentElement!);
        const paragraphStyle = window.getComputedStyle(elements.get(view.nodeDOM(position) as Element)!);
        const lineHeight = Math.max(parseFloat(textStyle.lineHeight) || parseFloat(textStyle.fontSize), parseFloat(paragraphStyle.lineHeight) || 0);
        rectangles.forEach((bounds, line) => {
          let low = 1;
          let high = length;
          // Find the first character in each visual line without measuring every character.
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            range.setEnd(text, textOffset + middle);
            if (range.getClientRects().length > line) high = middle;
            else low = middle + 1;
          }
          // Glyph rectangles include ascender/descender overhang outside the line box.
          const lineTop = (bounds.top - origin.top) / scale + (bounds.height / scale - lineHeight) / 2;
          result.push({ position: start + consumed + low - 1, top: lineTop, bottom: lineTop + lineHeight, left: (bounds.left - origin.left) / scale });
        });
        consumed += length;
      }
    });
    return result.sort((a, b) => a.position - b.position);
  };
  const paddingTop = (element: Element) => parseFloat(window.getComputedStyle(elements.get(element)!).paddingTop) || 0;
  return { rect, lines, paddingTop, destroy: () => copy.remove() };
}

export const ScreenPages = Extension.create<{ page: () => PageSettings }>({
  name: 'screenPages',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('screenPages');
    const settings = this.options.page;
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, decorations) => transaction.getMeta(key) ?? decorations.map(transaction.mapping, transaction.doc),
      },
      props: { decorations: (state) => key.getState(state) },
      view: (view) => {
        let frame = 0;
        let signature = '';
        let destroyed = false;
        let collapsed = false;
        let pageHeight = PAGE_HEIGHT;
        let pageGap = PAGE_GAP;
        const publishPosition = () => {
          if (destroyed) return;
          const paper = view.dom.closest<HTMLElement>('.paper');
          if (!paper) return;
          const pages = Number(paper.dataset.pageCount) || 1;
          const scale = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
          const caret = view.coordsAtPos(view.state.selection.head);
          const current = Math.max(1, Math.min(pages, Math.floor((caret.top - paper.getBoundingClientRect().top) / scale / (pageHeight + pageGap)) + 1));
          view.dom.dispatchEvent(new CustomEvent('screen-pagination', { detail: { current, total: pages } }));
        };
        const layout = () => {
          if (destroyed || view.composing) return;
          const paper = view.dom.closest<HTMLElement>('.paper');
          if (!paper) return;
          paper.addEventListener('dblclick', toggleGap);
          paper.title = 'Double-click between pages to hide or show page whitespace';
          const page = settings();
          const top = collapsed ? 6 : page.marginsIn.top * 96;
          const bottom = collapsed ? 6 : page.marginsIn.bottom * 96;
          pageHeight = collapsed ? PAGE_HEIGHT - (page.marginsIn.top + page.marginsIn.bottom) * 96 + 12 : PAGE_HEIGHT;
          pageGap = collapsed ? 2 : PAGE_GAP;
          const capacity = pageHeight - top - bottom;
          const stride = pageHeight + pageGap;
          paper.style.padding = `${top}px ${page.marginsIn.right * 96}px ${bottom}px ${page.marginsIn.left * 96}px`;
          paper.style.setProperty('--page-top', `${top}px`);
          paper.style.setProperty('--page-bottom', `${bottom}px`);
          paper.style.setProperty('--screen-page-height', `${pageHeight}px`);
          paper.style.setProperty('--screen-page-gap', `${pageGap}px`);
          paper.style.minHeight = `${pageHeight}px`;
          paper.dataset.pageGapCollapsed = String(collapsed);
          paper.style.background = '';
          const measurement = measure(view, paper);
          const decorations: Decoration[] = [];
          const parts: unknown[] = [];
          let lastBottom = top;
          const gap = (y: number, end: number, force = false) => {
            const pageIndex = Math.floor(Math.max(0, y - top) / stride);
            const boundary = pageIndex * stride + pageHeight - bottom;
            return force || end > boundary + 0.5 ? Math.max(0, (pageIndex + 1) * stride + top - y) : 0;
          };
          const pad = (position: number, node: DocumentNode, padding: number, extraStyle = '') => {
            const originalPadding = padding ? measurement.paddingTop(view.nodeDOM(position) as HTMLElement) : 0;
            const style = `${padding ? `padding-top:${padding + originalPadding}px;` : ''}${extraStyle}`;
            if (!style) return;
            decorations.push(Decoration.node(position, position + node.nodeSize, { style, 'data-screen-pagination': 'true' }));
            parts.push(['node', position, node.nodeSize, style]);
          };
          const spacer = (position: number, padding: number) => {
            decorations.push(Decoration.widget(position, () => {
              const element = window.document.createElement('span');
              element.className = 'screen-page-gap';
              element.style.height = `${padding}px`;
              element.contentEditable = 'false';
              element.setAttribute('aria-hidden', 'true');
              return element;
            }, { side: -1, key: `page:${position}:${padding}` }));
            parts.push(['line', position, padding]);
          };
          const children = (node: DocumentNode, position: number, offset: number): number => {
            let added = 0;
            node.forEach((child, childOffset) => { added += block(child, position + 1 + childOffset, offset + added); });
            return added;
          };
          const columnFlow = (node: DocumentNode, position: number, offset: number, count: number, columnGap: number): number => {
            const element = position < 0 ? view.dom : view.nodeDOM(position) as HTMLElement;
            const bounds = measurement.rect(element);
            const columnWidth = (bounds.width - columnGap * (count - 1)) / count;
            const offsets = Array.from({ length: count }, () => offset);
            node.descendants((child, childOffset) => {
              if (!child.isTextblock) return;
              const childPosition = position + 1 + childOffset;
              const naturalLines = measurement.lines(child, childPosition);
              if (child.childCount === 0) {
                const emptyBounds = measurement.rect(view.nodeDOM(childPosition) as HTMLElement);
                const column = Math.max(0, Math.min(count - 1, Math.floor((emptyBounds.left - bounds.left + 1) / (columnWidth + columnGap))));
                const padding = gap(emptyBounds.top + offsets[column], emptyBounds.bottom + offsets[column]);
                pad(childPosition, child, padding);
                offsets[column] += padding;
                lastBottom = Math.max(lastBottom, emptyBounds.bottom + offsets[column]);
              }
              const usedLines = new Set<string>();
              naturalLines.forEach((line) => {
                const column = Math.max(0, Math.min(count - 1, Math.floor((line.left - bounds.left + 1) / (columnWidth + columnGap))));
                const lineKey = `${column}:${Math.round(line.top * 10)}`;
                if (usedLines.has(lineKey)) return;
                usedLines.add(lineKey);
                const padding = gap(line.top + offsets[column], line.bottom + offsets[column]);
                if (padding) { spacer(line.position, padding); offsets[column] += padding; }
                lastBottom = Math.max(lastBottom, line.bottom + offsets[column]);
              });
              return false;
            });
            const added = Math.max(...offsets) - offset;
            const height = bounds.height + added;
            lastBottom = Math.max(lastBottom, bounds.bottom + offset + added);
            if (position >= 0) pad(position, node, 0, `height:${height}px;column-fill:auto;`);
            else { view.dom.style.height = `${height}px`; view.dom.style.columnFill = 'auto'; }
            return added;
          };
          const block = (node: DocumentNode, position: number, offset: number): number => {
            const element = view.nodeDOM(position) as HTMLElement | null;
            if (!element?.getBoundingClientRect) return 0;
            const bounds = measurement.rect(element);
            if (node.type.name === 'documentSection' && !node.attrs.explicitColumns && Number(node.attrs.columns) > 1) {
              return columnFlow(node, position, offset, Number(node.attrs.columns), Number(node.attrs.columnGapIn) * 96);
            }
            if (node.type.name === 'documentSection' && node.attrs.explicitColumns) {
              let added = 0;
              node.forEach((column, columnOffset) => { added = Math.max(added, children(column, position + 1 + columnOffset, offset)); });
              return added;
            }
            if (node.type.name === 'table') {
              let added = 0;
              node.forEach((row, rowOffset) => {
                const rowPosition = position + 1 + rowOffset;
                const rowElement = view.nodeDOM(rowPosition) as HTMLElement;
                const rowBounds = measurement.rect(rowElement);
                const rowPadding = rowBounds.height <= capacity ? gap(rowBounds.top + offset + added, rowBounds.bottom + offset + added) : 0;
                let cellAdded = 0;
                row.forEach((cell, cellOffset) => {
                  const cellPosition = rowPosition + 1 + cellOffset;
                  if (rowPadding) pad(cellPosition, cell, rowPadding);
                  cellAdded = Math.max(cellAdded, children(cell, cellPosition, offset + added + rowPadding));
                });
                added += rowPadding + cellAdded;
              });
              lastBottom = Math.max(lastBottom, bounds.bottom + offset + added);
              return added;
            }
            if (node.isTextblock) {
              // Split at visual lines, including short paragraphs, just as print layout does.
              if (node.childCount === 0) {
                const padding = gap(bounds.top + offset, bounds.bottom + offset);
                pad(position, node, padding);
                lastBottom = Math.max(lastBottom, bounds.bottom + offset + padding);
                return padding;
              }
              let added = 0;
              let lastLine = -Infinity;
              measurement.lines(node, position).forEach((line) => {
                if (Math.abs(line.top - lastLine) < 0.5) return;
                lastLine = line.top;
                const padding = gap(line.top + offset + added, line.bottom + offset + added);
                if (padding) { spacer(line.position, padding); added += padding; }
                lastBottom = Math.max(lastBottom, line.bottom + offset + added);
              });
              return added;
            }
            if (node.type.name === 'pageBreak') {
              const padding = gap(bounds.top + offset, bounds.bottom + offset, true);
              pad(position, node, padding);
              lastBottom = Math.max(lastBottom, bounds.bottom + offset + padding);
              return padding;
            }
            return node.childCount ? children(node, position, offset) : 0;
          };
          try {
            view.dom.style.height = '';
            view.dom.style.columnFill = '';
            if (page.columns > 1) columnFlow(view.state.doc, -1, 0, page.columns, page.columnGapIn * 96);
            else children(view.state.doc, -1, 0);
            const pages = Math.max(1, Math.floor((lastBottom + bottom - 1) / stride) + 1);
            paper.style.height = `${pages * pageHeight + (pages - 1) * pageGap}px`;
            paper.dataset.pageCount = String(pages);
            const nextSignature = JSON.stringify(parts);
            if (nextSignature !== signature) {
              signature = nextSignature;
              const transaction = view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decorations)).setMeta('addToHistory', false);
              view.dispatch(view.hasFocus() ? transaction.scrollIntoView() : transaction);
            }
            publishPosition();
            paper.dataset.paginationPending = 'false';
            paper.dataset.paginationSize = String(view.state.doc.content.size);
          } finally { measurement.destroy(); }
        };
        const schedule = () => {
          if (destroyed) return;
          const paper = view.dom.closest<HTMLElement>('.paper');
          if (paper) paper.dataset.paginationPending = 'true';
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(layout);
        };
        const toggleGap = (event: MouseEvent) => {
          const paper = view.dom.closest<HTMLElement>('.paper');
          if (!paper) return;
          const scale = paper.getBoundingClientRect().width / paper.offsetWidth || 1;
          const y = (event.clientY - paper.getBoundingClientRect().top) / scale;
          const within = y % (pageHeight + pageGap);
          const top = collapsed ? 6 : settings().marginsIn.top * 96;
          const bottom = collapsed ? 6 : settings().marginsIn.bottom * 96;
          if (y < pageHeight - bottom || within > top && within < pageHeight - bottom) return;
          event.preventDefault();
          collapsed = !collapsed;
          schedule();
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(view.dom);
        view.dom.addEventListener('compositionend', schedule);
        view.dom.addEventListener('screen-page-settings', schedule);
        view.dom.addEventListener('load', schedule, true);
        window.document.fonts.ready.then(schedule);
        schedule();
        return {
          update: (_view, previous) => previous.doc.eq(view.state.doc) ? publishPosition() : schedule(),
          destroy: () => {
            destroyed = true;
            view.dom.closest<HTMLElement>('.paper')?.removeEventListener('dblclick', toggleGap);
            cancelAnimationFrame(frame);
            observer.disconnect();
            view.dom.removeEventListener('compositionend', schedule);
            view.dom.removeEventListener('screen-page-settings', schedule);
            view.dom.removeEventListener('load', schedule, true);
          },
        };
      },
    })];
  },
});
