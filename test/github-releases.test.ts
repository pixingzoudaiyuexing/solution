import { describe, expect, it, vi } from 'vitest';
import {
  GITHUB_API_ORIGIN,
  GITHUB_RELEASE_MAX_ASSETS,
  GITHUB_RELEASE_MAX_BODY_BYTES,
  GitHubReleaseError,
  GitHubReleasesAdapter,
  type GitHubReleaseErrorCode,
} from '../src/adapters/github/releases';

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.3',
    published_at: '2026-09-25T00:00:00Z',
    assets: [
      {
        name: 'client-arm64.dmg',
        browser_download_url:
          'https://github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
        size: 123,
      },
    ],
    ignored_raw_field: 'RAW_GITHUB_SENTINEL',
    ...overrides,
  };
}

async function expectError(
  promise: Promise<unknown>,
  expected: { code: GitHubReleaseErrorCode; httpStatus?: number }
) {
  await expect(promise).rejects.toMatchObject(
    expected satisfies Partial<GitHubReleaseError>
  );
}

describe('fixed GitHub Releases adapter', () => {
  it('wraps receiver-sensitive fetch injection as a bare call', async () => {
    const receivers: unknown[] = [];
    const receiverSensitiveFetch = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> {
      receivers.push(this);
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(response(release()));
    } as typeof fetch;

    const oldHolder = { fetcher: receiverSensitiveFetch };
    expect(() => oldHolder.fetcher('https://api.github.com')).toThrow(
      'Illegal invocation'
    );
    receivers.length = 0;

    await expect(
      new GitHubReleasesAdapter(receiverSensitiveFetch).latest('owner/repo')
    ).resolves.toMatchObject({ tagName: 'v1.2.3' });
    expect(receivers).toEqual([undefined]);
  });

  it('uses only the code-owned latest-release endpoint, manual redirects, and fixed headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(release()));
    const result = await new GitHubReleasesAdapter(fetcher).latest('owner/repo');

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      `${GITHUB_API_ORIGIN}/repos/owner/repo/releases/latest`
    );
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('accept')).toBe('application/vnd.github+json');
    expect(new Headers(init.headers).get('user-agent')).toBe('solution-download-center/1.0');
    expect(result).toEqual({
      repository: { owner: 'owner', repo: 'repo' },
      tagName: 'v1.2.3',
      publishedAt: '2026-09-25T00:00:00.000Z',
      assets: [
        {
          name: 'client-arm64.dmg',
          downloadUrl:
            'https://github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
          sizeBytes: 123,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('RAW_GITHUB_SENTINEL');
  });

  it('classifies a non-timeout fetch rejection without raw Error metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('private network sentinel'));
    const promise = new GitHubReleasesAdapter(fetcher).latest('owner/repo');

    await expectError(promise, { code: 'FETCH_REJECTED' });
    await expect(promise).rejects.not.toHaveProperty('httpStatus');
    await expect(promise).rejects.not.toHaveProperty('cause');
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('private network sentinel')
    );
  });

  it.each([301, 302] as const)('does not follow and classifies HTTP %s redirects', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response('', status, { Location: 'https://attacker.example' })
    );
    await expectError(new GitHubReleasesAdapter(fetcher).latest('owner/repo'), {
      code: 'HTTP_REDIRECT',
      httpStatus: status,
    });
    expect((fetcher.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
  });

  it('enforces a bounded timeout', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const promise = new GitHubReleasesAdapter(fetcher, 5).latest('owner/repo');
    await expectError(promise, { code: 'TIMEOUT' });
    await expect(promise).rejects.not.toHaveProperty('httpStatus');
  });

  it.each([
    [403, 'RATE_LIMITED'],
    [429, 'RATE_LIMITED'],
    [404, 'HTTP_ERROR'],
    [500, 'HTTP_ERROR'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, status));
    await expectError(new GitHubReleasesAdapter(fetcher).latest('owner/repo'), {
      code,
      httpStatus: status,
    });
  });

  it.each([
    ['non-JSON content type', new Response('{}', { headers: { 'Content-Type': 'text/plain' } })],
    ['malformed JSON', response('{bad-json')],
    ['malformed structure', response({ tag_name: 'v1', assets: null })],
  ])('rejects %s', async (_case, outcome) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(outcome);
    const promise = new GitHubReleasesAdapter(fetcher).latest('owner/repo');
    await expectError(promise, { code: 'INVALID_RESPONSE' });
    await expect(promise).rejects.not.toHaveProperty('httpStatus');
  });

  it('rejects a declared oversized response before normalization', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response('{}', 200, { 'Content-Length': String(GITHUB_RELEASE_MAX_BODY_BYTES + 1) })
    );
    const promise = new GitHubReleasesAdapter(fetcher).latest('owner/repo');
    await expectError(promise, { code: 'RESPONSE_TOO_LARGE' });
    await expect(promise).rejects.not.toHaveProperty('httpStatus');
  });

  it('rejects a streamed oversized response', async () => {
    const bytes = new Uint8Array(GITHUB_RELEASE_MAX_BODY_BYTES + 1);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, { headers: { 'Content-Type': 'application/json' } })
    );
    await expectError(new GitHubReleasesAdapter(fetcher).latest('owner/repo'), {
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('rejects excessive asset counts and overlong relevant fields', async () => {
    const tooMany = Array.from({ length: GITHUB_RELEASE_MAX_ASSETS + 1 }, (_, index) => ({
      name: `asset-${index}`,
      browser_download_url: `https://github.com/owner/repo/releases/download/v1/asset-${index}`,
      size: 1,
    }));
    await expectError(
      new GitHubReleasesAdapter(vi.fn<typeof fetch>().mockResolvedValue(response(release({ assets: tooMany })))).latest('owner/repo'),
      { code: 'INVALID_RESPONSE' }
    );
    await expectError(
      new GitHubReleasesAdapter(vi.fn<typeof fetch>().mockResolvedValue(response(release({ tag_name: 'x'.repeat(129) })))).latest('owner/repo'),
      { code: 'INVALID_RESPONSE' }
    );
    await expectError(
      new GitHubReleasesAdapter(vi.fn<typeof fetch>().mockResolvedValue(response(release({ assets: [{ name: 'x'.repeat(256), browser_download_url: 'https://github.com/owner/repo/releases/download/v1/x', size: 1 }] })))).latest('owner/repo'),
      { code: 'INVALID_RESPONSE' }
    );
    await expectError(
      new GitHubReleasesAdapter(vi.fn<typeof fetch>().mockResolvedValue(response(release({ tag_name: '<script>' })))).latest('owner/repo'),
      { code: 'INVALID_RESPONSE' }
    );
    await expectError(
      new GitHubReleasesAdapter(vi.fn<typeof fetch>().mockResolvedValue(response(release({ assets: [{ name: '<client>.dmg', browser_download_url: 'https://github.com/owner/repo/releases/download/v1/%3Cclient%3E.dmg', size: 1 }] })))).latest('owner/repo'),
      { code: 'INVALID_RESPONSE' }
    );
  });

  it.each([
    ['redirect without status', () => new GitHubReleaseError('HTTP_REDIRECT')],
    ['redirect with non-redirect status', () => new GitHubReleaseError('HTTP_REDIRECT', 500)],
    ['HTTP error without status', () => new GitHubReleaseError('HTTP_ERROR')],
    ['HTTP error with rate-limit status', () => new GitHubReleaseError('HTTP_ERROR', 429)],
    ['fetch rejection with status', () => new GitHubReleaseError('FETCH_REJECTED', 500)],
    ['rate limit with arbitrary status', () => new GitHubReleaseError('RATE_LIMITED', 500)],
  ])('rejects invalid error construction: %s', (_case, factory) => {
    expect(factory).toThrow();
  });
});
