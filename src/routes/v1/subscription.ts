import { Hono } from 'hono';
import {
  createV2BoardClient,
  createV2BoardOriginClient,
} from '../../adapters/v2board/factory';
import { V2BoardSubscriptionAdapter } from '../../adapters/v2board/subscription';
import {
  V2BoardSubscriptionUnavailableError,
  V2BoardTimeoutError,
} from '../../adapters/v2board/errors';
import type { Env } from '../../config/env';
import type { SubscriptionAccessSuccessResponse } from '../../contract/v1/subscription';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';
import {
  validateGatewayPublicOrigin,
  validateSubscriptionToken,
} from '../../security/subscription';
import { validateTrustedUserAgent } from '../../security/user-agent';

const subscriptionRouter = new Hono<GatewayContext>();
const subscriptionAccessRouter = new Hono<GatewayContext>();

function adapter(env: Env): V2BoardSubscriptionAdapter {
  return new V2BoardSubscriptionAdapter(
    createV2BoardClient(env),
    createV2BoardOriginClient(env),
    env.V2BOARD_SUBSCRIBE_PATH
  );
}

function unavailable(status: 400 | 404 | 502 | 504): Response {
  return new Response('subscription_unavailable', {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

subscriptionRouter.get('/', requireAuthorization, async (c) => {
  if (!c.env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }
  const publicOrigin = validateGatewayPublicOrigin(
    c.req.url,
    c.env.V2BOARD_BASE_URL
  );
  const access = await adapter(c.env).subscriptionAccess(c.get('authToken'));
  const accessUrl = access.eligible
    ? new URL('/api/v1/access/subscription', publicOrigin)
    : null;
  if (accessUrl && access.eligible) {
    accessUrl.searchParams.set('token', access.token);
  }
  const response: SubscriptionAccessSuccessResponse = {
    ok: true,
    data: {
      eligible: access.eligible,
      accessUrl: accessUrl?.toString() ?? null,
    },
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionAccessRouter.get('/subscription', async (c) => {
  const entries = [...new URL(c.req.url).searchParams.entries()];
  let token: string;
  let trustedUserAgent: string | undefined;
  try {
    if (entries.length !== 1 || entries[0][0] !== 'token') {
      throw new Error('Invalid query');
    }
    token = validateSubscriptionToken(entries[0][1]);
    const requestUserAgent = c.req.header('User-Agent');
    trustedUserAgent = requestUserAgent
      ? validateTrustedUserAgent(requestUserAgent)
      : undefined;
  } catch {
    return unavailable(400);
  }

  try {
    const response = await adapter(c.env).subscriptionContent(
      token,
      trustedUserAgent
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof V2BoardSubscriptionUnavailableError) {
      return unavailable(404);
    }
    if (error instanceof V2BoardTimeoutError) {
      return unavailable(504);
    }
    return unavailable(502);
  }
});

export { subscriptionAccessRouter, subscriptionRouter };
