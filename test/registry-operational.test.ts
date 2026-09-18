import { describe, expect, it } from 'vitest';
import {
  REGISTRY_ALERT_KEY,
  REGISTRY_HEALTH_KEY,
  REGISTRY_SNAPSHOT_KEY,
  REGISTRY_SNAPSHOT_SCHEMA_VERSION,
  validateFreshnessPolicy,
} from '../src/registry/operational';

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
});
