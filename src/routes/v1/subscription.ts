import { Hono } from 'hono';
import { z } from 'zod';
import {
  createV2BoardClient,
  createV2BoardOriginClient,
} from '../../adapters/v2board/factory';
import { V2BoardSubscriptionAdapter } from '../../adapters/v2board/subscription';
import { V2BoardSubscriptionOverviewAdapter } from '../../adapters/v2board/subscription-overview';
import { V2BoardSubscriptionPeriodAdapter } from '../../adapters/v2board/subscription-period';
import {
  V2BoardSubscriptionUnavailableError,
  V2BoardTimeoutError,
} from '../../adapters/v2board/errors';
import type { Env } from '../../config/env';
import type {
  SubscriptionAccessSuccessResponse,
  SubscriptionAccessRotationSuccessResponse,
  SubscriptionEntriesSuccessResponse,
  SubscriptionEntryAccessSuccessResponse,
  SubscriptionOverviewSuccessResponse,
  SubscriptionPeriodAdvanceSuccessResponse,
  SubscriptionDeliveryOptionsSuccessResponse,
  SubscriptionAccessLinkSuccessResponse,
} from '../../contract/v1/subscription';
import { GatewayError } from '../../contract/error';
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
import { registryOperationalDefinitions } from '../../registry/definitions';
import {
  isSubscriptionDeliverySafeForDeployment,
  subscriptionDeliveryOperationalDefinition,
} from '../../registry/modules/subscription-delivery';
import { subscriptionProfileOperationalDefinition } from '../../registry/modules/subscription-profile';
import { readRegistryModuleSnapshot } from '../../registry/operational';
import {
  V2BoardSubscriptionAccessUnavailableError,
  V2BoardSubscriptionEntryUnavailableError,
} from '../../adapters/v2board/errors';

const subscriptionRouter = new Hono<GatewayContext>();
const subscriptionAccessRouter = new Hono<GatewayContext>();
const subscriptionEntryAccessRequestSchema = z
  .object({
    baseUrl: z
      .string()
      .min(1)
      .max(2048)
      .refine((value) => value.trim().length > 0),
  })
  .strict();
const accessLinkRequestSchema = z.object({
  entryId: z.string().regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/),
  profileId: z.enum(['default', 'cc']).optional().default('default'),
  subscriptionInfo: z.enum(['show', 'hide']).optional().default('show'),
}).strict();

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

function accessUrl(publicOrigin: string, token: string): string {
  const url = new URL('/api/v1/access/subscription', publicOrigin);
  url.searchParams.set('token', token);
  return url.toString();
}

async function availableCcProfile(env: Env) {
  if (!env.REGISTRY_KV) return null;
  const result = await readRegistryModuleSnapshot(
    env.REGISTRY_KV, subscriptionProfileOperationalDefinition, Date.now(), registryOperationalDefinitions
  );
  return result.status === 'available' && result.config.enabled ? result.config : null;
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
  const publicAccessUrl = access.eligible
    ? accessUrl(publicOrigin, access.token)
    : null;
  const response: SubscriptionAccessSuccessResponse = {
    ok: true,
    data: {
      eligible: access.eligible,
      accessUrl: publicAccessUrl,
    },
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.get('/overview', requireAuthorization, async (c) => {
  const adapter = new V2BoardSubscriptionOverviewAdapter(
    createV2BoardClient(c.env)
  );
  const data = await adapter.overview(c.get('authToken'));
  const response: SubscriptionOverviewSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.get('/entries', requireAuthorization, async (c) => {
  const entries = await adapter(c.env).subscriptionEntries(c.get('authToken'));
  const response: SubscriptionEntriesSuccessResponse = {
    ok: true,
    data: { entries },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.post('/entry-access', requireAuthorization, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = subscriptionEntryAccessRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const accessUrl = await adapter(c.env).subscriptionEntryAccess(
    c.get('authToken'),
    parsed.data.baseUrl
  );
  const response: SubscriptionEntryAccessSuccessResponse = {
    ok: true,
    data: { accessUrl },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.get('/delivery-options', requireAuthorization, async (c) => {
  const service = adapter(c.env);
  if (!(await service.accessEligible(c.get('authToken')))) {
    throw new V2BoardSubscriptionAccessUnavailableError();
  }
  let data: SubscriptionDeliveryOptionsSuccessResponse['data'] = {
    defaultEntryId: null,
    entries: [],
    profiles: [{ id: 'default', label: 'Default', available: true }],
  };
  if (c.env.REGISTRY_KV && c.env.V2BOARD_BASE_URL) {
    const result = await readRegistryModuleSnapshot(
      c.env.REGISTRY_KV,
      subscriptionDeliveryOperationalDefinition,
      Date.now(),
      registryOperationalDefinitions
    );
    if (
      result.status === 'available' &&
      isSubscriptionDeliverySafeForDeployment(result.config, c.env.V2BOARD_BASE_URL)
    ) {
      const entries = result.config.entries
        .filter((entry) => entry.enabled && entry.selectable)
        .map((entry) => ({ id: entry.id, label: entry.label.default }));
      if (entries.length > 0) {
        data = { ...data, defaultEntryId: result.config.defaultEntryId, entries };
      }
    }
  }
  const ccProfile = await availableCcProfile(c.env);
  data.profiles.push({ id: 'cc', label: ccProfile?.label.default ?? 'CC', available: ccProfile !== null });
  const response: SubscriptionDeliveryOptionsSuccessResponse = {
    ok: true, data, requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.post('/access-link', requireAuthorization, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request'); }
  const parsed = accessLinkRequestSchema.safeParse(body);
  if (!parsed.success) throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  const service = adapter(c.env);
  if (!(await service.accessEligible(c.get('authToken')))) {
    throw new V2BoardSubscriptionAccessUnavailableError();
  }
  if (!c.env.REGISTRY_KV || !c.env.V2BOARD_BASE_URL) {
    throw new V2BoardSubscriptionEntryUnavailableError();
  }
  const result = await readRegistryModuleSnapshot(
    c.env.REGISTRY_KV,
    subscriptionDeliveryOperationalDefinition,
    Date.now(),
    registryOperationalDefinitions
  );
  if (
    result.status !== 'available' ||
    !isSubscriptionDeliverySafeForDeployment(result.config, c.env.V2BOARD_BASE_URL)
  ) throw new V2BoardSubscriptionEntryUnavailableError();
  const entry = result.config.entries.find(
    (candidate) => candidate.id === parsed.data.entryId && candidate.enabled && candidate.selectable
  );
  if (!entry) throw new V2BoardSubscriptionEntryUnavailableError();
  if (parsed.data.profileId === 'cc' && !(await availableCcProfile(c.env))) {
    throw new V2BoardSubscriptionEntryUnavailableError();
  }
  const token = await service.normalSubscriptionToken(c.get('authToken'));
  const url = new URL(entry.publicOrigin);
  url.pathname = entry.pathPrefix ? `/${entry.pathPrefix}/${token}` : `/${token}`;
  if (parsed.data.profileId === 'cc') url.searchParams.set('profile', 'cc');
  if (parsed.data.subscriptionInfo === 'hide') url.searchParams.set('info', 'hide');
  const response: SubscriptionAccessLinkSuccessResponse = {
    ok: true, data: { accessUrl: url.toString() }, requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.post('/rotate-access', requireAuthorization, async (c) => {
  if (!c.env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }
  const publicOrigin = validateGatewayPublicOrigin(
    c.req.url,
    c.env.V2BOARD_BASE_URL
  );
  const token = await adapter(c.env).rotateAccess(c.get('authToken'));
  const response: SubscriptionAccessRotationSuccessResponse = {
    ok: true,
    data: {
      rotated: true,
      accessUrl: accessUrl(publicOrigin, token),
    },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

subscriptionRouter.post('/advance-period', requireAuthorization, async (c) => {
  const periodAdapter = new V2BoardSubscriptionPeriodAdapter(
    createV2BoardClient(c.env)
  );
  const data = await periodAdapter.advance(c.get('authToken'));
  const response: SubscriptionPeriodAdvanceSuccessResponse = {
    ok: true,
    data,
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
