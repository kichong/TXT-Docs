import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppCommand,
  DesktopDocumentsApi,
  EditorDocumentV1,
  SaveRequest,
} from './shared/types';

const api: DesktopDocumentsApi = {
  openDocument: () => ipcRenderer.invoke('documents:open'),
  openExternalDocument: () => ipcRenderer.invoke('documents:open-external'),
  cancelExternalOpen: () => ipcRenderer.send('documents:cancel-external'),
  openRecent: (id: string) => ipcRenderer.invoke('documents:open-recent', id),
  saveDocument: (request: SaveRequest) => ipcRenderer.invoke('documents:save', request),
  saveDocumentAs: (request: SaveRequest) => ipcRenderer.invoke('documents:save-as', request),
  printDocument: (request) => ipcRenderer.invoke('documents:print', request),
  pickImage: () => ipcRenderer.invoke('documents:pick-image'),
  readClipboardContent: () => ipcRenderer.invoke('clipboard:read-content'),
  getLegacyConverterStatus: () => ipcRenderer.invoke('documents:converter-status'),
  getRecentFiles: () => ipcRenderer.invoke('documents:recent'),
  writeRecovery: (document: EditorDocumentV1) => ipcRenderer.invoke('documents:write-recovery', document),
  readRecovery: () => ipcRenderer.invoke('documents:read-recovery'),
  clearRecovery: () => ipcRenderer.invoke('documents:clear-recovery'),
  setDirty: (dirty: boolean) => ipcRenderer.send('documents:set-dirty', dirty),
  requestCloseAfterSave: () => ipcRenderer.send('documents:close-after-save'),
  onCommand: (callback: (command: AppCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: AppCommand) => callback(command);
    ipcRenderer.on('app:command', listener);
    return () => ipcRenderer.removeListener('app:command', listener);
  },
};

contextBridge.exposeInMainWorld('documentsApi', api);
