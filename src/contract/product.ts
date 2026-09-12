import { z } from 'zod';

export const productIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .refine((value) => Number(value) <= 2_147_483_647);

export type BillingPeriod =
  | 'month'
  | 'quarter'
  | 'halfYear'
  | 'year'
  | 'twoYears'
  | 'threeYears'
  | 'oneTime';

export interface ProductPrice {
  billingPeriod: BillingPeriod;
  amountMinor: number;
}

export interface Product {
  id: string;
  name: string;
  dataAllowanceGb: number;
  speedLimitMbps: number | null;
  available: boolean;
  prices: ProductPrice[];
}

export interface ProductsSuccessResponse {
  ok: true;
  data: { products: Product[] };
  requestId: string;
}

export interface ProductSuccessResponse {
  ok: true;
  data: { product: Product };
  requestId: string;
}
