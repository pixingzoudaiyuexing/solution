import { z } from 'zod';
import type { SubscriptionPeriodAdvanced } from '../../contract/v1/subscription';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardSubscriptionPeriodAdvanceDisabledError,
  V2BoardSubscriptionPeriodAdvanceError,
  V2BoardSubscriptionPeriodAdvanceUnavailableError,
  V2BoardSubscriptionTrafficNotExhaustedError,
  V2BoardUpstreamError,
} from './errors';

const successResponseSchema = z.object({ data: z.literal(true) }).strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const DISABLED_MESSAGES = new Set(['renewal is not allowed']);
const TRAFFIC_NOT_EXHAUSTED_MESSAGES = new Set([
  'you have not used up your traffic, you cannot renew your subscription',
]);
const ADVANCE_UNAVAILABLE_MESSAGES = new Set([
  'you do not allow to renew the subscription',
  'you do not have enough time to renew your subscription',
]);
const ADVANCE_FAILED_MESSAGES = new Set(['save failed', '保存失败']);

function errorMessage(payload: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase();
}

export class V2BoardSubscriptionPeriodAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async advance(authToken: string): Promise<SubscriptionPeriodAdvanced> {
    const { response, payload } = await this.requestJson('user/newPeriod', {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && DISABLED_MESSAGES.has(message)) {
        throw new V2BoardSubscriptionPeriodAdvanceDisabledError();
      }
      if (message && TRAFFIC_NOT_EXHAUSTED_MESSAGES.has(message)) {
        throw new V2BoardSubscriptionTrafficNotExhaustedError();
      }
      if (message && ADVANCE_UNAVAILABLE_MESSAGES.has(message)) {
        throw new V2BoardSubscriptionPeriodAdvanceUnavailableError();
      }
      if (message && ADVANCE_FAILED_MESSAGES.has(message)) {
        throw new V2BoardSubscriptionPeriodAdvanceError();
      }
      throw new V2BoardUpstreamError();
    }
    if (!successResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { advanced: true };
  }
}
