import { z } from 'zod';
import type { DownloadItem } from '../contract/v1/downloads';
import { canonicalRegistryJson } from './operational';
import { isStableId } from './stable-id';
import { parseStrictJson } from './strict-json';

export const DOWNLOAD_CENTER_RESOLVED_KEY = 'registry:download-center:resolved:v1';
export const DOWNLOAD_CENTER_RESOLVED_SCHEMA_VERSION = 2;

const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UNSAFE_PRESENTATION_TEXT = /[<>\u0000-\u001f\u007f-\u009f]/;
const timestampSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safePresentationText = (max: number) =>
  z.string().min(1).max(max).refine((value) => !UNSAFE_PRESENTATION_TEXT.test(value));
const providerDownloadUrl = z.string().max(4096).refine((value) => {
  if (CONTROL.test(value)) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      hostname !== 'github.com' &&
      hostname !== 'api.github.com' &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      value.includes('https://github.com/') &&
      value.includes('/releases/download/')
    );
  } catch {
    return false;
  }
});
const isoTimestamp = z.string().max(64).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
});

const downloadOptionSchema = z
  .object({
    id: z.string().refine(isStableId),
    label: safePresentationText(160),
    url: providerDownloadUrl,
  })
  .strict();

export const resolvedDownloadItemSchema: z.ZodType<DownloadItem> = z
  .object({
    id: z.string().refine(isStableId),
    label: safePresentationText(160),
    platform: z.enum(['windows', 'macos', 'android', 'linux']),
    arch: safePresentationText(64).nullable(),
    version: safePresentationText(128),
    publishedAt: isoTimestamp.nullable(),
    filename: safePresentationText(255),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    downloads: z.tuple([downloadOptionSchema, downloadOptionSchema]),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.downloads[0].id === item.downloads[1].id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['downloads'],
        message: 'Download provider IDs must be distinct',
      });
    }
  });

const resolvedEntrySchema = z
  .object({
    id: z.string().refine(isStableId),
    configFingerprint: z.string().regex(SHA256),
    lastAttemptAt: timestampSchema,
    resolvedAt: timestampSchema.optional(),
    expiresAt: timestampSchema.optional(),
    data: resolvedDownloadItemSchema.optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const hasResolution =
      entry.resolvedAt !== undefined || entry.expiresAt !== undefined || entry.data !== undefined;
    if (
      hasResolution &&
      (entry.resolvedAt === undefined || entry.expiresAt === undefined || entry.data === undefined)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Incomplete resolution' });
      return;
    }
    if (!hasResolution) return;
    if (
      entry.data!.id !== entry.id ||
      entry.resolvedAt! > entry.lastAttemptAt ||
      entry.expiresAt! < entry.resolvedAt! ||
      entry.expiresAt! - entry.resolvedAt! > 168 * 60 * 60 * 1000
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid resolution timing' });
    }
  });

const resolvedEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(DOWNLOAD_CENTER_RESOLVED_SCHEMA_VERSION),
    generatedAt: timestampSchema,
    items: z.array(resolvedEntrySchema).max(50),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    const ids = envelope.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate item id' });
    }
    if (envelope.items.some((item) => item.lastAttemptAt > envelope.generatedAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Future attempt time' });
    }
  });

export type DownloadCenterResolvedEntry = z.infer<typeof resolvedEntrySchema>;
export type DownloadCenterResolvedState = z.infer<typeof resolvedEnvelopeSchema>;

export type DownloadCenterResolvedLoadResult =
  | { status: 'missing' }
  | { status: 'corrupt' }
  | { status: 'valid'; state: DownloadCenterResolvedState };

export async function downloadCenterConfigFingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRegistryJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function loadDownloadCenterResolvedState(
  kv: KVNamespace
): Promise<DownloadCenterResolvedLoadResult> {
  let text: string | null;
  try {
    text = await kv.get(DOWNLOAD_CENTER_RESOLVED_KEY, 'text');
  } catch {
    return { status: 'corrupt' };
  }
  if (text === null) return { status: 'missing' };
  try {
    const parsed = resolvedEnvelopeSchema.safeParse(parseStrictJson(text));
    return parsed.success
      ? { status: 'valid', state: parsed.data }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

export async function persistDownloadCenterResolvedState(
  kv: KVNamespace,
  state: DownloadCenterResolvedState
): Promise<void> {
  const parsed = resolvedEnvelopeSchema.safeParse(state);
  if (!parsed.success) throw new Error('Invalid Download Center resolved state');
  await kv.put(DOWNLOAD_CENTER_RESOLVED_KEY, canonicalRegistryJson(parsed.data));
}

export async function readAvailableDownloads(
  kv: KVNamespace,
  now: number
): Promise<DownloadItem[]> {
  if (!Number.isSafeInteger(now) || now < 0) return [];
  const loaded = await loadDownloadCenterResolvedState(kv);
  if (loaded.status !== 'valid' || loaded.state.generatedAt > now) return [];
  return loaded.state.items.flatMap((item) =>
    item.data !== undefined &&
    item.resolvedAt !== undefined &&
    item.expiresAt !== undefined &&
    item.resolvedAt <= now &&
    now <= item.expiresAt
      ? [item.data]
      : []
  );
}
