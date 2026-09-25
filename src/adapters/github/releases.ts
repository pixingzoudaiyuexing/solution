import { z } from 'zod';
import { cancelUnusedResponseBody } from '../../http/response-body';
import {
  parseGitHubRepository,
  type GitHubRepositoryIdentity,
} from '../../registry/modules/download-center';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_RELEASE_TIMEOUT_MS = 10_000;
export const GITHUB_RELEASE_MAX_BODY_BYTES = 512 * 1024;
export const GITHUB_RELEASE_MAX_ASSETS = 100;
export const GITHUB_RELEASE_MAX_TAG_LENGTH = 128;
export const GITHUB_RELEASE_MAX_ASSET_NAME_LENGTH = 255;
export const GITHUB_RELEASE_MAX_URL_LENGTH = 2048;

export type GitHubReleaseErrorCode =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'FETCH_REJECTED'
  | 'HTTP_REDIRECT'
  | 'HTTP_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

export class GitHubReleaseError extends Error {
  declare readonly httpStatus?: number;

  constructor(
    readonly code: GitHubReleaseErrorCode,
    httpStatus?: number
  ) {
    super(`GitHub release resolution failed: ${code}`);
    this.name = 'GitHubReleaseError';
    const validatedStatus = validateErrorHttpStatus(code, httpStatus);
    if (validatedStatus !== undefined) {
      this.httpStatus = validatedStatus;
    }
  }
}

function validHttpStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function validHttpErrorStatus(status: number): boolean {
  return (
    (status >= 100 && status < 200) ||
    (status >= 400 && status <= 599 && status !== 403 && status !== 429)
  );
}

function validateErrorHttpStatus(
  code: GitHubReleaseErrorCode,
  httpStatus: number | undefined
): number | undefined {
  if (code === 'HTTP_REDIRECT') {
    if (!validHttpStatus(httpStatus) || httpStatus < 300 || httpStatus >= 400) {
      throw new Error('Invalid GitHub redirect status');
    }
    return httpStatus;
  }
  if (code === 'HTTP_ERROR') {
    if (!validHttpStatus(httpStatus) || !validHttpErrorStatus(httpStatus)) {
      throw new Error('Invalid GitHub HTTP error status');
    }
    return httpStatus;
  }
  if (code === 'RATE_LIMITED') {
    if (
      httpStatus !== undefined &&
      (!validHttpStatus(httpStatus) || (httpStatus !== 403 && httpStatus !== 429))
    ) {
      throw new Error('Invalid GitHub rate-limit status');
    }
    return httpStatus;
  }
  if (httpStatus !== undefined) {
    throw new Error('GitHub error code does not allow an HTTP status');
  }
  return undefined;
}

export interface GitHubReleaseAsset {
  name: string;
  downloadUrl: string;
  sizeBytes: number;
}

export interface GitHubLatestRelease {
  repository: GitHubRepositoryIdentity;
  tagName: string;
  publishedAt: string | null;
  assets: GitHubReleaseAsset[];
}

const UNSAFE_PRESENTATION_TEXT = /[<>\u0000-\u001f\u007f-\u009f]/;
const tagSchema = z
  .string()
  .min(1)
  .max(GITHUB_RELEASE_MAX_TAG_LENGTH)
  .refine((value) => !UNSAFE_PRESENTATION_TEXT.test(value));
const assetNameSchema = z
  .string()
  .min(1)
  .max(GITHUB_RELEASE_MAX_ASSET_NAME_LENGTH)
  .refine((value) => !UNSAFE_PRESENTATION_TEXT.test(value));
const assetSchema = z.object({
  name: assetNameSchema,
  browser_download_url: z.string().min(1).max(GITHUB_RELEASE_MAX_URL_LENGTH),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const releaseSchema = z.object({
  tag_name: tagSchema,
  published_at: z.string().max(64).nullable().optional(),
  assets: z.array(assetSchema).max(GITHUB_RELEASE_MAX_ASSETS),
});

function normalizedPublishedAt(value: string | null | undefined): string | null {
  if (value == null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new GitHubReleaseError('INVALID_RESPONSE');
  return new Date(timestamp).toISOString();
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new GitHubReleaseError('INVALID_RESPONSE');
    }
    if (length > GITHUB_RELEASE_MAX_BODY_BYTES) {
      await cancelUnusedResponseBody(response);
      throw new GitHubReleaseError('RESPONSE_TOO_LARGE');
    }
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > GITHUB_RELEASE_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new GitHubReleaseError('RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new GitHubReleaseError('INVALID_RESPONSE');
  }
}

function releaseEndpoint(repository: GitHubRepositoryIdentity): string {
  return `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/releases/latest`;
}

export class GitHubReleasesAdapter {
  private readonly fetcher: typeof fetch;

  constructor(
    fetcher: typeof fetch = fetch,
    private readonly timeoutMs = GITHUB_RELEASE_TIMEOUT_MS
  ) {
    this.fetcher = (input, init) => fetcher(input, init);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Invalid GitHub timeout');
    }
  }

  async latest(repositoryValue: string): Promise<GitHubLatestRelease> {
    const repository = parseGitHubRepository(repositoryValue);
    if (!repository) throw new GitHubReleaseError('INVALID_RESPONSE');

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new GitHubReleaseError('TIMEOUT'));
      }, this.timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        this.fetcher(releaseEndpoint(repository), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'solution-download-center/1.0',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error instanceof GitHubReleaseError) throw error;
      if (controller.signal.aborted) throw new GitHubReleaseError('TIMEOUT');
      throw new GitHubReleaseError('FETCH_REJECTED');
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      await cancelUnusedResponseBody(response);
      throw new GitHubReleaseError('HTTP_REDIRECT', response.status);
    }
    if (response.status === 403 || response.status === 429) {
      await cancelUnusedResponseBody(response);
      throw new GitHubReleaseError('RATE_LIMITED', response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      await cancelUnusedResponseBody(response);
      throw new GitHubReleaseError('HTTP_ERROR', response.status);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      await cancelUnusedResponseBody(response);
      throw new GitHubReleaseError('INVALID_RESPONSE');
    }

    const body = await readBoundedBody(response);
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      throw new GitHubReleaseError('INVALID_RESPONSE');
    }
    const parsed = releaseSchema.safeParse(value);
    if (!parsed.success) throw new GitHubReleaseError('INVALID_RESPONSE');

    return {
      repository,
      tagName: parsed.data.tag_name,
      publishedAt: normalizedPublishedAt(parsed.data.published_at),
      assets: parsed.data.assets.map((asset) => ({
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        sizeBytes: asset.size,
      })),
    };
  }
}
