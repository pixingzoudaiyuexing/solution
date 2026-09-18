import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_SETTINGS_MAX_STALE_AGE_SECONDS,
  runtimeSettingsConfigSchema,
  runtimeSettingsOperationalDefinition,
  runtimeSettingsRegistryDefinition,
} from '../src/registry/modules/runtime-settings';
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

function registryBody(config: unknown, enabled = true): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId: 'runtime-settings',
    schemaVersion: 1,
    enabled,
    config,
  });
}

function sourceFetcher(body: string | null): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.has('id')) {
      return new Response(
        JSON.stringify({
          data: {
            id: 1,
            title: 'registry:runtime-settings',
            category: '__AUREOLE_REGISTRY__',
            show: 1,
            updated_at: 100,
            body,
            raw_admin: 'RAW_ADMIN_SENTINEL AUTHORIZATION_SENTINEL',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        data:
          body === null
            ? []
            : [
                {
                  id: 1,
                  title: 'registry:runtime-settings',
                  category: '__AUREOLE_REGISTRY__',
                  show: 1,
                  updated_at: 100,
                  raw_admin: 'RAW_ADMIN_SENTINEL',
                },
              ],
        auth_data: 'AUTH_DATA_SENTINEL',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
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

describe('REG-M01 Runtime Settings definition', () => {
  it('is a public schema-v1 module with code-owned 24-hour freshness', () => {
    expect(runtimeSettingsRegistryDefinition).toMatchObject({
      moduleId: 'runtime-settings',
      schemaVersion: 1,
      maximumExposure: 'public',
    });
    expect(runtimeSettingsOperationalDefinition.freshness).toEqual({
      class: 'STALE_TOLERANT',
      maxStaleAgeSeconds: 86_400,
    });
    expect(RUNTIME_SETTINGS_MAX_STALE_AGE_SECONDS).toBe(86_400);
    expect(registryOperationalDefinitions).toEqual([
      runtimeSettingsOperationalDefinition,
    ]);
  });

  it('accepts all seven bounded presentation fields and normalizes trim', () => {
    expect(
      runtimeSettingsConfigSchema.parse({
        siteName: ' Site ',
        brandName: ' Brand ',
        title: ' Title ',
        description: ' Description ',
        logoUrl: ' https://cdn.example/logo.png ',
        faviconUrl: 'https://cdn.example/favicon.ico',
        footerText: ' Footer ',
      })
    ).toEqual({
      siteName: 'Site',
      brandName: 'Brand',
      title: 'Title',
      description: 'Description',
      logoUrl: 'https://cdn.example/logo.png',
      faviconUrl: 'https://cdn.example/favicon.ico',
      footerText: 'Footer',
    });
    expect(runtimeSettingsConfigSchema.parse({ title: 'Only title' })).toEqual({
      title: 'Only title',
    });
  });

  it.each([
    ['unknown metadata', { metadata: { arbitrary: true } }],
    ['support field', { supportUrl: 'https://support.example' }],
    ['secret field', { secret: 'SECRET_SENTINEL' }],
    ['empty text', { siteName: '   ' }],
    ['site name too long', { siteName: 'x'.repeat(121) }],
    ['title too long', { title: 'x'.repeat(161) }],
    ['description too long', { description: 'x'.repeat(513) }],
    ['footer too long', { footerText: 'x'.repeat(513) }],
    ['markup', { description: '<strong>unsafe</strong>' }],
    ['control character', { title: 'bad\u0000value' }],
    ['relative logo', { logoUrl: '/logo.png' }],
    ['HTTP logo', { logoUrl: 'http://cdn.example/logo.png' }],
    ['FTP favicon', { faviconUrl: 'ftp://cdn.example/favicon.ico' }],
    ['javascript URL', { logoUrl: 'javascript:alert(1)' }],
    ['data URL', { logoUrl: 'data:text/plain,unsafe' }],
    ['URL userinfo', { logoUrl: 'https://user:pass@cdn.example/logo.png' }],
  ])('rejects %s', (_case, config) => {
    expect(runtimeSettingsConfigSchema.safeParse(config).success).toBe(false);
  });

  it.each([
    ['unknown metadata', { siteName: 'Site', metadata: true }],
    ['support', { siteName: 'Site', supportUrl: 'https://support.example' }],
    ['secret', { siteName: 'Site', secret: 'SECRET_SENTINEL' }],
  ])('maps forbidden %s fields to A1 INVALID_SCHEMA', (_case, config) => {
    const report = validateRegistryKnowledge(
      [
        {
          sourceId: 1,
          category: REGISTRY_CATEGORY,
          title: 'registry:runtime-settings',
          show: 1,
          updatedAt: 100,
          body: registryBody(config),
        },
      ],
      [runtimeSettingsRegistryDefinition]
    );

    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SCHEMA
    );
  });

  it('projects a new allowlisted snapshot object', () => {
    const config = {
      siteName: 'Site',
      title: 'Title',
      unexpected: 'UNEXPECTED_METADATA_SENTINEL',
    } as never;
    const projected = runtimeSettingsOperationalDefinition.projectSnapshot(config);

    expect(projected).toEqual({ siteName: 'Site', title: 'Title' });
    expect(projected).not.toBe(config);
    expect(JSON.stringify(projected)).not.toContain('UNEXPECTED_METADATA_SENTINEL');
  });
});

describe('REG-M01 refresh and snapshot integration', () => {
  it('writes only the safe allowlisted Runtime Settings config', async () => {
    const kv = new FakeKV();
    const body = registryBody({
      siteName: 'Site',
      brandName: 'Brand',
      title: 'Title',
      description: 'Description',
      logoUrl: 'https://cdn.example/logo.png',
      faviconUrl: 'https://cdn.example/favicon.ico',
      footerText: 'Footer',
    });
    const result = await refreshRegistryOperationalState(env(kv), {
      now: () => 10_000,
      fetcher: sourceFetcher(body),
    });

    expect(result.ok).toBe(true);
    const loaded = await loadRegistryOperationalSnapshot(
      kv.binding(),
      registryOperationalDefinitions
    );
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules).toEqual([
        expect.objectContaining({
          moduleId: 'runtime-settings',
          latest: {
            state: RegistryValidationState.VALID_ENABLED,
            enabled: true,
          },
          lkg: expect.objectContaining({
            config: {
              siteName: 'Site',
              brandName: 'Brand',
              title: 'Title',
              description: 'Description',
              logoUrl: 'https://cdn.example/logo.png',
              faviconUrl: 'https://cdn.example/favicon.ico',
              footerText: 'Footer',
            },
          }),
        }),
      ]);
    }
    const bytes = kv.values.get(REGISTRY_SNAPSHOT_KEY) ?? '';
    for (const forbidden of [
      body,
      'aureole.registry',
      'RAW_ADMIN_SENTINEL',
      'AUTH_DATA_SENTINEL',
      'AUTHORIZATION_SENTINEL',
      'SECRET_SENTINEL',
      'unexpected',
    ]) {
      expect(bytes).not.toContain(forbidden);
    }
  });

  it('retains valid LKG after invalid refresh and clears it when disabled or absent', async () => {
    const kv = new FakeKV();
    const refresh = (body: string | null, now: number) =>
      refreshRegistryOperationalState(env(kv), {
        now: () => now,
        fetcher: sourceFetcher(body),
      });

    await refresh(registryBody({ siteName: 'Good' }), 10_000);
    await refresh(registryBody({ siteName: '<invalid>' }), 20_000);
    let loaded = await loadRegistryOperationalSnapshot(
      kv.binding(),
      registryOperationalDefinitions
    );
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toMatchObject({
        latest: { state: RegistryValidationState.INVALID_SCHEMA },
        lkg: { validatedAt: 10_000, config: { siteName: 'Good' } },
      });
    }

    await refresh(registryBody({ siteName: 'Disabled' }, false), 30_000);
    loaded = await loadRegistryOperationalSnapshot(
      kv.binding(),
      registryOperationalDefinitions
    );
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toEqual({
        moduleId: 'runtime-settings',
        latest: {
          state: RegistryValidationState.VALID_DISABLED,
          enabled: false,
        },
      });
    }

    await refresh(null, 40_000);
    loaded = await loadRegistryOperationalSnapshot(
      kv.binding(),
      registryOperationalDefinitions
    );
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toEqual({
        moduleId: 'runtime-settings',
        latest: { state: 'ABSENT' },
      });
    }
  });
});
