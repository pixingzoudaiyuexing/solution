import type { Env } from '../config/env';
import {
  ControlPlaneError,
  ControlPlaneErrorCode,
  createV2BoardControlPlaneClient,
} from '../adapters/v2board/control-plane';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
  type RegistryKnowledgeRecord,
} from './kernel';
import type { SolutionSecretResolver } from './secrets';
import { registryOperationalDefinitions } from './definitions';
import {
  createRegistryAlertState,
  createRegistryModuleLkg,
  createRegistryOperationalSnapshot,
  evaluateRegistryFreshness,
  loadRegistryAlertState,
  loadRegistryHealth,
  loadRegistryOperationalSnapshot,
  persistRegistryAlertState,
  persistRegistryHealth,
  persistRegistryOperationalSnapshot,
  toLatestState,
  type RegistryHealthStatus,
  type RegistryModuleSnapshot,
  type RegistryOperationalHealth,
  type RegistryOperationalModuleDefinition,
} from './operational';

export type RegistryRefreshCode =
  | 'KV_UNAVAILABLE'
  | 'CONTROL_PLANE_AUTH_INVALID'
  | 'CONTROL_PLANE_CONFIG_INVALID'
  | 'CONTROL_PLANE_TIMEOUT'
  | 'CONTROL_PLANE_UPSTREAM_ERROR';

export type RegistryRefreshResult =
  | {
      ok: true;
      snapshotWritten: true;
      sourceFingerprint: string;
    }
  | {
      ok: false;
      snapshotWritten: false;
      code: RegistryRefreshCode;
    };

export interface RegistryRefreshOptions {
  definitions?: readonly RegistryOperationalModuleDefinition<any, any>[];
  fetcher?: typeof fetch;
  now?: () => number;
  solutionSecretResolver?: SolutionSecretResolver;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid Registry clock');
  }
  return value;
}

function recordForModule(
  records: readonly RegistryKnowledgeRecord[],
  moduleId: string
): RegistryKnowledgeRecord | undefined {
  const matches = records.filter(
    (record) =>
      record.category === REGISTRY_CATEGORY &&
      record.show === 1 &&
      record.title === `registry:${moduleId}`
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function containsSensitiveString(value: unknown, secret: string): boolean {
  if (typeof value === 'string') return value.includes(secret);
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveString(item, secret));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsSensitiveString(item, secret)
    );
  }
  return false;
}

function priorFailureCount(
  health: RegistryOperationalHealth | null,
  moduleId: string
): number {
  return (
    health?.modules.find((module) => module.moduleId === moduleId)
      ?.consecutiveFailures ?? 0
  );
}

function nextFailureCount(
  previous: number,
  status: RegistryHealthStatus
): number {
  return status === 'degraded' || status === 'error'
    ? Math.min(previous + 1, 1_000_000)
    : 0;
}

function overallStatus(
  modules: RegistryOperationalHealth['modules']
): RegistryHealthStatus {
  if (modules.some((module) => module.status === 'error')) return 'error';
  if (modules.some((module) => module.status === 'degraded')) return 'degraded';
  if (modules.length > 0 && modules.every((module) => module.status === 'disabled')) {
    return 'disabled';
  }
  return 'ok';
}

function controlPlaneCode(error: unknown): RegistryRefreshCode {
  if (error instanceof ControlPlaneError) return error.code;
  return ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR;
}

async function persistHealthAndAlert(
  kv: KVNamespace,
  health: RegistryOperationalHealth
): Promise<void> {
  const previousAlert = await loadRegistryAlertState(kv);
  const alert = await createRegistryAlertState(health, previousAlert);
  await persistRegistryHealth(kv, health);
  await persistRegistryAlertState(kv, alert);
}

async function sourceFailureHealth(
  kv: KVNamespace,
  definitions: readonly RegistryOperationalModuleDefinition<any, any>[],
  checkedAt: number,
  code: RegistryRefreshCode
): Promise<RegistryOperationalHealth> {
  const [snapshotLoad, previousHealth] = await Promise.all([
    loadRegistryOperationalSnapshot(kv, definitions),
    loadRegistryHealth(kv),
  ]);
  const previousSnapshot =
    snapshotLoad.status === 'valid' ? snapshotLoad.snapshot : null;
  const modules = definitions.map((definition) => {
    const moduleId = definition.registryDefinition.moduleId;
    const previousModule = previousSnapshot?.modules.find(
      (candidate) => candidate.moduleId === moduleId
    );
    let status: RegistryHealthStatus = 'error';
    let validatedAt: number | undefined;
    let ageSeconds: number | undefined;
    if (previousModule?.lkg) {
      const freshness = evaluateRegistryFreshness(
        previousModule.lkg.validatedAt,
        definition.freshness,
        checkedAt
      );
      validatedAt = previousModule.lkg.validatedAt;
      ageSeconds = freshness.ageSeconds;
      status = freshness.usable ? 'degraded' : 'error';
    }
    const previousFailures = priorFailureCount(previousHealth, moduleId);
    return {
      moduleId,
      status,
      code,
      checkedAt,
      ...(validatedAt === undefined ? {} : { validatedAt }),
      ...(ageSeconds === undefined ? {} : { ageSeconds }),
      ...(previousModule?.lkg === undefined ? {} : { sourceClass: 'lkg' as const }),
      consecutiveFailures: nextFailureCount(previousFailures, status),
    };
  });
  const status =
    code === ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID ||
    code === ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID ||
    modules.length === 0 ||
    modules.some((module) => module.status === 'error')
      ? 'error'
      : 'degraded';
  return {
    schemaVersion: 1,
    status,
    checkedAt,
    source: { status: 'error', code },
    modules,
  };
}

export async function refreshRegistryOperationalState(
  env: Env,
  options: RegistryRefreshOptions = {}
): Promise<RegistryRefreshResult> {
  const kv = env.REGISTRY_KV;
  if (!kv) {
    return { ok: false, snapshotWritten: false, code: 'KV_UNAVAILABLE' };
  }
  const definitions = options.definitions ?? registryOperationalDefinitions;
  const now = options.now ?? Date.now;

  let records: RegistryKnowledgeRecord[];
  try {
    records = await createV2BoardControlPlaneClient(
      env,
      options.fetcher
    ).readRegistryKnowledgeSource();
  } catch (error) {
    const checkedAt = safeNow(now);
    const code = controlPlaneCode(error);
    try {
      await persistHealthAndAlert(
        kv,
        await sourceFailureHealth(kv, definitions, checkedAt, code)
      );
    } catch {
      return { ok: false, snapshotWritten: false, code: 'KV_UNAVAILABLE' };
    }
    return { ok: false, snapshotWritten: false, code };
  }

  const checkedAt = safeNow(now);
  const [previousLoad, previousHealth] = await Promise.all([
    loadRegistryOperationalSnapshot(kv, definitions),
    loadRegistryHealth(kv),
  ]);
  const previousSnapshot =
    previousLoad.status === 'valid' ? previousLoad.snapshot : null;
  const report = validateRegistryKnowledge(
    records,
    definitions.map((definition) => definition.registryDefinition),
    { solutionSecretResolver: options.solutionSecretResolver }
  );

  const modules: RegistryModuleSnapshot[] = [];
  const healthModules: RegistryOperationalHealth['modules'] = [];

  for (const definition of definitions) {
    const moduleId = definition.registryDefinition.moduleId;
    const result = report.modules.find((module) => module.moduleId === moduleId);
    const previousModule = previousSnapshot?.modules.find(
      (module) => module.moduleId === moduleId
    );
    const previousFailures = priorFailureCount(previousHealth, moduleId);

    if (!result) {
      modules.push({ moduleId, latest: { state: 'ABSENT' } });
      healthModules.push({
        moduleId,
        status: 'disabled',
        code: 'MODULE_ABSENT',
        checkedAt,
        consecutiveFailures: 0,
      });
      continue;
    }

    if (result.state === RegistryValidationState.VALID_DISABLED) {
      modules.push({
        moduleId,
        latest: toLatestState({
          state: result.state,
          enabled: result.enabled,
        }),
      });
      healthModules.push({
        moduleId,
        status: 'disabled',
        checkedAt,
        sourceClass: 'control-plane',
        consecutiveFailures: 0,
      });
      continue;
    }

    if (result.state === RegistryValidationState.VALID_ENABLED) {
      try {
        const { projected, secretSources } = result.useConfig((config) => ({
          projected: definition.projectSnapshot(config),
          secretSources:
            definition.registryDefinition.getSecretSources?.(config) ?? [],
        }));
        const parsed = definition.snapshotSchema.safeParse(projected);
        if (!parsed.success) throw new Error('invalid projection');
        if (
          secretSources.some(
            (source) =>
              source.source === 'knowledge' &&
              containsSensitiveString(parsed.data, source.value)
          )
        ) {
          throw new Error('unsafe projection');
        }
        const record = recordForModule(records, moduleId);
        const lkg = await createRegistryModuleLkg({
          moduleId,
          validatedAt: checkedAt,
          sourceFetchedAt: checkedAt,
          ...(record === undefined
            ? {}
            : {
                source: {
                  sourceId: record.sourceId,
                  updatedAt: record.updatedAt,
                },
              }),
          ...(result.exposure === undefined
            ? {}
            : { exposure: result.exposure }),
          config: parsed.data,
        });
        modules.push({
          moduleId,
          latest: toLatestState({
            state: result.state,
            enabled: result.enabled,
          }),
          lkg,
        });
        healthModules.push({
          moduleId,
          status: 'ok',
          checkedAt,
          validatedAt: checkedAt,
          ageSeconds: 0,
          sourceClass: 'control-plane',
          consecutiveFailures: 0,
        });
        continue;
      } catch {
        const status = previousModule?.lkg
          ? evaluateRegistryFreshness(
              previousModule.lkg.validatedAt,
              definition.freshness,
              checkedAt
            ).usable
            ? 'degraded'
            : 'error'
          : 'error';
        modules.push({
          moduleId,
          latest: { state: 'SNAPSHOT_PROJECTION_INVALID' },
          ...(previousModule?.lkg === undefined
            ? {}
            : { lkg: previousModule.lkg }),
        });
        healthModules.push({
          moduleId,
          status,
          code: 'SNAPSHOT_PROJECTION_INVALID',
          checkedAt,
          ...(previousModule?.lkg === undefined
            ? {}
            : {
                validatedAt: previousModule.lkg.validatedAt,
                ageSeconds: evaluateRegistryFreshness(
                  previousModule.lkg.validatedAt,
                  definition.freshness,
                  checkedAt
                ).ageSeconds,
                sourceClass: 'lkg' as const,
              }),
          consecutiveFailures: nextFailureCount(previousFailures, status),
        });
        continue;
      }
    }

    const freshness = previousModule?.lkg
      ? evaluateRegistryFreshness(
          previousModule.lkg.validatedAt,
          definition.freshness,
          checkedAt
        )
      : null;
    const status: RegistryHealthStatus = freshness?.usable
      ? 'degraded'
      : 'error';
    modules.push({
      moduleId,
      latest: toLatestState({
        state: result.state,
        code: result.code,
        enabled: result.enabled,
      }),
      ...(previousModule?.lkg === undefined ? {} : { lkg: previousModule.lkg }),
    });
    healthModules.push({
      moduleId,
      status,
      code: result.code ?? result.state,
      checkedAt,
      ...(previousModule?.lkg === undefined
        ? {}
        : {
            validatedAt: previousModule.lkg.validatedAt,
            ageSeconds: freshness!.ageSeconds,
            sourceClass: 'lkg' as const,
          }),
      consecutiveFailures: nextFailureCount(previousFailures, status),
    });
  }

  const snapshot = await createRegistryOperationalSnapshot({
    generatedAt: checkedAt,
    modules,
  });
  const health: RegistryOperationalHealth = {
    schemaVersion: 1,
    status: overallStatus(healthModules),
    checkedAt,
    source: { status: 'ok' },
    modules: healthModules,
  };

  try {
    await persistRegistryOperationalSnapshot(kv, snapshot, definitions);
    await persistHealthAndAlert(kv, health);
  } catch {
    return { ok: false, snapshotWritten: false, code: 'KV_UNAVAILABLE' };
  }
  return {
    ok: true,
    snapshotWritten: true,
    sourceFingerprint: snapshot.sourceFingerprint,
  };
}
