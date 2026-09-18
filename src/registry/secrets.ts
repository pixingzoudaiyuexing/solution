import { isStableId } from './stable-id';

export type RegistrySecretSource =
  | { source: 'knowledge'; value: string }
  | { source: 'solution'; ref: string };

export type RegistrySecretClass = 'provider' | 'bootstrap';

export class RegistrySecretError extends Error {
  readonly code = 'SECRET_UNRESOLVED' as const;

  constructor() {
    super('Registry secret could not be resolved');
    this.name = 'RegistrySecretError';
  }

  toJSON(): { code: 'SECRET_UNRESOLVED' } {
    return { code: this.code };
  }
}

export class SensitiveSecret {
  #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static from(value: unknown): SensitiveSecret {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new RegistrySecretError();
    }
    return new SensitiveSecret(value);
  }

  consume(): string {
    return this.#value;
  }

  toJSON(): { redacted: true } {
    return { redacted: true };
  }
}

export interface SolutionSecretResolver {
  resolve(ref: string): SensitiveSecret;
}

type SolutionSecretAccessor = () => string | undefined;

export function createSolutionSecretResolver(
  allowlist: Readonly<Record<string, SolutionSecretAccessor>>
): SolutionSecretResolver {
  const entries = new Map(Object.entries(allowlist));
  return {
    resolve(ref: string): SensitiveSecret {
      const accessor = entries.get(ref);
      if (!accessor) throw new RegistrySecretError();
      return SensitiveSecret.from(accessor());
    },
  };
}

function isRegistrySecretSource(value: unknown): value is RegistrySecretSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    candidate.source === 'knowledge' &&
    keys.join(',') === 'source,value'
  ) {
    return typeof candidate.value === 'string';
  }
  if (
    candidate.source === 'solution' &&
    keys.join(',') === 'ref,source'
  ) {
    return typeof candidate.ref === 'string';
  }
  return false;
}

export function resolveProviderSecret(
  source: unknown,
  solutionResolver: SolutionSecretResolver,
  secretClass: RegistrySecretClass = 'provider'
): SensitiveSecret {
  if (secretClass !== 'provider' || !isRegistrySecretSource(source)) {
    throw new RegistrySecretError();
  }
  if (source.source === 'knowledge') {
    return SensitiveSecret.from(source.value);
  }
  if (!isStableId(source.ref.replaceAll('.', '-'))) {
    throw new RegistrySecretError();
  }
  return solutionResolver.resolve(source.ref);
}

export function resolveControlPlaneBootstrapSecret(
  deploymentValue: unknown
): SensitiveSecret {
  if (
    typeof deploymentValue !== 'string' ||
    deploymentValue.trim().length === 0 ||
    deploymentValue.length > 8192 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(deploymentValue)
  ) {
    throw new RegistrySecretError();
  }
  return SensitiveSecret.from(deploymentValue);
}
