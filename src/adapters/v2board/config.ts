import { z } from 'zod';
import type {
  AccountConfig,
  OnboardingConfig,
} from '../../contract/v1/config';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardUpstreamError } from './errors';

const upstreamFlagSchema = z.union([z.literal(0), z.literal(1)]);
const suffixSchema = z
  .string()
  .max(255)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0);
const guestConfigResponseSchema = z
  .object({
    data: z
      .object({
        tos_url: z.string().max(2048).nullable(),
        is_email_verify: upstreamFlagSchema,
        is_invite_force: upstreamFlagSchema,
        email_whitelist_suffix: z.union([
          z.literal(0),
          z.array(suffixSchema).max(255),
        ]),
        is_recaptcha: upstreamFlagSchema,
        recaptcha_site_key: z.string().max(4096).nullable().optional(),
      })
      .strip(),
  })
  .strip();
const shortConfigValueSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(16));
const accountConfigResponseSchema = z
  .object({
    data: z
      .object({
        currency: shortConfigValueSchema,
        currency_symbol: shortConfigValueSchema,
      })
      .strip(),
  })
  .strip();

function termsUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new V2BoardUpstreamError();
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new V2BoardUpstreamError();
  }
  return normalized;
}

export class V2BoardConfigAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async onboardingConfig(): Promise<OnboardingConfig> {
    const { response, payload } = await this.requestJson('guest/comm/config', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new V2BoardUpstreamError();

    const parsed = guestConfigResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const config = parsed.data.data;
    const antiBotEnabled = config.is_recaptcha === 1;
    const siteKey = config.recaptcha_site_key?.trim();
    if (antiBotEnabled && !siteKey) throw new V2BoardUpstreamError();

    return {
      termsUrl: termsUrl(config.tos_url),
      emailVerificationRequired: config.is_email_verify === 1,
      inviteCodeRequired: config.is_invite_force === 1,
      emailSuffixWhitelist:
        config.email_whitelist_suffix === 0
          ? null
          : config.email_whitelist_suffix,
      antiBot: antiBotEnabled
        ? {
            enabled: true,
            provider: 'recaptcha',
            mode: 'v2-checkbox',
            siteKey: siteKey ?? null,
          }
        : { enabled: false, provider: null, mode: null, siteKey: null },
    };
  }

  async accountConfig(authToken: string): Promise<AccountConfig> {
    const { response, payload } = await this.requestJson('user/comm/config', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = accountConfigResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      currency: parsed.data.data.currency,
      currencySymbol: parsed.data.data.currency_symbol,
    };
  }
}
