import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { findDocumentMatches } from '../src/renderer/search-extension';

describe('document search', () => {
  it('finds words spanning formatting while keeping paragraph and inline-break boundaries', () => {
    const schema = getSchema([StarterKit]);
    const document = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'Al' },
        { type: 'text', text: 'pha', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'beta' },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: 'gamma' }] },
    ] });
    const matches = findDocumentMatches(document, 'alpha');
    expect(matches).toEqual([{ from: 1, to: 6 }]);
    expect(document.textBetween(matches[0].from, matches[0].to)).toBe('Alpha');
    expect(findDocumentMatches(document, 'alphabeta')).toEqual([]);
    expect(findDocumentMatches(document, 'betagamma')).toEqual([]);
  });
  it('finds every case-insensitive text-node match in document order', () => {
    const schema = getSchema([StarterKit]);
    const document = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Alpha beta alpha' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'ALPHA' }] },
      ],
    });
    const matches = findDocumentMatches(document, 'alpha');
    expect(matches).toHaveLength(3);
    expect(matches.map((match) => document.textBetween(match.from, match.to))).toEqual(['Alpha', 'alpha', 'ALPHA']);
  });

  it('does not create matches for an empty query', () => {
    const schema = getSchema([StarterKit]);
    const document = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(findDocumentMatches(document, '   ')).toEqual([]);
  });
});
