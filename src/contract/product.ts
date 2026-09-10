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
