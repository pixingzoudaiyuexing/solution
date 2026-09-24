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

export interface RuntimeSettingsConfig {
  siteName: string | null;
  brandName: string | null;
  title: string | null;
  description: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  footerText: string | null;
}

export const EMPTY_RUNTIME_SETTINGS_CONFIG: RuntimeSettingsConfig = {
  siteName: null,
  brandName: null,
  title: null,
  description: null,
  logoUrl: null,
  faviconUrl: null,
  footerText: null,
};

export interface PromotionUiConfig {
  showCouponEntry: boolean;
  annualPrefillCode: string | null;
}

export const DEFAULT_PROMOTION_UI_CONFIG: PromotionUiConfig = {
  showCouponEntry: true,
  annualPrefillCode: null,
};

export interface PromotionUiConfigSuccessResponse {
  ok: true;
  data: PromotionUiConfig;
  requestId: string;
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

export interface RuntimeSettingsConfigSuccessResponse {
  ok: true;
  data: RuntimeSettingsConfig;
  requestId: string;
}
