import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardAuthAdapter } from '../adapters/v2board/auth';
import { V2BoardClient } from '../adapters/v2board/client';
import type { Env } from '../config/env';
import type { LoginSuccessResponse } from '../contract/auth';
import { GatewayError } from '../contract/error';
import type { CurrentUserSuccessResponse } from '../contract/user';
import { requestId } from '../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../security/authorization';

const loginRequestSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(1024),
  })
  .strict();

function authAdapter(env: Env): V2BoardAuthAdapter {
  if (!env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }

  return new V2BoardAuthAdapter(
    new V2BoardClient({
      baseUrl: env.V2BOARD_BASE_URL,
      accessClientId: env.V2BOARD_ACCESS_CLIENT_ID,
      accessClientSecret: env.V2BOARD_ACCESS_CLIENT_SECRET,
    })
  );
}

const v1Router = new Hono<GatewayContext>();

v1Router.post('/auth/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const parsed = loginRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const data = await authAdapter(c.env).login(parsed.data);
  const response: LoginSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

v1Router.get('/me', requireAuthorization, async (c) => {
  const data = await authAdapter(c.env).currentUser(c.get('authToken'));
  const response: CurrentUserSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { v1Router };
