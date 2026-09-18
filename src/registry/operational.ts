import { z } from 'zod';
import {
  RegistryValidationState,
  type RegistryModuleDefinition,
  type RegistryValidationCode,
} from './kernel';
import type { ExposureClass } from './exposure';
import type { RegistrySecretSource } from './secrets';
import { isStableId } from './stable-id';
import { parseStrictJson } from './strict-json';

export const REGISTRY_SNAPSHOT_KEY = 'registry:snapshot:v1';
export const REGISTRY_HEALTH_KEY = 'registry:health:v1';
export const REGISTRY_ALERT_KEY = 'registry:alert:v1';
export const REGISTRY_SNAPSHOT_SCHEMA_VERSION = 1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const timestampSchema = z.number().int().nonnegative();
const stableIdSchema = z.string().refine(isStableId);
const exposureSchema = z.enum(['public', 'authenticated', 'internal']);
const healthStatusSchema = z.enum(['ok', 'degraded', 'error', 'disabled']);
const healthCodeSchema = z.enum([
  'CONTROL_PLANE_AUTH_INVALID',
  'CONTROL_PLANE_CONFIG_INVALID',
  'CONTROL_PLANE_TIMEOUT',
  'CONTROL_PLANE_UPSTREAM_ERROR',
  'KV_UNAVAILABLE',
  'VALID_ENABLED',
  'VALID_DISABLED',
  'INVALID_SYNTAX',
  'INVALID_SCHEMA',
  'UNSUPPORTED_VERSION',
  'DUPLICATE_MODULE',
  'DEPENDENCY_INVALID',
  'SECRET_UNRESOLVED',
  'DUPLICATE_ITEM_ID',
  'EXPOSURE_BROADENING',
  'IDENTITY_INVALID',
  'REFERENCE_INVALID',
  'UNKNOWN_MODULE',
  'MODULE_ABSENT',
  'REGISTRY_SOURCE_INVALID',
  'SNAPSHOT_PROJECTION_INVALID',
]);

const validationStateSchema = z.nativeEnum(RegistryValidationState);
const validationCodeSchema = z.enum([
  'DUPLICATE_ITEM_ID',
  'EXPOSURE_BROADENING',
  'IDENTITY_INVALID',
  'REFERENCE_INVALID',
  'UNKNOWN_MODULE',
]);

export type RegistryFreshnessPolicy =
  | {
      class: 'STALE_TOLERANT';
      maxStaleAgeSeconds: number;
    }
  | {
      class: 'FRESH_REQUIRED';
      maxSnapshotAgeSeconds: number;
    };

export interface RegistryOperationalModuleDefinition<
  Config = unknown,
  SnapshotConfig = unknown,
> {
  registryDefinition: RegistryModuleDefinition<Config>;
  freshness: RegistryFreshnessPolicy;
  snapshotSchema: z.ZodType<SnapshotConfig>;
  projectSnapshot(config: Config): SnapshotConfig;
}

export function validateFreshnessPolicy(
  policy: RegistryFreshnessPolicy
): RegistryFreshnessPolicy {
  const bound =
    policy.class === 'STALE_TOLERANT'
      ? policy.maxStaleAgeSeconds
      : policy.maxSnapshotAgeSeconds;
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new Error('Invalid Registry freshness policy');
  }
  return { ...policy };
}

export type SafeSecretSourceSnapshot =
  | { source: 'knowledge' }
  | { source: 'solution'; ref: string };

export function projectSecretSourceForSnapshot(
  source: RegistrySecretSource
): SafeSecretSourceSnapshot {
  if (source.source === 'knowledge') return { source: 'knowledge' };
  if (
    !source.ref ||
    source.ref.length > 255 ||
    !source.ref.split('.').every(isStableId)
  ) {
    throw new Error('Invalid Registry secret source projection');
  }
  return { source: 'solution', ref: source.ref };
}

type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-JSON Registry value');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value !== 'object') throw new Error('Non-JSON Registry value');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Non-JSON Registry value');
  }
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    normalized[key] = normalizeJson((value as Record<string, unknown>)[key]);
  }
  return normalized;
}

export function canonicalRegistryJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRegistryJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const latestStateSchema = z
  .object({
    state: z.union([
      validationStateSchema,
      z.literal('ABSENT'),
      z.literal('SNAPSHOT_PROJECTION_INVALID'),
    ]),
    code: validationCodeSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type RegistryLatestState = z.infer<typeof latestStateSchema>;

const sourceMetadataSchema = z
  .object({
    sourceId: z.number().int().positive().max(2_147_483_647),
    updatedAt: timestampSchema,
  })
  .strict();

const lkgSchema = z
  .object({
    validatedAt: timestampSchema,
    sourceFetchedAt: timestampSchema,
    sourceFingerprint: z.string().regex(SHA256_PATTERN),
    source: sourceMetadataSchema.optional(),
    exposure: exposureSchema.optional(),
    config: z.unknown(),
  })
  .strict();

export interface RegistryModuleLkg<SnapshotConfig = unknown> {
  validatedAt: number;
  sourceFetchedAt: number;
  sourceFingerprint: string;
  source?: { sourceId: number; updatedAt: number };
  exposure?: ExposureClass;
  config: SnapshotConfig;
}

const moduleSnapshotSchema = z
  .object({
    moduleId: stableIdSchema,
    latest: latestStateSchema,
    lkg: lkgSchema.optional(),
  })
  .strict();

const snapshotEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SNAPSHOT_SCHEMA_VERSION),
    generatedAt: timestampSchema,
    sourceFingerprint: z.string().regex(SHA256_PATTERN),
    modules: z.array(moduleSnapshotSchema),
  })
  .strict();

export interface RegistryModuleSnapshot<SnapshotConfig = unknown> {
  moduleId: string;
  latest: RegistryLatestState;
  lkg?: RegistryModuleLkg<SnapshotConfig>;
}

export interface RegistryOperationalSnapshot {
  schemaVersion: 1;
  generatedAt: number;
  sourceFingerprint: string;
  modules: RegistryModuleSnapshot[];
}

export type RegistrySnapshotLoadResult =
  | { status: 'missing' }
  | { status: 'corrupt' }
  | { status: 'valid'; snapshot: RegistryOperationalSnapshot };

function operationalDefinitionsById(
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[]
): Map<string, RegistryOperationalModuleDefinition<any, any>> {
  const map = new Map<string, RegistryOperationalModuleDefinition<any, any>>();
  for (const definition of definitions) {
    const moduleId = definition.registryDefinition.moduleId;
    if (!isStableId(moduleId) || map.has(moduleId)) {
      throw new Error('Invalid Registry operational module definition');
    }
    validateFreshnessPolicy(definition.freshness);
    map.set(moduleId, definition);
  }
  return map;
}

async function moduleFingerprint(
  moduleId: string,
  lkg: Omit<RegistryModuleLkg, 'sourceFingerprint'>
): Promise<string> {
  return sha256({
    moduleId,
    ...(lkg.source === undefined ? {} : { source: lkg.source }),
    ...(lkg.exposure === undefined ? {} : { exposure: lkg.exposure }),
    config: lkg.config,
  });
}

// Safe content correlation metadata only, not a MAC or freshness authority.
async function snapshotFingerprint(
  snapshot: Omit<RegistryOperationalSnapshot, 'sourceFingerprint'>
): Promise<string> {
  return sha256({
    schemaVersion: snapshot.schemaVersion,
    modules: snapshot.modules.map((module) => ({
      moduleId: module.moduleId,
      latest: module.latest,
      ...(module.lkg === undefined
        ? {}
        : { lkgSourceFingerprint: module.lkg.sourceFingerprint }),
    })),
  });
}

export async function createRegistryModuleLkg<SnapshotConfig>(input: {
  moduleId: string;
  validatedAt: number;
  sourceFetchedAt: number;
  source?: { sourceId: number; updatedAt: number };
  exposure?: ExposureClass;
  config: SnapshotConfig;
}): Promise<RegistryModuleLkg<SnapshotConfig>> {
  const withoutFingerprint = {
    validatedAt: input.validatedAt,
    sourceFetchedAt: input.sourceFetchedAt,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.exposure === undefined ? {} : { exposure: input.exposure }),
    config: normalizeJson(input.config) as SnapshotConfig,
  };
  return {
    ...withoutFingerprint,
    sourceFingerprint: await moduleFingerprint(
      input.moduleId,
      withoutFingerprint
    ),
  };
}

export async function createRegistryOperationalSnapshot(input: {
  generatedAt: number;
  modules: RegistryModuleSnapshot[];
}): Promise<RegistryOperationalSnapshot> {
  const withoutFingerprint = {
    schemaVersion: REGISTRY_SNAPSHOT_SCHEMA_VERSION as 1,
    generatedAt: input.generatedAt,
    modules: [...input.modules].sort((a, b) =>
      a.moduleId.localeCompare(b.moduleId)
    ),
  };
  return {
    ...withoutFingerprint,
    sourceFingerprint: await snapshotFingerprint(withoutFingerprint),
  };
}

async function validateSnapshot(
  value: unknown,
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[]
): Promise<RegistryOperationalSnapshot | null> {
  const parsed = snapshotEnvelopeSchema.safeParse(value);
  if (!parsed.success) return null;
  const definitionsById = operationalDefinitionsById(definitions);
  const seen = new Set<string>();

  for (const module of parsed.data.modules) {
    if (seen.has(module.moduleId)) return null;
    seen.add(module.moduleId);
    const definition = definitionsById.get(module.moduleId);
    if (!definition) return null;
    if (
      (module.latest.state === RegistryValidationState.VALID_ENABLED &&
        (module.latest.enabled !== true || module.lkg === undefined)) ||
      ((module.latest.state === RegistryValidationState.VALID_DISABLED ||
        module.latest.state === 'ABSENT') &&
        (module.lkg !== undefined ||
          (module.latest.state === RegistryValidationState.VALID_DISABLED &&
            module.latest.enabled !== false) ||
          (module.latest.state === 'ABSENT' &&
            module.latest.enabled !== undefined))) ||
      ((module.latest.state !== RegistryValidationState.VALID_ENABLED &&
        module.latest.state !== RegistryValidationState.VALID_DISABLED &&
        module.latest.state !== 'ABSENT') &&
        module.latest.enabled !== undefined)
    ) {
      return null;
    }
    if (module.lkg) {
      if (
        module.lkg.sourceFetchedAt > module.lkg.validatedAt ||
        module.lkg.validatedAt > parsed.data.generatedAt
      ) {
        return null;
      }
      const config = definition.snapshotSchema.safeParse(module.lkg.config);
      if (!config.success) return null;
      try {
        canonicalRegistryJson(config.data);
      } catch {
        return null;
      }
      const expected = await moduleFingerprint(module.moduleId, {
        validatedAt: module.lkg.validatedAt,
        sourceFetchedAt: module.lkg.sourceFetchedAt,
        ...(module.lkg.source === undefined
          ? {}
          : { source: module.lkg.source }),
        ...(module.lkg.exposure === undefined
          ? {}
          : { exposure: module.lkg.exposure }),
        config: config.data,
      });
      if (expected !== module.lkg.sourceFingerprint) return null;
      module.lkg.config = config.data;
    }
  }

  const expected = await snapshotFingerprint({
    schemaVersion: REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: parsed.data.generatedAt,
    modules: parsed.data.modules as RegistryModuleSnapshot[],
  });
  if (expected !== parsed.data.sourceFingerprint) return null;
  return parsed.data as unknown as RegistryOperationalSnapshot;
}

export async function loadRegistryOperationalSnapshot(
  kv: KVNamespace,
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[]
): Promise<RegistrySnapshotLoadResult> {
  let text: string | null;
  try {
    text = await kv.get(REGISTRY_SNAPSHOT_KEY, 'text');
  } catch {
    return { status: 'corrupt' };
  }
  if (text === null) return { status: 'missing' };
  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch {
    return { status: 'corrupt' };
  }
  const snapshot = await validateSnapshot(value, definitions);
  return snapshot ? { status: 'valid', snapshot } : { status: 'corrupt' };
}

export async function persistRegistryOperationalSnapshot(
  kv: KVNamespace,
  snapshot: RegistryOperationalSnapshot,
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[]
): Promise<void> {
  const validated = await validateSnapshot(snapshot, definitions);
  if (!validated) throw new Error('Invalid Registry operational snapshot');
  await kv.put(REGISTRY_SNAPSHOT_KEY, canonicalRegistryJson(validated));
}

export interface RegistryFreshnessEvaluation {
  usable: boolean;
  ageSeconds: number;
}

export function evaluateRegistryFreshness(
  validatedAt: number,
  policy: RegistryFreshnessPolicy,
  now: number
): RegistryFreshnessEvaluation {
  validateFreshnessPolicy(policy);
  if (validatedAt > now) {
    return { usable: false, ageSeconds: 0 };
  }
  const ageMilliseconds = Math.max(0, now - validatedAt);
  const maximumSeconds =
    policy.class === 'STALE_TOLERANT'
      ? policy.maxStaleAgeSeconds
      : policy.maxSnapshotAgeSeconds;
  return {
    usable: ageMilliseconds <= maximumSeconds * 1000,
    ageSeconds: Math.floor(ageMilliseconds / 1000),
  };
}

export type RegistryModuleReadResult<SnapshotConfig = unknown> =
  | {
      status: 'available';
      config: SnapshotConfig;
      ageSeconds: number;
      freshnessClass: RegistryFreshnessPolicy['class'];
      latestState: RegistryLatestState['state'];
    }
  | { status: 'disabled' }
  | {
      status: 'unavailable';
      code:
        | 'SNAPSHOT_MISSING'
        | 'SNAPSHOT_CORRUPT'
        | 'MODULE_UNAVAILABLE'
        | 'SNAPSHOT_STALE';
    };

export async function readRegistryModuleSnapshot<Config, SnapshotConfig>(
  kv: KVNamespace,
  definition: RegistryOperationalModuleDefinition<Config, SnapshotConfig>,
  now: number,
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[] = [
    definition,
  ]
): Promise<RegistryModuleReadResult<SnapshotConfig>> {
  const loaded = await loadRegistryOperationalSnapshot(kv, definitions);
  if (loaded.status === 'missing') {
    return { status: 'unavailable', code: 'SNAPSHOT_MISSING' };
  }
  if (loaded.status === 'corrupt') {
    return { status: 'unavailable', code: 'SNAPSHOT_CORRUPT' };
  }
  const module = loaded.snapshot.modules.find(
    (candidate) => candidate.moduleId === definition.registryDefinition.moduleId
  );
  if (!module) return { status: 'unavailable', code: 'MODULE_UNAVAILABLE' };
  if (module.latest.state === RegistryValidationState.VALID_DISABLED) {
    return { status: 'disabled' };
  }
  if (!module.lkg) return { status: 'unavailable', code: 'MODULE_UNAVAILABLE' };
  const freshness = evaluateRegistryFreshness(
    module.lkg.validatedAt,
    definition.freshness,
    now
  );
  if (!freshness.usable) {
    return { status: 'unavailable', code: 'SNAPSHOT_STALE' };
  }
  return {
    status: 'available',
    config: module.lkg.config as SnapshotConfig,
    ageSeconds: freshness.ageSeconds,
    freshnessClass: definition.freshness.class,
    latestState: module.latest.state,
  };
}

export type RegistryHealthStatus = z.infer<typeof healthStatusSchema>;

const healthModuleSchema = z
  .object({
    moduleId: stableIdSchema,
    status: healthStatusSchema,
    code: healthCodeSchema.optional(),
    checkedAt: timestampSchema,
    validatedAt: timestampSchema.optional(),
    ageSeconds: z.number().int().nonnegative().optional(),
    sourceClass: z.enum(['control-plane', 'snapshot', 'lkg']).optional(),
    consecutiveFailures: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();

const healthEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SNAPSHOT_SCHEMA_VERSION),
    status: healthStatusSchema,
    checkedAt: timestampSchema,
    source: z
      .object({
        status: healthStatusSchema,
        code: healthCodeSchema.optional(),
      })
      .strict(),
    modules: z.array(healthModuleSchema),
  })
  .strict();

export type RegistryOperationalHealth = z.infer<typeof healthEnvelopeSchema>;

const alertEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(REGISTRY_SNAPSHOT_SCHEMA_VERSION),
    lastStatus: healthStatusSchema,
    fingerprint: z.string().regex(SHA256_PATTERN),
    consecutiveFailures: z.number().int().nonnegative().max(1_000_000),
    lastCheckedAt: timestampSchema,
    lastAlertAt: timestampSchema.optional(),
    recoveryPending: z.boolean(),
  })
  .strict();

export type RegistryAlertState = z.infer<typeof alertEnvelopeSchema>;

async function loadStrictRecord<T>(
  kv: KVNamespace,
  key: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  let text: string | null;
  try {
    text = await kv.get(key, 'text');
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const parsed = schema.safeParse(parseStrictJson(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function loadRegistryHealth(
  kv: KVNamespace
): Promise<RegistryOperationalHealth | null> {
  return loadStrictRecord(kv, REGISTRY_HEALTH_KEY, healthEnvelopeSchema);
}

export function loadRegistryAlertState(
  kv: KVNamespace
): Promise<RegistryAlertState | null> {
  return loadStrictRecord(kv, REGISTRY_ALERT_KEY, alertEnvelopeSchema);
}

export async function persistRegistryHealth(
  kv: KVNamespace,
  health: RegistryOperationalHealth
): Promise<void> {
  const parsed = healthEnvelopeSchema.safeParse(health);
  if (!parsed.success) throw new Error('Invalid Registry health');
  await kv.put(REGISTRY_HEALTH_KEY, canonicalRegistryJson(parsed.data));
}

export async function createRegistryAlertState(
  health: RegistryOperationalHealth,
  previous: RegistryAlertState | null
): Promise<RegistryAlertState> {
  const failing = health.status === 'degraded' || health.status === 'error';
  const previouslyFailing =
    previous?.lastStatus === 'degraded' || previous?.lastStatus === 'error';
  const normalized = {
    status: health.status,
    sourceStatus: health.source.status,
    sourceCode: health.source.code ?? null,
    modules: health.modules.map(({ moduleId, status, code }) => ({
      moduleId,
      status,
      code: code ?? null,
    })),
  };
  return {
    schemaVersion: REGISTRY_SNAPSHOT_SCHEMA_VERSION,
    lastStatus: health.status,
    fingerprint: await sha256(normalized),
    consecutiveFailures: failing
      ? Math.min((previous?.consecutiveFailures ?? 0) + 1, 1_000_000)
      : 0,
    lastCheckedAt: health.checkedAt,
    ...(previous?.lastAlertAt === undefined
      ? {}
      : { lastAlertAt: previous.lastAlertAt }),
    recoveryPending: failing
      ? false
      : Boolean(previous?.recoveryPending || previouslyFailing),
  };
}

export async function persistRegistryAlertState(
  kv: KVNamespace,
  alert: RegistryAlertState
): Promise<void> {
  const parsed = alertEnvelopeSchema.safeParse(alert);
  if (!parsed.success) throw new Error('Invalid Registry alert state');
  await kv.put(REGISTRY_ALERT_KEY, canonicalRegistryJson(parsed.data));
}

export function toLatestState(input: {
  state: RegistryValidationState;
  code?: RegistryValidationCode;
  enabled?: boolean;
}): RegistryLatestState {
  return {
    state: input.state,
    ...(input.code === undefined ? {} : { code: input.code }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  };
}
