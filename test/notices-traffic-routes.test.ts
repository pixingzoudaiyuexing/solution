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
    id: 7,
    title: 'Maintenance notice',
    content: '<p>Scheduled maintenance</p>',
    show: 1,
    img_url: 'https://private.example/banner.png',
    tags: ['maintenance'],
    created_at: 1704067200,
    updated_at: 1704153600,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/notices', () => {
  it('uses default pagination and omits detail-only and internal fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [upstreamNotice()], total: 1 })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/notices',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: '7',
            title: 'Maintenance notice',
            tags: ['maintenance'],
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      requestId: 'request-id',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Scheduled maintenance');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('show');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/notice/fetch?current=1&pageSize=100'
    );
  });

  it.each([
    ['custom public page', '?page=2&pageSize=25'],
    ['max public page size', '?page=1&pageSize=100'],
  ])('collects upstream before applying %s', async (_case, query) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      `/api/v1/notices${query}`,
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toContain(
      'current=1&pageSize=100'
    );
  });

  it('filters every lowercase reserved record and recomputes ordinary total', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamNotice({ id: 5, title: 'Normal 5', tags: ['news'] }),
          upstreamNotice({ id: 4, tags: ['aureole:unknown'] }),
          upstreamNotice({ id: 3, title: 'Normal 3', tags: null }),
          upstreamNotice({
            id: 2,
            content: 'https://custom.example',
            tags: ['aureole:iframe'],
          }),
          upstreamNotice({ id: 1, title: 'Normal 1', tags: [] }),
        ],
        total: 5,
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/notices?page=2&pageSize=2',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        items: [{ id: '1', title: 'Normal 1' }],
        page: 2,
        pageSize: 2,
        total: 3,
      },
    });
  });

  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=abc',
    '?page=2147483648',
    '?pageSize=0',
    '?pageSize=101',
    '?pageSize=1.5',
    '?pageSize=abc',
    '?page=1&page=2',
    '?unknown=1',
  ])('rejects invalid pagination %s before upstream', async (query) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      `/api/v1/notices${query}`,
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authorization before validating pagination', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/notices?page=bad', undefined, env);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/notices/:id', () => {
  it('returns content only in the detail DTO and strips the raw model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: upstreamNotice({ tags: null }) })
      )
    );
    const response = await app.request(
      '/api/v1/notices/7',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        id: '7',
        title: 'Maintenance notice',
        content: '<p>Scheduled maintenance</p>',
        tags: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      requestId: 'request-id',
    });
    expect(JSON.stringify(body)).not.toContain('private.example');
    expect(JSON.stringify(body)).not.toContain('show');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['0', '-1', '1.5', 'abc', '2147483648'])(
    'rejects invalid notice id %s before upstream',
    async (id) => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetcher);
      const response = await app.request(
        `/api/v1/notices/${encodeURIComponent(id)}`,
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['valid custom page', ['aureole:iframe']],
    ['invalid reserved config', ['aureole:unknown']],
  ])('hides %s detail as NOTICE_NOT_FOUND', async (_case, tags) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: upstreamNotice({
            content: 'https://custom.example',
            tags,
          }),
        })
      )
    );

    const response = await app.request(
      '/api/v1/notices/7',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOTICE_NOT_FOUND' },
    });
  });

  it('keeps a case-variant namespace tag ordinary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: upstreamNotice({ tags: ['Aureole:iframe'] }) })
      )
    );

    const response = await app.request(
      '/api/v1/notices/7',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: '7', tags: ['Aureole:iframe'] },
    });
  });

  it('normalizes not found, malformed detail, auth failure, and timeout', async () => {
    const cases = [
      [jsonResponse({ message: 'Notice not found' }, 404), 404, 'NOTICE_NOT_FOUND'],
      [jsonResponse({ data: upstreamNotice({ tags: 'bad' }) }), 502, 'UPSTREAM_ERROR'],
      [jsonResponse({ message: 'Session expired' }, 403), 401, 'AUTH_FAILED'],
    ] as const;
    for (const [upstream, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await app.request(
        '/api/v1/notices/7',
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).toContain(code);
      expect(text).not.toContain('Notice not found');
    }

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await app.request(
      '/api/v1/notices/7',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(timeout.status).toBe(504);
  });

  it('does not log notice content, the token, or upstream details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private notice failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/notices/7',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private notice failure');
    expect(logged).not.toContain('backend.example');
  });
});

describe('GET /api/v1/traffic/logs', () => {
  it('returns mapped facts in upstream order without user_id or derived traffic', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { u: 100, d: 200, record_at: 1704153600, user_id: 99, server_rate: '1.00' },
          { u: 50, d: 75, record_at: 1704067200, user_id: 99, server_rate: '2.50' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        entries: [
          {
            uploadedBytes: 100,
            downloadedBytes: 200,
            recordedAt: '2024-01-02T00:00:00.000Z',
            rateMultiplier: 1,
          },
          {
            uploadedBytes: 50,
            downloadedBytes: 75,
            recordedAt: '2024-01-01T00:00:00.000Z',
            rateMultiplier: 2.5,
          },
        ],
      },
      requestId: 'request-id',
    });
    const serialized = JSON.stringify(body);
    for (const field of ['user_id', 'totalBytes', 'ratedBytes', 'remainingBytes']) {
      expect(serialized).not.toContain(field);
    }
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/stat/getTrafficLog'
    );
  });

  it('returns an empty entry list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );
    const response = await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { entries: [] } });
  });

  it('requires authorization without contacting upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/traffic/logs', undefined, env);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes malformed data, auth failure, timeout, and hides upstream details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: [{ u: -1, d: 2, record_at: 1, user_id: 99, server_rate: '1.00' }] })
      )
    );
    let response = await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(502);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Session expired' }, 403))
    );
    response = await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer invalid-token' } },
      env
    );
    expect(response.status).toBe(401);

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(504);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private traffic failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/traffic/logs',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private traffic failure');
    expect(logged).not.toContain('backend.example');
  });
});
