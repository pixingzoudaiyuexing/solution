import { validatePaymentRedirectTarget } from './payment-target';

const SUBSCRIPTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const SUBSCRIPTION_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function validateSubscriptionToken(value: string): string {
  if (!SUBSCRIPTION_TOKEN_PATTERN.test(value)) {
    throw new Error('Invalid subscription token');
  }
  return value;
}

export function extractSubscriptionToken(value: string): string {
  try {
    if (value !== value.trim() || CONTROL_CHARACTERS.test(value)) {
      throw new Error();
    }
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.hash ||
      entries.length !== 1 ||
      entries[0][0] !== 'token'
    ) {
      throw new Error();
    }
    return validateSubscriptionToken(entries[0][1]);
  } catch {
    throw new Error('Invalid upstream subscription URL');
  }
}

export function normalizeV2BoardSubscribePath(value: string | undefined): string {
  if (
    !value ||
    value.length > 512 ||
    CONTROL_CHARACTERS.test(value) ||
    !SUBSCRIPTION_PATH_PATTERN.test(value) ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('%') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new Error('Invalid V2Board subscription path');
  }

  const segments = value.slice(1).split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    throw new Error('Invalid V2Board subscription path');
  }

  return segments.join('/');
}

export function validateGatewayPublicOrigin(
  requestUrl: string,
  hiddenOrigin: string
): string {
  try {
    return new URL(
      validatePaymentRedirectTarget(requestUrl, hiddenOrigin)
    ).origin;
  } catch {
    throw new Error('Invalid Gateway public origin');
  }
}
