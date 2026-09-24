import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
} from '../src/registry/kernel';
import {
  REGISTRY_SNAPSHOT_KEY,
  loadRegistryOperationalSnapshot,
} from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';

const LEGACY_MODULE_ID = 'support-widget';

function executionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function env(kv: FakeKV) {
  return {
    REGISTRY_KV: kv.binding(),
    V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
    V2BOARD_CONTROL_AUTH_DATA: 'AUTH_SENTINEL',
    V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('M10 external support widget removal', () => {
  it('does not register the retired module or public route', async () => {
    expect(
      registryOperationalDefinitions.some(
        (definition) =>
          definition.registryDefinition.moduleId === LEGACY_MODULE_ID
      )
    ).toBe(false);

    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch!(
      new Request('https://gateway.example/api/v1/config/support-widget'),
      {},
      executionContext()
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('404 Not Found');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an active legacy Registry source as an unknown module', () => {
    const report = validateRegistryKnowledge(
      [
        {
          sourceId: 13,
          category: REGISTRY_CATEGORY,
          title: `registry:${LEGACY_MODULE_ID}`,
          show: 1,
          updatedAt: 100,
          body: JSON.stringify({
            kind: 'aureole.registry',
            moduleId: LEGACY_MODULE_ID,
            schemaVersion: 1,
            enabled: true,
            config: { provider: 'retired' },
          }),
        },
      ],
      registryOperationalDefinitions.map(
        (definition) => definition.registryDefinition
      )
    );

    expect(report.modules).toHaveLength(1);
    expect(report.modules[0]).toMatchObject({
      moduleId: LEGACY_MODULE_ID,
      state: RegistryValidationState.INVALID_SCHEMA,
      code: 'UNKNOWN_MODULE',
    });
  });

  it('fails closed on a legacy snapshot and rewrites it through the normal refresh pipeline', async () => {
    const kv = new FakeKV();
    kv.values.set(
      REGISTRY_SNAPSHOT_KEY,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: 10_000,
        sourceFingerprint: '0'.repeat(64),
        modules: [
          {
            moduleId: LEGACY_MODULE_ID,
            latest: { state: 'ABSENT' },
          },
        ],
      })
    );

    expect(
      await loadRegistryOperationalSnapshot(
        kv.binding(),
        registryOperationalDefinitions
      )
    ).toEqual({ status: 'corrupt' });

    const response = await app.request(
      '/api/v1/config/promotion-ui',
      { headers: { 'cf-ray': 'request-id' } },
      { REGISTRY_KV: kv.binding() }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { showCouponEntry: true, annualPrefillCode: null },
      requestId: 'request-id',
    });

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const refreshed = await refreshRegistryOperationalState(env(kv), {
      now: () => 20_000,
      fetcher,
    });
    expect(refreshed.ok).toBe(true);

    const loaded = await loadRegistryOperationalSnapshot(
      kv.binding(),
      registryOperationalDefinitions
    );
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(
        loaded.snapshot.modules.map((module) => module.moduleId)
      ).toEqual([
        'announcements',
        'custom-pages',
        'promotion-ui',
        'runtime-settings',
        'subscription-delivery',
      ]);
      expect(
        loaded.snapshot.modules.every(
          (module) => module.latest.state === 'ABSENT'
        )
      ).toBe(true);
    }
  });
});
