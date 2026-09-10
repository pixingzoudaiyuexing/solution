export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponseData {
  accessToken: string;
  tokenType: 'Bearer';
}

export interface LoginSuccessResponse {
  ok: true;
  data: LoginResponseData;
  requestId: string;
}
