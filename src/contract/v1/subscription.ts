export interface SubscriptionAccess {
  eligible: boolean;
  accessUrl: string | null;
}

export interface SubscriptionAccessSuccessResponse {
  ok: true;
  data: SubscriptionAccess;
  requestId: string;
}
