import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardAuthAdapter } from '../adapters/v2board/auth';
import { V2BoardBusinessAdapter } from '../adapters/v2board/business';
import { createV2BoardClient } from '../adapters/v2board/factory';
import type {
  EmailCodeSuccessResponse,
  LoginSuccessResponse,
  PasswordResetSuccessResponse,
  RegisterSuccessResponse,
} from '../contract/auth';
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
import { billingRouter } from './v1/billing';
import {
  subscriptionAccessRouter,
  subscriptionRouter,
} from './v1/subscription';

const loginRequestSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(1024),
  })
  .strict();
const emailSchema = z.string().trim().email().max(254);
const passwordSchema = z.string().min(8).max(64);
const emailCodeSchema = z.string().regex(/^\d{6}$/);
const recaptchaDataSchema = z.string().min(1).max(4096);
const emailCodeRequestSchema = z
  .object({
    email: emailSchema,
    purpose: z.enum(['register', 'password-reset']),
    recaptchaData: recaptchaDataSchema.optional(),
  })
  .strict();
const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    emailCode: emailCodeSchema.optional(),
    inviteCode: z.string().min(1).max(255).optional(),
    recaptchaData: recaptchaDataSchema.optional(),
  })
  .strict();
const passwordResetRequestSchema = z
  .object({
    email: emailSchema,
    emailCode: emailCodeSchema,
    newPassword: passwordSchema,
  })
  .strict();

async function requestBody(c: Parameters<typeof requestId>[0]): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
}

function authAdapter(env: GatewayContext['Bindings']): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(createV2BoardClient(env));
}

function businessAdapter(env: GatewayContext['Bindings']): V2BoardBusinessAdapter {
  return new V2BoardBusinessAdapter(createV2BoardClient(env));
}

const v1Router = new Hono<GatewayContext>();

v1Router.post('/auth/login', async (c) => {
  const body = await requestBody(c);
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

v1Router.post('/auth/email-code', async (c) => {
  const parsed = emailCodeRequestSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const data = await authAdapter(c.env).sendEmailCode(parsed.data);
  const response: EmailCodeSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

v1Router.post('/auth/register', async (c) => {
  const parsed = registerRequestSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const data = await authAdapter(c.env).register(parsed.data);
  const response: RegisterSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

v1Router.post('/auth/password/reset', async (c) => {
  const parsed = passwordResetRequestSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const data = await authAdapter(c.env).resetPassword(parsed.data);
  const response: PasswordResetSuccessResponse = {
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
v1Router.route('/billing', billingRouter);
v1Router.route('/subscription', subscriptionRouter);
v1Router.route('/access', subscriptionAccessRouter);

export { v1Router };
