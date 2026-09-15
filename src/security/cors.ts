import type { MiddlewareHandler } from 'hono';

const UPSTREAM_CORS_HEADERS = [
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Origin',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
] as const;

function removeOriginVary(headers: Headers): void {
  const vary = headers.get('Vary');
  if (vary === null) return;

  const remaining = vary
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value.toLowerCase() !== 'origin');
  if (remaining.length === 0) {
    headers.delete('Vary');
  } else {
    headers.set('Vary', remaining.join(', '));
  }
}

export const strictCors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    c.res = new Response(null, { status: 204 });
  } else {
    await next();
  }

  for (const header of UPSTREAM_CORS_HEADERS) {
    c.res.headers.delete(header);
  }
  removeOriginVary(c.res.headers);
  c.header('Access-Control-Allow-Origin', '*');

  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    c.header('Access-Control-Max-Age', '86400');
  }

  return c.res;
};
