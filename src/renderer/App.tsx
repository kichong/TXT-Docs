import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  Baseline,
  Bug,
  Bold,
  BookOpenText,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Columns3,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  GripVertical,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Moon,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pilcrow,
  Printer,
  Redo2,
  RefreshCw,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Settings2,
  Scissors,
  Strikethrough,
  Subscript,
  Sun,
  Superscript,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { editorExtensions } from './extensions';
import { updateDocumentSearch } from './search-extension';
import { contentToPlainText, plainTextToContent } from '../shared/plain-text';
import {
  createBlankDocument,
  type AppCommand,
  type AppUpdateState,
  type CompatibilityIssue,
  type EditorDocumentV1,
  type OpenResult,
  type RecoveryDraft,
} from '../shared/types';
import { presentUpdate, type UpdateAction } from '../shared/updates';
import {
  DEFAULT_TOOLBAR_PREFERENCES,
  TOOLBAR_GROUPS,
  moveToolbarGroup,
  normalizeToolbarPreferences,
  type HeadingSizeKey,
  type ToolbarGroupId,
  type ToolbarPreferences,
} from './toolbar-preferences';

type OperationState = 'ready' | 'opening' | 'saving' | 'printing';
type PasteMode = 'source' | 'merge' | 'text';
const TOOLBAR_STORAGE_KEY = 'txt-docs:toolbar-preferences:v1';

interface ToolButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  subtle?: boolean;
  className?: string;
}

function ToolButton({ label, icon, onClick, active, disabled, subtle, className = '' }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tool-button${active ? ' is-active' : ''}${subtle ? ' is-subtle' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

interface SelectControlProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

function SelectControl({ label, value, onChange, children, className = '', disabled }: SelectControlProps) {
  return (
    <label className={`select-control ${className}`} title={label}>
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown size={13} aria-hidden="true" />
    </label>
  );
}

function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

function ToolbarSubdivider() {
  return <span className="toolbar-subdivider" aria-hidden="true" />;
}

interface PasteOptionsProps {
  onPaste: (mode: PasteMode) => void;
}

function PasteOptions({ onPaste }: PasteOptionsProps) {
  const [open, setOpen] = useState(false);
  const choose = (mode: PasteMode) => {
    onPaste(mode);
    setOpen(false);
  };
  return (
    <div className="paste-anchor">
      <button
        type="button"
        className="tool-button paste-primary"
        aria-label="Paste and keep source formatting"
        title="Paste and keep source formatting"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose('source')}
      >
        <ClipboardPaste size={16} />
      </button>
      <button
        type="button"
        className="tool-button paste-menu-button"
        aria-label="Paste options"
        aria-expanded={open}
        title="Paste options"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="paste-menu" role="menu" aria-label="Paste options">
          <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => choose('source')}>
            <strong>Keep source formatting</strong>
            <span>Preserve fonts, sizes, colors, and structure</span>
          </button>
          <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => choose('merge')}>
            <strong>Merge formatting</strong>
            <span>Keep emphasis and structure; use this document’s look</span>
          </button>
          <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => choose('text')}>
            <strong>Text only</strong>
            <span>Remove all copied formatting</span>
          </button>
        </div>
      )}
    </div>
  );
}

function mergeClipboardHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const element of parsed.body.querySelectorAll('*')) {
    element.removeAttribute('style');
    element.removeAttribute('class');
    element.removeAttribute('id');
    element.removeAttribute('color');
    element.removeAttribute('face');
    element.removeAttribute('size');
    element.removeAttribute('bgcolor');
  }
  return parsed.body.innerHTML;
}

const FONT_FAMILIES = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana'];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '64'];
const BLOCK_STYLES = {
  normal: { fontSize: 11, lineHeight: '1.15', spacingBeforePt: 0, spacingAfterPt: 8 },
  'no-spacing': { fontSize: 11, lineHeight: '1', spacingBeforePt: 0, spacingAfterPt: 0 },
  title: { fontSize: 28, lineHeight: '1.1', spacingBeforePt: 0, spacingAfterPt: 14 },
  'heading-1': { fontSize: 24, lineHeight: '1.18', spacingBeforePt: 20, spacingAfterPt: 8 },
  'heading-2': { fontSize: 18, lineHeight: '1.22', spacingBeforePt: 16, spacingAfterPt: 6 },
  'heading-3': { fontSize: 14, lineHeight: '1.25', spacingBeforePt: 13, spacingAfterPt: 5 },
} as const;
const TEXT_COLORS = ['#202124', '#5f6368', '#d93025', '#e37400', '#188038', '#1a73e8', '#7b1fa2', '#ffffff'];
const HIGHLIGHT_COLORS = ['#fff176', '#ffcc80', '#ff8a80', '#c5e1a5', '#80deea', '#90caf9', '#ce93d8', '#e0e0e0'];

interface ColorPaletteProps {
  label: string;
  icon: ReactNode;
  colors: string[];
  value: string;
  onSelect: (color: string) => void;
}

function ColorPalette({ label, icon, colors, value, onSelect }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="palette-anchor">
      <button
        type="button"
        className="tool-button color-trigger"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span className="active-color" style={{ background: value }} />
      </button>
      {open && (
        <div className="color-palette" role="menu" aria-label={`${label} colors`}>
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              className="color-swatch"
              style={{ '--swatch': color } as React.CSSProperties}
              aria-label={`${label}: ${color}`}
              aria-pressed={value.toLowerCase() === color.toLowerCase()}
              title={color}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(color);
                setOpen(false);
              }}
            />
          ))}
          <label className="custom-color" title={`Custom ${label.toLowerCase()}`}>
            <span>+</span>
            <input
              type="color"
              aria-label={`Custom ${label.toLowerCase()}`}
              value={value}
              onChange={(event) => {
                onSelect(event.target.value);
                setOpen(false);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

interface TablePickerProps {
  onInsert: (rows: number, cols: number) => void;
}

function TablePicker({ onInsert }: TablePickerProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState({ rows: 3, cols: 3 });
  const grid = Array.from({ length: 64 }, (_, index) => ({
    row: Math.floor(index / 8) + 1,
    col: (index % 8) + 1,
  }));
  return (
    <div className="table-picker-anchor">
      <button
        type="button"
        className="tool-button"
        aria-label="Insert table"
        aria-expanded={open}
        title="Insert table"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Table2 size={18} />
      </button>
      {open && (
        <div className="table-picker" role="dialog" aria-label="Choose table size">
          <strong>{hovered.rows} × {hovered.cols} table</strong>
          <div className="table-grid" role="grid">
            {grid.map(({ row, col }) => (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                className={row <= hovered.rows && col <= hovered.cols ? 'is-selected' : ''}
                aria-label={`${row} rows by ${col} columns`}
                onMouseEnter={() => setHovered({ rows: row, cols: col })}
                onFocus={() => setHovered({ rows: row, cols: col })}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onInsert(row, col);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function issueSummary(issues: CompatibilityIssue[]): string {
  if (!issues.length) return 'All detected content is supported by TXT Docs v1.';
  return `${issues.length} compatibility ${issues.length === 1 ? 'note' : 'notes'} to review before saving.`;
}

function operationLabel(state: OperationState): string {
  if (state === 'opening') return 'Opening document…';
  if (state === 'saving') return 'Saving document…';
  if (state === 'printing') return 'Opening print dialog…';
  return '';
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadToolbarPreferences(): ToolbarPreferences {
  try {
    const stored = window.localStorage.getItem(TOOLBAR_STORAGE_KEY);
    return stored ? normalizeToolbarPreferences(JSON.parse(stored)) : structuredClone(DEFAULT_TOOLBAR_PREFERENCES);
  } catch {
    return structuredClone(DEFAULT_TOOLBAR_PREFERENCES);
  }
}

export function App() {
  const [document, setDocument] = useState<EditorDocumentV1>(() => createBlankDocument());
  const documentRef = useRef(document);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [operation, setOperation] = useState<OperationState>('ready');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [outlineWidth, setOutlineWidth] = useState(224);
  const resizingOutline = useRef(false);
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [zoom, setZoom] = useState(1);
  const [, setSelectionRevision] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [updateState, setUpdateState] = useState<AppUpdateState>({
    currentVersion: '…',
    phase: 'unavailable',
    canCheck: false,
  });
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const [toolbarPreferences, setToolbarPreferences] = useState<ToolbarPreferences>(loadToolbarPreferences);
  const toolbarPreferencesRef = useRef(toolbarPreferences);
  const [toolbarCustomizeOpen, setToolbarCustomizeOpen] = useState(false);
  const draggedToolbarGroup = useRef<ToolbarGroupId | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const initialExternalOpenChecked = useRef(false);
  const plainTextMode = document.source?.format === 'txt' || document.source?.format === 'md';
  const hasSectionLayout = useMemo(
    () => (document.content.content ?? []).some((node) => node.type === 'documentSection'),
    [document.content],
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: document.content,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        class: 'document-editor',
        spellcheck: 'true',
        'aria-label': 'Document editing area',
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      setDocument((current) => ({
        ...current,
        content: activeEditor.getJSON(),
      }));
      setDirty(true);
    },
  });

  useEffect(() => {
    toolbarPreferencesRef.current = toolbarPreferences;
    window.localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify(toolbarPreferences));
  }, [toolbarPreferences]);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    if (!editor) return;
    const refreshSelectionState = () => {
      setSelectionRevision((value) => value + 1);
      const id = editor.getAttributes('commentAnchor').commentId;
      if (typeof id === 'string' && id) {
        setActiveCommentId(id);
        setCommentsOpen(true);
      }
    };
    editor.on('selectionUpdate', refreshSelectionState);
    return () => {
      editor.off('selectionUpdate', refreshSelectionState);
    };
  }, [editor]);

  useEffect(() => {
    dirtyRef.current = dirty;
    window.documentsApi.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    documentRef.current = document;
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void window.documentsApi.writeRecovery(documentRef.current).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [document, dirty]);

  useEffect(() => {
    void window.documentsApi
      .readRecovery()
      .then((recoveryDraft) => setRecovery(recoveryDraft))
      .catch((loadError) => setError(safeError(loadError)));
  }, []);

  useEffect(() => {
    const removeListener = window.documentsApi.onUpdateState((state) => setUpdateState(state));
    void window.documentsApi
      .getUpdateState()
      .then((state) => setUpdateState(state))
      .catch((loadError) => setError(safeError(loadError)));
    return removeListener;
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizingOutline.current) return;
      setOutlineWidth(Math.max(170, Math.min(420, event.clientX)));
    };
    const handlePointerUp = () => {
      resizingOutline.current = false;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const adaptOutline = () => {
      if (window.innerWidth < 900) setOutlineOpen(false);
    };
    adaptOutline();
    window.addEventListener('resize', adaptOutline);
    return () => window.removeEventListener('resize', adaptOutline);
  }, []);

  const applyOpenResult = useCallback(
    (result: OpenResult) => {
      if (!editor) return;
      editor.commands.setContent(result.document.content, { emitUpdate: false });
      setDocument(result.document);
      documentRef.current = result.document;
      setDirty(false);
      setError(null);
      setCompatibilityOpen(false);
      setCommentsOpen(false);
      setActiveCommentId(null);
      setNotice(`Opened ${result.document.source?.displayName ?? result.document.title}.`);
    },
    [editor],
  );

  const confirmAbandon = useCallback(() => {
    return !dirtyRef.current || window.confirm('Discard unsaved changes to this document?');
  }, []);

  const createNew = useCallback(() => {
    if (!editor || !confirmAbandon()) return;
    const blank = createBlankDocument();
    editor.commands.setContent(blank.content, { emitUpdate: false });
    setDocument(blank);
    documentRef.current = blank;
    setDirty(false);
    setError(null);
    setNotice('New document ready.');
    setCommentsOpen(false);
    setActiveCommentId(null);
    void window.documentsApi.clearRecovery();
  }, [confirmAbandon, editor]);

  const openDocument = useCallback(async () => {
    if (!confirmAbandon()) return;
    setOperation('opening');
    setError(null);
    try {
      const result = await window.documentsApi.openDocument();
      if (result) applyOpenResult(result);
    } catch (openError) {
      setError(safeError(openError));
    } finally {
      setOperation('ready');
    }
  }, [applyOpenResult, confirmAbandon]);

  const openExternalDocument = useCallback(async () => {
    if (!confirmAbandon()) {
      window.documentsApi.cancelExternalOpen();
      return;
    }
    setOperation('opening');
    setError(null);
    try {
      const result = await window.documentsApi.openExternalDocument();
      if (result) applyOpenResult(result);
    } catch (openError) {
      setError(safeError(openError));
    } finally {
      setOperation('ready');
    }
  }, [applyOpenResult, confirmAbandon]);

  useEffect(() => {
    if (!editor || initialExternalOpenChecked.current) return;
    initialExternalOpenChecked.current = true;
    void openExternalDocument();
  }, [editor, openExternalDocument]);

  const saveDocument = useCallback(
    async (saveAs = false, closeWhenDone = false): Promise<boolean> => {
      if (!editor) return false;
      const current: EditorDocumentV1 = { ...documentRef.current, content: editor.getJSON() };
      const savedSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
      setOperation('saving');
      setError(null);
      try {
        const request = {
          document: current,
          overwriteCompatibilityIssues: true,
          printHtml: editor.getHTML(),
        };
        const result = saveAs
          ? await window.documentsApi.saveDocumentAs(request)
          : await window.documentsApi.saveDocument(request);
        if (result.status === 'cancelled') return false;
        if (result.outputFormat === 'pdf') {
          setNotice(`Saved ${result.displayName ?? 'PDF copy'}. Your editable document remains unchanged.`);
          if (closeWhenDone) {
            setError('The PDF copy was saved, but the editable document still needs to be saved before closing.');
          }
          return true;
        }
        if (!result.source) return false;
        const plainText = result.source.format === 'txt' || result.source.format === 'md';
        const nextContent = plainText
          ? plainTextToContent(contentToPlainText(current.content))
          : current.content;
        const next = { ...current, content: nextContent, source: result.source };
        if (plainText) editor.commands.setContent(nextContent, { emitUpdate: false });
        setDocument(next);
        documentRef.current = next;
        setDirty(false);
        setNotice(
          plainText
            ? `Saved ${result.source.displayName} as plain text. Formatting tools are off for this file.`
            : `Saved ${result.source.displayName}.`,
        );
        if (closeWhenDone) window.documentsApi.requestCloseAfterSave();
        return true;
      } catch (saveError) {
        setError(safeError(saveError));
        return false;
      } finally {
        setOperation('ready');
        if (!closeWhenDone) {
          window.requestAnimationFrame(() => {
            const maximum = editor.state.doc.content.size;
            editor.chain().focus().setTextSelection({
              from: Math.max(1, Math.min(savedSelection.from, maximum)),
              to: Math.max(1, Math.min(savedSelection.to, maximum)),
            }).run();
          });
        }
      }
    },
    [editor],
  );

  const reportCompatibility = useCallback(async () => {
    try {
      await window.documentsApi.reportCompatibility({
        sourceFormat: documentRef.current.source?.format ?? 'unsaved',
        issues: documentRef.current.compatibilityIssues,
      });
      setNotice('Compatibility report opened in GitHub. Review it, then submit.');
    } catch (reportError) {
      setError(safeError(reportError));
    }
  }, []);

  const addComment = useCallback(() => {
    if (!editor || editor.state.selection.empty) {
      setNotice('Select the text you want to comment on first.');
      return;
    }
    const id = globalThis.crypto.randomUUID();
    const comment = { id, body: '', author: 'TXT Docs User', createdAt: new Date().toISOString() };
    editor.chain().focus().setMark('commentAnchor', { commentId: id }).run();
    setDocument((current) => ({ ...current, comments: [...(current.comments ?? []), comment] }));
    setDirty(true);
    setActiveCommentId(id);
    setCommentsOpen(true);
  }, [editor]);

  const updateComment = useCallback((id: string, body: string) => {
    setDocument((current) => ({
      ...current,
      comments: (current.comments ?? []).map((comment) => comment.id === id ? { ...comment, body } : comment),
    }));
    setDirty(true);
  }, []);

  const selectComment = useCallback((id: string) => {
    if (!editor) return;
    let range: { from: number; to: number } | undefined;
    editor.state.doc.descendants((node, position) => {
      if (!node.isText || !node.marks.some((mark) => mark.type.name === 'commentAnchor' && mark.attrs.commentId === id)) return;
      const from = position;
      const to = position + node.nodeSize;
      range = range ? { from: Math.min(range.from, from), to: Math.max(range.to, to) } : { from, to };
    });
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
    setActiveCommentId(id);
  }, [editor]);

  const deleteComment = useCallback((id: string) => {
    if (!editor) return;
    const mark = editor.schema.marks.commentAnchor.create({ commentId: id });
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.marks.some((candidate) => candidate.eq(mark))) {
        transaction.removeMark(position, position + node.nodeSize, mark);
      }
    });
    editor.view.dispatch(transaction);
    setDocument((current) => ({ ...current, comments: (current.comments ?? []).filter((comment) => comment.id !== id) }));
    setDirty(true);
    setActiveCommentId(null);
  }, [editor]);

  const printDocument = useCallback(async () => {
    if (!editor) return;
    setOperation('printing');
    try {
      const result = await window.documentsApi.printDocument({
        html: editor.getHTML(),
        page: documentRef.current.page,
      });
      if (result.status === 'failed') setError(result.error ?? 'Printing failed.');
    } catch (printError) {
      setError(safeError(printError));
    } finally {
      setOperation('ready');
    }
  }, [editor]);

  const restoreRecovery = useCallback(() => {
    if (!editor || !recovery) return;
    editor.commands.setContent(recovery.document.content, { emitUpdate: false });
    setDocument(recovery.document);
    documentRef.current = recovery.document;
    setDirty(true);
    setRecovery(null);
    setNotice(`Recovered local draft from ${new Date(recovery.savedAt).toLocaleString()}.`);
  }, [editor, recovery]);

  const discardRecovery = useCallback(() => {
    setRecovery(null);
    void window.documentsApi.clearRecovery();
  }, []);

  const insertImage = useCallback(async () => {
    if (!editor) return;
    try {
      const image = await window.documentsApi.pickImage();
      if (image) {
        editor.chain().focus().setImage({ src: image.dataUrl, alt: image.displayName }).run();
      }
    } catch (imageError) {
      setError(safeError(imageError));
    }
  }, [editor]);

  const setStyle = useCallback(
    (style: string) => {
      if (!editor) return;
      const baseStyle = BLOCK_STYLES[style as keyof typeof BLOCK_STYLES] ?? BLOCK_STYLES.normal;
      const customizedSize = style === 'title'
        ? toolbarPreferences.headingSizes.title
        : style === 'heading-1'
          ? toolbarPreferences.headingSizes.h1
          : style === 'heading-2'
            ? toolbarPreferences.headingSizes.h2
            : style === 'heading-3'
              ? toolbarPreferences.headingSizes.h3
              : baseStyle.fontSize;
      const selectedStyle = { ...baseStyle, fontSize: customizedSize };
      const originalSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
      let rangeFrom = Number.POSITIVE_INFINITY;
      let rangeTo = Number.NEGATIVE_INFINITY;
      editor.state.doc.nodesBetween(originalSelection.from, originalSelection.to, (node, position) => {
        if (!node.isTextblock) return;
        rangeFrom = Math.min(rangeFrom, position + 1);
        rangeTo = Math.max(rangeTo, position + node.nodeSize - 1);
      });
      if (!Number.isFinite(rangeFrom) || !Number.isFinite(rangeTo)) {
        rangeFrom = editor.state.selection.$from.start();
        rangeTo = editor.state.selection.$from.end();
      }
      const chain = editor.chain().focus().setTextSelection({ from: rangeFrom, to: rangeTo });
      if (style.startsWith('heading-')) {
        chain
          .setHeading({ level: Number(style.slice(-1)) as 1 | 2 | 3 })
          .updateAttributes('heading', {
            lineHeight: selectedStyle.lineHeight,
            spacingBeforePt: selectedStyle.spacingBeforePt,
            spacingAfterPt: selectedStyle.spacingAfterPt,
          });
      } else {
        chain
          .setParagraph()
          .updateAttributes('paragraph', {
            paragraphStyle: style === 'no-spacing' || style === 'title' ? style : null,
            lineHeight: selectedStyle.lineHeight,
            spacingBeforePt: selectedStyle.spacingBeforePt,
            spacingAfterPt: selectedStyle.spacingAfterPt,
          });
      }
      chain
        .setFontSize(`${selectedStyle.fontSize}pt`)
        .setTextSelection(originalSelection)
        .run();
    },
    [editor, toolbarPreferences.headingSizes],
  );

  const selectedBlock = editor?.state.selection.$from.parent;
  const selectedHeadingLevel = selectedBlock?.type.name === 'heading'
    ? Number(selectedBlock.attrs.level)
    : null;
  const selectedParagraphStyle = selectedBlock?.type.name === 'paragraph'
    ? selectedBlock.attrs.paragraphStyle
    : null;
  const styleValue = selectedHeadingLevel && selectedHeadingLevel >= 1 && selectedHeadingLevel <= 3
    ? `heading-${selectedHeadingLevel}`
    : selectedParagraphStyle === 'title'
      ? 'title'
      : selectedParagraphStyle === 'no-spacing'
        ? 'no-spacing'
        : 'normal';

  const adjustIndent = useCallback(
    (delta: number) => {
      if (!editor) return;
      const type = editor.isActive('heading') ? 'heading' : 'paragraph';
      const current = Number(editor.getAttributes(type).indent ?? 0);
      editor
        .chain()
        .focus()
        .updateAttributes(type, { indent: Math.max(0, Math.min(8, current + delta)) })
        .run();
    },
    [editor],
  );

  const setPageColumns = useCallback((value: string) => {
    const columns = Math.max(1, Math.min(8, Number(value) || 1));
    setDocument((current) => {
      const next = { ...current, page: { ...current.page, columns } };
      documentRef.current = next;
      return next;
    });
    setDirty(true);
  }, []);

  const toggleToolbarGroup = useCallback((group: ToolbarGroupId) => {
    setToolbarPreferences((current) => ({
      ...current,
      visible: current.visible.includes(group)
        ? current.visible.filter((id) => id !== group)
        : [...current.visible, group],
    }));
  }, []);

  const shiftToolbarGroup = useCallback((group: ToolbarGroupId, direction: -1 | 1) => {
    setToolbarPreferences((current) => {
      const index = current.order.indexOf(group);
      const target = current.order[index + direction];
      if (!target) return current;
      const order = [...current.order];
      [order[index], order[index + direction]] = [order[index + direction], order[index]];
      return { ...current, order };
    });
  }, []);

  const setHeadingSize = useCallback((key: HeadingSizeKey, value: number) => {
    if (!Number.isFinite(value)) return;
    const size = Math.round(value);
    const current = toolbarPreferencesRef.current;
    const next = { ...current, headingSizes: { ...current.headingSizes, [key]: size } };
    toolbarPreferencesRef.current = next;
    setToolbarPreferences(next);
  }, []);

  const applyHeadingSizesToDocument = useCallback(() => {
    if (!editor) return;
    const textStyle = editor.schema.marks.textStyle;
    if (!textStyle) return;
    const transaction = editor.state.tr;
    let changed = false;
    const headingSizes = toolbarPreferencesRef.current.headingSizes;
    editor.state.doc.descendants((node, position) => {
      const size = node.type.name === 'heading'
        ? headingSizes[`h${Number(node.attrs.level)}` as HeadingSizeKey]
        : node.type.name === 'paragraph' && node.attrs.paragraphStyle === 'title'
          ? headingSizes.title
          : undefined;
      if (!size) return;
      node.descendants((child, relativePosition) => {
        if (!child.isText) return;
        const from = position + 1 + relativePosition;
        const to = from + child.nodeSize;
        const existing = child.marks.find((mark) => mark.type === textStyle);
        if (existing) transaction.removeMark(from, to, existing);
        transaction.addMark(from, to, textStyle.create({ ...existing?.attrs, fontSize: `${size}pt` }));
        changed = true;
      });
    });
    if (changed) {
      editor.view.dispatch(transaction);
      setNotice('Applied the heading sizes to this document.');
    } else {
      setNotice('No headings found in this document.');
    }
  }, [editor]);

  const pasteWithMode = useCallback(async (mode: PasteMode) => {
    if (!editor) return;
    try {
      const clipboard = await window.documentsApi.readClipboardContent();
      const effectiveMode: PasteMode = plainTextMode ? 'text' : mode;
      if (effectiveMode === 'source' && clipboard.html.trim()) {
        editor.chain().focus().insertContent(clipboard.html).run();
      } else if (effectiveMode === 'merge' && clipboard.html.trim()) {
        editor.chain().focus().insertContent(mergeClipboardHtml(clipboard.html)).run();
      } else {
        editor.chain().focus().insertContent(plainTextToContent(clipboard.text).content ?? []).run();
      }
      setNotice(
        effectiveMode === 'source'
          ? 'Pasted with source formatting.'
          : effectiveMode === 'merge'
            ? 'Pasted with formatting merged into this document.'
            : 'Pasted as text only.',
      );
    } catch (clipboardError) {
      setError(`Clipboard paste failed. ${safeError(clipboardError)}`);
    }
  }, [editor, plainTextMode]);

  const runFind = useCallback(
    (query: string, requestedIndex: number) => {
      if (!editor) return;
      const result = updateDocumentSearch(editor, query, requestedIndex);
      setFindQuery(query);
      setFindIndex(result.currentIndex);
      setFindCount(result.matches.length);
      window.setTimeout(() => findInputRef.current?.focus());
    },
    [editor],
  );

  const showFind = useCallback(() => {
    setFindOpen(true);
    window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const closeFind = useCallback(() => {
    if (editor) updateDocumentSearch(editor, '', 0);
    setFindOpen(false);
    setFindQuery('');
    setFindIndex(0);
    setFindCount(0);
    editor?.commands.focus();
  }, [editor]);

  const moveFind = useCallback(
    (delta: number) => runFind(findQuery, findIndex + delta),
    [findIndex, findQuery, runFind],
  );

  useEffect(() => {
    const removeListener = window.documentsApi.onCommand((command: AppCommand) => {
      if (command === 'new') createNew();
      else if (command === 'open') void openDocument();
      else if (command === 'open-external') void openExternalDocument();
      else if (command === 'find') showFind();
      else if (command === 'save') void saveDocument(false);
      else if (command === 'save-as') void saveDocument(true);
      else if (command === 'print') void printDocument();
      else if (command === 'save-and-close') void saveDocument(false, true);
    });
    return removeListener;
  }, [createNew, openDocument, openExternalDocument, printDocument, saveDocument, showFind]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!editor) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        showFind();
        return;
      }
      if (plainTextMode) return;
      if (event.key === 'Enter' && editor.isActive('paragraph', { paragraphStyle: 'title' })) {
        window.setTimeout(() => {
          editor.chain().updateAttributes('paragraph', { paragraphStyle: null }).run();
        });
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const previous = String(editor.getAttributes('link').href ?? '');
        const href = window.prompt('Link address', previous || 'https://');
        if (href === null) return;
        if (!href.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, plainTextMode, showFind]);

  useEffect(() => {
    if (!findOpen || !findQuery) return;
    runFind(findQuery, findIndex);
  }, [document.content, findOpen, findIndex, findQuery, runFind]);

  const outline = useMemo(() => {
    if (!editor) return [];
    const headings: Array<{ level: number; text: string; position: number }> = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'heading') {
        headings.push({ level: Number(node.attrs.level), text: node.textContent || 'Untitled heading', position });
      }
    });
    return headings;
  }, [editor, document.content]);

  const wordCount = useMemo(() => {
    const text = editor?.getText().trim() ?? '';
    return text ? text.split(/\s+/u).length : 0;
  }, [editor, document.content]);

  const selectionFont = String(editor?.getAttributes('textStyle').fontFamily ?? 'Aptos');
  const selectionSize = String(editor?.getAttributes('textStyle').fontSize ?? '11pt').replace('pt', '');
  const availableFonts = FONT_FAMILIES.includes(selectionFont) ? FONT_FAMILIES : [selectionFont, ...FONT_FAMILIES];
  const availableSizes = FONT_SIZES.includes(selectionSize) ? FONT_SIZES : [selectionSize, ...FONT_SIZES];
  const lineHeight = String(
    editor?.getAttributes(editor?.isActive('heading') ? 'heading' : 'paragraph').lineHeight ?? '1.15',
  );
  const busy = operation !== 'ready';
  const updatePresentation = presentUpdate(updateState);
  const showUpdateBanner =
    updatePresentation.important
    && (updateState.phase !== 'available' || updateState.availableVersion !== dismissedUpdateVersion);

  const runUpdateAction = async (action: UpdateAction): Promise<void> => {
    if (!action) return;
    setError(null);
    try {
      if (action === 'check') setUpdateState(await window.documentsApi.checkForUpdates());
      if (action === 'download') setUpdateState(await window.documentsApi.downloadUpdate());
      if (action === 'install') {
        if (busy) return;
        if (dirty) {
          setNotice('Save your document before restarting to install the update.');
          return;
        }
        await window.documentsApi.installUpdate(documentRef.current.source?.id ?? null);
      }
    } catch (updateError) {
      setError(safeError(updateError));
    }
  };

  if (!editor) {
    return <main className="boot-screen">Preparing your document…</main>;
  }

  const toolbarGroupContent = (group: ToolbarGroupId): ReactNode => {
    if (group === 'history') return <>
      <ToolButton label="Undo" icon={<Undo2 size={17} />} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
      <ToolButton label="Redo" icon={<Redo2 size={17} />} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
      <ToolButton label="Cut" icon={<Scissors size={16} />} onClick={() => globalThis.document.execCommand('cut')} />
      <ToolButton label="Copy" icon={<Copy size={16} />} onClick={() => globalThis.document.execCommand('copy')} />
    </>;
    if (group === 'paste') return <PasteOptions onPaste={(mode) => void pasteWithMode(mode)} />;
    if (group === 'type') return <>
      <SelectControl label="Paragraph style" value={styleValue} onChange={setStyle} className="style-select">
        <option value="normal">Normal</option><option value="no-spacing">No Spacing</option><option value="title">Title</option>
        <option value="heading-1">Heading 1</option><option value="heading-2">Heading 2</option><option value="heading-3">Heading 3</option>
      </SelectControl>
      <SelectControl label="Font family" value={selectionFont} onChange={(value) => editor.chain().focus().setFontFamily(value).run()} className="font-select">
        {availableFonts.map((font) => <option key={font}>{font}</option>)}
      </SelectControl>
      <SelectControl label="Font size" value={selectionSize} onChange={(value) => editor.chain().focus().setFontSize(`${value}pt`).run()} className="size-select">
        {availableSizes.map((size) => <option key={size}>{size}</option>)}
      </SelectControl>
    </>;
    if (group === 'emphasis') return <>
      <ToolButton label="Bold" icon={<Bold size={17} />} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <ToolButton label="Italic" icon={<Italic size={17} />} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <ToolButton label="Underline" icon={<Underline size={17} />} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <ToolButton label="Strikethrough" icon={<Strikethrough size={17} />} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <ToolButton label="Subscript" icon={<Subscript size={17} />} active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
      <ToolButton label="Superscript" icon={<Superscript size={17} />} active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
      <ColorPalette label="Text color" icon={<Baseline size={18} />} colors={TEXT_COLORS} value={String(editor.getAttributes('textStyle').color ?? (darkMode ? '#f3f4f6' : '#202124'))} onSelect={(color) => editor.chain().focus().setColor(color).run()} />
      <ColorPalette label="Highlight color" icon={<Highlighter size={18} />} colors={HIGHLIGHT_COLORS} value={String(editor.getAttributes('highlight').color ?? '#fff176')} onSelect={(color) => editor.chain().focus().setHighlight({ color }).run()} />
    </>;
    if (group === 'paragraph') return <>
      <ToolButton label="Bulleted list" icon={<List size={18} />} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <ToolButton label="Numbered list" icon={<ListOrdered size={18} />} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <ToolbarSubdivider />
      <ToolButton label="Decrease indent" icon={<ArrowLeftToLine size={18} />} className="indent-tool" onClick={() => adjustIndent(-1)} />
      <ToolButton label="Increase indent" icon={<ArrowRightToLine size={18} />} className="indent-tool" onClick={() => adjustIndent(1)} />
      <ToolbarSubdivider />
      <ToolButton label="Align left" icon={<AlignLeft size={19} />} className="alignment-tool" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} />
      <ToolButton label="Align center" icon={<AlignCenter size={19} />} className="alignment-tool" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} />
      <ToolButton label="Align right" icon={<AlignRight size={19} />} className="alignment-tool" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} />
      <ToolButton label="Justify" icon={<AlignJustify size={19} />} className="alignment-tool" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} />
      <SelectControl label="Line spacing" value={['1', '1.15', '1.5', '2'].includes(lineHeight) ? lineHeight : '1.15'} onChange={(value) => editor.chain().focus().setLineHeight(value).run()} className="line-select">
        <option value="1">1.0</option><option value="1.15">1.15</option><option value="1.5">1.5</option><option value="2">2.0</option>
      </SelectControl>
      <ToolButton label="Clear formatting" icon={<Pilcrow size={18} />} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
    </>;
    if (group === 'insert') return <>
      <ToolButton label="Add or edit link" icon={<Link2 size={17} />} active={editor.isActive('link')} onClick={() => {
        const current = String(editor.getAttributes('link').href ?? 'https://');
        const href = window.prompt('Link address', current);
        if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
      }} />
      <ToolButton label="Remove link" icon={<Unlink size={17} />} disabled={!editor.isActive('link')} onClick={() => editor.chain().focus().unsetLink().run()} />
      <ToolButton label="Insert image" icon={<ImagePlus size={18} />} onClick={() => void insertImage()} />
      <TablePicker onInsert={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()} />
      <ToolButton label="Insert page break" icon={<BookOpenText size={18} />} onClick={() => editor.chain().focus().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).focus('end').run()} />
      {editor.isActive('table') && <>
        <ToolButton label="Add table row" icon={<Rows3 size={17} />} onClick={() => editor.chain().focus().addRowAfter().run()} />
        <ToolButton label="Add table column" icon={<Columns3 size={17} />} onClick={() => editor.chain().focus().addColumnAfter().run()} />
        <ToolButton label="Delete table" icon={<Trash2 size={17} />} onClick={() => editor.chain().focus().deleteTable().run()} />
      </>}
    </>;
    return <SelectControl label="Page columns" value={String(Math.max(1, Math.min(8, document.page.columns ?? 1)))} onChange={setPageColumns} className="columns-select" disabled={hasSectionLayout}>
      {Array.from({ length: 8 }, (_, index) => index + 1).map((columns) => <option key={columns} value={columns}>{columns} {columns === 1 ? 'column' : 'columns'}</option>)}
    </SelectControl>;
  };

  return (
    <div className={darkMode ? 'app theme-dark' : 'app theme-light'}>
      <header className={`app-header${toolbarCustomizeOpen ? ' has-toolbar-customizer' : ''}`}>
        <div className="titlebar">
          <img className="brand-mark" src="./txt-docs-logo.svg" alt="" aria-hidden="true" />
          <div className="titlebar-file-actions" aria-label="File actions">
            <ToolButton label="New document" icon={<FilePlus2 size={19} />} onClick={createNew} disabled={busy} />
            <ToolButton label="Open document" icon={<FolderOpen size={19} />} onClick={() => void openDocument()} disabled={busy} />
            <ToolButton label="Save" icon={<Save size={19} />} onClick={() => void saveDocument(false)} disabled={busy} />
            <ToolButton label="Print document" icon={<Printer size={19} />} onClick={() => void printDocument()} disabled={busy} />
          </div>
          <div className="document-identity">
            <input
              aria-label="Document title"
              value={document.title}
              onChange={(event) => {
                setDocument((current) => ({ ...current, title: event.target.value }));
                setDirty(true);
              }}
            />
            <span className={`save-state${dirty ? ' is-dirty' : ''}`}>
              {operation !== 'ready' ? operationLabel(operation) : dirty ? 'Unsaved' : 'Saved locally'}
            </span>
          </div>
          <div className="titlebar-actions">
            <button
              type="button"
              className="comments-button"
              onClick={() => { setCommentsOpen((open) => !open); setCompatibilityOpen(false); }}
              aria-expanded={commentsOpen}
            >
              <MessageSquarePlus size={15} aria-hidden="true" />
              {(document.comments ?? []).length ? `${document.comments.length} ${document.comments.length === 1 ? 'comment' : 'comments'}` : 'Comments'}
            </button>
            {document.compatibilityIssues.length > 0 && (
              <button
                type="button"
                className="compatibility-button"
                onClick={() => { setCompatibilityOpen((open) => !open); setCommentsOpen(false); }}
              >
                {document.compatibilityIssues.length} compatibility
              </button>
            )}
            <ToolButton
              label={darkMode ? 'Use light theme' : 'Use dark theme'}
              icon={darkMode ? <Sun size={16} /> : <Moon size={16} />}
              onClick={() => setDarkMode((value) => !value)}
              subtle
            />
            <div className="toolbar-customize-anchor">
              <ToolButton
                label="Customize toolbar"
                icon={<Settings2 size={17} />}
                active={toolbarCustomizeOpen}
                onClick={() => setToolbarCustomizeOpen((open) => !open)}
                subtle
              />
              {toolbarCustomizeOpen && (
                <aside className="toolbar-customizer" aria-label="Customize toolbar">
                  <div className="toolbar-customizer-header">
                    <div><strong>Customize toolbar</strong><span>Keep only what you use.</span></div>
                    <button type="button" aria-label="Close toolbar customization" onClick={() => setToolbarCustomizeOpen(false)}><X size={16} /></button>
                  </div>
                  <label className="toolbar-visibility-toggle">
                    <input
                      type="checkbox"
                      checked={toolbarPreferences.expanded}
                      onChange={(event) => setToolbarPreferences((current) => ({ ...current, expanded: event.target.checked }))}
                    />
                    <span><strong>Show formatting toolbar</strong><small>Hide the entire row for a distraction-free view.</small></span>
                  </label>
                  <div className="toolbar-customizer-section">
                    <div className="toolbar-customizer-label"><strong>Tool chunks</strong><span>Show, hide, or move.</span></div>
                    <div className="toolbar-chunk-list">
                      {toolbarPreferences.order.map((group, index) => {
                        const metadata = TOOLBAR_GROUPS.find((item) => item.id === group)!;
                        return (
                          <div
                            className="toolbar-chunk-row"
                            key={group}
                            draggable
                            onDragStart={() => { draggedToolbarGroup.current = group; }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              const dragged = draggedToolbarGroup.current;
                              if (dragged) setToolbarPreferences((current) => ({ ...current, order: moveToolbarGroup(current.order, dragged, group) }));
                              draggedToolbarGroup.current = null;
                            }}
                          >
                            <GripVertical size={15} aria-hidden="true" />
                            <label>
                              <input type="checkbox" checked={toolbarPreferences.visible.includes(group)} onChange={() => toggleToolbarGroup(group)} />
                              <span>{metadata.label}</span>
                            </label>
                            {'optional' in metadata && metadata.optional && <small>Optional</small>}
                            <div className="toolbar-order-actions">
                              <button type="button" aria-label={`Move ${metadata.label} left`} disabled={index === 0} onClick={() => shiftToolbarGroup(group, -1)}><ChevronLeft size={14} /></button>
                              <button type="button" aria-label={`Move ${metadata.label} right`} disabled={index === toolbarPreferences.order.length - 1} onClick={() => shiftToolbarGroup(group, 1)}><ChevronRight size={14} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="toolbar-customizer-section heading-size-settings">
                    <div className="toolbar-customizer-label"><strong>Heading sizes</strong><span>Defaults for this toolbar.</span></div>
                    <div className="heading-size-grid">
                      {([['title', 'Title'], ['h1', 'H1'], ['h2', 'H2'], ['h3', 'H3']] as Array<[HeadingSizeKey, string]>).map(([key, label]) => (
                        <label key={key}><span>{label}</span><input type="number" min="8" max="96" value={toolbarPreferences.headingSizes[key]} onChange={(event) => { if (event.target.value !== '') setHeadingSize(key, Number(event.target.value)); }} onBlur={(event) => setHeadingSize(key, Math.max(8, Math.min(96, Number(event.target.value) || DEFAULT_TOOLBAR_PREFERENCES.headingSizes[key])))} /><small>pt</small></label>
                      ))}
                    </div>
                    <button type="button" className="apply-heading-sizes" onClick={applyHeadingSizesToDocument}>Apply sizes to this document</button>
                  </div>
                  <button
                    type="button"
                    className="toolbar-reset-button"
                    onClick={() => setToolbarPreferences(structuredClone(DEFAULT_TOOLBAR_PREFERENCES))}
                  >
                    <RotateCcw size={14} /> Reset toolbar
                  </button>
                </aside>
              )}
            </div>
          </div>
        </div>

        {toolbarPreferences.expanded && (
          <div className={`toolbar customizable-toolbar${toolbarCustomizeOpen ? ' is-customizing' : ''}`} aria-label="Document formatting">
            {toolbarPreferences.order.filter((group) => toolbarPreferences.visible.includes(group)).map((group, index) => {
              const metadata = TOOLBAR_GROUPS.find((item) => item.id === group)!;
              const richOnly = group !== 'history' && group !== 'paste';
              return (
                <div
                  className="toolbar-chunk"
                  key={group}
                  draggable={toolbarCustomizeOpen}
                  data-toolbar-group={group}
                  onDragStart={() => { draggedToolbarGroup.current = group; }}
                  onDragOver={(event) => { if (toolbarCustomizeOpen) event.preventDefault(); }}
                  onDrop={() => {
                    const dragged = draggedToolbarGroup.current;
                    if (dragged) setToolbarPreferences((current) => ({ ...current, order: moveToolbarGroup(current.order, dragged, group) }));
                    draggedToolbarGroup.current = null;
                  }}
                >
                  {index > 0 && <ToolbarDivider />}
                  {toolbarCustomizeOpen && <span className="toolbar-chunk-grip" title={`Move ${metadata.label}`}><GripVertical size={13} /></span>}
                  <fieldset className="toolbar-group toolbar-chunk-controls" disabled={plainTextMode && richOnly} aria-label={metadata.label}>
                    {toolbarGroupContent(group)}
                  </fieldset>
                </div>
              );
            })}
          </div>
        )}
        {findOpen && (
          <form
            className="find-bar"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              moveFind(1);
            }}
          >
            <Search size={15} aria-hidden="true" />
            <input
              ref={findInputRef}
              aria-label="Find in document"
              value={findQuery}
              placeholder="Find in document"
              onChange={(event) => runFind(event.target.value, 0)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  moveFind(event.shiftKey ? -1 : 1);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="find-count" aria-live="polite">
              {findQuery ? (findCount ? `${findIndex + 1} of ${findCount}` : 'No matches') : ''}
            </span>
            <ToolButton label="Previous match" icon={<ChevronUp size={15} />} onClick={() => moveFind(-1)} disabled={!findCount} subtle />
            <ToolButton label="Next match" icon={<ChevronDown size={15} />} onClick={() => moveFind(1)} disabled={!findCount} subtle />
            <ToolButton label="Close find" icon={<X size={15} />} onClick={closeFind} subtle />
          </form>
        )}
      </header>

      <div className="notice-stack">
        {showUpdateBanner && (
          <div className={`update-bar is-${updateState.phase}`} role="status" aria-live="polite">
            <div className="update-bar-copy">
              <strong>{updatePresentation.detail}</strong>
              {updateState.phase === 'available' && <span>Download it now or continue working and update later.</span>}
              {updateState.phase === 'downloaded' && <span>Your document must be saved before TXT Docs restarts.</span>}
              {updateState.phase === 'downloading' && (
                <span className="update-progress" aria-hidden="true">
                  <span style={{ width: `${updateState.downloadPercent ?? 0}%` }} />
                </span>
              )}
            </div>
            <div className="update-bar-actions">
              {updatePresentation.action && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void runUpdateAction(updatePresentation.action)}
                >
                  {updatePresentation.action === 'download' && <Download size={14} aria-hidden="true" />}
                  {updatePresentation.action === 'install' && <RefreshCw size={14} aria-hidden="true" />}
                  {updatePresentation.actionLabel}
                </button>
              )}
              {updateState.phase === 'available' && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDismissedUpdateVersion(updateState.availableVersion ?? null)}
                >
                  Later
                </button>
              )}
            </div>
          </div>
        )}
        {(error || notice) && (
          <div className={`message-bar${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
            <span>{error ?? notice}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => { setError(null); setNotice(null); }}>
              <X size={15} />
            </button>
          </div>
        )}

        {recovery && (
          <div className="recovery-bar" role="alert">
            <span>
              <strong>Unsaved local draft found.</strong>
              {' '}Last recovered {new Date(recovery.savedAt).toLocaleString()}.
            </span>
            <div>
              <button type="button" className="text-button" onClick={discardRecovery}>Discard</button>
              <button type="button" className="primary-button" onClick={restoreRecovery}>Restore draft</button>
            </div>
          </div>
        )}
      </div>

      <main
        className="workspace"
        style={{ '--outline-width': `${outlineWidth}px` } as React.CSSProperties}
      >
        <aside className={`outline-panel${outlineOpen ? ' is-open' : ''}`} aria-label="Document outline">
          <div className="outline-header">
            <span>Outline</span>
            <ToolButton label="Close outline" icon={<PanelLeftClose size={16} />} onClick={() => setOutlineOpen(false)} subtle />
          </div>
          {outline.length ? (
            <nav>
              {outline.map((heading, index) => (
                <button
                  key={`${heading.position}-${index}`}
                  type="button"
                  style={{ paddingLeft: `${12 + (heading.level - 1) * 14}px` }}
                  onClick={() => editor.chain().focus().setTextSelection(heading.position + 1).scrollIntoView().run()}
                >
                  {heading.text}
                </button>
              ))}
            </nav>
          ) : (
            <p>Add headings to navigate a longer document.</p>
          )}
          <div
            className="outline-resizer"
            role="separator"
            aria-label="Resize document outline"
            aria-orientation="vertical"
            aria-valuemin={170}
            aria-valuemax={420}
            aria-valuenow={outlineWidth}
            tabIndex={0}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              event.preventDefault();
              resizingOutline.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              setOutlineWidth((value) =>
                Math.max(170, Math.min(420, value + (event.key === 'ArrowRight' ? 12 : -12))),
              );
            }}
          />
        </aside>

        {!outlineOpen && (
          <button type="button" className="outline-open-button" onClick={() => setOutlineOpen(true)} title="Open outline">
            <PanelLeftOpen size={17} />
          </button>
        )}

        <section className="canvas-scroll" aria-label="Document canvas">
          <div
            className="paper-scale"
            style={{ '--document-zoom': zoom } as React.CSSProperties}
          >
            <article
              className={`paper${plainTextMode ? ' is-plain-text' : ''}${hasSectionLayout ? ' has-section-layout' : ''}`}
              style={{
                '--document-columns': document.page.columns ?? 1,
                '--document-column-gap': `${document.page.columnGapIn ?? 0.5}in`,
              } as React.CSSProperties}
            >
              <EditorContent editor={editor} />
            </article>
          </div>
        </section>

        {compatibilityOpen && (
          <aside className="compatibility-panel" aria-label="Compatibility notices">
            <div className="compatibility-header">
              <div>
                <strong>Compatibility</strong>
                <span>Features detected when this file was opened</span>
              </div>
              <button type="button" aria-label="Close compatibility notices" onClick={() => setCompatibilityOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p>{issueSummary(document.compatibilityIssues)} Saving may change the features below. Use Save As to keep the original file unchanged.</p>
            <ul>
              {document.compatibilityIssues.map((issue) => (
                <li key={issue.code}>
                  <strong>{issue.title}</strong>
                  <span>{issue.detail}</span>
                </li>
              ))}
            </ul>
            <div className="compatibility-report">
              <button type="button" className="primary-button" onClick={() => void reportCompatibility()}>
                <Bug size={14} aria-hidden="true" /> Review report on GitHub
              </button>
              <small>Opens a draft GitHub issue containing compatibility categories only. Review it before submitting. Filenames, paths, document text, comments, authors, and metadata stay private.</small>
            </div>
          </aside>
        )}
        {commentsOpen && (
          <aside className="comments-panel" aria-label="Document comments">
            <div className="compatibility-header">
              <div><strong>Comments</strong><span>Review notes saved in this document</span></div>
              <button type="button" aria-label="Close comments" onClick={() => setCommentsOpen(false)}><X size={16} /></button>
            </div>
            <button type="button" className="primary-button comments-add" onClick={addComment} disabled={editor.state.selection.empty || plainTextMode}>
              <MessageSquarePlus size={14} aria-hidden="true" /> Add comment to selection
            </button>
            {plainTextMode && <p>Comments are available in DOCX documents.</p>}
            {(document.comments ?? []).length ? (
              <ul className="comments-list">
                {document.comments.map((comment) => (
                  <li key={comment.id} className={activeCommentId === comment.id ? 'is-active' : ''}>
                    <button type="button" className="comment-location" onClick={() => selectComment(comment.id)}>
                      {comment.author || 'Comment'}{comment.createdAt ? ` · ${new Date(comment.createdAt).toLocaleDateString()}` : ''}
                    </button>
                    <textarea
                      aria-label="Comment text"
                      value={comment.body}
                      placeholder="Write a comment…"
                      onFocus={() => setActiveCommentId(comment.id)}
                      onChange={(event) => updateComment(comment.id, event.target.value)}
                    />
                    <button type="button" className="text-button comment-delete" onClick={() => deleteComment(comment.id)}>Delete comment</button>
                  </li>
                ))}
              </ul>
            ) : <p>Select text, then add a comment.</p>}
          </aside>
        )}
      </main>

      <footer className="statusbar">
        <div>
          <span>{wordCount.toLocaleString()} {wordCount === 1 ? 'word' : 'words'}</span>
          <span>Letter</span>
          <span>
            {document.source?.format === 'doc-import'
              ? 'Imported DOC · save as DOCX'
              : document.source?.format === 'txt'
                ? 'Plain text'
                : document.source?.format === 'md'
                  ? 'Markdown'
                  : 'DOCX'}
          </span>
        </div>
        <div className="statusbar-actions">
          <div className={`update-control is-${updateState.phase}`} aria-live="polite">
            <span className="version-label">TXT Docs v{updateState.currentVersion}</span>
            {updatePresentation.action && (
              <button
                type="button"
                className="update-status-button"
                title={updatePresentation.detail}
                onClick={() => void runUpdateAction(updatePresentation.action)}
              >
                {updateState.phase === 'available' && <Download size={12} aria-hidden="true" />}
                {updateState.phase === 'downloaded' && <RefreshCw size={12} aria-hidden="true" />}
                {updatePresentation.actionLabel}
              </button>
            )}
            {updatePresentation.busy && (
              <span className="update-status-busy">
                <RefreshCw size={11} aria-hidden="true" />
                {updatePresentation.actionLabel}
              </span>
            )}
          </div>
          <div className="zoom-controls">
            <ToolButton label="Zoom out" icon={<ZoomOut size={15} />} onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))} subtle />
            <button type="button" className="zoom-value" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <ToolButton label="Zoom in" icon={<ZoomIn size={15} />} onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))} subtle />
          </div>
        </div>
      </footer>
    </div>
  );
}
