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

export function optionalAuthorization(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined;
  const match = authorization.match(BEARER_TOKEN);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) {
    throw new GatewayError(401, 'AUTH_REQUIRED', 'Authentication required');
  }
  return match[1];
}

export const requireAuthorization: MiddlewareHandler<GatewayContext> = async (
  c,
  next
) => {
  const authToken = optionalAuthorization(c.req.header('Authorization'));
  if (authToken === undefined) {
    throw new GatewayError(401, 'AUTH_REQUIRED', 'Authentication required');
  }

  c.set('authToken', authToken);
  await next();
};
