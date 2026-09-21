import { Hono } from 'hono';
import { createV2BoardClient, createV2BoardOriginClient } from '../adapters/v2board/factory';
import { V2BoardSubscriptionAdapter } from '../adapters/v2board/subscription';
import { V2BoardSubscriptionUnavailableError, V2BoardTimeoutError } from '../adapters/v2board/errors';
import type { Env } from '../config/env';
import { validateSubscriptionPathPrefix } from '../registry/modules/subscription-delivery';
import {
  normalizeV2BoardSubscribePath,
  validateSubscriptionToken,
} from '../security/subscription';
import { validateTrustedUserAgent } from '../security/user-agent';

const router = new Hono<{ Bindings: Env }>();

function unavailable(status: 400 | 404 | 502 | 504): Response {
  return new Response('subscription_unavailable', {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function parseQuery(url: string): { info: 'show' | 'hide' } {
  const entries = [...new URL(url).searchParams.entries()];
  const seen = new Set<string>();
  let info: 'show' | 'hide' = 'show';
  for (const [key, value] of entries) {
    if (seen.has(key) || (key !== 'profile' && key !== 'info')) throw new Error();
    seen.add(key);
    if (key === 'profile' && value !== 'default') throw new Error();
    if (key === 'info') {
      if (value !== 'show' && value !== 'hide') throw new Error();
      info = value;
    }
  }
  return { info };
}

function configuredLegacyPath(value: string | undefined): string | undefined {
  try {
    const path = `/${normalizeV2BoardSubscribePath(value)}`;
    const namespace = path.slice(1).split('/', 1)[0];
    return namespace === 'api' || namespace === 'cdn-cgi' ? undefined : path;
  } catch {
    return undefined;
  }
}

function legacyToken(url: string): string {
  const entries = [...new URL(url).searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'token') throw new Error();
  return validateSubscriptionToken(entries[0][1]);
}

async function serve(
  c: any,
  prefix: string | undefined,
  tokenValue: string,
  legacyInfo?: 'show'
): Promise<Response> {
  let token: string;
  let info: 'show' | 'hide';
  let userAgent: string | undefined;
  try {
    if (prefix !== undefined) validateSubscriptionPathPrefix(prefix);
    token = validateSubscriptionToken(tokenValue);
    info = legacyInfo ?? parseQuery(c.req.url).info;
    const rawUa = c.req.header('User-Agent');
    userAgent = rawUa ? validateTrustedUserAgent(rawUa) : undefined;
  } catch { return unavailable(400); }
  try {
    const adapter = new V2BoardSubscriptionAdapter(
      createV2BoardClient(c.env), createV2BoardOriginClient(c.env), c.env.V2BOARD_SUBSCRIBE_PATH
    );
    const response = await adapter.subscriptionContent(token, userAgent, info);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof V2BoardSubscriptionUnavailableError) return unavailable(404);
    if (error instanceof V2BoardTimeoutError) return unavailable(504);
    return unavailable(502);
  }
}

router.get('*', async (c, next) => {
  const configuredPath = configuredLegacyPath(c.env.V2BOARD_SUBSCRIBE_PATH);
  if (configuredPath === undefined || new URL(c.req.url).pathname !== configuredPath) {
    return next();
  }
  try {
    return serve(c, undefined, legacyToken(c.req.url), 'show');
  } catch {
    return unavailable(400);
  }
});

router.get('/:token', (c) => serve(c, undefined, c.req.param('token')));
router.get('/:prefix/:token', (c) => {
  const prefix = c.req.param('prefix');
  if (prefix === 'api' || prefix === 'cdn-cgi') return c.notFound();
  return serve(c, prefix, c.req.param('token'));
});

export { router as subscriptionPublicRouter };
