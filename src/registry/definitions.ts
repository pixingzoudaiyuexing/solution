import type { RegistryOperationalModuleDefinition } from './operational';
import { announcementsOperationalDefinition } from './modules/announcements';
import { customPagesOperationalDefinition } from './modules/custom-pages';
import { runtimeSettingsOperationalDefinition } from './modules/runtime-settings';
import { subscriptionDeliveryOperationalDefinition } from './modules/subscription-delivery';

export const registryOperationalDefinitions: readonly RegistryOperationalModuleDefinition<
  any,
  any
>[] = [
  runtimeSettingsOperationalDefinition,
  customPagesOperationalDefinition,
  subscriptionDeliveryOperationalDefinition,
  announcementsOperationalDefinition,
];
