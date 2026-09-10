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
