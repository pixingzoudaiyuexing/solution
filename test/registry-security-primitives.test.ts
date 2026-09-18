import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  projectAllowlistedFields,
} from '../src/registry/projection';
import {
  narrowExposure,
  type ExposureClass,
} from '../src/registry/exposure';
import {
  RegistrySecretError,
  SensitiveSecret,
  createSolutionSecretResolver,
  resolveControlPlaneBootstrapSecret,
  resolveProviderSecret,
  type RegistrySecretSource,
} from '../src/registry/secrets';
import {
  RegistryValidationState,
  validateRegistryKnowledge,
  type RegistryModuleDefinition,
} from '../src/registry/kernel';

describe('Registry exposure policy', () => {
  it.each([
    ['public', 'public', 'public'],
    ['public', 'authenticated', 'authenticated'],
    ['public', 'internal', 'internal'],
    ['authenticated', 'authenticated', 'authenticated'],
    ['authenticated', 'internal', 'internal'],
    ['internal', 'internal', 'internal'],
  ] satisfies Array<[ExposureClass, ExposureClass, ExposureClass]>)
    ('allows %s maximum to resolve as %s', (maximum, requested, expected) => {
      expect(narrowExposure(maximum, requested)).toBe(expected);
    });

  it.each([
    ['authenticated', 'public'],
    ['internal', 'authenticated'],
    ['internal', 'public'],
  ] satisfies Array<[ExposureClass, ExposureClass]>)
    ('prevents broadening %s to %s', (maximum, requested) => {
      expect(narrowExposure(maximum, requested)).toBeNull();
    });

  it('fails a module whose config attempts to broaden code-owned exposure', () => {
    const schema = z.object({ exposure: z.enum(['public', 'authenticated', 'internal']) }).strict();
    const definition: RegistryModuleDefinition<z.infer<typeof schema>> = {
      moduleId: 'module-a',
      schemaVersion: 1,
      configSchema: schema,
      maximumExposure: 'authenticated',
      getRequestedExposure: (config) => config.exposure,
    };
    const body = JSON.stringify({
      kind: 'aureole.registry',
      moduleId: 'module-a',
      schemaVersion: 1,
      enabled: true,
      config: { exposure: 'public' },
    });
    const report = validateRegistryKnowledge(
      [{
        sourceId: 1,
        category: '__AUREOLE_REGISTRY__',
        title: 'registry:module-a',
        show: 1,
        updatedAt: 1,
        body,
      }],
      [definition]
    );
    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SCHEMA
    );
  });
});

describe('Registry DTO allowlist projection', () => {
  it('builds a new DTO from explicitly approved fields only', () => {
    const source = {
      safe: 'public-value',
      secret: 'PROVIDER_SECRET_SENTINEL',
      internal: 'internal-only',
      unknown: 'unknown-value',
    };

    const projected = projectAllowlistedFields(source, ['safe'] as const);

    expect(projected).toEqual({ safe: 'public-value' });
    expect(JSON.stringify(projected)).not.toContain('PROVIDER_SECRET_SENTINEL');
    expect(projected).not.toBe(source);
  });
});

describe('Registry secret source model', () => {
  it('supports explicit provider knowledge plaintext without serialization', () => {
    const sentinel = 'PROVIDER_SECRET_SENTINEL';
    const source: RegistrySecretSource = { source: 'knowledge', value: sentinel };
    const secret = resolveProviderSecret(
      source,
      createSolutionSecretResolver({})
    );

    expect(secret).toBeInstanceOf(SensitiveSecret);
    expect(JSON.stringify({ secret })).not.toContain(sentinel);
    expect(secret?.consume()).toBe(sentinel);
  });

  it('resolves provider solution refs only through a code-owned allowlist', () => {
    const sentinel = 'PROVIDER_SECRET_SENTINEL';
    process.env.REGISTRY_ATTACKER_SELECTED_ENV = sentinel;
    const resolver = createSolutionSecretResolver({
      'provider.test.api-key': () => sentinel,
    });

    expect(
      resolveProviderSecret(
        { source: 'solution', ref: 'provider.test.api-key' },
        resolver
      )?.consume()
    ).toBe(sentinel);
    expect(() =>
      resolveProviderSecret(
        { source: 'solution', ref: 'REGISTRY_ATTACKER_SELECTED_ENV' },
        resolver
      )
    ).toThrowError(RegistrySecretError);
    delete process.env.REGISTRY_ATTACKER_SELECTED_ENV;
  });

  it('keeps bootstrap credentials outside generic Registry secret resolution', () => {
    const sentinel = 'AUTH_DATA_SENTINEL';
    const bootstrap = resolveControlPlaneBootstrapSecret(sentinel);
    expect(bootstrap.consume()).toBe(sentinel);
    expect(JSON.stringify(bootstrap)).not.toContain(sentinel);

    expect(() =>
      resolveProviderSecret(
        { source: 'knowledge', value: sentinel },
        createSolutionSecretResolver({}),
        'bootstrap'
      )
    ).toThrowError(RegistrySecretError);
  });

  it('does not expose secret plaintext through errors or console output', () => {
    const sentinel = 'PROVIDER_SECRET_SENTINEL';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const resolver = createSolutionSecretResolver({
      'provider.test.missing': () => undefined,
    });

    let thrown: unknown;
    try {
      resolveProviderSecret(
        { source: 'solution', ref: 'provider.test.missing' },
        resolver
      );
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(RegistrySecretError);
    expect(String((thrown as Error).message)).not.toContain(sentinel);
    expect(JSON.stringify(thrown)).not.toContain(sentinel);
    expect(JSON.stringify([...error.mock.calls, ...log.mock.calls])).not.toContain(
      sentinel
    );
    vi.restoreAllMocks();
  });

  it('integrates provider secret resolution with module-level fail closed', () => {
    const sentinel = 'PROVIDER_SECRET_SENTINEL';
    const configSchema = z
      .object({ secret: z.unknown() })
      .strict();
    const moduleDefinition = (
      moduleId: string
    ): RegistryModuleDefinition<z.infer<typeof configSchema>> => ({
      moduleId,
      schemaVersion: 1,
      configSchema,
      maximumExposure: 'internal',
      getSecretSources: (config) => [config.secret as RegistrySecretSource],
    });
    const registryRecord = (moduleId: string, secret: unknown, sourceId: number) => ({
      sourceId,
      category: '__AUREOLE_REGISTRY__',
      title: `registry:${moduleId}`,
      show: 1 as const,
      updatedAt: 1,
      body: JSON.stringify({
        kind: 'aureole.registry',
        moduleId,
        schemaVersion: 1,
        enabled: true,
        config: { secret },
      }),
    });
    const resolver = createSolutionSecretResolver({
      'provider.test.api-key': () => sentinel,
    });
    const report = validateRegistryKnowledge(
      [
        registryRecord(
          'knowledge-module',
          { source: 'knowledge', value: sentinel },
          1
        ),
        registryRecord(
          'solution-module',
          { source: 'solution', ref: 'provider.test.api-key' },
          2
        ),
        registryRecord(
          'missing-module',
          { source: 'solution', ref: 'provider.missing.api-key' },
          3
        ),
      ],
      [
        moduleDefinition('knowledge-module'),
        moduleDefinition('solution-module'),
        moduleDefinition('missing-module'),
      ],
      { solutionSecretResolver: resolver }
    );

    expect(report.modules.map(({ moduleId, state }) => [moduleId, state])).toEqual([
      ['knowledge-module', RegistryValidationState.VALID_ENABLED],
      ['solution-module', RegistryValidationState.VALID_ENABLED],
      ['missing-module', RegistryValidationState.SECRET_UNRESOLVED],
    ]);
    expect(JSON.stringify(report)).not.toContain(sentinel);
  });
});
