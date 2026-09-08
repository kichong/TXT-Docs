import { describe, expect, it } from 'vitest';
import { buildCompatibilityReportUrl } from '../src/shared/compatibility-report';

describe('compatibility report', () => {
  it('creates a sanitized, prefilled GitHub issue', () => {
    const report = new URL(buildCompatibilityReportUrl({
      appName: 'TXT Docs',
      appVersion: '0.3.5',
      operatingSystem: 'win32 10.0.26100',
      sourceFormat: 'docx',
      repositoryUrl: 'https://github.com/kichong/TXT-Docs',
      issues: [{
        code: 'comments',
        severity: 'warning',
        title: 'PRIVATE filename and document text',
        detail: 'PRIVATE comment body and author',
      }],
    }));

    expect(report.origin + report.pathname).toBe('https://github.com/kichong/TXT-Docs/issues/new');
    expect(report.searchParams.get('title')).not.toContain('PRIVATE');
    expect(report.searchParams.get('body')).not.toContain('PRIVATE');
    expect(report.searchParams.get('body')).toContain('does not include the filename');
    expect(report.searchParams.get('body')).toContain('Platform: other');
  });
});
