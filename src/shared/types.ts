export interface JSONMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: JSONMark[];
  text?: string;
}

export type DocumentFormat = 'docx' | 'doc-import' | 'txt' | 'md';
export type SaveFormat = 'docx' | 'pdf' | 'txt' | 'md';

export interface PageSettings {
  size: 'letter';
  orientation: 'portrait';
  columns: number;
  columnGapIn: number;
  marginsIn: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface CompatibilityIssue {
  code: string;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
}

export interface DocumentComment {
  id: string;
  body: string;
  author?: string;
  createdAt?: string;
}

export interface DocumentSource {
  id: string;
  displayName: string;
  format: DocumentFormat;
  readOnly: boolean;
  legacyImported: boolean;
}

export interface EditorDocumentV1 {
  schemaVersion: 1;
  title: string;
  content: JSONContent;
  page: PageSettings;
  source?: DocumentSource;
  compatibilityIssues: CompatibilityIssue[];
  comments: DocumentComment[];
}

export interface RecentFile {
  id: string;
  displayName: string;
  lastOpenedAt: string;
}

export interface OpenResult {
  document: EditorDocumentV1;
  recentFiles: RecentFile[];
}

export interface SaveRequest {
  document: EditorDocumentV1;
  overwriteCompatibilityIssues?: boolean;
  printHtml?: string;
}

export interface SaveResult {
  status: 'saved' | 'cancelled';
  source?: DocumentSource;
  outputFormat?: SaveFormat;
  displayName?: string;
  recentFiles: RecentFile[];
}

export interface PrintRequest {
  html: string;
  page: PageSettings;
}

export interface CompatibilityReportRequest {
  sourceFormat: DocumentFormat | 'unsaved';
  issues: CompatibilityIssue[];
}

export interface PrintResult {
  status: 'printed' | 'cancelled' | 'failed';
  error?: string;
}

export interface ImageAsset {
  dataUrl: string;
  displayName: string;
  width?: number;
  height?: number;
}

export interface ClipboardContent {
  text: string;
  html: string;
}

export interface ConverterStatus {
  available: boolean;
  name: 'LibreOffice';
  detail: string;
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unavailable';

export interface AppUpdateState {
  currentVersion: string;
  phase: UpdatePhase;
  canCheck: boolean;
  availableVersion?: string;
  downloadPercent?: number;
  lastCheckedAt?: string;
  message?: string;
}

export type AppCommand =
  | 'new'
  | 'open'
  | 'open-external'
  | 'find'
  | 'save'
  | 'save-as'
  | 'print'
  | 'save-and-close';

export interface RecoveryDraft {
  document: EditorDocumentV1;
  savedAt: string;
}

export interface DesktopDocumentsApi {
  openDocument(): Promise<OpenResult | null>;
  openExternalDocument(): Promise<OpenResult | null>;
  cancelExternalOpen(): void;
  openRecent(id: string): Promise<OpenResult | null>;
  saveDocument(request: SaveRequest): Promise<SaveResult>;
  saveDocumentAs(request: SaveRequest): Promise<SaveResult>;
  reportCompatibility(request: CompatibilityReportRequest): Promise<void>;
  printDocument(request: PrintRequest): Promise<PrintResult>;
  pickImage(): Promise<ImageAsset | null>;
  readClipboardContent(): Promise<ClipboardContent>;
  getLegacyConverterStatus(): Promise<ConverterStatus>;
  getRecentFiles(): Promise<RecentFile[]>;
  writeRecovery(document: EditorDocumentV1): Promise<void>;
  readRecovery(): Promise<RecoveryDraft | null>;
  clearRecovery(): Promise<void>;
  getUpdateState(): Promise<AppUpdateState>;
  checkForUpdates(): Promise<AppUpdateState>;
  downloadUpdate(): Promise<AppUpdateState>;
  installUpdate(): Promise<void>;
  setDirty(dirty: boolean): void;
  requestCloseAfterSave(): void;
  onCommand(callback: (command: AppCommand) => void): () => void;
  onUpdateState(callback: (state: AppUpdateState) => void): () => void;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: 'letter',
  orientation: 'portrait',
  columns: 1,
  columnGapIn: 0.5,
  marginsIn: {
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
  },
};

export function createBlankDocument(title = 'Untitled document'): EditorDocumentV1 {
  return {
    schemaVersion: 1,
    title,
    page: DEFAULT_PAGE_SETTINGS,
    compatibilityIssues: [],
    comments: [],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
  };
}
