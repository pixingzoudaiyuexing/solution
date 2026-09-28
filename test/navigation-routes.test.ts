import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { RegistryValidationState } from '../src/registry/kernel';
import { NAVIGATION_CORE_TARGETS } from '../src/registry/modules/navigation';
import { createRegistryModuleLkg, createRegistryOperationalSnapshot, persistRegistryOperationalSnapshot, REGISTRY_SNAPSHOT_KEY } from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';

const NOW = 500_000_000;
const core = () => NAVIGATION_CORE_TARGETS.map((targetId) => ({ kind: 'core' as const, targetId, visible: true }));
const page = (id: string, title: string) => ({ id, title, mode: 'iframe' as const, url: `https://${id}.example.org/` });
const session = () => new Response(JSON.stringify({ data: { email: 'user@example.org', expired_at: null, banned: 0 } }), { status: 200 });

async function store(kv: FakeKV, navItems: unknown[] | null, pages: ReturnType<typeof page>[] | null = null, navState = RegistryValidationState.VALID_ENABLED, validatedAt = NOW) {
  const modules = [];
  if (navItems !== null) modules.push({ moduleId: 'navigation', latest: navState === RegistryValidationState.VALID_ENABLED ? { state: navState, enabled: true } : { state: navState },
    lkg: await createRegistryModuleLkg({ moduleId: 'navigation', validatedAt, sourceFetchedAt: validatedAt, exposure: 'authenticated', config: { items: navItems } }) });
  if (pages !== null) modules.push({ moduleId: 'custom-pages', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
    lkg: await createRegistryModuleLkg({ moduleId: 'custom-pages', validatedAt, sourceFetchedAt: validatedAt, exposure: 'authenticated', config: { items: pages } }) });
  await persistRegistryOperationalSnapshot(kv.binding(), await createRegistryOperationalSnapshot({ generatedAt: NOW, modules }), registryOperationalDefinitions);
}

async function get(kv?: FakeKV, token = 'Bearer valid-token', status = 200) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(status === 200 ? session() : new Response('{}', { status }));
  vi.stubGlobal('fetch', fetcher);
  const response = await app.request('/api/v1/navigation', { headers: { Authorization: token, 'cf-ray': 'rid' } },
    { V2BOARD_BASE_URL: 'https://upstream.example/api/v1/', ...(kv ? { REGISTRY_KV: kv.binding() } : {}) });
  return { response, fetcher };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('GET /api/v1/navigation', () => {
  it('requires a real user session before reading Registry and uses canonical 401s', async () => {
    const { response: missing, fetcher } = await get(undefined, '');
    expect(missing.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
    expect((await get(undefined, 'Bearer bad token')).response.status).toBe(401);
    const invalid = await get(undefined, 'Bearer invalid-token', 403);
    expect(invalid.response.status).toBe(401);
    expect(await invalid.response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
  });

  it('returns compiled baseline without Download Center, with available Custom Pages appended', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV(); await store(kv, null, [page('page-a', 'Page A')]);
    const { response, fetcher } = await get(kv);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const items = (await response.json() as any).data.items;
    expect(items.slice(0, 11).map((item: any) => item.targetId)).toEqual(NAVIGATION_CORE_TARGETS.slice(0, 11));
    expect(items.at(-1)).toEqual({ kind: 'custom-page', itemId: 'page-a', label: 'Page A' });
    expect(JSON.stringify(items)).not.toContain('download-center');
    expect(JSON.stringify(items)).not.toContain('account');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/info');
  });

  it('resolves order, labels, visibility, explicit custom refs and unreferenced append', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    const config = [core()[0], { kind: 'custom-page', itemId: 'page-a', visible: true, label: 'Override' },
      ...core().slice(2), { ...core()[1], visible: false },
      { kind: 'custom-page', itemId: 'page-b', visible: false }];
    await store(kv, config, [page('page-a', 'Page A'), page('page-b', 'Page B'), page('page-c', 'Page C')]);
    const { response } = await get(kv);
    expect(response.status).toBe(200);
    const wire = await response.text();
    const items = JSON.parse(wire).data.items;
    expect(items[0]).toEqual({ kind: 'core', targetId: 'dashboard', label: 'Overview' });
    expect(items[1]).toEqual({ kind: 'custom-page', itemId: 'page-a', label: 'Override' });
    expect(items.some((item: any) => item.targetId === 'subscription')).toBe(false);
    expect(items.some((item: any) => item.targetId === 'download-center')).toBe(true);
    expect(items.some((item: any) => item.itemId === 'page-b')).toBe(false);
    expect(items.at(-1)).toEqual({ kind: 'custom-page', itemId: 'page-c', label: 'Page C' });
    for (const forbidden of ['https://', '/dashboard', '/downloads', 'account', 'visible', 'moduleId', 'freshness', 'sourceId', '__AUREOLE_REGISTRY__', 'auth_data']) expect(wire).not.toContain(forbidden);
    const downloads = await app.request('/api/v1/downloads', undefined, { REGISTRY_KV: kv.binding() });
    expect(downloads.status).toBe(200);
    expect(await downloads.json()).toMatchObject({ ok: true, data: { items: [] } });
  });

  it('uses fallback on absent/corrupt/disabled/stale navigation while retaining available Custom Pages', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const cases: FakeKV[] = [];
    cases.push(new FakeKV());
    const corrupt = new FakeKV(); corrupt.values.set(REGISTRY_SNAPSHOT_KEY, '{bad'); cases.push(corrupt);
    const disabled = new FakeKV();
    const disabledSnapshot = await createRegistryOperationalSnapshot({ generatedAt: NOW, modules: [
      { moduleId: 'navigation', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } },
      { moduleId: 'custom-pages', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
        lkg: await createRegistryModuleLkg({ moduleId: 'custom-pages', validatedAt: NOW, sourceFetchedAt: NOW, exposure: 'authenticated', config: { items: [page('page-a', 'Page A')] } }) },
    ] });
    await persistRegistryOperationalSnapshot(disabled.binding(), disabledSnapshot, registryOperationalDefinitions);
    cases.push(disabled);
    const stale = new FakeKV(); await store(stale, core(), null, RegistryValidationState.VALID_ENABLED, NOW - 86_400_001); cases.push(stale);
    for (const kv of cases) {
      const { response } = await get(kv);
      expect(response.status).toBe(200);
      const items = (await response.json() as any).data.items;
      expect(items[0]).toEqual({ kind: 'core', targetId: 'dashboard', label: 'Overview' });
      expect(items.some((item: any) => item.targetId === 'download-center')).toBe(false);
    }
    const invalidWithLkg = new FakeKV(); await store(invalidWithLkg, core(), null, RegistryValidationState.INVALID_SCHEMA);
    const result = await get(invalidWithLkg);
    expect((await result.response.json() as any).data.items.some((item: any) => item.targetId === 'download-center')).toBe(true);
  });
});
