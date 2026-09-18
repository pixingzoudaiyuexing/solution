import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function upstreamNotice(overrides: Record<string, unknown> = {}) {
  return {
    id: 6,
    title: ' Custom page ',
    content: ' https://custom.example:8443/docs?a=1#intro ',
    show: 1,
    img_url: 'https://private.example/banner.png',
    tags: ['ordinary', 'aureole:iframe'],
    created_at: 1704067200,
    updated_at: 1704153600,
    internal: 'must-not-leak',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/custom-pages', () => {
  it('requires Bearer authorization without contacting upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/custom-pages', undefined, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns the neutral strict DTO with no-store', async () => {
    const target = 'https://custom.example:8443/docs?a=1#intro';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [upstreamNotice()], total: 1 })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/custom-pages',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
        },
      },
      env
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: 'notice-6',
            title: 'Custom page',
            url: target,
            mode: 'iframe',
          },
        ],
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const value of [
      'ordinary',
      'aureole:iframe',
      'private.example',
      'createdAt',
      'updatedAt',
      'content',
    ]) {
      expect(text).not.toContain(value);
    }
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://backend.example/api/v1/user/notice/fetch?current=1&pageSize=100',
    ]);
    expect(String(fetcher.mock.calls[0][0])).not.toContain('custom.example');
  });

  it.each([401, 403])('maps upstream auth status %s to AUTH_FAILED', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'private' }, status))
    );

    const response = await app.request(
      '/api/v1/custom-pages',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
  });

  it('normalizes structural corruption and hides the target/content from logs', async () => {
    const target = 'https://sensitive-target.example/path';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [upstreamNotice({ content: target, tags: 'bad' })],
          total: 1,
        })
      )
    );

    const response = await app.request(
      '/api/v1/custom-pages',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain('UPSTREAM_ERROR');
    expect(text).not.toContain(target);
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain(target);
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('backend.example');
  });

  it('maps timeout without retry or target probing', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/custom-pages',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
