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
const ALL_NULL = {
  siteName: null,
  brandName: null,
  title: null,
  description: null,
  logoUrl: null,
  faviconUrl: null,
  footerText: null,
};

async function storeSnapshot(
  kv: FakeKV,
  module: RegistryModuleSnapshot | null,
  generatedAt = NOW
): Promise<void> {
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

async function availableModule(
  config: Record<string, string>,
  validatedAt = NOW,
  latestState: RegistryValidationState = RegistryValidationState.VALID_ENABLED
): Promise<RegistryModuleSnapshot> {
  return {
    moduleId: 'runtime-settings',
    latest:
      latestState === RegistryValidationState.VALID_ENABLED
        ? { state: latestState, enabled: true }
        : { state: latestState },
    lkg: await createRegistryModuleLkg({
      moduleId: 'runtime-settings',
      sourceFetchedAt: validatedAt,
      validatedAt,
      source: { sourceId: 7, updatedAt: 100 },
      exposure: 'public',
      config,
    }),
  };
}

async function requestRuntime(kv?: FakeKV): Promise<{
  response: Response;
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
}> {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const response = await app.request(
    '/api/v1/config/runtime',
    { headers: { 'cf-ray': 'request-id' } },
    kv ? { REGISTRY_KV: kv.binding() } : {}
  );
  return { response, fetcher };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/config/runtime', () => {
  it('returns all seven safe fields from a valid fresh snapshot without auth or fetch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(
      kv,
      await availableModule({
        siteName: 'Site',
        brandName: 'Brand',
        title: 'Title',
        description: 'Description',
        logoUrl: 'https://cdn.example/logo.png',
        faviconUrl: 'https://cdn.example/favicon.ico',
        footerText: 'Footer',
      })
    );

    const { response, fetcher } = await requestRuntime(kv);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        siteName: 'Site',
        brandName: 'Brand',
        title: 'Title',
        description: 'Description',
        logoUrl: 'https://cdn.example/logo.png',
        faviconUrl: 'https://cdn.example/favicon.ico',
        footerText: 'Footer',
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps a partial safe config to a complete null-filled Public DTO', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(kv, await availableModule({ title: 'Only title' }));

    const { response, fetcher } = await requestRuntime(kv);

    expect(await response.json()).toEqual({
      ok: true,
      data: { ...ALL_NULL, title: 'Only title' },
      requestId: 'request-id',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['missing binding', async () => undefined],
    ['missing snapshot', async () => new FakeKV()],
    [
      'corrupt snapshot',
      async () => {
        const kv = new FakeKV();
        kv.values.set(REGISTRY_SNAPSHOT_KEY, '{corrupt');
        return kv;
      },
    ],
    [
      'module absent from snapshot',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(kv, null);
        return kv;
      },
    ],
    [
      'module disabled',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(kv, {
          moduleId: 'runtime-settings',
          latest: {
            state: RegistryValidationState.VALID_DISABLED,
            enabled: false,
          },
        });
        return kv;
      },
    ],
    [
      'invalid module without LKG',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(kv, {
          moduleId: 'runtime-settings',
          latest: { state: RegistryValidationState.INVALID_SCHEMA },
        });
        return kv;
      },
    ],
    [
      'expired LKG',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(
          kv,
          await availableModule({ siteName: 'Expired' }, NOW - DAY_MS - 1)
        );
        return kv;
      },
    ],
    [
      'latest invalid with expired LKG',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(
          kv,
          await availableModule(
            { siteName: 'Expired' },
            NOW - DAY_MS - 1,
            RegistryValidationState.INVALID_SCHEMA
          )
        );
        return kv;
      },
    ],
    [
      'future-dated LKG',
      async () => {
        const kv = new FakeKV();
        await storeSnapshot(
          kv,
          await availableModule({ siteName: 'Future' }, NOW + 1),
          NOW + 1
        );
        return kv;
      },
    ],
    [
      'invalid temporal ordering',
      async () => {
        const kv = new FakeKV();
        const module = await availableModule({ siteName: 'Invalid time' }, NOW);
        const snapshot = await createRegistryOperationalSnapshot({
          generatedAt: NOW - 1,
          modules: [module],
        });
        kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));
        return kv;
      },
    ],
  ])('returns all-null fallback for %s with zero fetches', async (_case, setup) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = await setup();

    const { response, fetcher } = await requestRuntime(kv);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: ALL_NULL,
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['just inside', NOW - DAY_MS + 1],
    ['exact boundary', NOW - DAY_MS],
  ])('returns usable LKG %s 24 hours', async (_case, validatedAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(
      kv,
      await availableModule({ siteName: 'Usable LKG' }, validatedAt)
    );

    const { response, fetcher } = await requestRuntime(kv);

    expect(await response.json()).toEqual({
      ok: true,
      data: { ...ALL_NULL, siteName: 'Usable LKG' },
      requestId: 'request-id',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a retained latest-invalid LKG inside the 24-hour bound', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(
      kv,
      await availableModule(
        { brandName: 'Retained Brand' },
        NOW - 1,
        RegistryValidationState.INVALID_SCHEMA
      )
    );

    const { response, fetcher } = await requestRuntime(kv);

    expect(await response.json()).toEqual({
      ok: true,
      data: { ...ALL_NULL, brandName: 'Retained Brand' },
      requestId: 'request-id',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exposes no Registry, freshness, health, source, credential, or origin metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await storeSnapshot(kv, await availableModule({ siteName: 'Safe Site' }));

    const { response, fetcher } = await requestRuntime(kv);
    const serialized = JSON.stringify(await response.json());

    for (const forbidden of [
      'VALID_ENABLED',
      'STALE_TOLERANT',
      'ageSeconds',
      'validatedAt',
      'sourceFetchedAt',
      'sourceId',
      'sourceFingerprint',
      'REGISTRY_SOURCE_INVALID',
      'registry:snapshot:v1',
      'auth_data',
      'Authorization',
      'secure-admin',
      'backend.example',
      'knowledge/fetch',
      'secret',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(JSON.parse(serialized).data)).toEqual([
      'siteName',
      'brandName',
      'title',
      'description',
      'logoUrl',
      'faviconUrl',
      'footerText',
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
