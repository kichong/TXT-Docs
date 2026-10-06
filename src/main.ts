import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import { importDocx } from './main/docx/importer';
import { exportDocx } from './main/docx/exporter';
import { convertLegacyDoc, getLegacyConverterStatus } from './main/legacy-converter';
import { LocalDocumentStorage } from './main/storage';
import { findLaunchDocumentPath } from './main/launch-files';
import { contentToPlainText, plainTextToContent } from './shared/plain-text';
import { buildCompatibilityReportUrl } from './shared/compatibility-report';
import { compatibilityReportRequestSchema, editorDocumentSchema, printRequestSchema, saveRequestSchema } from './shared/schemas';
import { DEFAULT_PAGE_SETTINGS } from './shared/types';
import { AppUpdateManager } from './main/updater';
import type {
  AppCommand,
  CompatibilityReportRequest,
  DocumentFormat,
  EditorDocumentV1,
  ImageAsset,
  OpenResult,
  PageSettings,
  PrintRequest,
  PrintResult,
  SaveRequest,
  SaveResult,
  SaveFormat,
} from './shared/types';

let mainWindow: BrowserWindow | null = null;
let storage: LocalDocumentStorage;
let updateManager: AppUpdateManager;
let dirty = false;
let closeAfterSave = false;
let forceClose = false;
const pendingExternalPaths: string[] = [];

function applicationIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(process.cwd(), 'build', 'icon.ico');
}

function queueExternalDocument(commandLine: string[]): void {
  const path = findLaunchDocumentPath(commandLine);
  if (path && !pendingExternalPaths.includes(path)) pendingExternalPaths.push(path);
}

queueExternalDocument(process.argv.slice(1));

function sendCommand(command: AppCommand): void {
  mainWindow?.webContents.send('app:command', command);
}

function createApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'Ctrl+N', click: () => sendCommand('new') },
        { label: 'Open…', accelerator: 'Ctrl+O', click: () => sendCommand('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'Ctrl+S', click: () => sendCommand('save') },
        { label: 'Save As…', accelerator: 'Ctrl+Shift+S', click: () => sendCommand('save-as') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'Ctrl+P', click: () => sendCommand('print') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Findâ€¦', accelerator: 'Ctrl+F', click: () => sendCommand('find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for Updates…', click: () => void updateManager.checkForUpdates() },
        { type: 'separator' },
        {
          label: `About TXT Docs v${app.getVersion()}`,
          click: () => {
            void dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About TXT Docs',
              message: `TXT Docs v${app.getVersion()}`,
              detail: 'A free, open-source word processor.\n\nLicensed under Apache License 2.0.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openPath(path: string): Promise<OpenResult> {
  const extension = extname(path).toLowerCase();
  const legacyImported = extension === '.doc';
  const plainFormat: DocumentFormat | null =
    extension === '.txt' ? 'txt' : extension === '.md' || extension === '.markdown' ? 'md' : null;
  if (plainFormat) {
    const source = await storage.createSource(path, plainFormat, false);
    const recentFiles = await storage.remember(path);
    return {
      document: {
        schemaVersion: 1,
        title: parse(path).name,
        content: plainTextToContent(await readFile(path, 'utf8')),
        page: DEFAULT_PAGE_SETTINGS,
        source,
        compatibilityIssues: [],
        comments: [],
      },
      recentFiles,
    };
  }
  const bytes = legacyImported ? await convertLegacyDoc(path) : new Uint8Array(await readFile(path));
  const source = await storage.createSource(path, legacyImported ? 'doc-import' : 'docx', legacyImported);
  const document = await importDocx(bytes, source);
  const recentFiles = await storage.remember(path);
  return { document, recentFiles };
}

async function chooseOpenPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open a document',
    properties: ['openFile'],
    filters: [
      { name: 'Supported documents', extensions: ['docx', 'doc', 'txt', 'md', 'markdown'] },
      { name: 'Word documents', extensions: ['docx', 'doc'] },
      { name: 'Text and Markdown', extensions: ['txt', 'md', 'markdown'] },
      { name: 'DOCX documents', extensions: ['docx'] },
      { name: 'Legacy Word documents', extensions: ['doc'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

function editableSaveFormat(document: EditorDocumentV1): Exclude<SaveFormat, 'pdf'> {
  const format = document.source?.format;
  return format === 'txt' || format === 'md' ? format : 'docx';
}

async function chooseSavePath(document: EditorDocumentV1): Promise<string | null> {
  const format = editableSaveFormat(document);
  const cleanTitle = document.title.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '').trim() || 'Untitled document';
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save As',
    defaultPath: `${cleanTitle}.${format}`,
    filters: [
      { name: 'Word document', extensions: ['docx'] },
      { name: 'PDF document', extensions: ['pdf'] },
      { name: 'Plain text', extensions: ['txt'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });
  return result.canceled ? null : result.filePath ?? null;
}

function saveFormatForPath(path: string): SaveFormat {
  const extension = extname(path).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.txt') return 'txt';
  if (extension === '.md' || extension === '.markdown') return 'md';
  if (extension === '.docx') return 'docx';
  throw new Error('Choose a .docx, .pdf, .txt, or .md file name.');
}

const PRINT_STYLES = `
  * { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; color: #202124; background: #fff; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1; }
  .document-editor { min-height: 0; outline: none; caret-color: transparent; }
  .document-editor [data-text-color] { color: var(--document-text-color) !important; }
  .document-editor mark {
    padding: 0 .06em; border-radius: 2px; color: var(--highlight-foreground, #202124);
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
  }
  .document-editor section[data-document-section] {
    min-width: 0; column-count: var(--section-columns, 1); column-gap: var(--section-column-gap, .5in);
  }
  .document-editor section[data-document-section][data-explicit-columns="true"] {
    display: grid; grid-template-columns: var(--section-column-template); gap: var(--section-column-gap, 0); column-count: 1;
  }
  .document-editor [data-document-column] { min-width: 0; }
  .document-editor [data-document-column] > :first-child { margin-top: 0; }
  .document-editor [data-document-column] > :last-child { margin-bottom: 0; }
  .document-editor p { min-height: 1em; margin: 0; }
  .document-editor p[data-paragraph-style="no-spacing"] { margin-bottom: 0; line-height: 1; }
  .document-editor p[data-paragraph-style="title"] {
    margin: 0 0 14pt; font-family: Cambria, Georgia, serif; font-size: 28pt; line-height: 1.1;
  }
  .document-editor h1, .document-editor h2, .document-editor h3 {
    color: #202124; font-family: Cambria, Georgia, serif; break-after: avoid;
  }
  .document-editor h1 { margin: 20pt 0 8pt; font-size: 24pt; line-height: 1.18; }
  .document-editor h2 { margin: 16pt 0 6pt; font-size: 18pt; line-height: 1.22; }
  .document-editor h3 { margin: 13pt 0 5pt; font-size: 14pt; line-height: 1.25; }
  .document-editor ul, .document-editor ol { margin: 0 0 8pt; padding-left: 28px; }
  .document-editor ol ol { list-style-type: lower-alpha; }
  .document-editor ol ol ol { list-style-type: lower-roman; }
  .document-editor ol ol ol ol { list-style-type: decimal; }
  .document-editor ol ol ol ol ol { list-style-type: lower-alpha; }
  .document-editor ol ol ol ol ol ol { list-style-type: lower-roman; }
.document-editor ol ol ol ol ol ol ol { list-style-type: decimal; }
.document-editor ol ol ol ol ol ol ol ol { list-style-type: lower-alpha; }
.document-editor ol ol ol ol ol ol ol ol ol { list-style-type: lower-roman; }
  .document-editor li > p { margin-bottom: 3pt; }
  .document-editor a { color: #1f5fc4; text-decoration: underline; }
  .document-editor img { display: block; max-width: 100%; height: auto; margin: 10pt auto; }
  .document-editor table { width: 100%; margin: 12pt 0; border-collapse: collapse; table-layout: fixed; }
  .document-editor th, .document-editor td {
    min-width: 60px; padding: 7px 8px; border: 1px solid #bfc3ca; vertical-align: top;
  }
  .document-editor th { background: #f1f3f6; font-weight: 650; }
  .document-editor th p, .document-editor td p { margin: 0; }
  .document-editor [data-page-break] { height: 0; margin: 0; border: 0; break-after: page; }
  .document-editor [data-page-break]::after { display: none; }
  ::selection { color: inherit; background: transparent; }
`;

function printLayoutStyles(page: PageSettings): string {
  const columns = Math.max(1, Math.min(8, Math.round(page.columns ?? 1)));
  const gap = Math.max(0, Math.min(4, page.columnGapIn ?? 0.5));
  const { top, right, bottom, left } = page.marginsIn;
  return `
    @page { size: Letter portrait; margin: ${top}in ${right}in ${bottom}in ${left}in; }
    .document-editor { column-count: ${columns}; column-gap: ${gap}in; }
  `;
}

async function createPrintWindow(html: string, pageSettings: PageSettings): Promise<BrowserWindow> {
  const printWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: true,
    },
  });
  const page = `<!doctype html>
    <html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <style>${PRINT_STYLES}${printLayoutStyles(pageSettings)}</style></head>
    <body><article class="document-editor">${html}</article></body></html>`;
  await printWindow.loadURL(`data:text/html;base64,${Buffer.from(page, 'utf8').toString('base64')}`);
  await printWindow.webContents.executeJavaScript(`Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))]).then(() => true)`);
  return printWindow;
}

async function renderPdf(html: string, pageSettings: PageSettings): Promise<Uint8Array> {
  const printWindow = await createPrintWindow(html, pageSettings);
  try {
    return await printWindow.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
    });
  } finally {
    printWindow.destroy();
  }
}

async function saveToPath(request: SaveRequest, path: string): Promise<SaveResult> {
  const parsed = saveRequestSchema.parse(request);
  const document = { ...(parsed.document as EditorDocumentV1), title: parse(path).name };
  const format = saveFormatForPath(path);
  if (format === 'pdf') {
    if (!parsed.printHtml) throw new Error('The document print surface was unavailable.');
    await storage.atomicWrite(path, await renderPdf(parsed.printHtml, document.page));
    return {
      status: 'saved',
      outputFormat: 'pdf',
      displayName: basename(path),
      recentFiles: await storage.getRecentFiles(),
    };
  }
  const bytes =
    format === 'docx'
      ? await exportDocx(document)
      : Buffer.from(contentToPlainText(document.content), 'utf8');
  await storage.atomicWrite(path, bytes);
  const source = await storage.createSource(path, format, false);
  const recentFiles = await storage.remember(path);
  await storage.clearRecovery();
  dirty = false;
  return { status: 'saved', source, outputFormat: format, displayName: source.displayName, recentFiles };
}

function installIpcHandlers(): void {
  ipcMain.handle('documents:open', async () => {
    const path = await chooseOpenPath();
    return path ? openPath(path) : null;
  });
  ipcMain.handle('documents:open-external', async () => {
    const path = pendingExternalPaths.shift();
    return path ? openPath(path) : null;
  });
  ipcMain.on('documents:cancel-external', () => {
    pendingExternalPaths.shift();
  });
  ipcMain.handle('documents:open-recent', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid recent file identifier.');
    const path = await storage.getRecentPath(id);
    if (!path) throw new Error('This recent file is no longer available.');
    return openPath(path);
  });
  ipcMain.handle('documents:save', async (_event, request: unknown) => {
    const parsed = saveRequestSchema.parse(request) as SaveRequest;
    const source = parsed.document.source;
    const path = source && !source.legacyImported && !source.readOnly ? storage.resolveSource(source.id) : undefined;
    if (!path) {
      const chosen = await chooseSavePath(parsed.document);
      return chosen
        ? saveToPath(parsed, chosen)
        : ({ status: 'cancelled', recentFiles: await storage.getRecentFiles() } satisfies SaveResult);
    }
    return saveToPath(parsed, path);
  });
  ipcMain.handle('documents:save-as', async (_event, request: unknown) => {
    const parsed = saveRequestSchema.parse(request) as SaveRequest;
    const path = await chooseSavePath(parsed.document);
    return path
      ? saveToPath(parsed, path)
      : ({ status: 'cancelled', recentFiles: await storage.getRecentFiles() } satisfies SaveResult);
  });
  ipcMain.handle('documents:report-compatibility', async (_event, request: unknown) => {
    const parsed = compatibilityReportRequestSchema.parse(request) as CompatibilityReportRequest;
    await shell.openExternal(buildCompatibilityReportUrl({
      ...parsed,
      appName: 'TXT Docs',
      appVersion: app.getVersion(),
      operatingSystem: process.platform,
      repositoryUrl: 'https://github.com/kichong/TXT-Docs',
    }));
  });
  ipcMain.handle('documents:print', async (_event, request: unknown): Promise<PrintResult> => {
    const parsed = printRequestSchema.parse(request) as PrintRequest;
    const printWindow = await createPrintWindow(parsed.html, parsed.page);
    return new Promise((resolve) => {
      printWindow.webContents.print(
        { printBackground: true, silent: false },
        (success, errorType) => {
          printWindow.destroy();
          if (success) resolve({ status: 'printed' });
          else if (errorType === 'cancelled') resolve({ status: 'cancelled' });
          else resolve({ status: 'failed', error: errorType });
        },
      );
    });
  });
  ipcMain.handle('documents:pick-image', async (): Promise<ImageAsset | null> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Insert image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const bytes = await readFile(path);
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
    const extension = extname(path).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.gif' ? 'image/gif' : 'image/jpeg';
    return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, displayName: basename(path) };
  });
  ipcMain.handle('clipboard:read-content', () => ({
    text: clipboard.readText(),
    html: clipboard.readHTML(),
  }));
  ipcMain.handle('documents:converter-status', () => getLegacyConverterStatus());
  ipcMain.handle('documents:recent', () => storage.getRecentFiles());
  ipcMain.handle('documents:write-recovery', async (_event, document: unknown) => {
    const parsed = editorDocumentSchema.parse(document) as EditorDocumentV1;
    await storage.writeRecovery(parsed);
  });
  ipcMain.handle('documents:read-recovery', () => storage.readRecovery());
  ipcMain.handle('documents:clear-recovery', () => storage.clearRecovery());
  ipcMain.handle('updates:get-state', () => updateManager.getState());
  ipcMain.handle('updates:check', () => updateManager.checkForUpdates());
  ipcMain.handle('updates:download', () => updateManager.downloadUpdate());
  ipcMain.handle('updates:install', async (_event, sourceId: unknown) => {
    if (sourceId !== null && typeof sourceId !== 'string') throw new Error('Invalid document identifier.');
    if (dirty) throw new Error('Save your document before restarting to install the update.');
    const state = updateManager.getState();
    if (state.phase !== 'downloaded' || !state.availableVersion) throw new Error('No downloaded update is ready to install.');
    await storage.prepareUpdateResume(sourceId, state.availableVersion);
    try {
      if (dirty) throw new Error('Save your document before restarting to install the update.');
      forceClose = true;
      updateManager.installUpdate();
    } catch (error) {
      forceClose = false;
      await storage.clearUpdateResume();
      throw error;
    }
  });
  ipcMain.on('documents:set-dirty', (_event, value: unknown) => {
    dirty = value === true;
  });
  ipcMain.on('documents:close-after-save', () => {
    if (dirty) return;
    forceClose = true;
    mainWindow?.close();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 860,
    minHeight: 620,
    show: false,
    backgroundColor: '#202226',
    title: 'TXT Docs',
    icon: applicationIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const window = mainWindow;
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      items.push(...params.dictionarySuggestions.map((word) => ({
        label: word,
        click: () => window.webContents.replaceMisspelling(word),
      })));
      if (!params.dictionarySuggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
      items.push({ type: 'separator' });
    }
    items.push(
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    );
    Menu.buildFromTemplate(items).popup({ window });
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void mainWindow.loadURL(devServer);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/iu.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });
  mainWindow.on('close', (event) => {
    if (forceClose || !dirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: 'Unsaved changes',
      message: 'Save changes before closing?',
      detail: 'Your recovery copy remains local until the document is saved or discarded.',
      buttons: ['Save', 'Close without saving', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      closeAfterSave = true;
      sendCommand('save-and-close');
    } else if (choice === 1) {
      forceClose = true;
      void storage.clearRecovery().finally(() => mainWindow?.close());
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (closeAfterSave) closeAfterSave = false;
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

app.on('second-instance', (_event, commandLine) => {
  queueExternalDocument(commandLine);
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (pendingExternalPaths.length) sendCommand('open-external');
});

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  app.setAppUserModelId('com.txtdocs.app');
  storage = new LocalDocumentStorage(join(app.getPath('userData'), 'local-data'));
  await storage.initialize();
  const resumePath = await storage.consumeUpdateResume(app.getVersion());
  if (resumePath && pendingExternalPaths.length === 0) pendingExternalPaths.push(resumePath);
  updateManager = new AppUpdateManager(app.getVersion(), app.isPackaged, (state) => {
    if (state.phase === 'error') {
      forceClose = false;
      void storage.clearUpdateResume().catch(() => undefined);
    }
    mainWindow?.webContents.send('app:update-state', state);
  });
  updateManager.initialize();
  installIpcHandlers();
  createApplicationMenu();
  createWindow();
  if (app.isPackaged) {
    const firstCheck = setTimeout(() => void updateManager.checkForUpdates(), 4_000);
    firstCheck.unref();
    const recurringCheck = setInterval(() => void updateManager.checkForUpdates(), 6 * 60 * 60 * 1_000);
    recurringCheck.unref();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
