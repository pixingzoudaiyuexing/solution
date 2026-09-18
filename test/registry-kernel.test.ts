import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
  type RegistryKnowledgeRecord,
  type RegistryModuleDefinition,
} from '../src/registry/kernel';

const objectConfigSchema = z
  .object({
    value: z.string(),
    items: z
      .array(z.object({ id: z.string() }).strict())
      .optional(),
    references: z
      .array(
        z
          .object({ moduleId: z.string(), itemId: z.string() })
          .strict()
      )
      .optional(),
  })
  .strict();

type TestConfig = z.infer<typeof objectConfigSchema>;

function definition(
  moduleId: string,
  overrides: Partial<RegistryModuleDefinition<TestConfig>> = {}
): RegistryModuleDefinition<TestConfig> {
  return {
    moduleId,
    schemaVersion: 1,
    configSchema: objectConfigSchema,
    maximumExposure: 'authenticated',
    getItemIds: (config) => config.items?.map((item) => item.id) ?? [],
    getReferences: (config) => config.references ?? [],
    ...overrides,
  };
}

function body(
  moduleId: string,
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId,
    schemaVersion: 1,
    enabled: true,
    config: { value: moduleId },
    ...overrides,
  });
}

function record(
  moduleId: string,
  overrides: Partial<RegistryKnowledgeRecord> = {}
): RegistryKnowledgeRecord {
  return {
    sourceId: 7,
    category: REGISTRY_CATEGORY,
    title: `registry:${moduleId}`,
    show: 1,
    updatedAt: 1704067200,
    body: body(moduleId),
    ...overrides,
  };
}

describe('Registry identity and strict envelope', () => {
  it('accepts exact reserved identity and a strict supported envelope', () => {
    const report = validateRegistryKnowledge(
      [record('module-a')],
      [definition('module-a')]
    );

    expect(report.modules).toHaveLength(1);
    expect(report.modules[0]).toMatchObject({
      moduleId: 'module-a',
      state: RegistryValidationState.VALID_ENABLED,
      enabled: true,
    });
    expect(report.ordinaryCount).toBe(0);
  });

  it('keeps a registry-looking body in an ordinary category non-Registry', () => {
    const report = validateRegistryKnowledge(
      [record('module-a', { category: 'Help' })],
      [definition('module-a')]
    );

    expect(report.modules).toEqual([]);
    expect(report.invalidReserved).toEqual([]);
    expect(report.ordinaryCount).toBe(1);
  });

  it.each([
    ['wrong title', { title: 'module-a' }],
    ['invalid title module id', { title: 'registry:Module_A' }],
  ])('classifies reserved title identity failure as reserved-invalid: %s', (_case, overrides) => {
    const report = validateRegistryKnowledge(
      [record('module-a', overrides)],
      [definition('module-a')]
    );

    expect(report.modules).toEqual([]);
    expect(report.invalidReserved).toHaveLength(1);
    expect(report.ordinaryCount).toBe(0);
  });

  it.each([
    ['wrong body kind', { kind: 'other.registry' }],
    ['module disagreement', { moduleId: 'module-b' }],
  ])('classifies reserved body identity failure as module-invalid: %s', (_case, overrides) => {
    const report = validateRegistryKnowledge(
      [record('module-a', { body: body('module-a', overrides) })],
      [definition('module-a')]
    );

    expect(report.modules[0]).toMatchObject({
      moduleId: 'module-a',
      state: RegistryValidationState.INVALID_SCHEMA,
    });
    expect(report.ordinaryCount).toBe(0);
  });

  it('ignores hidden reserved records without interpreting enabled=false', () => {
    const report = validateRegistryKnowledge(
      [record('module-a', { show: 0, body: undefined })],
      [definition('module-a')]
    );

    expect(report.modules).toEqual([]);
    expect(report.hiddenReserved).toEqual([
      expect.objectContaining({ moduleId: 'module-a' }),
    ]);
  });

  it.each([
    ['kind'],
    ['moduleId'],
    ['schemaVersion'],
    ['enabled'],
    ['config'],
  ])('rejects a missing required envelope field %s', (field) => {
    const envelope = JSON.parse(body('module-a'));
    delete envelope[field];
    const report = validateRegistryKnowledge(
      [record('module-a', { body: JSON.stringify(envelope) })],
      [definition('module-a')]
    );
    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SCHEMA
    );
  });

  it.each([
    ['unknown top-level field', { extra: true }, RegistryValidationState.INVALID_SCHEMA],
    ['zero version', { schemaVersion: 0 }, RegistryValidationState.INVALID_SCHEMA],
    ['negative version', { schemaVersion: -1 }, RegistryValidationState.INVALID_SCHEMA],
    ['fractional version', { schemaVersion: 1.5 }, RegistryValidationState.INVALID_SCHEMA],
    ['string version', { schemaVersion: '1' }, RegistryValidationState.INVALID_SCHEMA],
    ['future version', { schemaVersion: 2 }, RegistryValidationState.UNSUPPORTED_VERSION],
    ['wrong enabled type', { enabled: 1 }, RegistryValidationState.INVALID_SCHEMA],
    ['wrong config type', { config: 'bad' }, RegistryValidationState.INVALID_SCHEMA],
  ])('rejects %s without coercion', (_case, overrides, state) => {
    const report = validateRegistryKnowledge(
      [record('module-a', { body: body('module-a', overrides) })],
      [definition('module-a')]
    );
    expect(report.modules[0].state).toBe(state);
  });

  it('validates disabled modules structurally', () => {
    const valid = validateRegistryKnowledge(
      [record('module-a', { body: body('module-a', { enabled: false }) })],
      [definition('module-a')]
    );
    const invalid = validateRegistryKnowledge(
      [
        record('module-a', {
          body: body('module-a', { enabled: false, config: 'bad' }),
        }),
      ],
      [definition('module-a')]
    );

    expect(valid.modules[0].state).toBe(
      RegistryValidationState.VALID_DISABLED
    );
    expect(invalid.modules[0].state).toBe(
      RegistryValidationState.INVALID_SCHEMA
    );
  });

  it('fails closed for an unregistered module definition', () => {
    const report = validateRegistryKnowledge([record('module-a')], []);
    expect(report.modules[0]).toMatchObject({
      moduleId: 'module-a',
      state: RegistryValidationState.INVALID_SCHEMA,
      code: 'UNKNOWN_MODULE',
    });
  });

  it('uses module-specific strict config validation', () => {
    const report = validateRegistryKnowledge(
      [
        record('module-a', {
          body: body('module-a', {
            config: { value: 'module-a', unknown: true },
          }),
        }),
      ],
      [definition('module-a')]
    );
    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SCHEMA
    );
  });

  it('normalizes malformed JSON without exposing a body snippet', () => {
    const sentinel = 'RAW_BODY_SECRET_SENTINEL';
    const report = validateRegistryKnowledge(
      [record('module-a', { body: `{${sentinel}` })],
      [definition('module-a')]
    );

    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SYNTAX
    );
    expect(JSON.stringify(report)).not.toContain(sentinel);
  });

  it.each([
    [
      'top-level duplicate',
      '{"kind":"aureole.registry","moduleId":"module-a","schemaVersion":1,"enabled":true,"enabled":false,"config":{"value":"module-a"}}',
    ],
    [
      'nested config duplicate',
      '{"kind":"aureole.registry","moduleId":"module-a","schemaVersion":1,"enabled":true,"config":{"value":"module-a","value":"other"}}',
    ],
  ])('rejects %s JSON keys with no ambiguous last-value behavior', (_case, duplicateBody) => {
    const report = validateRegistryKnowledge(
      [record('module-a', { body: duplicateBody })],
      [definition('module-a')]
    );
    expect(report.modules[0].state).toBe(
      RegistryValidationState.INVALID_SYNTAX
    );
    expect(JSON.stringify(report)).not.toContain(duplicateBody);
  });
});

describe('Registry module isolation and duplicates', () => {
  it('preserves unrelated valid modules around a malformed module', () => {
    const report = validateRegistryKnowledge(
      [
        record('module-a', { sourceId: 1 }),
        record('module-b', { sourceId: 2, body: '{bad' }),
        record('module-c', { sourceId: 3 }),
      ],
      [definition('module-a'), definition('module-b'), definition('module-c')]
    );

    expect(report.modules.map(({ moduleId, state }) => [moduleId, state])).toEqual([
      ['module-a', RegistryValidationState.VALID_ENABLED],
      ['module-b', RegistryValidationState.INVALID_SYNTAX],
      ['module-c', RegistryValidationState.VALID_ENABLED],
    ]);
  });

  it('fails only the duplicated active module', () => {
    const report = validateRegistryKnowledge(
      [
        record('module-a', { sourceId: 1 }),
        record('module-a', { sourceId: 2 }),
        record('module-b', { sourceId: 3 }),
      ],
      [definition('module-a'), definition('module-b')]
    );

    expect(report.modules).toEqual([
      expect.objectContaining({
        moduleId: 'module-a',
        state: RegistryValidationState.DUPLICATE_MODULE,
      }),
      expect.objectContaining({
        moduleId: 'module-b',
        state: RegistryValidationState.VALID_ENABLED,
      }),
    ]);
  });
});

describe('Registry stable IDs, references, and cycles', () => {
  it.each(['valid-id', 'a', `a${'b'.repeat(63)}`])(
    'accepts stable ID %s',
    (moduleId) => {
      const report = validateRegistryKnowledge(
        [record(moduleId)],
        [definition(moduleId)]
      );
      expect(report.modules[0].state).toBe(
        RegistryValidationState.VALID_ENABLED
      );
    }
  );

  it.each([
    'Upper',
    'under_score',
    'has space',
    '1leading',
    'trailing-',
    'double--hyphen',
    '',
    `a${'b'.repeat(64)}`,
  ])(
    'rejects invalid stable ID %s',
    (moduleId) => {
      const report = validateRegistryKnowledge(
        [record(moduleId)],
        []
      );
      expect(report.modules).toEqual([]);
      expect(report.invalidReserved).toHaveLength(1);
    }
  );

  it('fails a module with duplicate item stable IDs', () => {
    const config = {
      value: 'module-a',
      items: [{ id: 'same-id' }, { id: 'same-id' }],
    };
    const report = validateRegistryKnowledge(
      [record('module-a', { body: body('module-a', { config }) })],
      [definition('module-a')]
    );
    expect(report.modules[0]).toMatchObject({
      state: RegistryValidationState.INVALID_SCHEMA,
      code: 'DUPLICATE_ITEM_ID',
    });
  });

  it.each([
    ['unknown module', { moduleId: 'missing', itemId: 'item-a' }],
    ['unknown item', { moduleId: 'module-b', itemId: 'missing' }],
  ])('fails only the dependent for %s', (_case, reference) => {
    const aConfig = { value: 'module-a', references: [reference] };
    const bConfig = { value: 'module-b', items: [{ id: 'item-b' }] };
    const report = validateRegistryKnowledge(
      [
        record('module-a', { body: body('module-a', { config: aConfig }) }),
        record('module-b', { body: body('module-b', { config: bConfig }) }),
      ],
      [definition('module-a'), definition('module-b')]
    );

    expect(report.modules.find((item) => item.moduleId === 'module-a')?.state).toBe(
      RegistryValidationState.DEPENDENCY_INVALID
    );
    expect(report.modules.find((item) => item.moduleId === 'module-b')?.state).toBe(
      RegistryValidationState.VALID_ENABLED
    );
  });

  it.each([
    [
      'self cycle',
      {
        'module-a': [{ moduleId: 'module-a', itemId: 'item-a' }],
      },
      ['module-a'],
    ],
    [
      'two-module cycle',
      {
        'module-a': [{ moduleId: 'module-b', itemId: 'item-b' }],
        'module-b': [{ moduleId: 'module-a', itemId: 'item-a' }],
      },
      ['module-a', 'module-b'],
    ],
    [
      'indirect cycle',
      {
        'module-a': [{ moduleId: 'module-b', itemId: 'item-b' }],
        'module-b': [{ moduleId: 'module-c', itemId: 'item-c' }],
        'module-c': [{ moduleId: 'module-a', itemId: 'item-a' }],
      },
      ['module-a', 'module-b', 'module-c'],
    ],
  ])('rejects %s', (_case, refs, cyclicModules) => {
    const modules = Object.keys(refs);
    const records = modules.map((moduleId, index) => {
      const config = {
        value: moduleId,
        items: [{ id: `item-${moduleId.at(-1)}` }],
        references: refs[moduleId as keyof typeof refs],
      };
      return record(moduleId, {
        sourceId: index + 1,
        body: body(moduleId, { config }),
      });
    });
    records.push(record('module-z', { sourceId: 99 }));
    const report = validateRegistryKnowledge(
      records,
      [...modules.map((id) => definition(id)), definition('module-z')]
    );

    for (const moduleId of cyclicModules) {
      expect(report.modules.find((item) => item.moduleId === moduleId)?.state).toBe(
        RegistryValidationState.DEPENDENCY_INVALID
      );
    }
    expect(report.modules.find((item) => item.moduleId === 'module-z')?.state).toBe(
      RegistryValidationState.VALID_ENABLED
    );
  });
});
