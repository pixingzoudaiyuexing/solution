import { z } from 'zod';
import {
  narrowExposure,
  type ExposureClass,
} from './exposure';
import {
  RegistrySecretError,
  resolveProviderSecret,
  validateProviderSecretSource,
  type RegistrySecretSource,
  type SolutionSecretResolver,
} from './secrets';
import { duplicateStableIds, isStableId } from './stable-id';
import { parseStrictJson } from './strict-json';

export const REGISTRY_CATEGORY = '__AUREOLE_REGISTRY__';
export const REGISTRY_KIND = 'aureole.registry';
export const REGISTRY_SCHEMA_VERSION = 1;

export interface RegistryKnowledgeRecord {
  sourceId: number;
  category: string;
  title: string;
  show: 0 | 1;
  updatedAt: number;
  body?: string;
}

export interface RegistryReference {
  moduleId: string;
  itemId: string;
}

export interface RegistryModuleDefinition<Config = any> {
  moduleId: string;
  schemaVersion: number;
  configSchema: z.ZodType<Config>;
  maximumExposure: ExposureClass;
  getRequestedExposure?: (config: Config) => ExposureClass | undefined;
  getItemIds?: (config: Config) => readonly string[];
  getReferences?: (config: Config) => readonly RegistryReference[];
  getSecretSources?: (config: Config) => readonly RegistrySecretSource[];
}

export enum RegistryValidationState {
  VALID_ENABLED = 'VALID_ENABLED',
  VALID_DISABLED = 'VALID_DISABLED',
  INVALID_SYNTAX = 'INVALID_SYNTAX',
  INVALID_SCHEMA = 'INVALID_SCHEMA',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  DUPLICATE_MODULE = 'DUPLICATE_MODULE',
  DEPENDENCY_INVALID = 'DEPENDENCY_INVALID',
  SECRET_UNRESOLVED = 'SECRET_UNRESOLVED',
}

export type RegistryValidationCode =
  | 'DUPLICATE_ITEM_ID'
  | 'EXPOSURE_BROADENING'
  | 'IDENTITY_INVALID'
  | 'REFERENCE_INVALID'
  | 'UNKNOWN_MODULE';

export class RegistryModuleResult<Config = unknown> {
  #config: Config | undefined;
  #state: RegistryValidationState;
  #code: RegistryValidationCode | undefined;

  constructor(
    readonly moduleId: string,
    state: RegistryValidationState,
    readonly enabled?: boolean,
    readonly exposure?: ExposureClass,
    config?: Config,
    code?: RegistryValidationCode
  ) {
    this.#state = state;
    this.#config = config;
    this.#code = code;
  }

  get state(): RegistryValidationState {
    return this.#state;
  }

  get code(): RegistryValidationCode | undefined {
    return this.#code;
  }

  useConfig<Result>(consumer: (config: Config) => Result): Result {
    if (this.#config === undefined) {
      throw new Error('Validated Registry config is unavailable');
    }
    return consumer(this.#config);
  }

  invalidate(
    state: RegistryValidationState,
    code?: RegistryValidationCode
  ): void {
    this.#state = state;
    this.#code = code;
    this.#config = undefined;
  }

  toJSON(): Record<string, unknown> {
    return {
      moduleId: this.moduleId,
      state: this.#state,
      ...(this.enabled === undefined ? {} : { enabled: this.enabled }),
      ...(this.exposure === undefined ? {} : { exposure: this.exposure }),
      ...(this.#code === undefined ? {} : { code: this.#code }),
    };
  }
}

export interface RegistryRecordIssue {
  moduleId: string | null;
  state: 'HIDDEN_RESERVED' | 'RESERVED_INVALID';
}

export interface RegistryValidationReport {
  modules: RegistryModuleResult[];
  invalidReserved: RegistryRecordIssue[];
  hiddenReserved: RegistryRecordIssue[];
  ordinaryCount: number;
}

export interface RegistryValidationOptions {
  solutionSecretResolver?: SolutionSecretResolver;
}

const envelopeSchema = z
  .object({
    kind: z.literal(REGISTRY_KIND),
    moduleId: z.string(),
    schemaVersion: z.number().int().positive(),
    enabled: z.boolean(),
    config: z.unknown(),
  })
  .strict();

const exposureClasses = new Set<ExposureClass>([
  'public',
  'authenticated',
  'internal',
]);

interface Candidate {
  result: RegistryModuleResult;
  itemIds: Set<string>;
  references: RegistryReference[];
}

function moduleIdFromTitle(title: unknown): string | null {
  if (typeof title !== 'string' || !title.startsWith('registry:')) return null;
  const moduleId = title.slice('registry:'.length);
  return isStableId(moduleId) ? moduleId : null;
}

function safeDefinitionMap(
  definitions: readonly RegistryModuleDefinition<any>[]
): Map<string, RegistryModuleDefinition<any>> {
  const map = new Map<string, RegistryModuleDefinition<any>>();
  for (const definition of definitions) {
    if (
      !isStableId(definition.moduleId) ||
      definition.schemaVersion !== REGISTRY_SCHEMA_VERSION ||
      map.has(definition.moduleId)
    ) {
      throw new Error('Invalid Registry module definition');
    }
    map.set(definition.moduleId, definition);
  }
  return map;
}

function invalidResult(
  moduleId: string,
  state: RegistryValidationState,
  code?: RegistryValidationCode
): RegistryModuleResult {
  return new RegistryModuleResult(moduleId, state, undefined, undefined, undefined, code);
}

function parseCandidate(
  record: RegistryKnowledgeRecord,
  moduleId: string,
  definition: RegistryModuleDefinition<any> | undefined,
  options: RegistryValidationOptions
): Candidate {
  let parsedJson: unknown;
  try {
    parsedJson = parseStrictJson(record.body ?? '');
  } catch {
    return {
      result: invalidResult(moduleId, RegistryValidationState.INVALID_SYNTAX),
      itemIds: new Set(),
      references: [],
    };
  }

  const parsedEnvelope = envelopeSchema.safeParse(parsedJson);
  if (!parsedEnvelope.success) {
    const candidate = parsedJson as { schemaVersion?: unknown } | null;
    if (
      candidate &&
      typeof candidate === 'object' &&
      typeof candidate.schemaVersion === 'number' &&
      Number.isInteger(candidate.schemaVersion) &&
      candidate.schemaVersion > 0 &&
      candidate.schemaVersion !== REGISTRY_SCHEMA_VERSION
    ) {
      return {
        result: invalidResult(
          moduleId,
          RegistryValidationState.UNSUPPORTED_VERSION
        ),
        itemIds: new Set(),
        references: [],
      };
    }
    return {
      result: invalidResult(moduleId, RegistryValidationState.INVALID_SCHEMA),
      itemIds: new Set(),
      references: [],
    };
  }

  const envelope = parsedEnvelope.data;
  if (envelope.moduleId !== moduleId || !isStableId(envelope.moduleId)) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.INVALID_SCHEMA,
        'IDENTITY_INVALID'
      ),
      itemIds: new Set(),
      references: [],
    };
  }
  if (envelope.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.UNSUPPORTED_VERSION
      ),
      itemIds: new Set(),
      references: [],
    };
  }
  if (!definition) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.INVALID_SCHEMA,
        'UNKNOWN_MODULE'
      ),
      itemIds: new Set(),
      references: [],
    };
  }
  if (definition.schemaVersion !== envelope.schemaVersion) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.UNSUPPORTED_VERSION
      ),
      itemIds: new Set(),
      references: [],
    };
  }

  const parsedConfig = definition.configSchema.safeParse(envelope.config);
  if (!parsedConfig.success) {
    return {
      result: invalidResult(moduleId, RegistryValidationState.INVALID_SCHEMA),
      itemIds: new Set(),
      references: [],
    };
  }

  let exposure = definition.maximumExposure;
  let itemIds: readonly string[] = [];
  let references: readonly RegistryReference[] = [];
  try {
    const requestedExposure = definition.getRequestedExposure?.(parsedConfig.data);
    if (requestedExposure !== undefined) {
      if (!exposureClasses.has(requestedExposure)) throw new Error('invalid');
      const narrowed = narrowExposure(definition.maximumExposure, requestedExposure);
      if (narrowed === null) {
        return {
          result: invalidResult(
            moduleId,
            RegistryValidationState.INVALID_SCHEMA,
            'EXPOSURE_BROADENING'
          ),
          itemIds: new Set(),
          references: [],
        };
      }
      exposure = narrowed;
    }
    itemIds = definition.getItemIds?.(parsedConfig.data) ?? [];
    references = definition.getReferences?.(parsedConfig.data) ?? [];
  } catch {
    return {
      result: invalidResult(moduleId, RegistryValidationState.INVALID_SCHEMA),
      itemIds: new Set(),
      references: [],
    };
  }

  if (itemIds.some((itemId) => !isStableId(itemId))) {
    return {
      result: invalidResult(moduleId, RegistryValidationState.INVALID_SCHEMA),
      itemIds: new Set(),
      references: [],
    };
  }
  if (duplicateStableIds(itemIds).length > 0) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.INVALID_SCHEMA,
        'DUPLICATE_ITEM_ID'
      ),
      itemIds: new Set(),
      references: [],
    };
  }
  if (
    references.some(
      (reference) =>
        !reference ||
        !isStableId(reference.moduleId) ||
        !isStableId(reference.itemId)
    )
  ) {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.DEPENDENCY_INVALID,
        'REFERENCE_INVALID'
      ),
      itemIds: new Set(itemIds),
      references: [],
    };
  }

  try {
    const secretSources = definition.getSecretSources?.(parsedConfig.data) ?? [];
    for (const secretSource of secretSources) {
      validateProviderSecretSource(
        secretSource,
        options.solutionSecretResolver
      );
    }
    if (envelope.enabled) {
      for (const secretSource of secretSources) {
        resolveProviderSecret(secretSource, options.solutionSecretResolver);
      }
    }
  } catch {
    return {
      result: invalidResult(
        moduleId,
        RegistryValidationState.SECRET_UNRESOLVED
      ),
      itemIds: new Set(itemIds),
      references: [...references],
    };
  }

  return {
    result: new RegistryModuleResult(
      moduleId,
      envelope.enabled
        ? RegistryValidationState.VALID_ENABLED
        : RegistryValidationState.VALID_DISABLED,
      envelope.enabled,
      exposure,
      parsedConfig.data
    ),
    itemIds: new Set(itemIds),
    references: [...references],
  };
}

function isValidState(state: RegistryValidationState): boolean {
  return (
    state === RegistryValidationState.VALID_ENABLED ||
    state === RegistryValidationState.VALID_DISABLED
  );
}

function markDependencyFailures(candidates: Map<string, Candidate>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [moduleId, candidate] of candidates) {
      if (!isValidState(candidate.result.state)) continue;
      const invalid = candidate.references.some((reference) => {
        const target = candidates.get(reference.moduleId);
        return (
          !target ||
          !isValidState(target.result.state) ||
          !target.itemIds.has(reference.itemId)
        );
      });
      if (invalid) {
        candidate.result.invalidate(
          RegistryValidationState.DEPENDENCY_INVALID,
          'REFERENCE_INVALID'
        );
        candidates.set(moduleId, candidate);
        changed = true;
      }
    }
  }
}

function markCycles(candidates: Map<string, Candidate>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();

  const visit = (moduleId: string): void => {
    if (visited.has(moduleId)) return;
    if (visiting.has(moduleId)) {
      const index = stack.indexOf(moduleId);
      for (const item of stack.slice(index)) cyclic.add(item);
      return;
    }
    const candidate = candidates.get(moduleId);
    if (!candidate || !isValidState(candidate.result.state)) return;
    visiting.add(moduleId);
    stack.push(moduleId);
    for (const reference of candidate.references) {
      visit(reference.moduleId);
    }
    stack.pop();
    visiting.delete(moduleId);
    visited.add(moduleId);
  };

  for (const moduleId of candidates.keys()) visit(moduleId);
  for (const moduleId of cyclic) {
    candidates
      .get(moduleId)
      ?.result.invalidate(RegistryValidationState.DEPENDENCY_INVALID);
  }
  markDependencyFailures(candidates);
}

export function validateRegistryKnowledge(
  records: readonly RegistryKnowledgeRecord[],
  definitions: readonly RegistryModuleDefinition<any>[],
  options: RegistryValidationOptions = {}
): RegistryValidationReport {
  const definitionsById = safeDefinitionMap(definitions);
  const invalidReserved: RegistryRecordIssue[] = [];
  const hiddenReserved: RegistryRecordIssue[] = [];
  const activeByModule = new Map<string, RegistryKnowledgeRecord[]>();
  let ordinaryCount = 0;

  for (const record of records) {
    if (record.category !== REGISTRY_CATEGORY) {
      ordinaryCount += 1;
      continue;
    }
    const moduleId = moduleIdFromTitle(record.title);
    if (record.show === 0) {
      hiddenReserved.push({ moduleId, state: 'HIDDEN_RESERVED' });
      continue;
    }
    if (record.show !== 1 || moduleId === null) {
      invalidReserved.push({ moduleId, state: 'RESERVED_INVALID' });
      continue;
    }
    const group = activeByModule.get(moduleId) ?? [];
    group.push(record);
    activeByModule.set(moduleId, group);
  }

  const candidates = new Map<string, Candidate>();
  for (const [moduleId, moduleRecords] of activeByModule) {
    if (moduleRecords.length > 1) {
      candidates.set(moduleId, {
        result: invalidResult(
          moduleId,
          RegistryValidationState.DUPLICATE_MODULE
        ),
        itemIds: new Set(),
        references: [],
      });
      continue;
    }
    candidates.set(
      moduleId,
      parseCandidate(
        moduleRecords[0],
        moduleId,
        definitionsById.get(moduleId),
        options
      )
    );
  }

  markDependencyFailures(candidates);
  markCycles(candidates);

  return {
    modules: [...candidates.values()].map((candidate) => candidate.result),
    invalidReserved,
    hiddenReserved,
    ordinaryCount,
  };
}
