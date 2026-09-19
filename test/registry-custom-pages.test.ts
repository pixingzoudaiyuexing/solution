import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_PAGES_MAX_STALE_AGE_SECONDS,
  customPagesConfigSchema,
  customPagesOperationalDefinition,
  customPagesRegistryDefinition,
} from '../src/registry/modules/custom-pages';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
} from '../src/registry/kernel';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { REGISTRY_SNAPSHOT_KEY, loadRegistryOperationalSnapshot } from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';

describe('REG-M02 Custom Pages definition', () => {
  it('is authenticated with a code-owned 24-hour freshness policy', () => {
    expect(customPagesRegistryDefinition).toMatchObject({
      moduleId: 'custom-pages',
      schemaVersion: 1,
      maximumExposure: 'authenticated',
    });
    expect(customPagesOperationalDefinition.freshness).toEqual({
      class: 'STALE_TOLERANT',
      maxStaleAgeSeconds: 86_400,
    });
    expect(CUSTOM_PAGES_MAX_STALE_AGE_SECONDS).toBe(86_400);
    expect(registryOperationalDefinitions.map((item) => item.registryDefinition.moduleId)).toEqual([
      'runtime-settings',
      'custom-pages',
      'subscription-delivery',
    ]);
  });

  it('accepts strict ordered Custom Page items and preserves title trimming', () => {
    expect(customPagesConfigSchema.parse({
      items: [
        { id: 'notice-6', title: { default: ' Status ' }, mode: 'iframe', url: ' https://status.example ', enabled: true },
        { id: 'custom-help', title: { default: 'Help' }, mode: 'external', url: 'https://help.example', enabled: false },
      ],
    })).toEqual({
      items: [
        { id: 'notice-6', title: { default: 'Status' }, mode: 'iframe', url: 'https://status.example', enabled: true },
        { id: 'custom-help', title: { default: 'Help' }, mode: 'external', url: 'https://help.example', enabled: false },
      ],
    });
    expect(customPagesConfigSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it.each([
    ['invalid stable id', { id: 'Notice_6', title: { default: 'Title' }, mode: 'iframe', url: 'https://status.example', enabled: true }],
    ['unknown item field', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'https://status.example', enabled: true, extra: true }],
    ['missing enabled', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'https://status.example' }],
    ['empty title', { id: 'notice-6', title: { default: '  ' }, mode: 'iframe', url: 'https://status.example', enabled: true }],
    ['overlong title', { id: 'notice-6', title: { default: 'x'.repeat(256) }, mode: 'iframe', url: 'https://status.example', enabled: true }],
    ['markup title', { id: 'notice-6', title: { default: '<script>' }, mode: 'iframe', url: 'https://status.example', enabled: true }],
    ['control title', { id: 'notice-6', title: { default: 'bad\u0000title' }, mode: 'iframe', url: 'https://status.example', enabled: true }],
    ['unsupported mode', { id: 'notice-6', title: { default: 'Title' }, mode: 'redirect', url: 'https://status.example', enabled: true }],
    ['HTTP URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'http://status.example', enabled: true }],
    ['javascript URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'javascript:alert(1)', enabled: true }],
    ['data URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'data:text/plain,x', enabled: true }],
    ['file URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'file:///tmp/x', enabled: true }],
    ['relative URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: '/status', enabled: true }],
    ['protocol relative URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: '//status.example', enabled: true }],
    ['userinfo URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'https://user:pass@status.example', enabled: true }],
    ['control URL', { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'https://status.example/\u0000', enabled: true }],
  ])('rejects %s', (_case, item) => {
    expect(customPagesConfigSchema.safeParse({ items: [item] }).success).toBe(false);
  });

  it('uses A1 duplicate item-ID validation without silently deduplicating', () => {
    const item = { id: 'notice-6', title: { default: 'Title' }, mode: 'iframe', url: 'https://status.example', enabled: true };
    const report = validateRegistryKnowledge([
      { sourceId: 1, category: REGISTRY_CATEGORY, title: 'registry:custom-pages', show: 1, updatedAt: 100, body: registryBody({ items: [item, item] }) },
    ], [customPagesRegistryDefinition]);
    expect(report.modules[0]).toMatchObject({ state: RegistryValidationState.INVALID_SCHEMA, code: 'DUPLICATE_ITEM_ID' });
  });
});

function registryBody(config: unknown, enabled = true): string {
  return JSON.stringify({ kind: 'aureole.registry', moduleId: 'custom-pages', schemaVersion: 1, enabled, config });
}

function sourceFetcher(body: string | null): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.has('id')) {
      return new Response(JSON.stringify({ data: { id: 1, title: 'registry:custom-pages', category: '__AUREOLE_REGISTRY__', show: 1, updated_at: 100, body, raw: 'RAW_ADMIN_SENTINEL' } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: body === null ? [] : [{ id: 1, title: 'registry:custom-pages', category: '__AUREOLE_REGISTRY__', show: 1, updated_at: 100, raw: 'RAW_ADMIN_SENTINEL' }], auth_data: 'AUTH_DATA_SENTINEL' }), { headers: { 'Content-Type': 'application/json' } });
  });
}

function env(kv: FakeKV) {
  return { REGISTRY_KV: kv.binding(), V2BOARD_BASE_URL: 'https://backend.example/api/v1/', V2BOARD_CONTROL_AUTH_DATA: 'AUTH_DATA_SENTINEL', V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin' };
}

describe('REG-M02 operational snapshot', () => {
  it('projects only enabled items in original Registry order', async () => {
    const kv = new FakeKV();
    const result = await refreshRegistryOperationalState(env(kv), {
      now: () => 10_000,
      fetcher: sourceFetcher(registryBody({ items: [
        { id: 'notice-6', title: { default: 'First' }, mode: 'iframe', url: 'https://first.example', enabled: true },
        { id: 'disabled-page', title: { default: 'Disabled' }, mode: 'external', url: 'https://disabled.example', enabled: false },
        { id: 'notice-123', title: { default: 'Last' }, mode: 'external', url: 'https://last.example', enabled: true },
      ] })),
    });
    expect(result.ok).toBe(true);
    const loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((item) => item.moduleId === 'custom-pages')).toMatchObject({
        lkg: { config: { items: [
          { id: 'notice-6', title: 'First', url: 'https://first.example', mode: 'iframe' },
          { id: 'notice-123', title: 'Last', url: 'https://last.example', mode: 'external' },
        ] } },
      });
    }
    const bytes = kv.values.get(REGISTRY_SNAPSHOT_KEY) ?? '';
    for (const forbidden of ['RAW_ADMIN_SENTINEL', 'AUTH_DATA_SENTINEL', 'AUTHORIZATION_SENTINEL', 'secure-admin', 'disabled-page', 'title.default', 'unexpected']) {
      expect(bytes).not.toContain(forbidden);
    }
  });

  it('preserves valid LKG after invalid refresh and clears config for disabled or absent module', async () => {
    const kv = new FakeKV();
    const refresh = (body: string | null, now: number) => refreshRegistryOperationalState(env(kv), { now: () => now, fetcher: sourceFetcher(body) });
    await refresh(registryBody({ items: [{ id: 'notice-6', title: { default: 'Good' }, mode: 'iframe', url: 'https://good.example', enabled: true }] }), 10_000);
    await refresh(registryBody({ items: [{ id: 'notice-6', title: { default: '<bad>' }, mode: 'iframe', url: 'https://good.example', enabled: true }] }), 20_000);
    let loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((item) => item.moduleId === 'custom-pages')).toMatchObject({ latest: { state: RegistryValidationState.INVALID_SCHEMA }, lkg: { config: { items: [{ id: 'notice-6' }] } } });
    await refresh(registryBody({ items: [] }, false), 30_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((item) => item.moduleId === 'custom-pages')).toEqual({ moduleId: 'custom-pages', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } });
    await refresh(null, 40_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((item) => item.moduleId === 'custom-pages')).toEqual({ moduleId: 'custom-pages', latest: { state: 'ABSENT' } });
  });
});
