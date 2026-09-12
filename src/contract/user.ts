export interface CurrentUserResponseData {
  email: string;
  expiresAt: string | null;
  status: 'active' | 'disabled' | 'expired';
}

export interface CurrentUserSuccessResponse {
  ok: true;
  data: CurrentUserResponseData;
  requestId: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface PasswordChanged {
  changed: true;
}

export interface ChangePasswordSuccessResponse {
  ok: true;
  data: PasswordChanged;
  requestId: string;
}

export interface AccountPreferencesRequest {
  autoRenewal?: boolean;
  remindExpire?: boolean;
  remindTraffic?: boolean;
}

export interface AccountPreferences {
  autoRenewal: boolean;
  remindExpire: boolean;
  remindTraffic: boolean;
}

export interface AccountPreferencesSuccessResponse {
  ok: true;
  data: AccountPreferences;
  requestId: string;
}

export interface PreferencesUpdated {
  updated: true;
}

export interface UpdatePreferencesSuccessResponse {
  ok: true;
  data: PreferencesUpdated;
  requestId: string;
}

export interface AccountStats {
  pendingOrders: number;
  openTickets: number;
  invitedUsers: number;
}

export interface AccountStatsSuccessResponse {
  ok: true;
  data: AccountStats;
  requestId: string;
}
