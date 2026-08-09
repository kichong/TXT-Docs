import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface DocumentSearchMatch {
  from: number;
  to: number;
}

export interface DocumentSearchState {
  query: string;
  matches: DocumentSearchMatch[];
  currentIndex: number;
  decorations: DecorationSet;
}

interface SearchUpdate {
  query: string;
  currentIndex: number;
}

export const documentSearchPluginKey = new PluginKey<DocumentSearchState>('documentSearch');

export function findDocumentMatches(document: ProseMirrorNode, query: string): DocumentSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const matches: DocumentSearchMatch[] = [];
  document.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLocaleLowerCase();
    let offset = 0;
    while (offset <= text.length - normalizedQuery.length) {
      const found = text.indexOf(normalizedQuery, offset);
      if (found < 0) break;
      matches.push({ from: position + found, to: position + found + normalizedQuery.length });
      offset = found + Math.max(1, normalizedQuery.length);
    }
  });
  return matches;
}

function createSearchState(document: ProseMirrorNode, update: SearchUpdate): DocumentSearchState {
  const matches = findDocumentMatches(document, update.query);
  const currentIndex = matches.length
    ? ((update.currentIndex % matches.length) + matches.length) % matches.length
    : 0;
  const decorations = DecorationSet.create(
    document,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === currentIndex ? 'document-search-match is-current' : 'document-search-match',
      }),
    ),
  );
  return { query: update.query, matches, currentIndex, decorations };
}

export const DocumentSearch = Extension.create({
  name: 'documentSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin<DocumentSearchState>({
        key: documentSearchPluginKey,
        state: {
          init: (_, state) => createSearchState(state.doc, { query: '', currentIndex: 0 }),
          apply: (transaction, previous) => {
            const update = transaction.getMeta(documentSearchPluginKey) as SearchUpdate | undefined;
            if (update) return createSearchState(transaction.doc, update);
            if (transaction.docChanged && previous.query) {
              return createSearchState(transaction.doc, {
                query: previous.query,
                currentIndex: previous.currentIndex,
              });
            }
            return previous;
          },
        },
        props: {
          decorations: (state) => documentSearchPluginKey.getState(state)?.decorations ?? null,
        },
      }),
    ];
  },
});

export function updateDocumentSearch(editor: Editor, query: string, currentIndex: number): DocumentSearchState {
  editor.view.dispatch(editor.state.tr.setMeta(documentSearchPluginKey, { query, currentIndex } satisfies SearchUpdate));
  const state = documentSearchPluginKey.getState(editor.state);
  if (!state) throw new Error('Document search is unavailable.');
  const current = state.matches[state.currentIndex];
  if (current) {
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, current.from, current.to))
        .scrollIntoView(),
    );
  }
  return state;
}
