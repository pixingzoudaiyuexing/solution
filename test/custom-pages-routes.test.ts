import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { RegistryValidationState } from '../src/registry/kernel';
import {
  REGISTRY_SNAPSHOT_KEY,
  canonicalRegistryJson,
  createRegistryModuleLkg,
  createRegistryOperationalSnapshot,
  persistRegistryOperationalSnapshot,
  type RegistryModuleSnapshot,
} from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';

const NOW = 200_000_000;
const DAY_MS = 86_400_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    data: {
      email: 'user@example.com',
      expired_at: null,
      banned: 0,
      ...overrides,
    },
  });
}

async function customPagesModule(
  items: Array<{ id: string; title: string; url: string; mode: 'iframe' | 'external' }>,
  validatedAt = NOW,
  latestState: RegistryValidationState = RegistryValidationState.VALID_ENABLED
): Promise<RegistryModuleSnapshot> {
  return {
    moduleId: 'custom-pages',
    latest:
      latestState === RegistryValidationState.VALID_ENABLED
        ? { state: latestState, enabled: true }
        : { state: latestState },
    lkg: await createRegistryModuleLkg({
      moduleId: 'custom-pages',
      sourceFetchedAt: validatedAt,
      validatedAt,
      source: { sourceId: 6, updatedAt: 100 },
      exposure: 'authenticated',
      config: { items },
    }),
  };
}

async function storeSnapshot(kv: FakeKV, module: RegistryModuleSnapshot | null, generatedAt = NOW) {
  const snapshot = await createRegistryOperationalSnapshot({
    generatedAt,
    modules: module === null ? [] : [module],
  });
  await persistRegistryOperationalSnapshot(
    kv.binding(),
    snapshot,
    registryOperationalDefinitions
  );
}

async function requestCustomPages(
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>,
  kv?: FakeKV,
  authorization = 'Bearer opaque-token'
): Promise<Response> {
  vi.stubGlobal('fetch', fetcher);
  return app.request(
    '/api/v1/custom-pages',
    { headers: { Authorization: authorization, 'cf-ray': 'request-id' } },
    {
      V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
      ...(kv === undefined ? {} : { REGISTRY_KV: kv.binding() }),
    }
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/custom-pages', () => {
  it('requires Bearer syntax before any upstream request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/custom-pages',
      undefined,
      { V2BOARD_BASE_URL: 'https://backend.example/api/v1/' }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects malformed Bearer syntax before upstream request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/custom-pages',
      { headers: { Authorization: 'Bearer invalid token' } },
      { V2BOARD_BASE_URL: 'https://backend.example/api/v1/' }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403])('maps rejected V2Board session %s to AUTH_FAILED', async (status) => {
    const response = await requestCustomPages(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'private' }, status))
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
  });

  it('validates user/info then returns Registry items with exact DTO parity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(
      kv,
      await customPagesModule([
        { id: 'notice-6', title: 'Status', url: 'https://status.example', mode: 'iframe' },
        { id: 'custom-help', title: 'Help', url: 'https://help.example', mode: 'external' },
      ])
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
    const response = await requestCustomPages(fetcher, kv);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: {
        items: [
          { id: 'notice-6', title: 'Status', url: 'https://status.example', mode: 'iframe' },
          { id: 'custom-help', title: 'Help', url: 'https://help.example', mode: 'external' },
        ],
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://backend.example/api/v1/user/info',
    ]);
  });

  it('does not require subscription entitlement after session validation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(
      kv,
      await customPagesModule([
        { id: 'notice-6', title: 'Status', url: 'https://status.example', mode: 'iframe' },
      ])
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      sessionResponse({ expired_at: 1, banned: 0 })
    );
    const response = await requestCustomPages(fetcher, kv);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { items: [{ id: 'notice-6' }] } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing KV', async () => undefined],
    ['missing snapshot', async () => new FakeKV()],
    ['corrupt snapshot', async () => {
      const kv = new FakeKV(); kv.values.set(REGISTRY_SNAPSHOT_KEY, '{bad'); return kv;
    }],
    ['absent module', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, null); return kv;
    }],
    ['disabled module', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, { moduleId: 'custom-pages', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } }); return kv;
    }],
    ['invalid module without LKG', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, { moduleId: 'custom-pages', latest: { state: RegistryValidationState.INVALID_SCHEMA } }); return kv;
    }],
    ['expired LKG', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Expired', url: 'https://expired.example', mode: 'iframe' }], NOW - DAY_MS - 1)); return kv;
    }],
    ['latest invalid and expired LKG', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Expired', url: 'https://expired.example', mode: 'iframe' }], NOW - DAY_MS - 1, RegistryValidationState.INVALID_SCHEMA)); return kv;
    }],
    ['future timestamp', async () => {
      const kv = new FakeKV(); await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Future', url: 'https://future.example', mode: 'iframe' }], NOW + 1), NOW + 1); return kv;
    }],
    ['invalid temporal snapshot', async () => {
      const kv = new FakeKV(); const module = await customPagesModule([{ id: 'notice-6', title: 'Invalid', url: 'https://invalid.example', mode: 'iframe' }]); const snapshot = await createRegistryOperationalSnapshot({ generatedAt: NOW - 1, modules: [module] }); kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot)); return kv;
    }],
  ])('returns authenticated empty fallback for %s without Notice fetch', async (_case, setup) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = await setup();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
    const response = await requestCustomPages(fetcher, kv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { items: [] }, requestId: 'request-id' });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://backend.example/api/v1/user/info',
    ]);
  });

  it.each([
    ['just inside', NOW - DAY_MS + 1],
    ['exact boundary', NOW - DAY_MS],
  ])('returns usable LKG %s 24 hours', async (_case, validatedAt) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Retained', url: 'https://status.example', mode: 'iframe' }], validatedAt));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
    const response = await requestCustomPages(fetcher, kv);
    expect(await response.json()).toMatchObject({ data: { items: [{ title: 'Retained' }] } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns fresh retained LKG when latest Registry validation is invalid', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Retained', url: 'https://status.example', mode: 'iframe' }], NOW - 1, RegistryValidationState.INVALID_SCHEMA));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
    const response = await requestCustomPages(fetcher, kv);
    expect(await response.json()).toMatchObject({ data: { items: [{ title: 'Retained' }] } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('never falls back to Notice even when Notice could return a page', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 6, title: 'Notice', content: 'https://notice.example', tags: ['aureole:iframe'], created_at: 1, updated_at: 1 }], total: 1 }));
    const response = await requestCustomPages(fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { items: [] } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe('https://backend.example/api/v1/user/info');
  });

  it('does not expose Registry metadata or target-fetch internals', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(kv, await customPagesModule([{ id: 'notice-6', title: 'Safe', url: 'https://target.example/path', mode: 'iframe' }]));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
    const response = await requestCustomPages(fetcher, kv);
    const text = await response.text();
    for (const forbidden of ['enabled', 'title.default', 'schemaVersion', 'moduleId', 'STALE_TOLERANT', 'ageSeconds', 'validatedAt', 'sourceFetchedAt', 'sourceFingerprint', 'health', 'registry:snapshot:v1', 'auth_data', 'Authorization', 'backend.example', 'secure-admin', 'raw-registry']) {
      expect(text).not.toContain(forbidden);
    }
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://backend.example/api/v1/user/info']);
  });
});
