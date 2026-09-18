import type { RegistryOperationalModuleDefinition } from './operational';
import { customPagesOperationalDefinition } from './modules/custom-pages';
import { runtimeSettingsOperationalDefinition } from './modules/runtime-settings';

export const registryOperationalDefinitions: readonly RegistryOperationalModuleDefinition<
  any,
  any
>[] = [runtimeSettingsOperationalDefinition, customPagesOperationalDefinition];
