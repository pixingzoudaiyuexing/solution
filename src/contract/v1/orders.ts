export type OrderStatus =
  | 'adjusted'
  | 'cancelled'
  | 'completed'
  | 'pending'
  | 'processing';

export interface Order {
  id: string;
  status: OrderStatus;
  amountMinor: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface OrdersSuccessResponse {
  ok: true;
  data: Order[];
  requestId: string;
}
