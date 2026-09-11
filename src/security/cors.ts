import type { MiddlewareHandler } from 'hono';
import type { Env } from '../config/env';

const UPSTREAM_CORS_HEADERS = [
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Origin',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
] as const;

function isValidOrigin(value: string): boolean {
  if (value === '*') {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function allowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(isValidOrigin)
  );
}

export function isAllowedFrontendOrigin(
  origin: string | undefined,
  configuredOrigins: string | undefined
): origin is string {
  return Boolean(origin && allowedOrigins(configuredOrigins).has(origin));
}

export const strictCors: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const requestOrigin = c.req.header('Origin');
  const originIsAllowed = isAllowedFrontendOrigin(
    requestOrigin,
    c.env.FRONTEND_ORIGINS
  );

  if (c.req.method === 'OPTIONS') {
    c.res = new Response(null, { status: 204 });
  } else {
    await next();
  }

  for (const header of UPSTREAM_CORS_HEADERS) {
    c.res.headers.delete(header);
  }

  if (requestOrigin) {
    c.header('Vary', 'Origin', { append: true });
  }

  if (originIsAllowed) {
    c.header('Access-Control-Allow-Origin', requestOrigin);
    c.header('Access-Control-Allow-Credentials', 'true');

    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      c.header('Access-Control-Max-Age', '86400');
    }
  }

  return c.res;
};
