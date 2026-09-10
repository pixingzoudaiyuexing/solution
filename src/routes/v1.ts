import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardAuthAdapter } from '../adapters/v2board/auth';
import { V2BoardBusinessAdapter } from '../adapters/v2board/business';
import { createV2BoardClient } from '../adapters/v2board/factory';
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
import { ordersRouter } from './v1/orders';

const loginRequestSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(1024),
  })
  .strict();

function authAdapter(env: GatewayContext['Bindings']): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(createV2BoardClient(env));
}

function businessAdapter(env: GatewayContext['Bindings']): V2BoardBusinessAdapter {
  return new V2BoardBusinessAdapter(createV2BoardClient(env));
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

v1Router.route('/orders', ordersRouter);

export { v1Router };
