export type AntiBotProvider = 'recaptcha';
export type AntiBotMode = 'v2-checkbox';

export interface AntiBotConfig {
  enabled: boolean;
  provider: AntiBotProvider | null;
  mode: AntiBotMode | null;
  siteKey: string | null;
}

export interface OnboardingConfig {
  termsUrl: string | null;
  emailVerificationRequired: boolean;
  inviteCodeRequired: boolean;
  emailSuffixWhitelist: string[] | null;
  antiBot: AntiBotConfig;
}

export interface AccountConfig {
  currency: string;
  currencySymbol: string;
}

export interface OnboardingConfigSuccessResponse {
  ok: true;
  data: OnboardingConfig;
  requestId: string;
}

export interface AccountConfigSuccessResponse {
  ok: true;
  data: AccountConfig;
  requestId: string;
}
