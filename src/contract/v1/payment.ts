export const PAYMENT_METHOD_ID_PATTERN = /^[1-9]\d{0,9}$/;

export interface PaymentFee {
  fixedMinor: number;
  percent: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  icon: string | null;
  fee: PaymentFee;
}

export interface PaymentMethodsSuccessResponse {
  ok: true;
  data: PaymentMethod[];
  requestId: string;
}

export interface CheckoutRequest {
  paymentMethodId: string;
}

export type CheckoutAction =
  | { type: 'finished' }
  | { type: 'qrcode'; data: string }
  | { type: 'redirect'; target: string };

export interface CheckoutSuccessResponse {
  ok: true;
  data: CheckoutAction;
  requestId: string;
}
