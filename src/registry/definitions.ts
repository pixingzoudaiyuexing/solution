import type { RegistryOperationalModuleDefinition } from './operational';
import { runtimeSettingsOperationalDefinition } from './modules/runtime-settings';

export const registryOperationalDefinitions: readonly RegistryOperationalModuleDefinition<
  any,
  any
>[] = [runtimeSettingsOperationalDefinition];
