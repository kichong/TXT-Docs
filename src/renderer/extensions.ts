import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import { Underline } from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { DocumentSearch } from './search-extension';

export const ParagraphPresentation = Extension.create({
  name: 'paragraphPresentation',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => Number(element.getAttribute('data-indent') ?? 0),
            renderHTML: (attributes) => {
              const indent = Number(attributes.indent ?? 0);
              return indent > 0
                ? { 'data-indent': indent, style: `margin-left: ${indent * 2}rem` }
                : {};
            },
          },
          paragraphStyle: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-paragraph-style'),
            renderHTML: (attributes) =>
              attributes.paragraphStyle
                ? { 'data-paragraph-style': attributes.paragraphStyle }
                : {},
          },
          spacingBeforePt: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-spacing-before-pt'),
            renderHTML: (attributes) => {
              if (attributes.spacingBeforePt === null || attributes.spacingBeforePt === undefined) return {};
              const value = Number(attributes.spacingBeforePt);
              return Number.isFinite(value) && value >= 0
                ? { 'data-spacing-before-pt': value, style: `margin-top: ${value}pt` }
                : {};
            },
          },
          spacingAfterPt: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-spacing-after-pt'),
            renderHTML: (attributes) => {
              if (attributes.spacingAfterPt === null || attributes.spacingAfterPt === undefined) return {};
              const value = Number(attributes.spacingAfterPt);
              return Number.isFinite(value) && value >= 0
                ? { 'data-spacing-after-pt': value, style: `margin-bottom: ${value}pt` }
                : {};
            },
          },
        },
      },
    ];
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': 'true', role: 'separator' })];
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () =>
        this.editor
          .chain()
          .insertContent([{ type: this.name }, { type: 'paragraph' }])
          .focus('end')
          .run(),
    };
  },
});

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 420,
        parseHTML: (element) => Number(element.getAttribute('width') ?? 420),
        renderHTML: (attributes) => ({ width: attributes.width }),
      },
      height: {
        default: 280,
        parseHTML: (element) => Number(element.getAttribute('height') ?? 280),
        renderHTML: (attributes) => ({ height: attributes.height }),
      },
    };
  },
});

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    underline: false,
  }),
  TextStyle,
  FontFamily,
  FontSize,
  LineHeight.configure({ types: ['heading', 'paragraph'] }),
  Color,
  Highlight.configure({ multicolor: true }),
  Underline,
  Subscript,
  Superscript,
  Link.configure({
    openOnClick: false,
    autolink: false,
    defaultProtocol: 'https',
    HTMLAttributes: { rel: 'noopener noreferrer' },
  }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage.configure({ inline: true, allowBase64: true }),
  Table.configure({ resizable: true, allowTableNodeSelection: true }),
  TableRow,
  TableHeader,
  TableCell,
  ParagraphPresentation,
  PageBreak,
  DocumentSearch,
];
