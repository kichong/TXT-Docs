import type { CompatibilityIssue, CompatibilityReportRequest } from './types';

interface CompatibilityReportContext extends CompatibilityReportRequest {
  appName: string;
  appVersion: string;
  operatingSystem: string;
  repositoryUrl: string;
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

const SAFE_ISSUES: Record<string, { title: string; detail: string }> = {
  macros: { title: 'Macros are not preserved', detail: 'VBA macros may be removed when the document is saved.' },
  'headers-footers': { title: 'Headers or footers may change', detail: 'Advanced header and footer content is not fully supported.' },
  'tracked-changes': { title: 'Tracked changes are flattened', detail: 'Revisions are imported as document content, not retained as revisions.' },
  'content-controls': { title: 'Content controls are not preserved', detail: 'Form controls are imported as visible content only.' },
  equations: { title: 'Equations are not preserved', detail: 'Office Math objects are not currently supported.' },
  'embedded-content': { title: 'Embedded content is not preserved', detail: 'Embedded alternate content is not currently supported.' },
  'floating-objects': { title: 'Floating objects may move', detail: 'Floating objects are converted to inline content.' },
  'uneven-columns': { title: 'Uneven columns may change', detail: 'Some unequal-width column layouts may be simplified.' },
  'custom-numbering': { title: 'Some numbering is simplified', detail: 'Unsupported numbering formats become standard numbering.' },
};

function safeIssues(issues: CompatibilityIssue[]) {
  return [...new Set(issues.map((issue) => issue.code))]
    .map((code) => ({ code, ...SAFE_ISSUES[code] }))
    .filter((issue) => issue.title);
}

export function buildCompatibilityReportUrl(context: CompatibilityReportContext): string {
  const issues = safeIssues(context.issues);
  const issueNames = issues.map((issue) => issue.title);
  const title = `[Compatibility] ${issueNames.slice(0, 2).join(', ')}${issueNames.length > 2 ? ` +${issueNames.length - 2} more` : ''}`;
  const body = [
    '## Compatibility report',
    '',
    '> Privacy note: this report contains only the app version, general platform, file type, and compatibility categories. It does not include the filename, file path, document text, comments, authors, or other document metadata.',
    '',
    `- App: ${singleLine(context.appName)} ${singleLine(context.appVersion)}`,
    `- Platform: ${['win32', 'darwin', 'linux'].includes(context.operatingSystem) ? context.operatingSystem : 'other'}`,
    `- Source format: ${singleLine(context.sourceFormat)}`,
    '',
    '### Detected issues',
    '',
    ...issues.map((issue) => `- **${issue.title}** (\`${issue.code}\`): ${issue.detail}`),
    '',
    '### What happened?',
    '',
    '<!-- Describe the behavior without pasting private document content. A small newly-created sample file is safest if a reproduction is needed. -->',
    '',
    'Expected:',
    '',
    'Actual:',
  ].join('\n');
  const params = new URLSearchParams({ title, body });
  return `${context.repositoryUrl.replace(/\/$/u, '')}/issues/new?${params.toString()}`;
}
