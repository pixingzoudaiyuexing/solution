import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { RegistryValidationState } from '../src/registry/kernel';
import { REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson, createRegistryModuleLkg,
  createRegistryOperationalSnapshot, persistRegistryOperationalSnapshot, type RegistryModuleSnapshot } from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';

const NOW = 200_000_000;
const DAY = 86_400_000;
const OFF = { crisp: { enabled: false } };
const ON = { crisp: { enabled: true, websiteId: '123e4567-e89b-12d3-a456-426614174000' } };

async function module(config: object, validatedAt = NOW): Promise<RegistryModuleSnapshot> {
  return { moduleId: 'support-widget', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
    lkg: await createRegistryModuleLkg({ moduleId: 'support-widget', validatedAt, sourceFetchedAt: validatedAt,
      exposure: 'public', config }) };
}

async function put(kv: FakeKV, item: RegistryModuleSnapshot | null, generatedAt = NOW): Promise<void> {
  await persistRegistryOperationalSnapshot(kv.binding(), await createRegistryOperationalSnapshot({ generatedAt,
    modules: item ? [item] : [] }), registryOperationalDefinitions);
}

async function request(kv?: FakeKV): Promise<{ response: Response; fetcher: ReturnType<typeof vi.fn<typeof fetch>> }> {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  const response = await app.request('/api/v1/config/support-widget', { headers: { 'cf-ray': 'request-id' } },
    kv ? { REGISTRY_KV: kv.binding() } : {});
  return { response, fetcher };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET /api/v1/config/support-widget', () => {
  it('returns only the allowlisted public DTO anonymously without provider or Admin calls', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await put(kv, await module(ON));
    const { response, fetcher } = await request(kv);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: ON, requestId: 'request-id' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose identifiers when Crisp is disabled', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await put(kv, await module(OFF));
    expect(await (await request(kv)).response.json()).toEqual({ ok: true, data: OFF, requestId: 'request-id' });
  });

  it.each([
    ['missing binding', async () => undefined],
    ['missing snapshot', async () => new FakeKV()],
    ['corrupt snapshot', async () => { const kv = new FakeKV(); kv.values.set(REGISTRY_SNAPSHOT_KEY, '{broken'); return kv; }],
    ['module absent', async () => { const kv = new FakeKV(); await put(kv, null); return kv; }],
    ['module disabled', async () => { const kv = new FakeKV(); await put(kv, { moduleId: 'support-widget',
      latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } }); return kv; }],
    ['invalid without LKG', async () => { const kv = new FakeKV(); await put(kv, { moduleId: 'support-widget',
      latest: { state: RegistryValidationState.INVALID_SCHEMA } }); return kv; }],
    ['stale LKG', async () => { const kv = new FakeKV(); await put(kv, await module(ON, NOW - DAY - 1)); return kv; }],
    ['future LKG', async () => { const kv = new FakeKV(); await put(kv, await module(ON, NOW + 1), NOW + 1); return kv; }],
    ['KV read failure', async () => { const kv = new FakeKV(); kv.get = async () => { throw new Error('KV unavailable'); }; return kv; }],
  ])('returns Crisp disabled for %s', async (_case, setup) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const { response, fetcher } = await request(await setup());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: OFF, requestId: 'request-id' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not reactivate invalid latest config from a bounded LKG or bypass disabled state', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); const valid = await module(ON);
    await put(kv, { ...valid, latest: { state: RegistryValidationState.INVALID_SCHEMA } });
    expect(await (await request(kv)).response.json()).toMatchObject({ data: OFF });
    await put(kv, { moduleId: 'support-widget', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } });
    expect(await (await request(kv)).response.json()).toMatchObject({ data: OFF });
  });

  it('rejects a validly fingerprinted snapshot with extra unapproved config fields', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    const snapshot = await createRegistryOperationalSnapshot({ generatedAt: NOW,
      modules: [await module({ ...ON, injectedScript: 'https://evil.example/x.js' })] });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));
    expect(await (await request(kv)).response.json()).toMatchObject({ data: OFF });
  });

  it('rejects an old snapshot carrying Chatwoot even when Crisp is enabled', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    const snapshot = await createRegistryOperationalSnapshot({ generatedAt: NOW,
      modules: [await module({ ...ON, chatwoot: { enabled: false } })] });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));
    expect(await (await request(kv)).response.json()).toEqual({ ok: true, data: OFF, requestId: 'request-id' });
  });
});
