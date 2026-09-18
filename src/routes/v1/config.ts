import { Hono } from 'hono';
import { V2BoardConfigAdapter } from '../../adapters/v2board/config';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type {
  AccountConfigSuccessResponse,
  RuntimeSettingsConfig,
  RuntimeSettingsConfigSuccessResponse,
  OnboardingConfigSuccessResponse,
} from '../../contract/v1/config';
import { EMPTY_RUNTIME_SETTINGS_CONFIG } from '../../contract/v1/config';
import { requestId } from '../../http/request-id';
import { registryOperationalDefinitions } from '../../registry/definitions';
import { runtimeSettingsOperationalDefinition } from '../../registry/modules/runtime-settings';
import { readRegistryModuleSnapshot } from '../../registry/operational';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const configRouter = new Hono<GatewayContext>();

function configAdapter(
  env: GatewayContext['Bindings']
): V2BoardConfigAdapter {
  return new V2BoardConfigAdapter(createV2BoardClient(env));
}

configRouter.get('/onboarding', async (c) => {
  const data = await configAdapter(c.env).onboardingConfig();
  const response: OnboardingConfigSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

configRouter.get('/account', requireAuthorization, async (c) => {
  const data = await configAdapter(c.env).accountConfig(c.get('authToken'));
  const response: AccountConfigSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

function publicRuntimeSettings(
  config: Partial<Record<keyof RuntimeSettingsConfig, string>>
): RuntimeSettingsConfig {
  return {
    siteName: config.siteName ?? null,
    brandName: config.brandName ?? null,
    title: config.title ?? null,
    description: config.description ?? null,
    logoUrl: config.logoUrl ?? null,
    faviconUrl: config.faviconUrl ?? null,
    footerText: config.footerText ?? null,
  };
}

configRouter.get('/runtime', async (c) => {
  let data = EMPTY_RUNTIME_SETTINGS_CONFIG;
  if (c.env.REGISTRY_KV) {
    const result = await readRegistryModuleSnapshot(
      c.env.REGISTRY_KV,
      runtimeSettingsOperationalDefinition,
      Date.now(),
      registryOperationalDefinitions
    );
    if (result.status === 'available') {
      data = publicRuntimeSettings(result.config);
    }
  }

  const response: RuntimeSettingsConfigSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { configRouter };
