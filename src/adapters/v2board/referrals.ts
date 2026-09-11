import { z } from 'zod';
import type {
  CommissionPage,
  CommissionPageRequest,
  CreatedReferralCode,
  ReferralOverview,
} from '../../contract/v1/referrals';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardReferralCodeLimitError,
  V2BoardUpstreamError,
} from './errors';

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.number().int().nonnegative().max(253_402_300_799);
const inviteCodeSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9]{1,32}$/),
    created_at: timestampSchema,
  })
  .strip();
const referralStatsSchema = z.tuple([
  safeIntegerSchema,
  safeIntegerSchema,
  safeIntegerSchema,
  z.number().int().min(0).max(100),
  safeIntegerSchema,
]);
const referralOverviewResponseSchema = z
  .object({
    data: z
      .object({
        codes: z.array(inviteCodeSchema),
        stat: referralStatsSchema,
      })
      .strip(),
  })
  .strip();
const createdCodeResponseSchema = z.object({ data: z.literal(true) }).strip();
const commissionSchema = z
  .object({
    order_amount: safeIntegerSchema,
    get_amount: safeIntegerSchema,
    created_at: timestampSchema,
  })
  .strip();
const commissionHistoryResponseSchema = z
  .object({
    data: z.array(commissionSchema),
    total: safeIntegerSchema,
  })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const CODE_LIMIT_MESSAGES = new Set([
  'the maximum number of creations has been reached',
  '已达到创建数量上限',
]);

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function errorMessage(payload: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase();
}

export class V2BoardReferralsAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async overview(authToken: string): Promise<ReferralOverview> {
    const { response, payload } = await this.requestJson('user/invite/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = referralOverviewResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const [
      registeredUsers,
      earnedCommissionMinor,
      pendingCommissionMinor,
      commissionRatePercent,
      availableCommissionMinor,
    ] = parsed.data.data.stat;
    return {
      codes: parsed.data.data.codes.map((code) => ({
        code: code.code,
        createdAt: toIsoTimestamp(code.created_at),
      })),
      stats: {
        registeredUsers,
        earnedCommissionMinor,
        pendingCommissionMinor,
        commissionRatePercent,
        availableCommissionMinor,
      },
    };
  }

  async createCode(authToken: string): Promise<CreatedReferralCode> {
    const { response, payload } = await this.requestJson('user/invite/save', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && CODE_LIMIT_MESSAGES.has(message)) {
        throw new V2BoardReferralCodeLimitError();
      }
      throw new V2BoardUpstreamError();
    }
    if (!createdCodeResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { created: true };
  }

  async commissions(
    authToken: string,
    pagination: CommissionPageRequest
  ): Promise<CommissionPage> {
    const query = new URLSearchParams({
      current: String(pagination.page),
      page_size: String(pagination.pageSize),
    });
    const { response, payload } = await this.requestJson(
      `user/invite/details?${query.toString()}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthorizedResponse(response);

    const parsed = commissionHistoryResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      items: parsed.data.data.map((record) => ({
        orderAmountMinor: record.order_amount,
        commissionAmountMinor: record.get_amount,
        createdAt: toIsoTimestamp(record.created_at),
      })),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: parsed.data.total,
    };
  }
}
