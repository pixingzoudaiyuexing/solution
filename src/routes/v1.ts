import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardAuthAdapter } from '../adapters/v2board/auth';
import { V2BoardBusinessAdapter } from '../adapters/v2board/business';
import { V2BoardClient } from '../adapters/v2board/client';
import type { Env } from '../config/env';
import type { LoginSuccessResponse } from '../contract/auth';
import { GatewayError } from '../contract/error';
import type { CurrentUserSuccessResponse } from '../contract/user';
import type { ProductsSuccessResponse } from '../contract/product';
import type { ResourcesSuccessResponse } from '../contract/resource';
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

function v2boardClient(env: Env): V2BoardClient {
  if (!env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }

  return new V2BoardClient({
    baseUrl: env.V2BOARD_BASE_URL,
    accessClientId: env.V2BOARD_ACCESS_CLIENT_ID,
    accessClientSecret: env.V2BOARD_ACCESS_CLIENT_SECRET,
  });
}

function authAdapter(env: Env): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(v2boardClient(env));
}

function businessAdapter(env: Env): V2BoardBusinessAdapter {
  return new V2BoardBusinessAdapter(v2boardClient(env));
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

v1Router.get('/products', requireAuthorization, async (c) => {
  const products = await businessAdapter(c.env).products(c.get('authToken'));
  const response: ProductsSuccessResponse = {
    ok: true,
    data: { products },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

v1Router.get('/resources', requireAuthorization, async (c) => {
  const resources = await businessAdapter(c.env).resources(c.get('authToken'));
  const response: ResourcesSuccessResponse = {
    ok: true,
    data: { resources },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { v1Router };
