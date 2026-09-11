import { z } from 'zod';
import type {
  CommissionPage,
  CommissionPageRequest,
  CommissionTransferred,
  CreatedReferralCode,
  ReferralOverview,
  WithdrawalOptions,
  WithdrawalRequest,
  WithdrawalRequested,
} from '../../contract/v1/referrals';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardCommissionTransferError,
  V2BoardInsufficientCommissionBalanceError,
  V2BoardReferralCodeLimitError,
  V2BoardUpstreamError,
  V2BoardWithdrawalDisabledError,
  V2BoardWithdrawalMethodUnsupportedError,
  V2BoardWithdrawalMinimumNotMetError,
  V2BoardWithdrawalRequestError,
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
const trueResponseSchema = z.object({ data: z.literal(true) }).strip();
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
const withdrawalOptionsResponseSchema = z
  .object({
    data: z
      .object({
        withdraw_close: z.union([z.literal(0), z.literal(1)]),
        withdraw_methods: z.array(z.string().min(1).max(255)),
      })
      .strip(),
  })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const CODE_LIMIT_MESSAGES = new Set([
  'the maximum number of creations has been reached',
  '已达到创建数量上限',
]);
const INSUFFICIENT_COMMISSION_MESSAGES = new Set([
  'insufficient commission balance',
  '推广佣金余额不足',
]);
const COMMISSION_TRANSFER_FAILED_MESSAGES = new Set([
  'transfer failed',
  '划转失败',
  'the user does not exist',
  '该用户不存在',
]);
const WITHDRAWAL_DISABLED_MESSAGES = new Set([
  'user.ticket.withdraw.not_support_withdraw',
]);
const WITHDRAWAL_METHOD_UNSUPPORTED_MESSAGES = new Set([
  'unsupported withdrawal method',
  '不支持的提现方式',
]);
const WITHDRAWAL_REQUEST_FAILED_MESSAGES = new Set([
  'failed to open ticket',
  '工单创建失败',
]);
const WITHDRAWAL_MINIMUM_MESSAGES = [
  /^the current required minimum withdrawal commission is (?:0|[1-9]\d*)(?:\.\d+)?$/,
  /^当前系统要求的最少提现佣金为：¥(?:0|[1-9]\d*)(?:\.\d+)?cny$/,
];

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
    if (!trueResponseSchema.safeParse(payload).success) {
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

  async transferCommission(
    authToken: string,
    amountMinor: number
  ): Promise<CommissionTransferred> {
    const { response, payload } = await this.requestJson('user/transfer', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transfer_amount: amountMinor }),
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && INSUFFICIENT_COMMISSION_MESSAGES.has(message)) {
        throw new V2BoardInsufficientCommissionBalanceError();
      }
      if (message && COMMISSION_TRANSFER_FAILED_MESSAGES.has(message)) {
        throw new V2BoardCommissionTransferError();
      }
      throw new V2BoardUpstreamError();
    }
    if (!trueResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { transferred: true };
  }

  async withdrawalOptions(authToken: string): Promise<WithdrawalOptions> {
    const { response, payload } = await this.requestJson('user/comm/config', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = withdrawalOptionsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      enabled: parsed.data.data.withdraw_close === 0,
      methods: parsed.data.data.withdraw_methods,
    };
  }

  async requestWithdrawal(
    authToken: string,
    request: WithdrawalRequest
  ): Promise<WithdrawalRequested> {
    const { response, payload } = await this.requestJson('user/ticket/withdraw', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        withdraw_method: request.method,
        withdraw_account: request.account,
      }),
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && WITHDRAWAL_DISABLED_MESSAGES.has(message)) {
        throw new V2BoardWithdrawalDisabledError();
      }
      if (message && WITHDRAWAL_METHOD_UNSUPPORTED_MESSAGES.has(message)) {
        throw new V2BoardWithdrawalMethodUnsupportedError();
      }
      if (
        message &&
        WITHDRAWAL_MINIMUM_MESSAGES.some((pattern) => pattern.test(message))
      ) {
        throw new V2BoardWithdrawalMinimumNotMetError();
      }
      if (message && WITHDRAWAL_REQUEST_FAILED_MESSAGES.has(message)) {
        throw new V2BoardWithdrawalRequestError();
      }
      throw new V2BoardUpstreamError();
    }
    if (!trueResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { requested: true };
  }
}
