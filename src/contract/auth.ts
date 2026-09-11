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

export type EmailCodePurpose = 'register' | 'password-reset';

export interface EmailCodeRequest {
  email: string;
  purpose: EmailCodePurpose;
  challengeToken?: string;
}

export interface EmailCodeResponseData {
  sent: true;
}

export interface EmailCodeSuccessResponse {
  ok: true;
  data: EmailCodeResponseData;
  requestId: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  emailCode?: string;
  inviteCode?: string;
  challengeToken?: string;
}

export type RegisterSuccessResponse = LoginSuccessResponse;

export interface PasswordResetRequest {
  email: string;
  emailCode: string;
  newPassword: string;
}

export interface PasswordResetResponseData {
  reset: true;
}

export interface PasswordResetSuccessResponse {
  ok: true;
  data: PasswordResetResponseData;
  requestId: string;
}
