import { z } from 'zod';
import type {
  CheckoutAction,
  CheckoutRequest,
  PaymentMethod,
} from '../../contract/v1/payment';
import { validatePaymentRedirectTarget } from '../../security/payment-target';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardOrderExpiredError,
  V2BoardPaymentCreateError,
  V2BoardPaymentMethodUnavailableError,
  V2BoardUpstreamError,
} from './errors';

const percentageSchema = z.union([
  z.number().finite().nonnegative().max(100),
  z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(
    z.number().finite().nonnegative().max(100)
  ),
]);
const enabledSchema = z.union([z.boolean(), z.literal(0), z.literal(1)]).optional();
const paymentMethodSchema = z
  .object({
    id: z.number().int().positive().max(2_147_483_647),
    name: z.string().min(1).max(255),
    icon: z.string().nullable().optional(),
    handling_fee_fixed: z.number().int().nonnegative().nullable().optional(),
    handling_fee_percent: percentageSchema.nullable().optional(),
    enable: enabledSchema,
  })
  .strip();
const paymentMethodsResponseSchema = z
  .object({ data: z.array(paymentMethodSchema) })
  .strip();

const qrPayloadSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value));
const checkoutResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal(-1), data: z.literal(true) }).strip(),
  z.object({ type: z.literal(0), data: qrPayloadSchema }).strip(),
  z.object({ type: z.literal(1), data: z.string().min(1).max(8192) }).strip(),
  z.object({ type: z.literal(2), data: z.literal(true) }).strip(),
]);
const paymentErrorSchema = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .strip();

const UNAVAILABLE_MESSAGES = new Set([
  'payment method is not available',
  '支付方式不可用',
]);
const EXPIRED_ORDER_MESSAGES = new Set(['order has expired']);

function enabled(value: z.infer<typeof enabledSchema>): boolean {
  return value === undefined || value === true || value === 1;
}

function publicIcon(icon: string | null | undefined, hiddenOrigin: string): string | null {
  if (!icon) return null;
  try {
    return validatePaymentRedirectTarget(icon, hiddenOrigin);
  } catch {
    return null;
  }
}

export interface V2BoardCheckoutContext {
  trustedOrigin?: string;
  trustedUserAgent?: string;
}

export class V2BoardPaymentAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient, private readonly hiddenOrigin: string) {
    super(client);
  }

  async paymentMethods(authToken: string): Promise<PaymentMethod[]> {
    const { response, payload } = await this.requestJson(
      'user/order/getPaymentMethod',
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthorizedResponse(response);

    const parsed = paymentMethodsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return parsed.data.data.filter((method) => enabled(method.enable)).map((method) => ({
      id: String(method.id),
      name: method.name,
      icon: publicIcon(method.icon, this.hiddenOrigin),
      fee: {
        fixedMinor: method.handling_fee_fixed ?? 0,
        percent: method.handling_fee_percent ?? 0,
      },
    }));
  }

  async checkout(
    authToken: string,
    orderId: string,
    request: CheckoutRequest,
    context: V2BoardCheckoutContext = {}
  ): Promise<CheckoutAction> {
    const { response, payload } = await this.requestJson('user/order/checkout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        trade_no: orderId,
        method: Number(request.paymentMethodId),
      }),
      trustedOrigin: context.trustedOrigin,
      trustedUserAgent: context.trustedUserAgent,
    });
    this.assertAuthenticatedResponse(response);

    if (!response.ok) {
      const parsedError = paymentErrorSchema.safeParse(payload);
      if (!parsedError.success) {
        throw new V2BoardUpstreamError();
      }
      const message = (parsedError.data.message ?? parsedError.data.error)
        ?.trim()
        .toLowerCase();
      if (message && EXPIRED_ORDER_MESSAGES.has(message)) {
        throw new V2BoardOrderExpiredError();
      }
      if (message && UNAVAILABLE_MESSAGES.has(message)) {
        throw new V2BoardPaymentMethodUnavailableError();
      }
      throw new V2BoardPaymentCreateError();
    }

    const parsed = checkoutResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardPaymentCreateError();
    }

    switch (parsed.data.type) {
      case -1:
      case 2:
        return { type: 'finished' };
      case 0:
        return { type: 'qrcode', data: parsed.data.data };
      case 1:
        try {
          return {
            type: 'redirect',
            target: validatePaymentRedirectTarget(
              parsed.data.data,
              this.hiddenOrigin,
              { allowSignedV2BoardParameters: true }
            ),
          };
        } catch {
          throw new V2BoardPaymentCreateError();
        }
    }
  }
}
