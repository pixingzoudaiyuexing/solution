import { Hono } from 'hono';
import { V2BoardConfigAdapter } from '../../adapters/v2board/config';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type {
  AccountConfigSuccessResponse,
  OnboardingConfigSuccessResponse,
} from '../../contract/v1/config';
import { requestId } from '../../http/request-id';
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

export { configRouter };
