import { z } from 'zod';
import {
  extractSubscriptionToken,
  normalizeV2BoardSubscribePath,
  validateSubscriptionToken,
} from '../../security/subscription';
import { cancelUnusedResponseBody } from '../../http/response-body';
import { CC_MAX_YAML_BYTES } from '../../security/cc-profile-limits';
import type { SubscriptionProfileConfig } from '../../registry/modules/subscription-profile';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardSubscriptionAccessUnavailableError,
  V2BoardSubscriptionEntryUnavailableError,
  V2BoardSubscriptionRotationError,
  V2BoardSubscriptionUnavailableError,
  V2BoardUpstreamError,
} from './errors';

const entitlementBannedSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);
const entitlementTimestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(253_402_300_799);
const entitlementCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const subscriptionEntitlementSchema = z
  .object({
    data: z
      .object({
        banned: entitlementBannedSchema,
        transfer_enable: entitlementCountSchema,
        expired_at: entitlementTimestampSchema.nullable(),
      })
      .strip(),
  })
  .strip();
const subscriptionResponseSchema = z
  .object({
    data: z
      .object({ subscribe_url: z.string().min(1).max(8192) })
      .strip(),
  })
  .strip();
const normalSubscriptionResponseSchema = z.object({
  data: z.object({ token: z.string(), subscribe_url: z.string().min(1).max(8192) }).strip(),
}).strip();
const rotationResponseSchema = z
  .object({ data: z.string().min(1).max(8192) })
  .strip();
const subscriptionEntriesResponseSchema = z
  .object({
    data: z
      .object({
        entries: z
          .array(
            z
              .object({ base_url: z.string().min(1).max(2048) })
              .strip()
          )
          .max(100),
      })
      .strip(),
  })
  .strip();
const subscriptionEntryAccessResponseSchema = z
  .object({
    data: z
      .object({ subscribe_url: z.string().min(1).max(8192) })
      .strip(),
  })
  .strip();
const subscriptionEntryUnavailableResponseSchema = z
  .object({
    message: z.literal('Selected subscription entry is invalid'),
  })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();
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
  constructor(
    client: V2BoardClient,
    private readonly originClient: V2BoardClient,
    private readonly subscribePath: string | undefined
  ) {
    super(client);
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

  async subscriptionEntries(
    authToken: string
  ): Promise<Array<{ baseUrl: string }>> {
    if (!(await this.accessEligible(authToken))) {
      throw new V2BoardSubscriptionAccessUnavailableError();
    }

    const { response, payload } = await this.requestJson(
      'user/getSubscribeEntries',
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthorizedResponse(response);

    const parsed = subscriptionEntriesResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return parsed.data.data.entries.map((entry) => ({
      baseUrl: entry.base_url,
    }));
  }

  async subscriptionEntryAccess(
    authToken: string,
    baseUrl: string
  ): Promise<string> {
    if (!(await this.accessEligible(authToken))) {
      throw new V2BoardSubscriptionAccessUnavailableError();
    }

    const { response, payload } = await this.requestJson(
      'user/getSubscribeForEntry',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: authToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base_url: baseUrl }),
      }
    );
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      if (
        response.status === 422 &&
        subscriptionEntryUnavailableResponseSchema.safeParse(payload).success
      ) {
        throw new V2BoardSubscriptionEntryUnavailableError();
      }
      throw new V2BoardUpstreamError();
    }

    const parsed = subscriptionEntryAccessResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return parsed.data.data.subscribe_url;
  }

  async accessEligible(authToken: string): Promise<boolean> {
    const entitlement = await this.requestJson('user/info', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(entitlement.response);

    const parsed = subscriptionEntitlementSchema.safeParse(entitlement.payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }
    const data = parsed.data.data;
    return (
      !data.banned &&
      data.transfer_enable > 0 &&
      (data.expired_at === null ||
        data.expired_at > Math.floor(Date.now() / 1000))
    );
  }

  async normalSubscriptionToken(authToken: string): Promise<string> {
    const { response, payload } = await this.requestJson('user/getSubscribe', {
      method: 'GET', headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);
    const parsed = normalSubscriptionResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardSubscriptionEntryUnavailableError();
    try {
      const direct = validateSubscriptionToken(parsed.data.data.token);
      const fromUrl = extractSubscriptionToken(parsed.data.data.subscribe_url);
      if (direct !== fromUrl) throw new Error();
      return direct;
    } catch { throw new V2BoardSubscriptionEntryUnavailableError(); }
  }

  async subscriptionContent(
    token: string,
    trustedUserAgent?: string,
    subscriptionInfo: 'show' | 'hide' = 'show'
  ): Promise<Response> {
    const subscribePath = normalizeV2BoardSubscribePath(this.subscribePath);
    const query = new URLSearchParams({
      token: validateSubscriptionToken(token),
    });
    const response = await this.request(
      `${subscribePath}?${query.toString()}`,
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
      if (value !== null && !(subscriptionInfo === 'hide' && name === 'subscription-userinfo')) {
        headers.set(name, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  async ccProfileContent(
    token: string,
    trustedUserAgent: string | undefined,
    subscriptionInfo: 'show' | 'hide',
    config: SubscriptionProfileConfig
  ): Promise<Response> {
    const subscribePath = normalizeV2BoardSubscribePath(this.subscribePath);
    const query = new URLSearchParams({ token: validateSubscriptionToken(token), flag: 'meta' });
    const response = await this.request(
      `${subscribePath}?${query.toString()}`,
      { method: 'GET', headers: { Accept: 'application/yaml' }, trustedUserAgent },
      this.originClient
    );
    if (!response.ok) {
      await cancelUnusedResponseBody(response);
      if (response.status >= 400 && response.status < 500) throw new V2BoardSubscriptionUnavailableError();
      throw new V2BoardUpstreamError();
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > CC_MAX_YAML_BYTES)) {
      await cancelUnusedResponseBody(response);
      throw new V2BoardUpstreamError();
    }
    if (!response.body) throw new V2BoardUpstreamError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
    }, 10_000);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > CC_MAX_YAML_BYTES) throw new V2BoardUpstreamError();
        chunks.push(value);
      }
      if (timedOut) throw new V2BoardUpstreamError();
    } catch {
      void reader.cancel().catch(() => undefined);
      throw new V2BoardUpstreamError();
    } finally {
      clearTimeout(timeout);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let yaml: string;
    try {
      const { transformCcProfile } = await import('../../security/cc-profile');
      yaml = transformCcProfile(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), config);
    } catch { throw new V2BoardUpstreamError(); }
    const headers = new Headers({ 'Content-Type': 'application/yaml; charset=utf-8' });
    for (const name of SUBSCRIPTION_RESPONSE_HEADERS) {
      if (name === 'content-type' || name === 'content-disposition') continue;
      const value = response.headers.get(name);
      if (value !== null && !(subscriptionInfo === 'hide' && name === 'subscription-userinfo')) headers.set(name, value);
    }
    return new Response(yaml, { status: 200, headers });
  }
}
