import type { DesktopDocumentsApi } from './shared/types';

declare global {
  interface Window {
    documentsApi: DesktopDocumentsApi;
  }
}

export {};
