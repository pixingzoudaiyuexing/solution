import type { MiddlewareHandler } from 'hono';
import type { Env } from '../config/env';
import { GatewayError } from '../contract/error';

export interface AuthVariables {
  authToken: string;
}

export type GatewayContext = {
  Bindings: Env;
  Variables: AuthVariables;
};

const BEARER_TOKEN = /^Bearer ([^\s]+)$/i;
const MAX_TOKEN_LENGTH = 8192;

export const requireAuthorization: MiddlewareHandler<GatewayContext> = async (
  c,
  next
) => {
  const authorization = c.req.header('Authorization');
  const match = authorization?.match(BEARER_TOKEN);

  if (!match || match[1].length > MAX_TOKEN_LENGTH) {
    throw new GatewayError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  c.set('authToken', match[1]);
  await next();
};
