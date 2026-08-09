import { z } from 'zod';

const jsonMarkSchema = z.object({
  type: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

export const jsonContentSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(jsonContentSchema).optional(),
    marks: z.array(jsonMarkSchema).optional(),
    text: z.string().optional(),
  }),
);

const compatibilityIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warning']),
  title: z.string(),
  detail: z.string(),
});

const sourceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  format: z.enum(['docx', 'doc-import', 'txt', 'md']),
  readOnly: z.boolean(),
  legacyImported: z.boolean(),
});

export const editorDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().max(500),
  content: jsonContentSchema,
  page: z.object({
    size: z.literal('letter'),
    orientation: z.literal('portrait'),
    marginsIn: z.object({
      top: z.number().min(0).max(4),
      right: z.number().min(0).max(4),
      bottom: z.number().min(0).max(4),
      left: z.number().min(0).max(4),
    }),
  }),
  source: sourceSchema.optional(),
  compatibilityIssues: z.array(compatibilityIssueSchema).max(100),
});

export const saveRequestSchema = z.object({
  document: editorDocumentSchema,
  overwriteCompatibilityIssues: z.boolean().optional(),
  printHtml: z.string().max(50_000_000).optional(),
});

export const printRequestSchema = z.object({
  html: z.string().max(50_000_000),
});

export const appUpdateStateSchema = z.object({
  currentVersion: z.string().min(1).max(100),
  phase: z.enum([
    'idle',
    'checking',
    'available',
    'downloading',
    'downloaded',
    'up-to-date',
    'error',
    'unavailable',
  ]),
  canCheck: z.boolean(),
  availableVersion: z.string().min(1).max(100).optional(),
  downloadPercent: z.number().min(0).max(100).optional(),
  lastCheckedAt: z.string().datetime().optional(),
  message: z.string().max(1_000).optional(),
});
