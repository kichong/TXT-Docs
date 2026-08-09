import { describe, expect, it } from 'vitest';
import { contentToPlainText, plainTextToContent } from '../src/shared/plain-text';
import type { JSONContent } from '../src/shared/types';

describe('plain text adapters', () => {
  it('preserves text lines and blank lines', () => {
    const input = 'First line\n\nThird line';
    const content = plainTextToContent(input);

    expect(content.content).toHaveLength(3);
    expect(contentToPlainText(content)).toBe(input);
  });

  it('flattens rich blocks into readable text', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
              ],
            },
          ],
        },
      ],
    };

    expect(contentToPlainText(content)).toBe('Title\n- First\n- Second\nA\tB');
  });
});
