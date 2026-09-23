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
const DAY = 86_400_000;
const DEFAULT = { showCouponEntry: true, annualPrefillCode: null };
const ENABLED = { showCouponEntry: true, annualPrefillCode: 'PUBLIC-ANNUAL' };

async function module(config: object, validatedAt = NOW): Promise<RegistryModuleSnapshot> {
  return {
    moduleId: 'promotion-ui',
    latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
    lkg: await createRegistryModuleLkg({
      moduleId: 'promotion-ui', validatedAt, sourceFetchedAt: validatedAt,
      exposure: 'public', config,
    }),
  };
}

async function put(kv: FakeKV, item: RegistryModuleSnapshot | null, generatedAt = NOW): Promise<void> {
  await persistRegistryOperationalSnapshot(kv.binding(), await createRegistryOperationalSnapshot({
    generatedAt, modules: item ? [item] : [],
  }), registryOperationalDefinitions);
}

async function request(kv?: FakeKV) {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const response = await app.request('/api/v1/config/promotion-ui', { headers: { 'cf-ray': 'request-id' } },
    kv ? { REGISTRY_KV: kv.binding() } : {});
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(fetcher).not.toHaveBeenCalled();
  return response.json();
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET /api/v1/config/promotion-ui', () => {
  it('returns the compatible manual-entry default anonymously with no upstream call', async () => {
    expect(await request()).toEqual({ ok: true, data: DEFAULT, requestId: 'request-id' });
  });

  it('returns enabled entry with no annual code', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await put(kv, await module({ showCouponEntry: true }));
    expect(await request(kv)).toEqual({ ok: true, data: DEFAULT, requestId: 'request-id' });
  });

  it('returns only the safe annual code when the entry is explicitly enabled', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await put(kv, await module(ENABLED));
    expect(await request(kv)).toEqual({ ok: true, data: ENABLED, requestId: 'request-id' });
  });

  it('never returns a retained annual code when the entry is hidden', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await put(kv, await module({ showCouponEntry: false }));
    expect(await request(kv)).toEqual({ ok: true, data: { showCouponEntry: false, annualPrefillCode: null }, requestId: 'request-id' });
    // Even a validly fingerprinted legacy snapshot cannot expose a hidden code.
    const legacy = await createRegistryOperationalSnapshot({ generatedAt: NOW,
      modules: [await module({ showCouponEntry: false, annualPrefillCode: 'RETAINED-CODE' })] });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(legacy));
    expect(await request(kv)).toEqual({ ok: true, data: { showCouponEntry: false, annualPrefillCode: null }, requestId: 'request-id' });
  });

  it.each([
    ['missing binding', async () => undefined],
    ['missing snapshot', async () => new FakeKV()],
    ['corrupt snapshot', async () => { const kv = new FakeKV(); kv.values.set(REGISTRY_SNAPSHOT_KEY, '{broken'); return kv; }],
    ['module absent', async () => { const kv = new FakeKV(); await put(kv, null); return kv; }],
    ['module disabled', async () => { const kv = new FakeKV(); await put(kv, {
      moduleId: 'promotion-ui', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false },
    }); return kv; }],
    ['invalid without LKG', async () => { const kv = new FakeKV(); await put(kv, {
      moduleId: 'promotion-ui', latest: { state: RegistryValidationState.INVALID_SCHEMA },
    }); return kv; }],
    ['stale LKG', async () => { const kv = new FakeKV(); await put(kv, await module(ENABLED, NOW - DAY - 1)); return kv; }],
    ['future LKG', async () => { const kv = new FakeKV(); await put(kv, await module(ENABLED, NOW + 1), NOW + 1); return kv; }],
    ['KV read failure', async () => { const kv = new FakeKV(); kv.get = async () => { throw new Error('KV unavailable'); }; return kv; }],
  ])('uses the compatible fallback for %s', async (_label, setup) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    expect(await request(await setup())).toEqual({ ok: true, data: DEFAULT, requestId: 'request-id' });
  });

  it.each([
    RegistryValidationState.INVALID_SCHEMA,
    RegistryValidationState.INVALID_SYNTAX,
    RegistryValidationState.UNSUPPORTED_VERSION,
    RegistryValidationState.DEPENDENCY_INVALID,
  ])('does not republish retained LKG for latest state %s', async (state) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    await put(kv, { ...await module(ENABLED), latest: { state } });
    expect(await request(kv)).toEqual({ ok: true, data: DEFAULT, requestId: 'request-id' });
  });

  it('rejects validly fingerprinted snapshots with unknown fields or unsafe codes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    for (const config of [{ ...ENABLED, autoApply: true }, { showCouponEntry: true, annualPrefillCode: '<script>' }]) {
      const snapshot = await createRegistryOperationalSnapshot({ generatedAt: NOW, modules: [await module(config)] });
      kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));
      expect(await request(kv)).toEqual({ ok: true, data: DEFAULT, requestId: 'request-id' });
    }
  });
});
