export interface SubscriptionAccess {
  eligible: boolean;
  accessUrl: string | null;
}

export interface SubscriptionAccessSuccessResponse {
  ok: true;
  data: SubscriptionAccess;
  requestId: string;
}

export interface SubscriptionAccessRotated {
  rotated: true;
  accessUrl: string;
}

export interface SubscriptionAccessRotationSuccessResponse {
  ok: true;
  data: SubscriptionAccessRotated;
  requestId: string;
}

export interface SubscriptionPeriodAdvanced {
  advanced: true;
}

export interface SubscriptionPeriodAdvanceSuccessResponse {
  ok: true;
  data: SubscriptionPeriodAdvanced;
  requestId: string;
}

export interface SubscriptionOverviewProduct {
  id: string;
  name: string;
}

export interface SubscriptionTraffic {
  uploadedBytes: number;
  downloadedBytes: number;
  allowanceBytes: number;
}

export interface SubscriptionOverview {
  product: SubscriptionOverviewProduct | null;
  expiresAt: string | null;
  traffic: SubscriptionTraffic;
  deviceLimit: number | null;
  activeDevices: number;
  resetDay: number | null;
  renewalAllowed: boolean;
}

export interface SubscriptionOverviewSuccessResponse {
  ok: true;
  data: SubscriptionOverview;
  requestId: string;
}
