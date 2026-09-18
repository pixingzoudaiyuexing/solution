import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  REGISTRY_ALERT_KEY,
  REGISTRY_HEALTH_KEY,
  REGISTRY_SNAPSHOT_KEY,
  REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  canonicalRegistryJson,
  createRegistryModuleLkg,
  createRegistryOperationalSnapshot,
  loadRegistryOperationalSnapshot,
  persistRegistryOperationalSnapshot,
  readRegistryModuleSnapshot,
  validateFreshnessPolicy,
  type RegistryOperationalModuleDefinition,
} from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';
import { RegistryValidationState } from '../src/registry/kernel';

const configSchema = z.object({ value: z.string() }).strict();

function definition(): RegistryOperationalModuleDefinition<
  { value: string },
  { value: string }
> {
  return {
    registryDefinition: {
      moduleId: 'module-a',
      schemaVersion: 1,
      configSchema,
      maximumExposure: 'internal',
    },
    freshness: {
      class: 'FRESH_REQUIRED',
      maxSnapshotAgeSeconds: 10,
    },
    snapshotSchema: configSchema,
    projectSnapshot: (config) => config,
  };
}

async function snapshotWithTimes(input: {
  sourceFetchedAt: number;
  validatedAt: number;
  generatedAt: number;
}) {
  const lkg = await createRegistryModuleLkg({
    moduleId: 'module-a',
    sourceFetchedAt: input.sourceFetchedAt,
    validatedAt: input.validatedAt,
    config: { value: 'safe' },
  });
  return createRegistryOperationalSnapshot({
    generatedAt: input.generatedAt,
    modules: [
      {
        moduleId: 'module-a',
        latest: {
          state: RegistryValidationState.VALID_ENABLED,
          enabled: true,
        },
        lkg,
      },
    ],
  });
}

describe('Registry operational foundation', () => {
  it('uses a fixed code-owned v1 keyspace', () => {
    expect(REGISTRY_SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect([
      REGISTRY_SNAPSHOT_KEY,
      REGISTRY_HEALTH_KEY,
      REGISTRY_ALERT_KEY,
    ]).toEqual([
      'registry:snapshot:v1',
      'registry:health:v1',
      'registry:alert:v1',
    ]);
  });

  it('accepts only positive code-owned freshness bounds', () => {
    expect(
      validateFreshnessPolicy({
        class: 'FRESH_REQUIRED',
        maxSnapshotAgeSeconds: 60,
      })
    ).toEqual({
      class: 'FRESH_REQUIRED',
      maxSnapshotAgeSeconds: 60,
    });
    expect(() =>
      validateFreshnessPolicy({
        class: 'STALE_TOLERANT',
        maxStaleAgeSeconds: 0,
      })
    ).toThrowError('Invalid Registry freshness policy');
  });

  it('fails closed when validatedAt is in the reader future', async () => {
    const kv = new FakeKV();
    const moduleDefinition = definition();
    const snapshot = await snapshotWithTimes({
      sourceFetchedAt: 20_000,
      validatedAt: 20_000,
      generatedAt: 20_000,
    });
    await persistRegistryOperationalSnapshot(
      kv.binding(),
      snapshot,
      [moduleDefinition]
    );

    await expect(
      readRegistryModuleSnapshot(kv.binding(), moduleDefinition, 19_999)
    ).resolves.toEqual({ status: 'unavailable', code: 'SNAPSHOT_STALE' });
  });

  it('treats sourceFetchedAt after validatedAt as corrupt', async () => {
    const kv = new FakeKV();
    const moduleDefinition = definition();
    const snapshot = await snapshotWithTimes({
      sourceFetchedAt: 20_001,
      validatedAt: 20_000,
      generatedAt: 20_000,
    });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));

    await expect(
      loadRegistryOperationalSnapshot(kv.binding(), [moduleDefinition])
    ).resolves.toEqual({ status: 'corrupt' });
  });

  it('treats validatedAt after generatedAt as corrupt', async () => {
    const kv = new FakeKV();
    const moduleDefinition = definition();
    const snapshot = await snapshotWithTimes({
      sourceFetchedAt: 20_000,
      validatedAt: 20_000,
      generatedAt: 19_999,
    });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));

    await expect(
      loadRegistryOperationalSnapshot(kv.binding(), [moduleDefinition])
    ).resolves.toEqual({ status: 'corrupt' });
  });

  it('accepts a retained LKG whose envelope was generated later', async () => {
    const kv = new FakeKV();
    const moduleDefinition = definition();
    const snapshot = await snapshotWithTimes({
      sourceFetchedAt: 10_000,
      validatedAt: 10_000,
      generatedAt: 20_000,
    });
    kv.values.set(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(snapshot));

    await expect(
      loadRegistryOperationalSnapshot(kv.binding(), [moduleDefinition])
    ).resolves.toMatchObject({ status: 'valid' });
  });
});
