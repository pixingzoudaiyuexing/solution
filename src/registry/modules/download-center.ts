import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const DOWNLOAD_CENTER_MODULE_ID = 'download-center';
export const DOWNLOAD_CENTER_MAX_ITEMS = 50;
export const DOWNLOAD_CENTER_MAX_MIRRORS = 8;
export const DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES = 8;
export const DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS = 168 * 60 * 60;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UNSAFE_PLAIN_TEXT = /[<>\u0000-\u001f\u007f-\u009f]/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9._-])?$/;
const ALLOWED_MIRROR_PLACEHOLDERS = new Set([
  '{owner}',
  '{repo}',
  '{tag}',
  '{filename}',
]);

function plainTextSchema(maxLength: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !UNSAFE_PLAIN_TEXT.test(value));
}

const presentationMetadataSchema = plainTextSchema(64);
const matcherLiteralSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !CONTROL.test(value));

export interface GitHubRepositoryIdentity {
  owner: string;
  repo: string;
}

export function parseGitHubRepository(
  value: string
): GitHubRepositoryIdentity | null {
  if (value.length > 140 || value.trim() !== value) return null;
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    !GITHUB_OWNER.test(parts[0]) ||
    !GITHUB_REPOSITORY.test(parts[1]) ||
    parts[1] === '.' ||
    parts[1] === '..'
  ) {
    return null;
  }
  return { owner: parts[0], repo: parts[1] };
}

const repositorySchema = z
  .string()
  .min(3)
  .max(140)
  .refine((value) => parseGitHubRepository(value) !== null);

function substituteMirrorTemplate(
  template: string,
  values: GitHubRepositoryIdentity & { tag: string; filename: string }
): string {
  return template
    .replaceAll('{owner}', encodeURIComponent(values.owner))
    .replaceAll('{repo}', encodeURIComponent(values.repo))
    .replaceAll('{tag}', encodeURIComponent(values.tag))
    .replaceAll('{filename}', encodeURIComponent(values.filename));
}

function safeHttpsUrl(value: string): boolean {
  if (value.length > 2048 || CONTROL.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function isValidMirrorTemplate(value: string): boolean {
  if (value.length === 0 || value.length > 2048 || CONTROL.test(value)) {
    return false;
  }
  const placeholders = value.match(/\{[^{}]*\}/g) ?? [];
  if (placeholders.some((placeholder) => !ALLOWED_MIRROR_PLACEHOLDERS.has(placeholder))) {
    return false;
  }
  const withoutAllowed = value.replace(/\{(?:owner|repo|tag|filename)\}/g, 'x');
  if (/[{}]/.test(withoutAllowed)) return false;
  return safeHttpsUrl(
    substituteMirrorTemplate(value, {
      owner: 'owner',
      repo: 'repo',
      tag: 'v1.0.0',
      filename: 'client.dmg',
    })
  );
}

export function renderMirrorUrl(
  template: string,
  values: GitHubRepositoryIdentity & { tag: string; filename: string }
): string {
  if (!isValidMirrorTemplate(template)) {
    throw new Error('Invalid mirror template');
  }
  const rendered = substituteMirrorTemplate(template, values);
  if (!safeHttpsUrl(rendered)) throw new Error('Invalid rendered mirror URL');
  return rendered;
}

const mirrorSchema = z
  .object({
    id: z.string().refine(isStableId),
    label: plainTextSchema(160),
    template: z.string().refine(isValidMirrorTemplate),
  })
  .strict();

const assetMatchSchema = z
  .object({
    prefix: matcherLiteralSchema.nullable(),
    suffix: matcherLiteralSchema.nullable(),
    contains: z.array(matcherLiteralSchema).max(DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES),
    include: z.array(matcherLiteralSchema).max(DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES),
    exclude: z.array(matcherLiteralSchema).max(DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES),
  })
  .strict();

const githubSchema = z
  .object({
    repository: repositorySchema,
    release: z.literal('latest'),
    assetMatch: assetMatchSchema,
  })
  .strict();

const labelSchema = z.object({ default: plainTextSchema(160) }).strict();

const downloadItemBaseSchema = z
  .object({
    id: z.string().refine(isStableId),
    enabled: z.boolean(),
    label: labelSchema,
    audience: z.literal('public'),
    platform: presentationMetadataSchema.optional(),
    arch: presentationMetadataSchema.optional(),
    github: githubSchema,
    refreshHours: z.number().int().min(1).max(168),
    maxStaleHours: z.number().int().min(1).max(168),
    mirrors: z.array(mirrorSchema).max(DOWNLOAD_CENTER_MAX_MIRRORS),
  })
  .strict();

function validateDownloadItemBounds(
  item: {
    refreshHours: number;
    maxStaleHours: number;
    mirrors: Array<{ id: string }>;
  },
  ctx: z.RefinementCtx
): void {
    if (item.maxStaleHours < item.refreshHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxStaleHours'],
        message: 'maxStaleHours must not be lower than refreshHours',
      });
    }
    const mirrorIds = item.mirrors.map((mirror) => mirror.id);
    if (new Set(mirrorIds).size !== mirrorIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mirrors'],
        message: 'Duplicate mirror id',
      });
    }
}

const downloadItemSchema = downloadItemBaseSchema.superRefine(
  validateDownloadItemBounds
);

export const downloadCenterConfigSchema = z
  .object({
    items: z.array(downloadItemSchema).max(DOWNLOAD_CENTER_MAX_ITEMS),
  })
  .strict();

export type DownloadCenterRegistryConfig = z.infer<
  typeof downloadCenterConfigSchema
>;
export type DownloadCenterRegistryItem = DownloadCenterRegistryConfig['items'][number];

const downloadItemSnapshotSchema = downloadItemBaseSchema
  .omit({ enabled: true })
  .superRefine(validateDownloadItemBounds);

export const downloadCenterSnapshotSchema = z
  .object({
    items: z.array(downloadItemSnapshotSchema).max(DOWNLOAD_CENTER_MAX_ITEMS),
  })
  .strict();

export type DownloadCenterSnapshot = z.infer<typeof downloadCenterSnapshotSchema>;
export type DownloadCenterItemConfig = DownloadCenterSnapshot['items'][number];

export const downloadCenterRegistryDefinition: RegistryModuleDefinition<DownloadCenterRegistryConfig> = {
  moduleId: DOWNLOAD_CENTER_MODULE_ID,
  schemaVersion: 1,
  configSchema: downloadCenterConfigSchema,
  maximumExposure: 'public',
  getItemIds: (config) => config.items.map((item) => item.id),
};

export const downloadCenterOperationalDefinition: RegistryOperationalModuleDefinition<
  DownloadCenterRegistryConfig,
  DownloadCenterSnapshot
> = {
  registryDefinition: downloadCenterRegistryDefinition,
  freshness: {
    class: 'STALE_TOLERANT',
    maxStaleAgeSeconds: DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS,
  },
  snapshotSchema: downloadCenterSnapshotSchema,
  projectSnapshot: (config) => ({
    items: config.items
      .filter((item) => item.enabled)
      .map(({ enabled: _enabled, ...item }) => item),
  }),
};
