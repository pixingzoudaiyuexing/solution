export type OrderStatus =
  | 'adjusted'
  | 'cancelled'
  | 'completed'
  | 'pending'
  | 'processing';

export const ORDER_BILLING_PERIODS = [
  'month',
  'quarter',
  'halfYear',
  'year',
  'twoYears',
  'threeYears',
  'oneTime',
] as const;

export type OrderBillingPeriod = (typeof ORDER_BILLING_PERIODS)[number];
export const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

export interface CreateOrderRequest {
  productId: string;
  billingPeriod: OrderBillingPeriod;
}

export interface CreatedOrder {
  id: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  amountMinor: number;
  createdAt: string;
  updatedAt: string | null;
  expiresAt: string;
}

export interface OrdersSuccessResponse {
  ok: true;
  data: Order[];
  requestId: string;
}

export interface OrderSuccessResponse {
  ok: true;
  data: Order;
  requestId: string;
}

export interface CreateOrderSuccessResponse {
  ok: true;
  data: CreatedOrder;
  requestId: string;
}
