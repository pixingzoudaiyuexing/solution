import { z } from 'zod';
import { ORDER_ID_PATTERN } from '../../contract/v1/orders';
import type {
  Wallet,
  WalletDepositCreated,
} from '../../contract/v1/wallet';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardUpstreamError,
  V2BoardWalletDepositAmountInvalidError,
  V2BoardWalletDepositCreateError,
  V2BoardWalletDepositUnavailableError,
} from './errors';

const walletResponseSchema = z
  .object({
    data: z
      .object({
        balance: z.number().int().nonnegative().max(2_147_483_647),
      })
      .strip(),
  })
  .strip();
const depositResponseSchema = z
  .object({ data: z.string().regex(ORDER_ID_PATTERN) })
  .strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const DEPOSIT_UNAVAILABLE_MESSAGES = new Set([
  'you have an unpaid or pending order, please try again later or cancel it',
  '您有未付款或开通中的订单，请稍后再试或将其取消',
]);
const DEPOSIT_AMOUNT_INVALID_MESSAGES = new Set([
  'failed to create order, deposit amount must be greater than 0',
  'deposit amount too large, please contact the administrator',
]);
const DEPOSIT_CREATE_FAILED_MESSAGES = new Set([
  'failed to create order',
  '订单创建失败',
]);

function errorMessage(payload: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase();
}

export class V2BoardWalletAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async wallet(authToken: string): Promise<Wallet> {
    const { response, payload } = await this.requestJson('user/info', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = walletResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return { balanceMinor: parsed.data.data.balance };
  }

  async createDeposit(
    authToken: string,
    amountMinor: number
  ): Promise<WalletDepositCreated> {
    const { response, payload } = await this.requestJson('user/order/save', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: 0,
        period: 'deposit',
        deposit_amount: amountMinor,
      }),
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && DEPOSIT_UNAVAILABLE_MESSAGES.has(message)) {
        throw new V2BoardWalletDepositUnavailableError();
      }
      if (message && DEPOSIT_AMOUNT_INVALID_MESSAGES.has(message)) {
        throw new V2BoardWalletDepositAmountInvalidError();
      }
      if (message && DEPOSIT_CREATE_FAILED_MESSAGES.has(message)) {
        throw new V2BoardWalletDepositCreateError();
      }
      throw new V2BoardUpstreamError();
    }

    const parsed = depositResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return { id: parsed.data.data };
  }
}
