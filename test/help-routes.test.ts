import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { FakeKV } from './helpers/fake-kv';
import { persistDownloadCenterResolvedState } from '../src/registry/download-center-resolved';

const TOKEN = 'SYNTHETIC_USER_AUTH_SENTINEL';
const ADMIN = 'SYNTHETIC_ADMIN_AUTH_SENTINEL';
const NODE = 'SYNTHETIC_NODE_SECRET_SENTINEL';
const UPDATED = 1_704_067_200;
const NOW = Date.parse('2026-09-27T00:00:00.000Z');
const env = (kv?: FakeKV) => ({
  V2BOARD_BASE_URL: 'https://hidden.example/api/v1/',
  V2BOARD_CONTROL_AUTH_DATA: ADMIN,
  V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin',
  ...(kv ? { REGISTRY_KV: kv.binding() } : {}),
});
const ordinary = (id: number, title: string, category = 'Guides') => ({ id, title, category, updated_at: UPDATED });
const grouped = {
  Guides: [ordinary(1, 'Install'), ordinary(2, 'Troubleshooting')],
  '__AUREOLE_REGISTRY__': [{ id: 9, title: 'registry:secret', category: '__AUREOLE_REGISTRY__', updated_at: UPDATED }],
  Other: [ordinary(3, '{"kind":"aureole.registry"}', 'Other')],
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const urlPath = (url: RequestInfo | URL) => new URL(String(url)).pathname;

function fetcher(options: {
  list?: unknown;
  raw?: Record<string, unknown>;
  listStatus?: number;
  rawStatus?: number;
} = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const pathname = urlPath(url);
    const headers = new Headers(init?.headers);
    expect(init?.redirect).toBe('manual');
    if (pathname.endsWith('/user/knowledge/fetch')) {
      expect(headers.get('authorization')).toBe(TOKEN);
      expect(new URL(String(url)).searchParams.get('language')).toBe('zh-CN');
      return json({ data: options.list ?? grouped }, options.listStatus ?? 200);
    }
    if (pathname.endsWith('/secure-admin/knowledge/fetch')) {
      expect(headers.get('authorization')).toBe(ADMIN);
      return json({ data: options.raw ?? { ...ordinary(1, 'Install'), show: 1, body: '<h2>Getting started</h2><p>Hello</p>' } }, options.rawStatus ?? 200);
    }
    throw new Error('Unexpected upstream path');
  });
}
const authenticated = (path: string) => app.request(path, { headers: { Authorization: `Bearer ${TOKEN}`, 'cf-ray': 'rid' } }, env());

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('authenticated Help collection routes', () => {
  it.each(['/api/v1/help/categories', '/api/v1/help/articles', '/api/v1/help/articles/1'])('rejects missing authorization on %s', async (path) => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const response = await app.request(path, {}, env());
    expect(response.status).toBe(401);
    expect((await response.json() as any).error.code).toBe('AUTH_REQUIRED');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('uses actual User Knowledge auth and excludes reserved catalog records from counts and DTO', async () => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const categories = await authenticated('/api/v1/help/categories');
    expect(await categories.json()).toEqual({ ok: true, data: { categories: [
      { name: 'Guides', articleCount: 2 }, { name: 'Other', articleCount: 1 },
    ] }, requestId: 'rid' });
    const list = await authenticated('/api/v1/help/articles');
    expect(await list.json()).toEqual({ ok: true, data: {
      items: [
        { id: '1', title: 'Install', category: 'Guides', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: '2', title: 'Troubleshooting', category: 'Guides', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: '3', title: '{"kind":"aureole.registry"}', category: 'Other', updatedAt: '2024-01-01T00:00:00.000Z' },
      ], page: 1, pageSize: 20, total: 3,
    }, requestId: 'rid' });
    expect(upstream.mock.calls.every(([url]) => urlPath(url).endsWith('/user/knowledge/fetch'))).toBe(true);
  });

  it('paginates after category filter and passes q to V2Board body/title search', async () => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles?category=Guides&q=body-hit&page=2&pageSize=1');
    expect(await response.json()).toMatchObject({ data: {
      items: [{ id: '2' }], page: 2, pageSize: 1, total: 2,
    } });
    expect(new URL(String(upstream.mock.calls[0][0])).searchParams.get('keyword')).toBe('body-hit');
  });

  it('returns only upstream title/body keyword hits and treats empty results as normal', async () => {
    const hits = { Guides: [ordinary(2, 'Troubleshooting')] };
    const upstream = fetcher({ list: hits }); vi.stubGlobal('fetch', upstream);
    const title = await authenticated('/api/v1/help/articles?q=Troubleshooting');
    const body = await authenticated('/api/v1/help/articles?q=body-only-keyword');
    for (const response of [title, body]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { items: [{ id: '2' }], total: 1 } });
    }
    expect(new URL(String(upstream.mock.calls[0][0])).searchParams.get('keyword')).toBe('Troubleshooting');
    expect(new URL(String(upstream.mock.calls[1][0])).searchParams.get('keyword')).toBe('body-only-keyword');
    vi.stubGlobal('fetch', fetcher({ list: { '__AUREOLE_REGISTRY__': [{ malformed: NODE }] } }));
    const empty = await authenticated('/api/v1/help/articles?q=registry-secret');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: { items: [], total: 0 } });
    vi.stubGlobal('fetch', fetcher({ list: [] }));
    const actualEmptyShape = await authenticated('/api/v1/help/articles?q=no-hits');
    expect(actualEmptyShape.status).toBe(200);
    expect(await actualEmptyShape.json()).toMatchObject({ data: { items: [], total: 0 } });
  });

  it.each(['?page=0', '?page=10001', '?pageSize=51', '?q=', `?q=${'x'.repeat(129)}`, `?category=${'x'.repeat(256)}`, '?x=1', '?q=a&q=b'])('rejects invalid query %s before upstream', async (suffix) => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const response = await authenticated(`/api/v1/help/articles${suffix}`);
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['0', '01', '2147483648', 'abc'])('rejects invalid article ID %s', async (id) => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const response = await authenticated(`/api/v1/help/articles/${id}`);
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid real bearer and does not call privileged raw detail', async () => {
    const upstream = fetcher({ listStatus: 403 }); vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles/1');
    expect(response.status).toBe(401);
    expect(upstream).toHaveBeenCalledOnce();
    expect(urlPath(upstream.mock.calls[0][0])).toContain('/user/knowledge/fetch');
  });

  it('rejects invalid bearer on all collection routes', async () => {
    for (const path of ['/api/v1/help/categories', '/api/v1/help/articles?q=x']) {
      vi.stubGlobal('fetch', fetcher({ listStatus: 403 }));
      const response = await authenticated(path);
      expect(response.status).toBe(401);
      expect((await response.json() as any).error.code).toBe('AUTH_FAILED');
    }
  });

  it.each(['9', '99'])('does not read Admin detail for reserved or nonexistent ID %s', async (id) => {
    const upstream = fetcher(); vi.stubGlobal('fetch', upstream);
    const response = await authenticated(`/api/v1/help/articles/${id}`);
    expect(response.status).toBe(404);
    expect((await response.json() as any).error.code).toBe('HELP_ARTICLE_NOT_FOUND');
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    { id: 999 }, { title: 'Wrong' }, { category: '__AUREOLE_REGISTRY__' },
    { show: 0 }, { updated_at: UPDATED + 1 },
  ])('returns the same 404 for raw metadata mismatches %j', async (mutation) => {
    const upstream = fetcher({ raw: { ...ordinary(1, 'Install'), show: 1, body: '<p>secret</p>', ...mutation } });
    vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles/1');
    expect(response.status).toBe(404);
    expect((await response.json() as any).error).toMatchObject({ code: 'HELP_ARTICLE_NOT_FOUND', message: 'Help article was not found' });
  });

  it('returns structured raw detail without expanding credential placeholders', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = `<h1>Guide</h1><p>{{subscribeUrl}} {{urlEncodeSubscribeUrl}} {{safeBase64SubscribeUrl}} {{subscribeToken}}</p><!--access start--><p>${NODE}</p><!--access end--><p><script>bad</script>End</p>`;
    const upstream = fetcher({ raw: { ...ordinary(1, 'Install'), show: 1, body } });
    vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles/1');
    expect(response.status).toBe(200);
    const result = await response.json() as any;
    expect(result.data.article).toMatchObject({ id: '1', blocks: [{ type: 'heading' }, { type: 'paragraph' }, { type: 'paragraph' }] });
    const wire = JSON.stringify(result);
    expect(wire).toContain('{{subscribeUrl}}');
    for (const secret of [NODE, TOKEN, ADMIN, 'https://hidden.example/client/subscribe?token=SECRET']) {
      expect(wire).not.toContain(secret);
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    }
    expect(wire).not.toContain('"rawBody"');
    expect(wire).not.toContain('"show"');
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(new URL(String(upstream.mock.calls[1][0])).searchParams.get('id')).toBe('1');
  });

  it('uses a resolved Download Center option and omits an unavailable one', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const kv = new FakeKV();
    const href = 'https://mirror.example/https://github.com/x/y/releases/download/v1/app.hap';
    await persistDownloadCenterResolvedState(kv.binding(), { schemaVersion: 2, generatedAt: NOW, items: [
      { id: 'clashbox-harmonyos', configFingerprint: 'a'.repeat(64), lastAttemptAt: NOW, resolvedAt: NOW, expiresAt: NOW + 1000,
        data: { id: 'clashbox-harmonyos', label: 'ClashBox', platform: 'harmonyos', arch: null, version: 'v1', publishedAt: null, filename: 'secret.hap', sizeBytes: 1,
          downloads: [{ id: 'first', label: 'Fast', url: href }, { id: 'second', label: 'Backup', url: href }] } },
    ] });
    const upstream = fetcher({ raw: { ...ordinary(1, 'Install'), show: 1, body: '<p>[[download:clashbox-harmonyos:primary]] [[download:clashbox-harmonyos:backup]] [[download:missing:primary]]</p>' } });
    vi.stubGlobal('fetch', upstream);
    const response = await app.request('/api/v1/help/articles/1', { headers: { Authorization: `Bearer ${TOKEN}` } }, env(kv));
    expect(response.status).toBe(200);
    const blocks = (await response.json() as any).data.article.blocks;
    expect(blocks[0].children.filter((item: any) => item.type === 'download')).toEqual([
      { type: 'download', itemId: 'clashbox-harmonyos', slot: 'primary', label: 'ClashBox', href },
      { type: 'download', itemId: 'clashbox-harmonyos', slot: 'backup', label: 'ClashBox', href },
    ]);
    expect(JSON.stringify(blocks)).not.toContain('missing');
    expect(JSON.stringify(blocks)).not.toContain('secret.hap');
  });

  it.each([
    { list: { Guides: 'bad' } },
    { list: [ordinary(1, 'Not a grouped catalog')] },
    { list: { Guides: Array.from({ length: 501 }, (_, n) => ordinary(n + 1, 'x')) } },
    { list: { Guides: [ordinary(1, 'Install'), ordinary(1, 'Duplicate')] } },
  ])('returns neutral unavailable for malformed ordinary catalogs %j', async (fixture) => {
    const upstream = fetcher(fixture); vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles');
    expect(response.status).toBe(503);
    expect((await response.json() as any).error.code).toBe('HELP_UNAVAILABLE');
  });

  it('ignores malformed reserved metadata before public counting', async () => {
    const upstream = fetcher({ list: { Guides: [ordinary(1, 'Install')], '__AUREOLE_REGISTRY__': [{ malformed: NODE }] } });
    vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/categories');
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(NODE);
  });

  it('maps privileged raw source failures and parser/resource errors to neutral 503', async () => {
    for (const options of [
      { rawStatus: 500 },
      { raw: { ...ordinary(1, 'Install'), show: 1, body: '<!--access start-->not closed' } },
      { raw: { ...ordinary(1, 'Install'), show: 1, body: 'x'.repeat(512 * 1024 + 1) } },
    ]) {
      vi.stubGlobal('fetch', fetcher(options));
      const response = await authenticated('/api/v1/help/articles/1');
      expect(response.status).toBe(503);
      expect((await response.json() as any).error).toMatchObject({ code: 'HELP_UNAVAILABLE', message: 'Help content is unavailable' });
    }
  });

  it('rejects an oversized User Knowledge JSON response with no client-visible metadata', async () => {
    const upstream = fetcher({ list: { Guides: [ordinary(1, 'x'.repeat(1_048_576))] } });
    vi.stubGlobal('fetch', upstream);
    const response = await authenticated('/api/v1/help/articles');
    expect(response.status).toBe(503);
    const wire = JSON.stringify(await response.json());
    expect(wire).toContain('HELP_UNAVAILABLE');
    expect(wire).not.toContain('Guides');
  });
});
