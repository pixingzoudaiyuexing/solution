import { z } from 'zod';
import {
  extractSubscriptionToken,
  normalizeV2BoardSubscribePath,
  validateSubscriptionToken,
} from '../../security/subscription';
import { cancelUnusedResponseBody } from '../../http/response-body';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardSubscriptionAccessUnavailableError,
  V2BoardSubscriptionRotationError,
  V2BoardSubscriptionUnavailableError,
  V2BoardUpstreamError,
} from './errors';

const qualifyingStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const orderHistorySchema = z
  .object({
    data: z.array(
      z
        .object({
          plan_id: z.number().int().nonnegative().max(2_147_483_647),
          status: qualifyingStatusSchema,
        })
        .strip()
    ),
  })
  .strip();
const subscriptionResponseSchema = z
  .object({
    data: z
      .object({ subscribe_url: z.string().min(1).max(8192) })
      .strip(),
  })
  .strip();
const rotationResponseSchema = z
  .object({ data: z.string().min(1).max(8192) })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();
const QUALIFYING_ORDER_STATUSES = new Set([1, 3, 4]);
const ROTATION_FAILED_MESSAGES = new Set(['reset failed', '重置失败']);
const SUBSCRIPTION_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'subscription-userinfo',
  'profile-update-interval',
  'profile-title',
] as const;

export type InternalSubscriptionAccess =
  | { eligible: false }
  | { eligible: true; token: string };

export class V2BoardSubscriptionAdapter extends V2BoardAdapterBase {
  private readonly subscribePath: string;

  constructor(
    client: V2BoardClient,
    private readonly originClient: V2BoardClient,
    subscribePath: string | undefined
  ) {
    super(client);
    this.subscribePath = normalizeV2BoardSubscribePath(subscribePath);
  }

  async subscriptionAccess(authToken: string): Promise<InternalSubscriptionAccess> {
    if (!(await this.accessEligible(authToken))) {
      return { eligible: false };
    }

    const subscription = await this.requestJson('user/getSubscribe', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(subscription.response);

    const parsedSubscription = subscriptionResponseSchema.safeParse(
      subscription.payload
    );
    if (!parsedSubscription.success) {
      throw new V2BoardUpstreamError();
    }

    try {
      return {
        eligible: true,
        token: extractSubscriptionToken(
          parsedSubscription.data.data.subscribe_url
        ),
      };
    } catch {
      throw new V2BoardUpstreamError();
    }
  }

  async rotateAccess(authToken: string): Promise<string> {
    if (!(await this.accessEligible(authToken))) {
      throw new V2BoardSubscriptionAccessUnavailableError();
    }

    const { response, payload } = await this.requestJson('user/resetSecurity', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const parsedError = errorResponseSchema.safeParse(payload);
      const message = parsedError.success
        ? (parsedError.data.message ?? parsedError.data.error)?.trim().toLowerCase()
        : undefined;
      if (message && ROTATION_FAILED_MESSAGES.has(message)) {
        throw new V2BoardSubscriptionRotationError();
      }
      throw new V2BoardUpstreamError();
    }

    const parsed = rotationResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    try {
      return extractSubscriptionToken(parsed.data.data);
    } catch {
      throw new V2BoardUpstreamError();
    }
  }

  private async accessEligible(authToken: string): Promise<boolean> {
    const history = await this.requestJson('user/order/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(history.response);

    const parsedHistory = orderHistorySchema.safeParse(history.payload);
    if (!parsedHistory.success) {
      throw new V2BoardUpstreamError();
    }
    return parsedHistory.data.data.some(
      (order) =>
        order.plan_id > 0 && QUALIFYING_ORDER_STATUSES.has(order.status)
    );
  }

  async subscriptionContent(
    token: string,
    trustedUserAgent?: string
  ): Promise<Response> {
    const query = new URLSearchParams({
      token: validateSubscriptionToken(token),
    });
    const response = await this.request(
      `${this.subscribePath}?${query.toString()}`,
      {
        method: 'GET',
        headers: { Accept: '*/*' },
        trustedUserAgent,
      },
      this.originClient
    );

    if (!response.ok) {
      await cancelUnusedResponseBody(response);
      if (response.status >= 400 && response.status < 500) {
        throw new V2BoardSubscriptionUnavailableError();
      }
      throw new V2BoardUpstreamError();
    }

    const headers = new Headers();
    for (const name of SUBSCRIPTION_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }
}
