import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const DOWNLOAD_CENTER_MODULE_ID = 'download-center';
export const DOWNLOAD_CENTER_MAX_ITEMS = 50;
export const DOWNLOAD_CENTER_MAX_PROVIDERS = 8;
export const DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES = 8;
export const DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS = 168 * 60 * 60;
export const DOWNLOAD_PROVIDER_BASE_URL_MAX_LENGTH = 2048;
export const DOWNLOAD_PROVIDER_OUTPUT_URL_MAX_LENGTH = 4096;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UNSAFE_PLAIN_TEXT = /[<>\u0000-\u001f\u007f-\u009f]/;
const UNSAFE_PROVIDER_SYNTAX = /[{}\\`]/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9._-])?$/;

function plainTextSchema(maxLength: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !UNSAFE_PLAIN_TEXT.test(value));
}

const matcherLiteralSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !CONTROL.test(value));
const stableIdSchema = z.string().refine(isStableId);
const defaultProviderIdsSchema = z.tuple([stableIdSchema, stableIdSchema]);

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

export function normalizedGitHubRepositoryKey(value: string): string | null {
  const repository = parseGitHubRepository(value);
  return repository
    ? `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`
    : null;
}

const repositorySchema = z
  .string()
  .min(3)
  .max(140)
  .refine((value) => parseGitHubRepository(value) !== null);

export function normalizeDownloadProviderBaseUrl(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > DOWNLOAD_PROVIDER_BASE_URL_MAX_LENGTH ||
    CONTROL.test(value) ||
    UNSAFE_PROVIDER_SYNTAX.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.hostname.length === 0 ||
      url.username.length !== 0 ||
      url.password.length !== 0 ||
      url.search.length !== 0 ||
      url.hash.length !== 0 ||
      !url.pathname.endsWith('/') ||
      hostname === 'github.com' ||
      hostname === 'api.github.com'
    ) {
      return null;
    }
    const normalized = url.toString();
    return normalized.length <= DOWNLOAD_PROVIDER_BASE_URL_MAX_LENGTH
      ? normalized
      : null;
  } catch {
    return null;
  }
}

const providerBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOWNLOAD_PROVIDER_BASE_URL_MAX_LENGTH)
  .transform((value, ctx) => {
    const normalized = normalizeDownloadProviderBaseUrl(value);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid download provider base URL',
      });
      return z.NEVER;
    }
    return normalized;
  });

export function renderGithubUrlPrefixDownload(
  baseUrl: string,
  githubDownloadUrl: string
): string {
  const normalizedBaseUrl = normalizeDownloadProviderBaseUrl(baseUrl);
  if (normalizedBaseUrl === null || normalizedBaseUrl !== baseUrl) {
    throw new Error('Invalid download provider base URL');
  }
  let source: URL;
  try {
    source = new URL(githubDownloadUrl);
  } catch {
    throw new Error('Invalid GitHub download URL');
  }
  if (
    source.protocol !== 'https:' ||
    source.hostname.toLowerCase() !== 'github.com' ||
    source.port !== '' ||
    source.username !== '' ||
    source.password !== '' ||
    source.search !== '' ||
    source.hash !== '' ||
    !source.pathname.includes('/releases/download/')
  ) {
    throw new Error('Invalid GitHub download URL');
  }
  const rendered = `${normalizedBaseUrl}${githubDownloadUrl}`;
  if (rendered.length > DOWNLOAD_PROVIDER_OUTPUT_URL_MAX_LENGTH) {
    throw new Error('Rendered download URL is too long');
  }
  const parsed = new URL(rendered);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !rendered.endsWith(githubDownloadUrl)
  ) {
    throw new Error('Invalid rendered download URL');
  }
  return rendered;
}

const downloadProviderBaseSchema = z
  .object({
    id: stableIdSchema,
    enabled: z.boolean(),
    label: plainTextSchema(160),
    type: z.literal('github-url-prefix'),
    baseUrl: providerBaseUrlSchema,
  })
  .strict();
const downloadProviderSnapshotSchema = downloadProviderBaseSchema.omit({
  enabled: true,
});

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
    id: stableIdSchema,
    enabled: z.boolean(),
    label: labelSchema,
    audience: z.literal('public'),
    platform: z.enum(['windows', 'macos', 'android', 'linux']),
    arch: plainTextSchema(64).optional(),
    github: githubSchema,
    refreshHours: z.number().int().min(1).max(168),
    maxStaleHours: z.number().int().min(1).max(168),
  })
  .strict();

function validateDownloadItemBounds(
  item: { refreshHours: number; maxStaleHours: number },
  ctx: z.RefinementCtx
): void {
  if (item.maxStaleHours < item.refreshHours) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxStaleHours'],
      message: 'maxStaleHours must not be lower than refreshHours',
    });
  }
}

const downloadItemSchema = downloadItemBaseSchema.superRefine(
  validateDownloadItemBounds
);
const downloadItemSnapshotSchema = downloadItemBaseSchema
  .omit({ enabled: true })
  .superRefine(validateDownloadItemBounds);

function validateProviderIds(
  providers: ReadonlyArray<{ id: string }>,
  defaultIds: readonly [string, string],
  ctx: z.RefinementCtx,
  enabledIds?: ReadonlySet<string>
): void {
  const ids = providers.map((provider) => provider.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['downloadProviders'],
      message: 'Duplicate download provider id',
    });
  }
  if (defaultIds[0] === defaultIds[1]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultDownloadProviderIds'],
      message: 'Default download providers must be distinct',
    });
  }
  const providerIds = new Set(ids);
  for (const [index, id] of defaultIds.entries()) {
    if (!providerIds.has(id) || (enabledIds !== undefined && !enabledIds.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultDownloadProviderIds', index],
        message: 'Default download provider is missing or disabled',
      });
    }
  }
}

export const downloadCenterConfigSchema = z
  .object({
    downloadProviders: z
      .array(downloadProviderBaseSchema)
      .max(DOWNLOAD_CENTER_MAX_PROVIDERS),
    defaultDownloadProviderIds: defaultProviderIdsSchema,
    items: z.array(downloadItemSchema).max(DOWNLOAD_CENTER_MAX_ITEMS),
  })
  .strict()
  .superRefine((config, ctx) => {
    validateProviderIds(
      config.downloadProviders,
      config.defaultDownloadProviderIds,
      ctx,
      new Set(
        config.downloadProviders
          .filter((provider) => provider.enabled)
          .map((provider) => provider.id)
      )
    );
  });

export type DownloadCenterRegistryConfig = z.infer<
  typeof downloadCenterConfigSchema
>;

export const downloadCenterSnapshotSchema = z
  .object({
    downloadProviders: z
      .array(downloadProviderSnapshotSchema)
      .max(DOWNLOAD_CENTER_MAX_PROVIDERS),
    defaultDownloadProviderIds: defaultProviderIdsSchema,
    items: z.array(downloadItemSnapshotSchema).max(DOWNLOAD_CENTER_MAX_ITEMS),
  })
  .strict()
  .superRefine((config, ctx) => {
    validateProviderIds(
      config.downloadProviders,
      config.defaultDownloadProviderIds,
      ctx
    );
  });

export type DownloadCenterSnapshot = z.infer<typeof downloadCenterSnapshotSchema>;
export type DownloadCenterItemConfig = DownloadCenterSnapshot['items'][number];
export type DownloadProviderConfig = DownloadCenterSnapshot['downloadProviders'][number];
export type SelectedDownloadProviders = readonly [
  DownloadProviderConfig,
  DownloadProviderConfig,
];

export function getDefaultDownloadProviders(
  config: DownloadCenterSnapshot
): SelectedDownloadProviders {
  const providers = new Map(
    config.downloadProviders.map((provider) => [provider.id, provider])
  );
  const first = providers.get(config.defaultDownloadProviderIds[0]);
  const second = providers.get(config.defaultDownloadProviderIds[1]);
  if (!first || !second || first.id === second.id) {
    throw new Error('Invalid default download providers');
  }
  return [first, second];
}

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
    downloadProviders: config.downloadProviders
      .filter((provider) => provider.enabled)
      .map(({ enabled: _enabled, ...provider }) => provider),
    defaultDownloadProviderIds: config.defaultDownloadProviderIds,
    items: config.items
      .filter((item) => item.enabled)
      .map(({ enabled: _enabled, ...item }) => item),
  }),
};
