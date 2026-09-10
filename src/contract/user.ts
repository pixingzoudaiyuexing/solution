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
