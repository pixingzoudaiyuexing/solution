import type { RegistryOperationalModuleDefinition } from './operational';
import { announcementsOperationalDefinition } from './modules/announcements';
import { customPagesOperationalDefinition } from './modules/custom-pages';
import { downloadCenterOperationalDefinition } from './modules/download-center';
import { runtimeSettingsOperationalDefinition } from './modules/runtime-settings';
import { subscriptionDeliveryOperationalDefinition } from './modules/subscription-delivery';
import { subscriptionProfileOperationalDefinition } from './modules/subscription-profile';

export const registryOperationalDefinitions: readonly RegistryOperationalModuleDefinition<
  any,
  any
>[] = [
  runtimeSettingsOperationalDefinition,
  customPagesOperationalDefinition,
  subscriptionDeliveryOperationalDefinition,
  subscriptionProfileOperationalDefinition,
  announcementsOperationalDefinition,
  downloadCenterOperationalDefinition,
];
