import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { announcementsConfigSchema } from '../src/registry/modules/announcements';
import {
  createRegistryModuleLkg,
  createRegistryOperationalSnapshot,
  persistRegistryOperationalSnapshot,
  REGISTRY_SNAPSHOT_KEY,
} from '../src/registry/operational';
import { RegistryValidationState } from '../src/registry/kernel';
import { FakeKV } from './helpers/fake-kv';

const env = (kv?: FakeKV) => ({
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
  ...(kv ? { REGISTRY_KV: kv.binding() } : {}),
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'public-update',
  title: 'Public update',
  body: 'Public body',
  enabled: true,
  sort: 10,
  visibility: 'public',
  ...overrides,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function kvWith(
  items: Array<Record<string, unknown>>,
  validatedAt = Date.now()
): Promise<FakeKV> {
  const kv = new FakeKV();
  const config = announcementsConfigSchema.parse({ items });
  const lkg = await createRegistryModuleLkg({
    moduleId: 'announcements',
    validatedAt,
    sourceFetchedAt: validatedAt,
    exposure: 'authenticated',
    config: {
      items: config.items
        .filter((entry) => entry.enabled)
        .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id))
        .map(({ id, title, body, sort, visibility }) => ({ id, title, body, sort, visibility })),
    },
  });
  const snapshot = await createRegistryOperationalSnapshot({
    generatedAt: Date.now(),
    modules: [{
      moduleId: 'announcements',
      latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
      lkg,
    }],
  });
  await persistRegistryOperationalSnapshot(kv.binding(), snapshot, registryOperationalDefinitions);
  return kv;
}

const validUser = { data: { email: 'user@example.com', expired_at: null, banned: 0 } };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/announcements', () => {
  it('returns only public announcements anonymously in stable snapshot order', async () => {
    const kv = await kvWith([
      item({ id: 'z-last', sort: 10 }),
      item({ id: 'authenticated-reminder', sort: 1, visibility: 'authenticated', title: 'Private', body: 'Private body' }),
      item({ id: 'a-first', sort: 10 }),
      item({ id: 'disabled', sort: 0, enabled: false }),
    ]);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/announcements', { headers: { 'cf-ray': 'request-id' } }, env(kv));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { items: [
        { id: 'a-first', title: 'Public update', body: 'Public body' },
        { id: 'z-last', title: 'Public update', body: 'Public body' },
      ] },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates an optional Bearer before returning authenticated announcements', async () => {
    const kv = await kvWith([
      item({ id: 'public', sort: 2 }),
      item({ id: 'authenticated', sort: 1, visibility: 'authenticated', title: 'Private', body: 'Private body' }),
    ]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(validUser));
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/announcements', {
      headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' },
    }, env(kv));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { items: [
        { id: 'authenticated', title: 'Private', body: 'Private body' },
        { id: 'public', title: 'Public update', body: 'Public body' },
      ] },
      requestId: 'request-id',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('https://backend.example/api/v1/user/info');
  });

  it.each([
    ['malformed authorization', { Authorization: 'Basic opaque-token' }, undefined],
    ['invalid upstream authorization', { Authorization: 'Bearer invalid-token' }, json({ message: 'invalid token' }, 401)],
  ])('does not leak authenticated announcements for %s', async (_case, headers, outcome) => {
    const kv = await kvWith([item({ id: 'private', visibility: 'authenticated', body: 'PRIVATE_SENTINEL' })]);
    const fetcher = vi.fn<typeof fetch>();
    if (outcome) fetcher.mockResolvedValue(outcome);
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/announcements', { headers }, env(kv));
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain(outcome ? 'AUTH_FAILED' : 'AUTH_REQUIRED');
    expect(text).not.toContain('PRIVATE_SENTINEL');
  });

  it.each(['corrupt snapshot', 'stale snapshot', 'disabled module'])('returns no announcements for %s', async (state) => {
    const kv = new FakeKV();
    if (state === 'corrupt snapshot') {
      kv.values.set(REGISTRY_SNAPSHOT_KEY, '{not-json');
    } else if (state === 'stale snapshot') {
      const stale = await kvWith([item()], Date.now() - 86_401_000);
      kv.values.set(REGISTRY_SNAPSHOT_KEY, stale.values.get(REGISTRY_SNAPSHOT_KEY)!);
    } else {
      const snapshot = await createRegistryOperationalSnapshot({
        generatedAt: Date.now(),
        modules: [{
          moduleId: 'announcements',
          latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false },
        }],
      });
      await persistRegistryOperationalSnapshot(kv.binding(), snapshot, registryOperationalDefinitions);
    }

    const response = await app.request('/api/v1/announcements', undefined, env(kv));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { items: [] } });
  });

  it.each([
    ['missing snapshot', undefined],
    ['empty configured snapshot', []],
  ])('returns a non-cacheable empty list for %s', async (_case, items) => {
    const kv = items === undefined ? undefined : await kvWith(items);
    const response = await app.request('/api/v1/announcements', undefined, env(kv));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { items: [] } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not expose raw snapshot metadata or source-only announcement fields', async () => {
    const kv = await kvWith([item({ id: 'private', visibility: 'authenticated', body: 'PRIVATE_SENTINEL' })]);
    const response = await app.request('/api/v1/announcements', undefined, env(kv));
    const text = await response.text();

    for (const forbidden of ['PRIVATE_SENTINEL', 'visibility', 'sort', 'enabled', 'validatedAt', 'sourceFingerprint', 'REGISTRY_KV']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it.each([
    [json({ data: null }), 502, 'UPSTREAM_ERROR'],
    [new DOMException('timeout', 'TimeoutError'), 504, 'UPSTREAM_TIMEOUT'],
  ])('does not downgrade authenticated requests when session validation fails', async (outcome, status, code) => {
    const kv = await kvWith([item({ id: 'private', visibility: 'authenticated', body: 'PRIVATE_SENTINEL' })]);
    const fetcher = vi.fn<typeof fetch>();
    if (outcome instanceof Error) fetcher.mockRejectedValue(outcome);
    else fetcher.mockResolvedValue(outcome);
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/announcements', {
      headers: { Authorization: 'Bearer opaque-token' },
    }, env(kv));
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain('PRIVATE_SENTINEL');
  });
});
