import { describe, expect, it, vi } from 'vitest';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { REGISTRY_CATEGORY, RegistryValidationState, validateRegistryKnowledge } from '../src/registry/kernel';
import {
  SUPPORT_WIDGET_MAX_STALE_AGE_SECONDS,
  supportWidgetConfigSchema,
  supportWidgetOperationalDefinition,
  supportWidgetRegistryDefinition,
} from '../src/registry/modules/support-widget';
import { loadRegistryOperationalSnapshot } from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';

const websiteId = '123e4567-e89b-12d3-a456-426614174000';
const enabledConfig = {
  crisp: { enabled: true, websiteId },
  chatwoot: { enabled: true, baseUrl: 'https://chat.example.com', websiteToken: 'AbC12345_x' },
};

function body(config: unknown, enabled = true): string {
  return JSON.stringify({ kind: 'aureole.registry', moduleId: 'support-widget', schemaVersion: 1, enabled, config });
}

function source(bodyText: string | null): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const detail = new URL(String(input)).searchParams.has('id');
    return new Response(JSON.stringify({ data: detail
      ? { id: 14, title: 'registry:support-widget', category: REGISTRY_CATEGORY, show: 1, updated_at: 100, body: bodyText }
      : bodyText === null ? [] : [{ id: 14, title: 'registry:support-widget', category: REGISTRY_CATEGORY, show: 1, updated_at: 100 }],
    }), { headers: { 'Content-Type': 'application/json' } });
  });
}

function env(kv: FakeKV) {
  return { REGISTRY_KV: kv.binding(), V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
    V2BOARD_CONTROL_AUTH_DATA: 'AUTH_SENTINEL', V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin' };
}

describe('M10 support-widget Registry', () => {
  it('has a bounded public definition and allowlisted safe snapshot', () => {
    expect(supportWidgetRegistryDefinition).toMatchObject({ moduleId: 'support-widget', schemaVersion: 1, maximumExposure: 'public' });
    expect(supportWidgetOperationalDefinition.freshness).toEqual({ class: 'STALE_TOLERANT', maxStaleAgeSeconds: 86_400 });
    expect(SUPPORT_WIDGET_MAX_STALE_AGE_SECONDS).toBe(86_400);
    expect(registryOperationalDefinitions.at(-1)).toBe(supportWidgetOperationalDefinition);
    expect(supportWidgetOperationalDefinition.projectSnapshot(enabledConfig)).toEqual(enabledConfig);
    expect(supportWidgetOperationalDefinition.projectSnapshot({ crisp: { enabled: false }, chatwoot: { enabled: false } })).toEqual({
      crisp: { enabled: false }, chatwoot: { enabled: false },
    });
  });

  it('accepts independently enabled/disabled providers with canonical HTTPS origin', () => {
    expect(supportWidgetConfigSchema.parse({ crisp: { enabled: false }, chatwoot: {
      enabled: true, baseUrl: 'https://CHAT.example.com/', websiteToken: 'AbC12345_x',
    } })).toEqual({ crisp: { enabled: false }, chatwoot: {
      enabled: true, baseUrl: 'https://chat.example.com', websiteToken: 'AbC12345_x',
    } });
    expect(supportWidgetConfigSchema.parse({ crisp: enabledConfig.crisp, chatwoot: { enabled: false } })).toEqual({
      crisp: enabledConfig.crisp, chatwoot: { enabled: false },
    });
  });

  const invalidConfigs: Array<[string, unknown]> = [
    ['missing provider', { crisp: { enabled: false } }],
    ['unknown provider', { ...enabledConfig, custom: { enabled: true } }],
    ['unknown script field', { ...enabledConfig, crisp: { ...enabledConfig.crisp, script: 'https://evil.example/x.js' } }],
    ['string enabled', { ...enabledConfig, crisp: { enabled: 'true', websiteId } }],
    ['missing enabled value', { ...enabledConfig, crisp: { enabled: true } }],
    ['disabled retaining website ID', { ...enabledConfig, crisp: { enabled: false, websiteId } }],
    ['invalid website ID', { ...enabledConfig, crisp: { enabled: true, websiteId: 'not-a-uuid' } }],
    ['empty token', { ...enabledConfig, chatwoot: { ...enabledConfig.chatwoot, websiteToken: '' } }],
    ['token with markup', { ...enabledConfig, chatwoot: { ...enabledConfig.chatwoot, websiteToken: '<script>x</script>' } }],
    ['token with slash', { ...enabledConfig, chatwoot: { ...enabledConfig.chatwoot, websiteToken: 'AbC12345/path' } }],
    ['disabled retaining token', { ...enabledConfig, chatwoot: { ...enabledConfig.chatwoot, enabled: false } }],
    ...['http://chat.example.com', 'https://u:p@chat.example.com', 'https://chat.example.com/x',
      'https://chat.example.com?x=1', 'https://chat.example.com/#x', 'https://localhost',
      'https://chat.local', 'https://chat.internal', 'https://chat.test',
      'https://127.0.0.1', 'https://[::1]', 'https://chat.example.com:8443',
      'https://chat.example.com.', 'https://chat..example.com',
      'https://chat.example.com\\@evil.example', ' https://chat.example.com',
    ].map((baseUrl): [string, unknown] => [`invalid Chatwoot origin ${baseUrl}`, { ...enabledConfig,
      chatwoot: { ...enabledConfig.chatwoot, baseUrl } }]),
  ];

  it.each(invalidConfigs)('rejects %s', (_case, config) => {
    expect(supportWidgetConfigSchema.safeParse(config).success).toBe(false);
  });

  it('isolates invalid M10 config from unrelated Registry modules', () => {
    const records = [
      { sourceId: 14, category: REGISTRY_CATEGORY, title: 'registry:support-widget', show: 1 as const,
        updatedAt: 100, body: body({ ...enabledConfig, arbitraryScript: 'evil' }) },
      { sourceId: 15, category: REGISTRY_CATEGORY, title: 'registry:runtime-settings', show: 1 as const,
        updatedAt: 100, body: JSON.stringify({ kind: 'aureole.registry', moduleId: 'runtime-settings', schemaVersion: 1,
          enabled: true, config: { siteName: 'Site' } }) },
    ];
    const report = validateRegistryKnowledge(records, registryOperationalDefinitions.map((d) => d.registryDefinition));
    expect(report.modules.find((module) => module.moduleId === 'support-widget')?.state).toBe(RegistryValidationState.INVALID_SCHEMA);
    expect(report.modules.find((module) => module.moduleId === 'runtime-settings')?.state).toBe(RegistryValidationState.VALID_ENABLED);
  });

  it('projects only safe fields, preserves LKG on invalid source, and clears it on disable/absence', async () => {
    const kv = new FakeKV();
    const refresh = (value: string | null, at: number) => refreshRegistryOperationalState(env(kv), {
      now: () => at, fetcher: source(value),
    });
    expect((await refresh(body(enabledConfig), 10_000)).ok).toBe(true);
    let loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules.find((module) => module.moduleId === 'support-widget')?.lkg?.config).toEqual(enabledConfig);
      expect(loaded.snapshot.modules.find((module) => module.moduleId === 'runtime-settings')?.latest.state).toBe('ABSENT');
    }
    await refresh(body({ ...enabledConfig, extra: 'INVALID' }), 20_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((module) => module.moduleId === 'support-widget')).toMatchObject({
      latest: { state: RegistryValidationState.INVALID_SCHEMA }, lkg: { validatedAt: 10_000, config: enabledConfig },
    });
    await refresh(body(enabledConfig, false), 30_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((module) => module.moduleId === 'support-widget')).toEqual({
      moduleId: 'support-widget', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false },
    });
    await refresh(null, 40_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (loaded.status === 'valid') expect(loaded.snapshot.modules.find((module) => module.moduleId === 'support-widget')).toEqual({
      moduleId: 'support-widget', latest: { state: 'ABSENT' },
    });
  });
});
