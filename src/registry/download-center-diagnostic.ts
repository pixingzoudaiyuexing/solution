import { z } from 'zod';
import { normalizedGitHubRepositoryKey } from './modules/download-center';
import { canonicalRegistryJson } from './operational';
import { parseStrictJson } from './strict-json';

export const DOWNLOAD_CENTER_DIAGNOSTIC_KEY =
  'registry:download-center:diagnostic:v1';
export const DOWNLOAD_CENTER_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const DOWNLOAD_CENTER_DIAGNOSTIC_MAX_REPOSITORIES = 50;
export const DOWNLOAD_CENTER_DIAGNOSTIC_MAX_ELAPSED_MS = 300_000;

export const downloadCenterDiagnosticErrorCodeSchema = z.enum([
  'TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'UNEXPECTED',
]);

const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const elapsedSchema = z
  .number()
  .int()
  .nonnegative()
  .max(DOWNLOAD_CENTER_DIAGNOSTIC_MAX_ELAPSED_MS);
const repositorySchema = z
  .string()
  .min(3)
  .max(140)
  .refine((value) => normalizedGitHubRepositoryKey(value) === value);

const successDiagnosticSchema = z
  .object({
    repository: repositorySchema,
    attemptedAt: timestampSchema,
    elapsedMs: elapsedSchema,
    status: z.literal('success'),
  })
  .strict();

const errorDiagnosticSchema = z
  .object({
    repository: repositorySchema,
    attemptedAt: timestampSchema,
    elapsedMs: elapsedSchema,
    status: z.literal('error'),
    errorCode: downloadCenterDiagnosticErrorCodeSchema,
  })
  .strict();

export const downloadCenterRepositoryDiagnosticSchema = z.discriminatedUnion(
  'status',
  [successDiagnosticSchema, errorDiagnosticSchema]
);

export const downloadCenterDiagnosticStateSchema = z
  .object({
    schemaVersion: z.literal(DOWNLOAD_CENTER_DIAGNOSTIC_SCHEMA_VERSION),
    checkedAt: timestampSchema,
    repositories: z
      .array(downloadCenterRepositoryDiagnosticSchema)
      .max(DOWNLOAD_CENTER_DIAGNOSTIC_MAX_REPOSITORIES),
  })
  .strict()
  .superRefine((state, ctx) => {
    const repositories = state.repositories.map((item) => item.repository);
    if (new Set(repositories).size !== repositories.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repositories'],
        message: 'Duplicate repository diagnostic',
      });
    }
    if (state.repositories.some((item) => item.attemptedAt > state.checkedAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkedAt'],
        message: 'Diagnostic checkedAt precedes an attempt',
      });
    }
  });

export type DownloadCenterDiagnosticErrorCode = z.infer<
  typeof downloadCenterDiagnosticErrorCodeSchema
>;
export type DownloadCenterRepositoryDiagnostic = z.infer<
  typeof downloadCenterRepositoryDiagnosticSchema
>;
export type DownloadCenterDiagnosticState = z.infer<
  typeof downloadCenterDiagnosticStateSchema
>;

export type DownloadCenterDiagnosticLoadResult =
  | { status: 'missing' }
  | { status: 'corrupt' }
  | { status: 'valid'; state: DownloadCenterDiagnosticState };

export async function loadDownloadCenterDiagnosticState(
  kv: KVNamespace
): Promise<DownloadCenterDiagnosticLoadResult> {
  let text: string | null;
  try {
    text = await kv.get(DOWNLOAD_CENTER_DIAGNOSTIC_KEY, 'text');
  } catch {
    return { status: 'corrupt' };
  }
  if (text === null) return { status: 'missing' };
  try {
    const parsed = downloadCenterDiagnosticStateSchema.safeParse(
      parseStrictJson(text)
    );
    return parsed.success
      ? { status: 'valid', state: parsed.data }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

export async function persistDownloadCenterDiagnosticState(
  kv: KVNamespace,
  state: DownloadCenterDiagnosticState
): Promise<void> {
  const parsed = downloadCenterDiagnosticStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new Error('Invalid Download Center diagnostic state');
  }
  await kv.put(DOWNLOAD_CENTER_DIAGNOSTIC_KEY, canonicalRegistryJson(parsed.data));
}
