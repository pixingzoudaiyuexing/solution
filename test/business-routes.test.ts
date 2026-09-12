import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function authorizedRequest(path: string): Promise<Response> {
  return app.request(
    path,
    {
      headers: {
        Authorization: 'Bearer opaque-token',
        'cf-ray': 'request-id',
      },
    },
    env
  );
}

function upstreamPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    group_id: 2,
    transfer_enable: 100,
    name: 'Pro Plan',
    speed_limit: null,
    content: '<b>internal html</b>',
    month_price: 990,
    quarter_price: null,
    half_year_price: null,
    year_price: 9990,
    two_year_price: null,
    three_year_price: null,
    onetime_price: 19990,
    reset_price: 100,
    capacity_limit: 8,
    device_limit: 3,
    show: 1,
    renew: 1,
    sort: 2,
    created_at: 1700000000,
    updated_at: 1700000100,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/products', () => {
  it('maps V2Board plans to the public product contract', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 7,
            group_id: 2,
            transfer_enable: 100,
            name: 'Pro Plan',
            speed_limit: null,
            content: '<b>internal html</b>',
            month_price: 990,
            quarter_price: null,
            half_year_price: null,
            year_price: 9990,
            two_year_price: null,
            three_year_price: null,
            onetime_price: 19990,
            reset_price: 100,
            capacity_limit: 8,
            created_at: 1700000000,
          },
        ],
        private_meta: 'must-not-leak',
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await authorizedRequest('/api/v1/products');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        products: [
          {
            id: '7',
            name: 'Pro Plan',
            dataAllowanceGb: 100,
            speedLimitMbps: null,
            available: true,
            prices: [
              { billingPeriod: 'month', amountMinor: 990 },
              { billingPeriod: 'year', amountMinor: 9990 },
              { billingPeriod: 'oneTime', amountMinor: 19990 },
            ],
          },
        ],
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/plan/fetch');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('returns an empty public list for no available plans', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );

    const response = await authorizedRequest('/api/v1/products');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { products: [] },
    });
  });

  it('fails closed on a malformed plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: [{ id: 7, transfer_enable: 100 }] })
      )
    );

    const response = await authorizedRequest('/api/v1/products');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('maps an outbound timeout to UPSTREAM_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    const response = await authorizedRequest('/api/v1/products');

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'UPSTREAM_TIMEOUT',
        message: 'The upstream service timed out',
        requestId: 'request-id',
      },
    });
  });
});

describe('GET /api/v1/products/:id', () => {
  it('returns a visible plan through the existing Product DTO with one upstream call', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: upstreamPlan(),
        private_meta: 'must-not-leak',
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        product: {
          id: '7',
          name: 'Pro Plan',
          dataAllowanceGb: 100,
          speedLimitMbps: null,
          available: true,
          prices: [
            { billingPeriod: 'month', amountMinor: 990 },
            { billingPeriod: 'year', amountMinor: 9990 },
            { billingPeriod: 'oneTime', amountMinor: 19990 },
          ],
        },
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).toHaveBeenCalledOnce();

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/plan/fetch?id=7');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(String(url)).not.toContain('user/info');
    expect(String(url)).not.toContain('getSubscribe');

    const serialized = JSON.stringify(body);
    for (const secret of [
      'group_id',
      'show',
      'renew',
      'sort',
      'created_at',
      'updated_at',
      'reset_price',
      'capacity_limit',
      'device_limit',
      'internal html',
      'private_meta',
      'opaque-token',
      'private.example',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('does not reject a hidden current renewable plan allowed by V2Board', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: upstreamPlan({ show: 0, renew: 1, capacity_limit: 0 }),
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { product: { id: '7', available: false } },
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each(['Subscription plan does not exist', '订阅计划不存在'])(
    'maps the exact official not-found message without leaking it: %s',
    async (message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );

      const response = await authorizedRequest('/api/v1/products/7');

      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain('PRODUCT_NOT_FOUND');
      expect(body).not.toContain(message);
    }
  );

  it('does not loosely match an upstream not-found message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          { message: 'Subscription plan does not exist right now' },
          500
        )
      )
    );

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it.each([
    ['zero', '0'],
    ['negative', '-1'],
    ['decimal', '1.5'],
    ['scientific notation', '1e3'],
    ['signed', '+7'],
    ['arbitrary text', 'plan'],
    ['encoded path traversal', '%2E%2E%2F7'],
    ['above signed INT', '2147483648'],
  ])('rejects an invalid product ID: %s', async (_label, id) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await authorizedRequest(`/api/v1/products/${id}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('requires the shared Authorization middleware before calling upstream', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/products/7',
      { headers: { 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('maps an invalid upstream token to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it.each([
    ['missing data', {}],
    ['null data', { data: null }],
    ['array data', { data: [upstreamPlan()] }],
    ['wrong id', { data: upstreamPlan({ id: 8 }) }],
    [
      'missing name',
      { data: (({ name: _name, ...plan }) => plan)(upstreamPlan()) },
    ],
    ['invalid price type', { data: upstreamPlan({ month_price: '990' }) }],
    ['negative price', { data: upstreamPlan({ month_price: -1 }) }],
    ['fraction price', { data: upstreamPlan({ month_price: 9.9 }) }],
    ['invalid transfer', { data: upstreamPlan({ transfer_enable: -1 }) }],
  ])('fails closed on malformed detail: %s', async (_label, payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it.each([
    ['HTML', new Response('<h1>private Laravel error</h1>', { status: 500 })],
    [
      'invalid JSON',
      new Response('{"data":', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ],
  ])(
    'fails closed on an upstream %s response',
    async (_label, upstreamResponse) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse)
      );

      const response = await authorizedRequest('/api/v1/products/7');

      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('UPSTREAM_ERROR');
      expect(body).not.toContain('private Laravel error');
    }
  );

  it('maps an upstream timeout to UPSTREAM_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    const response = await authorizedRequest('/api/v1/products/7');

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
  });
});

describe('GET /api/v1/resources', () => {
  it('maps only public resource identity and status fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 3,
              name: 'Hong Kong 01',
              type: 'vmess',
              is_online: 1,
              host: 'private-node.example',
              port: 443,
              server_key: 'private-server-key',
              networkSettings: { path: '/private-path' },
            },
            {
              id: 4,
              name: 'Tokyo 01',
              type: 'trojan',
              is_online: 0,
              host: '198.51.100.10',
            },
          ],
        })
      )
    );

    const response = await authorizedRequest('/api/v1/resources');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        resources: [
          {
            id: '3',
            name: 'Hong Kong 01',
            category: 'vmess',
            status: 'online',
          },
          {
            id: '4',
            name: 'Tokyo 01',
            category: 'trojan',
            status: 'offline',
          },
        ],
      },
      requestId: 'request-id',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('private-node.example');
    expect(serialized).not.toContain('198.51.100.10');
    expect(serialized).not.toContain('private-server-key');
    expect(serialized).not.toContain('opaque-token');
  });

  it('fails closed on a malformed resource response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [{ id: 3, name: 'Hong Kong 01', host: 'private-node.example' }],
        })
      )
    );

    const response = await authorizedRequest('/api/v1/resources');

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain('private-node.example');
  });
});
