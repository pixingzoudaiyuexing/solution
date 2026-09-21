import { describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENTS_MAX_STALE_AGE_SECONDS,
  announcementsConfigSchema,
  announcementsOperationalDefinition,
  announcementsRegistryDefinition,
} from '../src/registry/modules/announcements';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
} from '../src/registry/kernel';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import {
  loadRegistryOperationalSnapshot,
  REGISTRY_SNAPSHOT_KEY,
} from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';

const announcement = (overrides: Record<string, unknown> = {}): {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
  sort: number;
  visibility: 'public' | 'authenticated';
} => ({
  id: 'service-update',
  title: 'Service update',
  body: 'A maintenance window is scheduled.',
  enabled: true,
  sort: 10,
  visibility: 'public',
  ...overrides,
} as {
  id: string;
  title: string;
  body: string;
  enabled: boolean;
  sort: number;
  visibility: 'public' | 'authenticated';
});

function registryBody(config: unknown, enabled = true): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId: 'announcements',
    schemaVersion: 1,
    enabled,
    config,
  });
}

function sourceFetcher(body: string | null): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.has('id')) {
      return new Response(JSON.stringify({
        data: {
          id: 12,
          title: 'registry:announcements',
          category: '__AUREOLE_REGISTRY__',
          show: 1,
          updated_at: 100,
          body,
          raw: 'RAW_ADMIN_SENTINEL',
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: body === null ? [] : [{
        id: 12,
        title: 'registry:announcements',
        category: '__AUREOLE_REGISTRY__',
        show: 1,
        updated_at: 100,
        raw: 'RAW_ADMIN_SENTINEL',
      }],
      auth_data: 'AUTH_DATA_SENTINEL',
    }), { headers: { 'Content-Type': 'application/json' } });
  });
}

function env(kv: FakeKV) {
  return {
    REGISTRY_KV: kv.binding(),
    V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
    V2BOARD_CONTROL_AUTH_DATA: 'AUTH_DATA_SENTINEL',
    V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin',
  };
}

describe('M12 announcements Registry definition', () => {
  it('uses schema v1, authenticated maximum exposure, and a 24-hour freshness bound', () => {
    expect(announcementsRegistryDefinition).toMatchObject({
      moduleId: 'announcements',
      schemaVersion: 1,
      maximumExposure: 'authenticated',
    });
    expect(announcementsOperationalDefinition.freshness).toEqual({
      class: 'STALE_TOLERANT',
      maxStaleAgeSeconds: 86_400,
    });
    expect(ANNOUNCEMENTS_MAX_STALE_AGE_SECONDS).toBe(86_400);
  });

  it('accepts bounded plain-text public and authenticated announcements', () => {
    expect(announcementsConfigSchema.parse({ items: [
      announcement({ title: ' Public ', body: ' Public body ', sort: 20 }),
      announcement({
        id: 'account-reminder',
        title: 'Account reminder',
        body: 'Please review your account.',
        sort: 10,
        visibility: 'authenticated',
      }),
    ] })).toEqual({ items: [
      announcement({ title: 'Public', body: 'Public body', sort: 20 }),
      announcement({
        id: 'account-reminder',
        title: 'Account reminder',
        body: 'Please review your account.',
        sort: 10,
        visibility: 'authenticated',
      }),
    ] });
    expect(announcementsConfigSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it.each([
    ['unknown config field', { items: [], extra: true }],
    ['invalid stable id', { items: [announcement({ id: 'Bad_ID' })] }],
    ['unknown item field', { items: [announcement({ extra: true })] }],
    ['empty title', { items: [announcement({ title: '  ' })] }],
    ['overlong title', { items: [announcement({ title: 'x'.repeat(161) })] }],
    ['empty body', { items: [announcement({ body: '  ' })] }],
    ['overlong body', { items: [announcement({ body: 'x'.repeat(4001) })] }],
    ['HTML title', { items: [announcement({ title: '<script>' })] }],
    ['HTML body', { items: [announcement({ body: '<img onerror=alert(1)>' })] }],
    ['control body', { items: [announcement({ body: 'bad\u0000body' })] }],
    ['negative sort', { items: [announcement({ sort: -1 })] }],
    ['fractional sort', { items: [announcement({ sort: 1.5 })] }],
    ['unknown visibility', { items: [announcement({ visibility: 'all' })] }],
    ['too many items', { items: Array.from({ length: 101 }, (_, index) => announcement({ id: `item-${index}` })) }],
  ])('rejects %s', (_case, config) => {
    expect(announcementsConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects duplicate IDs through Registry validation without deduplicating', () => {
    const item = announcement();
    const report = validateRegistryKnowledge([{
      sourceId: 12,
      category: REGISTRY_CATEGORY,
      title: 'registry:announcements',
      show: 1,
      updatedAt: 100,
      body: registryBody({ items: [item, item] }),
    }], [announcementsRegistryDefinition]);

    expect(report.modules[0]).toMatchObject({
      state: RegistryValidationState.INVALID_SCHEMA,
      code: 'DUPLICATE_ITEM_ID',
    });
  });

  it('projects enabled items in stable sort then ID order without source-only fields', () => {
    const projected = announcementsOperationalDefinition.projectSnapshot({
      items: [
        announcement({ id: 'z-last', sort: 10, enabled: true }),
        announcement({ id: 'disabled', sort: 0, enabled: false }),
        announcement({ id: 'a-first', sort: 10, enabled: true }),
        announcement({ id: 'early', sort: 1, enabled: true, visibility: 'authenticated' }),
      ],
    });

    expect(projected).toEqual({ items: [
      { id: 'early', title: 'Service update', body: 'A maintenance window is scheduled.', sort: 1, visibility: 'authenticated' },
      { id: 'a-first', title: 'Service update', body: 'A maintenance window is scheduled.', sort: 10, visibility: 'public' },
      { id: 'z-last', title: 'Service update', body: 'A maintenance window is scheduled.', sort: 10, visibility: 'public' },
    ] });
    expect(JSON.stringify(projected)).not.toContain('disabled');
    expect(JSON.stringify(projected)).not.toContain('enabled');
  });
});

describe('M12 announcements operational snapshot', () => {
  it('stores only the safe enabled projection', async () => {
    const kv = new FakeKV();
    const result = await refreshRegistryOperationalState(env(kv), {
      now: () => 10_000,
      fetcher: sourceFetcher(registryBody({ items: [
        announcement({ id: 'visible', sort: 2 }),
        announcement({ id: 'private', visibility: 'authenticated', sort: 1 }),
        announcement({ id: 'disabled', enabled: false, sort: 0 }),
      ] })),
    });

    expect(result.ok).toBe(true);
    const loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((item) => item.moduleId === 'announcements')).toMatchObject({
        latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
        lkg: { config: { items: [
          { id: 'private', visibility: 'authenticated' },
          { id: 'visible', visibility: 'public' },
        ] } },
      });
    }
    const bytes = kv.values.get(REGISTRY_SNAPSHOT_KEY) ?? '';
    for (const forbidden of ['RAW_ADMIN_SENTINEL', 'AUTH_DATA_SENTINEL', 'disabled', 'aureole.registry']) {
      expect(bytes).not.toContain(forbidden);
    }
  });

  it('retains bounded valid LKG after an invalid refresh but clears it for disabled or absent state', async () => {
    const kv = new FakeKV();
    const refresh = (body: string | null, now: number) => refreshRegistryOperationalState(env(kv), {
      now: () => now,
      fetcher: sourceFetcher(body),
    });

    await refresh(registryBody({ items: [announcement({ id: 'good' })] }), 10_000);
    await refresh(registryBody({ items: [announcement({ id: 'bad', body: '<unsafe>' })] }), 20_000);
    let loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((item) => item.moduleId === 'announcements')).toMatchObject({
        latest: { state: RegistryValidationState.INVALID_SCHEMA },
        lkg: { config: { items: [{ id: 'good' }] } },
      });
    }

    await refresh(registryBody({ items: [] }, false), 30_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((item) => item.moduleId === 'announcements')).toEqual({
        moduleId: 'announcements',
        latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false },
      });
    }

    await refresh(null, 40_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((item) => item.moduleId === 'announcements')).toEqual({
        moduleId: 'announcements',
        latest: { state: 'ABSENT' },
      });
    }
  });
});
