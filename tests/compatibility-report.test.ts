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
        title: 'Comments are not preserved',
        detail: 'Review comments will be removed on save.',
      }],
    }));

    expect(report.origin + report.pathname).toBe('https://github.com/kichong/TXT-Docs/issues/new');
    expect(report.searchParams.get('title')).toContain('Comments are not preserved');
    expect(report.searchParams.get('body')).toContain('No filename or document contents are included.');
    expect(report.searchParams.get('body')).toContain('win32 10.0.26100');
  });
});
