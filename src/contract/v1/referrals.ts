export interface ReferralCode {
  code: string;
  createdAt: string;
}

export interface ReferralStats {
  registeredUsers: number;
  earnedCommissionMinor: number;
  pendingCommissionMinor: number;
  commissionRatePercent: number;
  availableCommissionMinor: number;
}

export interface ReferralOverview {
  codes: ReferralCode[];
  stats: ReferralStats;
}

export interface CreatedReferralCode {
  created: true;
}

export interface CommissionTransferRequest {
  amountMinor: number;
}

export interface CommissionTransferred {
  transferred: true;
}

export interface CommissionHistoryItem {
  orderAmountMinor: number;
  commissionAmountMinor: number;
  createdAt: string;
}

export interface CommissionPageRequest {
  page: number;
  pageSize: number;
}

export interface CommissionPage extends CommissionPageRequest {
  items: CommissionHistoryItem[];
  total: number;
}

export interface ReferralOverviewSuccessResponse {
  ok: true;
  data: ReferralOverview;
  requestId: string;
}

export interface CreateReferralCodeSuccessResponse {
  ok: true;
  data: CreatedReferralCode;
  requestId: string;
}

export interface CommissionTransferSuccessResponse {
  ok: true;
  data: CommissionTransferred;
  requestId: string;
}

export interface CommissionHistorySuccessResponse {
  ok: true;
  data: CommissionPage;
  requestId: string;
}
