import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  REGISTRY_ALERT_KEY,
  REGISTRY_HEALTH_KEY,
  REGISTRY_SNAPSHOT_KEY,
  loadRegistryAlertState,
  loadRegistryHealth,
  loadRegistryOperationalSnapshot,
  projectSecretSourceForSnapshot,
  readRegistryModuleSnapshot,
  type RegistryFreshnessPolicy,
  type RegistryOperationalModuleDefinition,
} from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import {
  createSolutionSecretResolver,
  type RegistrySecretSource,
} from '../src/registry/secrets';
import { FakeKV } from './helpers/fake-kv';

const FORBIDDEN_SENTINELS = [
  'RAW_ADMIN_SENTINEL',
  'RAW_KNOWLEDGE_SENTINEL',
  'KNOWLEDGE_SECRET_SENTINEL',
  'SOLUTION_SECRET_SENTINEL',
  'AUTH_DATA_SENTINEL',
  'AUTHORIZATION_SENTINEL',
  'SUBSCRIPTION_TOKEN_SENTINEL',
  'COUPON_SENTINEL',
  'NODE_CREDENTIAL_SENTINEL',
  'APPLE_CREDENTIAL_SENTINEL',
];

const rawMarker = FORBIDDEN_SENTINELS.filter(
  (value) => value !== 'AUTH_DATA_SENTINEL' && value !== 'SOLUTION_SECRET_SENTINEL'
).join(' ');

const secretSourceSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('knowledge'), value: z.string() }).strict(),
  z.object({ source: z.literal('solution'), ref: z.string() }).strict(),
]);
const configSchema = z
  .object({
    value: z.string(),
    rawMarker: z.string().optional(),
    secret: secretSourceSchema,
  })
  .strict();
const safeSecretSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('knowledge') }).strict(),
  z.object({ source: z.literal('solution'), ref: z.string() }).strict(),
]);
const snapshotConfigSchema = z
  .object({ value: z.string(), secret: safeSecretSchema })
  .strict();

type TestConfig = z.infer<typeof configSchema>;
type TestSnapshot = z.infer<typeof snapshotConfigSchema>;

function definition(
  moduleId: string,
  freshness: RegistryFreshnessPolicy = {
    class: 'FRESH_REQUIRED',
    maxSnapshotAgeSeconds: 60,
  }
): RegistryOperationalModuleDefinition<TestConfig, TestSnapshot> {
  return {
    registryDefinition: {
      moduleId,
      schemaVersion: 1,
      configSchema,
      maximumExposure: 'internal',
      getSecretSources: (config) => [config.secret as RegistrySecretSource],
    },
    freshness,
    snapshotSchema: snapshotConfigSchema,
    projectSnapshot: (config) => ({
      value: config.value,
      secret: projectSecretSourceForSnapshot(config.secret),
    }),
  };
}

function registryBody(
  moduleId: string,
  config: TestConfig,
  enabled = true
): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId,
    schemaVersion: 1,
    enabled,
    config,
  });
}

interface SourceModule {
  id: number;
  moduleId: string;
  body: string;
  updatedAt?: number;
  title?: string;
  show?: 0 | 1;
}

function sourceFetcher(modules: readonly SourceModule[]): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const id = url.searchParams.get('id');
    if (id === null) {
      return jsonResponse({
        data: modules.map((module) => ({
          id: module.id,
          title: module.title ?? `registry:${module.moduleId}`,
          category: '__AUREOLE_REGISTRY__',
          show: module.show ?? 1,
          updated_at: module.updatedAt ?? 100,
          raw: 'RAW_ADMIN_SENTINEL',
        })),
        raw: 'RAW_ADMIN_SENTINEL',
      });
    }
    const module = modules.find((candidate) => candidate.id === Number(id));
    if (!module) return jsonResponse({ message: 'missing' }, 404);
    return jsonResponse({
      data: {
        id: module.id,
        title: module.title ?? `registry:${module.moduleId}`,
        category: '__AUREOLE_REGISTRY__',
        show: module.show ?? 1,
        updated_at: module.updatedAt ?? 100,
        body: module.body,
        raw: 'RAW_ADMIN_SENTINEL',
      },
    });
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

function solutionResolver() {
  return createSolutionSecretResolver({
    'provider.test.api-key': () => 'SOLUTION_SECRET_SENTINEL',
  });
}

function serializedKv(kv: FakeKV): string {
  return [...kv.values.values()].join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Registry refresh safe projection and LKG', () => {
  it('persists only safe projected config and logical solution refs', async () => {
    const kv = new FakeKV();
    const definitions = [definition('knowledge-module'), definition('solution-module')];
    const result = await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      solutionSecretResolver: solutionResolver(),
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'knowledge-module',
          body: registryBody('knowledge-module', {
            value: 'safe-knowledge',
            rawMarker,
            secret: {
              source: 'knowledge',
              value: 'KNOWLEDGE_SECRET_SENTINEL',
            },
          }),
        },
        {
          id: 2,
          moduleId: 'solution-module',
          body: registryBody('solution-module', {
            value: 'safe-solution',
            rawMarker,
            secret: { source: 'solution', ref: 'provider.test.api-key' },
          }),
        },
      ]),
    });

    expect(result.ok).toBe(true);
    const bytes = serializedKv(kv);
    for (const sentinel of FORBIDDEN_SENTINELS) {
      expect(bytes).not.toContain(sentinel);
    }
    expect(bytes).toContain('provider.test.api-key');
    expect(bytes).toContain('"source":"knowledge"');
    expect([...kv.values.keys()].sort()).toEqual([
      REGISTRY_ALERT_KEY,
      REGISTRY_HEALTH_KEY,
      REGISTRY_SNAPSHOT_KEY,
    ]);
    const loaded = await loadRegistryOperationalSnapshot(kv.binding(), definitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(loaded.snapshot.modules).toEqual([
        expect.objectContaining({
          moduleId: 'knowledge-module',
          lkg: expect.objectContaining({
            config: {
              value: 'safe-knowledge',
              secret: { source: 'knowledge' },
            },
          }),
        }),
        expect.objectContaining({
          moduleId: 'solution-module',
          lkg: expect.objectContaining({
            config: {
              value: 'safe-solution',
              secret: {
                source: 'solution',
                ref: 'provider.test.api-key',
              },
            },
          }),
        }),
      ]);
    }
  });

  it('does not make fingerprints depend on omitted plaintext or raw body fields', async () => {
    const run = async (secret: string, marker: string, now: number) => {
      const kv = new FakeKV();
      const definitions = [definition('module-a')];
      const result = await refreshRegistryOperationalState(env(kv), {
        definitions,
        now: () => now,
        fetcher: sourceFetcher([
          {
            id: 1,
            moduleId: 'module-a',
            body: registryBody('module-a', {
              value: 'same-safe-value',
              rawMarker: marker,
              secret: { source: 'knowledge', value: secret },
            }),
          },
        ]),
      });
      expect(result.ok).toBe(true);
      return result.ok ? result.sourceFingerprint : '';
    };

    expect(await run('first-secret', 'first-raw-body', 10_000)).toBe(
      await run('second-secret', 'second-raw-body', 20_000)
    );
  });

  it('fails closed if a code-owned projector returns Knowledge plaintext', async () => {
    const kv = new FakeKV();
    const unsafe = definition('module-a');
    unsafe.projectSnapshot = (config) => ({
      value:
        config.secret.source === 'knowledge'
          ? config.secret.value
          : config.value,
      secret: projectSecretSourceForSnapshot(config.secret),
    });
    await refreshRegistryOperationalState(env(kv), {
      definitions: [unsafe],
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'safe',
            secret: {
              source: 'knowledge',
              value: 'KNOWLEDGE_SECRET_SENTINEL',
            },
          }),
        },
      ]),
    });

    expect(serializedKv(kv)).not.toContain('KNOWLEDGE_SECRET_SENTINEL');
    const loaded = await loadRegistryOperationalSnapshot(kv.binding(), [unsafe]);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toEqual({
        moduleId: 'module-a',
        latest: { state: 'SNAPSHOT_PROJECTION_INVALID' },
      });
    }
  });

  it('retains an invalid module LKG while unrelated valid modules update', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a'), definition('module-b')];
    const refresh = (modules: SourceModule[], now: number) =>
      refreshRegistryOperationalState(env(kv), {
        definitions,
        now: () => now,
        fetcher: sourceFetcher(modules),
      });

    await refresh(
      [
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'a-old',
            secret: { source: 'knowledge', value: 'old-secret-a' },
          }),
        },
        {
          id: 2,
          moduleId: 'module-b',
          body: registryBody('module-b', {
            value: 'b-old',
            secret: { source: 'knowledge', value: 'old-secret-b' },
          }),
        },
      ],
      10_000
    );
    await refresh(
      [
        { id: 1, moduleId: 'module-a', body: '{RAW_KNOWLEDGE_SENTINEL' },
        {
          id: 2,
          moduleId: 'module-b',
          body: registryBody('module-b', {
            value: 'b-new',
            secret: { source: 'knowledge', value: 'new-secret-b' },
          }),
        },
      ],
      20_000
    );

    const loaded = await loadRegistryOperationalSnapshot(kv.binding(), definitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toMatchObject({
        moduleId: 'module-a',
        latest: { state: 'INVALID_SYNTAX' },
        lkg: { validatedAt: 10_000, config: { value: 'a-old' } },
      });
      expect(loaded.snapshot.modules[1]).toMatchObject({
        moduleId: 'module-b',
        latest: { state: 'VALID_ENABLED' },
        lkg: { validatedAt: 20_000, config: { value: 'b-new' } },
      });
    }
  });

  it('clears old active config when a module is disabled or absent', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    const refresh = (modules: SourceModule[], now: number) =>
      refreshRegistryOperationalState(env(kv), {
        definitions,
        now: () => now,
        fetcher: sourceFetcher(modules),
      });
    const config: TestConfig = {
      value: 'active',
      secret: { source: 'knowledge', value: 'KNOWLEDGE_SECRET_SENTINEL' },
    };

    await refresh(
      [{ id: 1, moduleId: 'module-a', body: registryBody('module-a', config) }],
      1_000
    );
    await refresh(
      [
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', config, false),
        },
      ],
      2_000
    );
    let loaded = await loadRegistryOperationalSnapshot(kv.binding(), definitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toEqual({
        moduleId: 'module-a',
        latest: { state: 'VALID_DISABLED', enabled: false },
      });
    }
    await expect(
      readRegistryModuleSnapshot(kv.binding(), definitions[0], 2_000)
    ).resolves.toEqual({ status: 'disabled' });
    expect(serializedKv(kv)).not.toContain('KNOWLEDGE_SECRET_SENTINEL');

    await refresh([], 3_000);
    loaded = await loadRegistryOperationalSnapshot(kv.binding(), definitions);
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.snapshot.modules[0]).toEqual({
        moduleId: 'module-a',
        latest: { state: 'ABSENT' },
      });
    }
  });
});

describe('Registry recovery, freshness, health, and redaction', () => {
  it('rebuilds empty, deleted, malformed, and wrong-version operational state', async () => {
    const definitions = [definition('module-a')];
    for (const initial of [
      null,
      '{malformed',
      JSON.stringify({ schemaVersion: 999 }),
    ]) {
      const kv = new FakeKV();
      if (initial !== null) {
        kv.values.set(REGISTRY_SNAPSHOT_KEY, initial);
        kv.values.set(REGISTRY_HEALTH_KEY, '{bad-health');
        kv.values.set(REGISTRY_ALERT_KEY, '{bad-alert');
      }
      const run = () =>
        refreshRegistryOperationalState(env(kv), {
          definitions,
          now: () => 10_000,
          fetcher: sourceFetcher([
            {
              id: 1,
              moduleId: 'module-a',
              body: registryBody('module-a', {
                value: 'rebuilt',
                secret: { source: 'knowledge', value: 'secret' },
              }),
            },
          ]),
        });
      expect((await run()).ok).toBe(true);
      expect(
        (await loadRegistryOperationalSnapshot(kv.binding(), definitions)).status
      ).toBe('valid');
      expect(await loadRegistryHealth(kv.binding())).not.toBeNull();
      expect(await loadRegistryAlertState(kv.binding())).not.toBeNull();
      kv.clear();
      expect((await run()).ok).toBe(true);
      expect(kv.values.has(REGISTRY_SNAPSHOT_KEY)).toBe(true);
    }
  });

  it.each([
    [
      'STALE_TOLERANT',
      { class: 'STALE_TOLERANT', maxStaleAgeSeconds: 10 } as const,
    ],
    [
      'FRESH_REQUIRED',
      { class: 'FRESH_REQUIRED', maxSnapshotAgeSeconds: 10 } as const,
    ],
  ])('enforces %s just inside, at, and outside the code-owned bound', async (_case, policy) => {
    const kv = new FakeKV();
    const moduleDefinition = definition('module-a', policy);
    await refreshRegistryOperationalState(env(kv), {
      definitions: [moduleDefinition],
      now: () => 100_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'freshness',
            secret: { source: 'knowledge', value: 'secret' },
          }),
        },
      ]),
    });

    await expect(
      readRegistryModuleSnapshot(kv.binding(), moduleDefinition, 109_999)
    ).resolves.toMatchObject({ status: 'available' });
    await expect(
      readRegistryModuleSnapshot(kv.binding(), moduleDefinition, 110_000)
    ).resolves.toMatchObject({ status: 'available' });
    await expect(
      readRegistryModuleSnapshot(kv.binding(), moduleDefinition, 110_001)
    ).resolves.toEqual({ status: 'unavailable', code: 'SNAPSHOT_STALE' });
  });

  it('rejects Registry attempts to supply freshness policy through config', async () => {
    const kv = new FakeKV();
    const moduleDefinition = definition('module-a', {
      class: 'FRESH_REQUIRED',
      maxSnapshotAgeSeconds: 5,
    });
    const body = JSON.stringify({
      kind: 'aureole.registry',
      moduleId: 'module-a',
      schemaVersion: 1,
      enabled: true,
      config: {
        value: 'attack',
        secret: { source: 'knowledge', value: 'secret' },
        freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: 999999 },
      },
    });
    await refreshRegistryOperationalState(env(kv), {
      definitions: [moduleDefinition],
      now: () => 10_000,
      fetcher: sourceFetcher([{ id: 1, moduleId: 'module-a', body }]),
    });
    await expect(
      readRegistryModuleSnapshot(kv.binding(), moduleDefinition, 10_000)
    ).resolves.toEqual({ status: 'unavailable', code: 'MODULE_UNAVAILABLE' });
  });

  it('preserves snapshot and redacts health/alert on auth failure', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'good',
            secret: { source: 'knowledge', value: 'secret' },
          }),
        },
      ]),
    });
    const snapshotBefore = kv.values.get(REGISTRY_SNAPSHOT_KEY);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 20_000,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          { message: FORBIDDEN_SENTINELS.join(' ') },
          401
        )
      ),
    });

    expect(result).toEqual({
      ok: false,
      snapshotWritten: false,
      code: 'CONTROL_PLANE_AUTH_INVALID',
    });
    expect(kv.values.get(REGISTRY_SNAPSHOT_KEY)).toBe(snapshotBefore);
    const health = await loadRegistryHealth(kv.binding());
    expect(health).toMatchObject({
      status: 'error',
      source: { status: 'error', code: 'CONTROL_PLANE_AUTH_INVALID' },
    });
    const serialized = `${serializedKv(kv)}${JSON.stringify([
      ...errorSpy.mock.calls,
      ...logSpy.mock.calls,
    ])}`;
    for (const sentinel of FORBIDDEN_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it.each([
    [
      'timeout',
      'CONTROL_PLANE_TIMEOUT',
      () =>
        vi
          .fn<typeof fetch>()
          .mockRejectedValue(new DOMException('RAW_ADMIN_SENTINEL', 'TimeoutError')),
      {},
    ],
    [
      'upstream failure',
      'CONTROL_PLANE_UPSTREAM_ERROR',
      () =>
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({ message: 'RAW_ADMIN_SENTINEL' }, 500)),
      {},
    ],
    [
      'invalid deployment config',
      'CONTROL_PLANE_CONFIG_INVALID',
      () => vi.fn<typeof fetch>(),
      { V2BOARD_CONTROL_ADMIN_PREFIX: 'bad?prefix' },
    ],
  ] as const)(
    'keeps the valid snapshot on normalized %s',
    async (_case, expectedCode, fetcherFactory, envOverride) => {
      const kv = new FakeKV();
      const definitions = [definition('module-a')];
      await refreshRegistryOperationalState(env(kv), {
        definitions,
        now: () => 10_000,
        fetcher: sourceFetcher([
          {
            id: 1,
            moduleId: 'module-a',
            body: registryBody('module-a', {
              value: 'good',
              secret: { source: 'knowledge', value: 'secret' },
            }),
          },
        ]),
      });
      const snapshotBefore = kv.values.get(REGISTRY_SNAPSHOT_KEY);
      const result = await refreshRegistryOperationalState(
        { ...env(kv), ...envOverride },
        {
          definitions,
          now: () => 20_000,
          fetcher: fetcherFactory(),
        }
      );

      expect(result).toEqual({
        ok: false,
        snapshotWritten: false,
        code: expectedCode,
      });
      expect(kv.values.get(REGISTRY_SNAPSHOT_KEY)).toBe(snapshotBefore);
      expect(serializedKv(kv)).not.toContain('RAW_ADMIN_SENTINEL');
    }
  );

  it('records a safe failure streak and recovery without network delivery', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    const failed = await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'RAW_ADMIN_SENTINEL' }, 500)),
    });
    expect(failed.ok).toBe(false);
    expect(await loadRegistryAlertState(kv.binding())).toMatchObject({
      lastStatus: 'error',
      consecutiveFailures: 1,
      recoveryPending: false,
    });

    const recovered = await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 20_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'recovered',
            secret: { source: 'knowledge', value: 'secret' },
          }),
        },
      ]),
    });
    expect(recovered.ok).toBe(true);
    expect(await loadRegistryAlertState(kv.binding())).toMatchObject({
      lastStatus: 'ok',
      consecutiveFailures: 0,
      recoveryPending: true,
    });
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 30_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'still-healthy',
            secret: { source: 'knowledge', value: 'secret' },
          }),
        },
      ]),
    });
    expect(await loadRegistryAlertState(kv.binding())).toMatchObject({
      lastStatus: 'ok',
      consecutiveFailures: 0,
      recoveryPending: true,
    });
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 40_000,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'safe failure' }, 500)),
    });
    expect(await loadRegistryAlertState(kv.binding())).toMatchObject({
      lastStatus: 'degraded',
      consecutiveFailures: 1,
      recoveryPending: false,
    });
    expect(serializedKv(kv)).not.toContain('RAW_ADMIN_SENTINEL');
  });

  it('keeps a disabled module disabled when a later source refresh fails', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody(
            'module-a',
            {
              value: 'disabled',
              secret: { source: 'knowledge', value: 'secret' },
            },
            false
          ),
        },
      ]),
    });
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 20_000,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'safe failure' }, 500)),
    });

    expect(await loadRegistryHealth(kv.binding())).toMatchObject({
      source: { status: 'error', code: 'CONTROL_PLANE_UPSTREAM_ERROR' },
      modules: [
        {
          moduleId: 'module-a',
          status: 'disabled',
          checkedAt: 20_000,
          consecutiveFailures: 0,
        },
      ],
    });
  });
});

describe('Registry static source health', () => {
  it('reports active unknown modules as a normalized source error', async () => {
    const kv = new FakeKV();
    await refreshRegistryOperationalState(env(kv), {
      definitions: [],
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'unknown-module',
          body: registryBody('unknown-module', {
            value: 'unknown',
            secret: { source: 'knowledge', value: 'RAW_KNOWLEDGE_SENTINEL' },
          }),
        },
      ]),
    });

    expect(await loadRegistryHealth(kv.binding())).toMatchObject({
      status: 'error',
      source: { status: 'error', code: 'REGISTRY_SOURCE_INVALID' },
    });
    expect(serializedKv(kv)).not.toContain('RAW_KNOWLEDGE_SENTINEL');
  });

  it('reports reserved-invalid identity without exposing its raw fields', async () => {
    const kv = new FakeKV();
    await refreshRegistryOperationalState(env(kv), {
      definitions: [],
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'ignored',
          title: 'RAW_ADMIN_SENTINEL malformed-title',
          body: 'RAW_KNOWLEDGE_SENTINEL',
        },
      ]),
    });

    expect(await loadRegistryHealth(kv.binding())).toMatchObject({
      status: 'error',
      source: { status: 'error', code: 'REGISTRY_SOURCE_INVALID' },
    });
    expect(serializedKv(kv)).not.toContain('RAW_ADMIN_SENTINEL');
    expect(serializedKv(kv)).not.toContain('RAW_KNOWLEDGE_SENTINEL');
  });

  it('does not treat hidden reserved records as a source error', async () => {
    const kv = new FakeKV();
    await refreshRegistryOperationalState(env(kv), {
      definitions: [],
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'hidden-module',
          show: 0,
          body: 'RAW_KNOWLEDGE_SENTINEL',
        },
      ]),
    });

    expect(await loadRegistryHealth(kv.binding())).toMatchObject({
      status: 'ok',
      source: { status: 'ok' },
    });
  });

  it('updates known safe modules while reporting an unknown neighbor', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    await refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      fetcher: sourceFetcher([
        {
          id: 1,
          moduleId: 'module-a',
          body: registryBody('module-a', {
            value: 'known-safe',
            secret: { source: 'knowledge', value: 'known-secret' },
          }),
        },
        {
          id: 2,
          moduleId: 'unknown-module',
          body: registryBody('unknown-module', {
            value: 'unknown',
            secret: { source: 'knowledge', value: 'unknown-secret' },
          }),
        },
      ]),
    });

    expect(await loadRegistryHealth(kv.binding())).toMatchObject({
      status: 'error',
      source: { status: 'error', code: 'REGISTRY_SOURCE_INVALID' },
      modules: [expect.objectContaining({ moduleId: 'module-a', status: 'ok' })],
    });
    await expect(
      readRegistryModuleSnapshot(kv.binding(), definitions[0], 10_000)
    ).resolves.toMatchObject({
      status: 'available',
      config: { value: 'known-safe' },
    });
  });
});

describe('Registry concurrent refresh safety', () => {
  it('does not let an overlapping source failure overwrite a successful snapshot', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const successBase = sourceFetcher([
      {
        id: 1,
        moduleId: 'module-a',
        body: registryBody('module-a', {
          value: 'success',
          secret: { source: 'knowledge', value: 'secret' },
        }),
      },
    ]);
    let first = true;
    const delayedSuccess: typeof fetch = async (input, init) => {
      if (first) {
        first = false;
        await gate;
      }
      return successBase(input, init);
    };
    const success = refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 20_000,
      fetcher: delayedSuccess,
    });
    await Promise.resolve();
    const failure = refreshRegistryOperationalState(env(kv), {
      definitions,
      now: () => 10_000,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'safe failure' }, 500)),
    });
    expect((await failure).ok).toBe(false);
    release();
    expect((await success).ok).toBe(true);
    expect(
      (await loadRegistryOperationalSnapshot(kv.binding(), definitions)).status
    ).toBe('valid');
  });

  it('persists only independently valid candidates across overlapping successes', async () => {
    const kv = new FakeKV();
    const definitions = [definition('module-a')];
    const run = (value: string, now: number) =>
      refreshRegistryOperationalState(env(kv), {
        definitions,
        now: () => now,
        fetcher: sourceFetcher([
          {
            id: 1,
            moduleId: 'module-a',
            body: registryBody('module-a', {
              value,
              secret: { source: 'knowledge', value: `secret-${value}` },
            }),
          },
        ]),
      });
    const results = await Promise.all([run('first', 10_000), run('second', 20_000)]);
    expect(results.every((result) => result.ok)).toBe(true);

    const snapshotWrites = kv.writes.filter(
      ({ key }) => key === REGISTRY_SNAPSHOT_KEY
    );
    expect(snapshotWrites).toHaveLength(2);
    for (const write of snapshotWrites) {
      const candidate = new FakeKV();
      candidate.values.set(REGISTRY_SNAPSHOT_KEY, write.value);
      expect(
        (await loadRegistryOperationalSnapshot(candidate.binding(), definitions))
          .status
      ).toBe('valid');
    }
    const final = await loadRegistryOperationalSnapshot(kv.binding(), definitions);
    expect(final.status).toBe('valid');
    if (final.status === 'valid') {
      expect([10_000, 20_000]).toContain(final.snapshot.generatedAt);
    }
  });
});
