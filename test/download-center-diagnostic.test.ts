import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_CENTER_DIAGNOSTIC_KEY,
  DOWNLOAD_CENTER_DIAGNOSTIC_MAX_ELAPSED_MS,
  DOWNLOAD_CENTER_DIAGNOSTIC_MAX_REPOSITORIES,
  downloadCenterDiagnosticStateSchema,
  loadDownloadCenterDiagnosticState,
  persistDownloadCenterDiagnosticState,
} from '../src/registry/download-center-diagnostic';
import { FakeKV } from './helpers/fake-kv';

const success = {
  repository: 'owner/repo',
  attemptedAt: 1_000,
  elapsedMs: 125,
  status: 'success' as const,
};

describe('Download Center repository diagnostics', () => {
  it('uses the fixed internal key and persists strict success/error records', async () => {
    const kv = new FakeKV();
    const state = {
      schemaVersion: 1 as const,
      checkedAt: 2_000,
      repositories: [
        success,
        {
          repository: 'other/repo',
          attemptedAt: 1_500,
          elapsedMs: 10_000,
          status: 'error' as const,
          errorCode: 'TIMEOUT' as const,
        },
        {
          repository: 'redirect/repo',
          attemptedAt: 1_600,
          elapsedMs: 20,
          status: 'error' as const,
          errorCode: 'HTTP_REDIRECT' as const,
          httpStatus: 302,
        },
        {
          repository: 'error/repo',
          attemptedAt: 1_700,
          elapsedMs: 30,
          status: 'error' as const,
          errorCode: 'HTTP_ERROR' as const,
          httpStatus: 500,
        },
        {
          repository: 'limited/repo',
          attemptedAt: 1_800,
          elapsedMs: 40,
          status: 'error' as const,
          errorCode: 'RATE_LIMITED' as const,
          httpStatus: 429 as const,
        },
        {
          repository: 'limited-old/repo',
          attemptedAt: 1_850,
          elapsedMs: 0,
          status: 'error' as const,
          errorCode: 'RATE_LIMITED' as const,
        },
        {
          repository: 'legacy/repo',
          attemptedAt: 1_900,
          elapsedMs: 0,
          status: 'error' as const,
          errorCode: 'UPSTREAM_ERROR' as const,
        },
      ],
    };

    await persistDownloadCenterDiagnosticState(kv.binding(), state);

    expect(DOWNLOAD_CENTER_DIAGNOSTIC_KEY).toBe(
      'registry:download-center:diagnostic:v1'
    );
    await expect(loadDownloadCenterDiagnosticState(kv.binding())).resolves.toEqual({
      status: 'valid',
      state,
    });
  });

  it.each([
    ['future schema', { schemaVersion: 2, checkedAt: 2_000, repositories: [] }],
    ['unknown envelope field', { schemaVersion: 1, checkedAt: 2_000, repositories: [], extra: true }],
    ['uppercase repository', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, repository: 'Owner/Repo' }] }],
    ['repository URL', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, repository: 'https://github.com/owner/repo' }] }],
    ['duplicate repository', { schemaVersion: 1, checkedAt: 2_000, repositories: [success, success] }],
    ['negative elapsed', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, elapsedMs: -1 }] }],
    ['fractional elapsed', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, elapsedMs: 1.5 }] }],
    ['unbounded elapsed', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, elapsedMs: DOWNLOAD_CENTER_DIAGNOSTIC_MAX_ELAPSED_MS + 1 }] }],
    ['attempt after check', { schemaVersion: 1, checkedAt: 999, repositories: [success] }],
    ['success with error code', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, errorCode: 'TIMEOUT' }] }],
    ['success with HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, httpStatus: 200 }] }],
    ['error without code', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error' }] }],
    ['unknown error code', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'OTHER' }] }],
    ['fetch rejection with HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'FETCH_REJECTED', httpStatus: 500 }] }],
    ['timeout with HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'TIMEOUT', httpStatus: 504 }] }],
    ['invalid response with HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'INVALID_RESPONSE', httpStatus: 200 }] }],
    ['oversize with HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'RESPONSE_TOO_LARGE', httpStatus: 200 }] }],
    ['redirect missing HTTP status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_REDIRECT' }] }],
    ['redirect outside range', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_REDIRECT', httpStatus: 404 }] }],
    ['HTTP error missing status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_ERROR' }] }],
    ['HTTP error with success status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_ERROR', httpStatus: 200 }] }],
    ['HTTP error with redirect status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_ERROR', httpStatus: 302 }] }],
    ['HTTP error with rate limit status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'HTTP_ERROR', httpStatus: 403 }] }],
    ['rate limit with arbitrary status', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, status: 'error', errorCode: 'RATE_LIMITED', httpStatus: 500 }] }],
    ['unknown repository field', { schemaVersion: 1, checkedAt: 2_000, repositories: [{ ...success, message: 'raw error' }] }],
    ['too many repositories', {
      schemaVersion: 1,
      checkedAt: 2_000,
      repositories: Array.from(
        { length: DOWNLOAD_CENTER_DIAGNOSTIC_MAX_REPOSITORIES + 1 },
        (_, index) => ({ ...success, repository: `owner/repo-${index}` })
      ),
    }],
  ])('rejects %s', (_case, value) => {
    expect(downloadCenterDiagnosticStateSchema.safeParse(value).success).toBe(false);
  });

  it('fails corrupt state independently', async () => {
    const kv = new FakeKV();
    kv.values.set(DOWNLOAD_CENTER_DIAGNOSTIC_KEY, '{bad-json');
    await expect(loadDownloadCenterDiagnosticState(kv.binding())).resolves.toEqual({
      status: 'corrupt',
    });
  });
});
