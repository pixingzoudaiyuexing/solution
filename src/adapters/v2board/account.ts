import { z } from 'zod';
import type {
  AccountPreferences,
  AccountPreferencesRequest,
  AccountStats,
  PreferencesUpdated,
} from '../../contract/user';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardPreferencesUpdateError,
  V2BoardUpstreamError,
} from './errors';

const trueResponseSchema = z.object({ data: z.literal(true) }).strip();
const preferenceFlagSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);
const preferencesResponseSchema = z
  .object({
    data: z
      .object({
        auto_renewal: preferenceFlagSchema,
        remind_expire: preferenceFlagSchema,
        remind_traffic: preferenceFlagSchema,
      })
      .strip(),
  })
  .strip();
const boundedCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_647);
const statsResponseSchema = z
  .object({
    data: z.tuple([
      boundedCountSchema,
      boundedCountSchema,
      boundedCountSchema,
    ]),
  })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();
const PREFERENCES_UPDATE_MESSAGES = new Set([
  'save failed',
  '保存失败',
  'the user does not exist',
  '该用户不存在',
]);

export class V2BoardAccountAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async preferences(authToken: string): Promise<AccountPreferences> {
    const { response, payload } = await this.requestJson('user/info', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = preferencesResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      autoRenewal: parsed.data.data.auto_renewal,
      remindExpire: parsed.data.data.remind_expire,
      remindTraffic: parsed.data.data.remind_traffic,
    };
  }

  async updatePreferences(
    authToken: string,
    request: AccountPreferencesRequest
  ): Promise<PreferencesUpdated> {
    const body: Record<string, 0 | 1> = {};
    if (request.autoRenewal !== undefined) {
      body.auto_renewal = request.autoRenewal ? 1 : 0;
    }
    if (request.remindExpire !== undefined) {
      body.remind_expire = request.remindExpire ? 1 : 0;
    }
    if (request.remindTraffic !== undefined) {
      body.remind_traffic = request.remindTraffic ? 1 : 0;
    }
    const { response, payload } = await this.requestJson('user/update', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const parsed = errorResponseSchema.safeParse(payload);
      const message = parsed.success
        ? (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase()
        : undefined;
      if (message && PREFERENCES_UPDATE_MESSAGES.has(message)) {
        throw new V2BoardPreferencesUpdateError();
      }
      throw new V2BoardUpstreamError();
    }
    if (!trueResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { updated: true };
  }

  async stats(authToken: string): Promise<AccountStats> {
    const { response, payload } = await this.requestJson('user/getStat', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);
    const parsed = statsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const [pendingOrders, openTickets, invitedUsers] = parsed.data.data;
    return { pendingOrders, openTickets, invitedUsers };
  }
}
