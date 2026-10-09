import { Extension, InputRule, Mark, Node, getStyleProperty, mergeAttributes, wrappingInputRule } from '@tiptap/core';
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
import { accessibleTextPreviews, highlightForeground } from './color-contrast';
export { ScreenPages } from './screen-pagination';

// LineHeight's upstream commands always target textStyle, even with node types.
const ParagraphLineHeight = LineHeight.extend({
  addCommands() {
    return {
      setLineHeight: (lineHeight) => ({ chain }) => chain()
        .updateAttributes('paragraph', { lineHeight, lineSpacingRule: null })
        .updateAttributes('heading', { lineHeight, lineSpacingRule: null }).run(),
      unsetLineHeight: () => ({ chain }) => chain()
        .resetAttributes('paragraph', ['lineHeight', 'lineSpacingRule'])
        .resetAttributes('heading', ['lineHeight', 'lineSpacingRule']).run(),
    };
  },
});

const AccessibleColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute('data-text-color') ?? getStyleProperty(element, 'color') ?? element.style.color;
              return value?.replace(/['"]+/gu, '');
            },
            renderHTML: (attributes) => {
              if (!attributes.color) return {};
              const color = String(attributes.color);
              const previews = accessibleTextPreviews(color);
              return {
                'data-text-color': color,
                style: `--document-text-color: ${color}; --document-text-color-light: ${previews.light}; --document-text-color-dark: ${previews.dark}; color: var(--document-text-color)`,
              };
            },
          },
        },
      },
    ];
  },
});

const AccessibleHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-color')
          ?? getStyleProperty(element, 'background-color')
          ?? element.style.backgroundColor,
        renderHTML: (attributes) => {
          if (!attributes.color) return {};
          const color = String(attributes.color);
          return {
            'data-color': color,
            style: `--highlight-foreground: ${highlightForeground(color)}; background-color: ${color}; color: var(--highlight-foreground)`,
          };
        },
      },
    };
  },
});

export const ParagraphPresentation = Extension.create({
  name: 'paragraphPresentation',
  addKeyboardShortcuts() {
    const indent = (delta: number) => {
      if (this.editor.isActive('table')) return false;
      if (this.editor.isActive('listItem')) return delta > 0
        ? this.editor.commands.sinkListItem('listItem')
        : this.editor.commands.liftListItem('listItem');
      const type = this.editor.isActive('heading') ? 'heading' : 'paragraph';
      const current = Number(this.editor.getAttributes(type).tabIndentIn ?? 0);
      return this.editor.commands.updateAttributes(type, { tabIndentIn: Math.max(0, Math.min(4, current + delta * 0.5)) });
    };
    return { Tab: () => indent(1), 'Shift-Tab': () => indent(-1) };
  },
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
          lineSpacingRule: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-line-spacing-rule'),
            renderHTML: (attributes) => attributes.lineSpacingRule ? { 'data-line-spacing-rule': attributes.lineSpacingRule } : {},
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
          tabIndentIn: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-tab-indent-in'),
            renderHTML: (attributes) => {
              const value = Number(attributes.tabIndentIn);
              return Number.isFinite(value) && value > 0
                ? { 'data-tab-indent-in': value, style: `margin-left: ${value}in` }
                : {};
            },
          },
        },
      },
    ];
  },
});

export const DocumentSection = Node.create({
  name: 'documentSection',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      columns: { default: 1 },
      columnGapIn: { default: 0.5 },
      columnWidthsIn: { default: null },
      continuous: { default: false },
      explicitColumns: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-document-section]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    const columns = Math.max(1, Math.min(8, Number(node.attrs.columns) || 1));
    const gap = Math.max(0, Number(node.attrs.columnGapIn) || 0);
    const widths = Array.isArray(node.attrs.columnWidthsIn)
      ? node.attrs.columnWidthsIn.map(Number).filter((value: number) => Number.isFinite(value) && value > 0)
      : [];
    const style = widths.length === columns
      ? `--section-column-template: ${widths.map((width: number) => `${width}fr`).join(' ')}; --section-column-gap: ${gap}in`
      : `--section-columns: ${columns}; --section-column-gap: ${gap}in`;
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-document-section': 'true',
        'data-columns': columns,
        'data-explicit-columns': node.attrs.explicitColumns ? 'true' : 'false',
        style,
      }),
      0,
    ];
  },
});

export const DocumentColumn = Node.create({
  name: 'documentColumn',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-document-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-document-column': 'true' }), 0];
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

export const CommentAnchor = Mark.create({
  name: 'commentAnchor',
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => attributes.commentId
          ? { 'data-comment-id': attributes.commentId }
          : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-anchor' }), 0];
  },
});

export const AutomaticLists = Extension.create<{ isEnabled: () => boolean }>({
  name: 'automaticLists',
  addOptions() {
    return { isEnabled: () => true };
  },
  addInputRules() {
    const rules = [
      wrappingInputRule({
        find: /^\s*([-+*\u2022])\s$/,
        type: this.editor.schema.nodes.bulletList,
        keepMarks: true,
        editor: this.editor,
      }),
      wrappingInputRule({
        find: /^(\d{1,9})[.)]\s$/,
        type: this.editor.schema.nodes.orderedList,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) => Number(match[1]) === node.attrs.start + node.childCount,
        keepMarks: true,
        editor: this.editor,
      }),
    ];
    return rules.map((rule) => new InputRule({
      find: rule.find,
      handler: (props) => this.options.isEnabled() ? rule.handler(props) : null,
    }));
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
  ParagraphLineHeight.configure({ types: ['heading', 'paragraph'] }),
  AccessibleColor,
  AccessibleHighlight.configure({ multicolor: true }),
  CommentAnchor,
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
  DocumentSection,
  DocumentColumn,
  PageBreak,
  DocumentSearch,
];
