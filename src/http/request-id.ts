import type { Context } from 'hono';

export function requestId(c: Context): string {
  return c.req.header('cf-ray') || crypto.randomUUID();
}
