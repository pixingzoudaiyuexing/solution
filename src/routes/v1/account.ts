import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardAccountAdapter } from '../../adapters/v2board/account';
import { V2BoardAuthAdapter } from '../../adapters/v2board/auth';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type {
  AccountPreferencesSuccessResponse,
  AccountStatsSuccessResponse,
  ChangePasswordSuccessResponse,
  UpdatePreferencesSuccessResponse,
} from '../../contract/user';
import { GatewayError } from '../../contract/error';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const accountRouter = new Hono<GatewayContext>();
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(8).max(1024),
  })
  .strict();
const preferencesSchema = z
  .object({
    autoRenewal: z.boolean().optional(),
    remindExpire: z.boolean().optional(),
    remindTraffic: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

async function requestBody(
  c: Parameters<typeof requestId>[0]
): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
}

accountRouter.post('/password', requireAuthorization, async (c) => {
  const parsed = changePasswordSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const adapter = new V2BoardAuthAdapter(createV2BoardClient(c.env));
  const data = await adapter.changePassword(c.get('authToken'), parsed.data);
  const response: ChangePasswordSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

accountRouter.get('/preferences', requireAuthorization, async (c) => {
  const adapter = new V2BoardAccountAdapter(createV2BoardClient(c.env));
  const data = await adapter.preferences(c.get('authToken'));
  const response: AccountPreferencesSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

accountRouter.patch('/preferences', requireAuthorization, async (c) => {
  const parsed = preferencesSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const adapter = new V2BoardAccountAdapter(createV2BoardClient(c.env));
  const data = await adapter.updatePreferences(c.get('authToken'), parsed.data);
  const response: UpdatePreferencesSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

accountRouter.get('/stats', requireAuthorization, async (c) => {
  const adapter = new V2BoardAccountAdapter(createV2BoardClient(c.env));
  const data = await adapter.stats(c.get('authToken'));
  const response: AccountStatsSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { accountRouter };
