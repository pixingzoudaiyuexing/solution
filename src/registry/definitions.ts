import type { RegistryOperationalModuleDefinition } from './operational';
import { announcementsOperationalDefinition } from './modules/announcements';
import { customPagesOperationalDefinition } from './modules/custom-pages';
import { promotionUiOperationalDefinition } from './modules/promotion-ui';
import { runtimeSettingsOperationalDefinition } from './modules/runtime-settings';
import { subscriptionDeliveryOperationalDefinition } from './modules/subscription-delivery';
import { supportWidgetOperationalDefinition } from './modules/support-widget';

export const registryOperationalDefinitions: readonly RegistryOperationalModuleDefinition<
  any,
  any
>[] = [
  runtimeSettingsOperationalDefinition,
  customPagesOperationalDefinition,
  subscriptionDeliveryOperationalDefinition,
  announcementsOperationalDefinition,
  supportWidgetOperationalDefinition,
  promotionUiOperationalDefinition,
];
