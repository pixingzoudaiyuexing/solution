const INVALID_TARGET_ERROR = 'Invalid payment redirect target';
const SIGNED_V2BOARD_PARAMETERS = new Set(['notify_url', 'return_url']);
const NOTIFY_PATH_PATTERN =
  /^\/api\/v1\/guest\/payment\/notify\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
const RETURN_HASH_PATTERN = /^#\/order\/[A-Za-z0-9_-]{1,36}$/;

export interface PaymentTargetValidationOptions {
  allowSignedV2BoardParameters?: boolean;
}

function fail(): never {
  throw new Error(INVALID_TARGET_ERROR);
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function parseIpv4(hostname: string): number[] | undefined {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }

  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function isUnsafeIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return isUnsafeIpv4(ipv4);
  }

  if (normalized.includes(':')) {
    return (
      normalized.startsWith('::') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('fec') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }

  return false;
}

function fullyDecoded(value: string): string {
  let decoded = value;
  for (let i = 0; i < 5; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function containsHiddenHostname(value: string, hiddenHostname: string): boolean {
  return fullyDecoded(value).toLowerCase().includes(hiddenHostname);
}

function isAllowedSignedV2BoardUrl(
  name: string,
  value: string,
  hiddenHostname: string
): boolean {
  if (!SIGNED_V2BOARD_PARAMETERS.has(name)) return false;

  let nested: URL;
  try {
    nested = new URL(fullyDecoded(value));
  } catch {
    return false;
  }
  if (
    (nested.protocol !== 'http:' && nested.protocol !== 'https:') ||
    nested.username ||
    nested.password ||
    normalizeHostname(nested.hostname) !== hiddenHostname
  ) {
    return false;
  }

  if (name === 'notify_url') {
    return (
      nested.search === '' &&
      nested.hash === '' &&
      NOTIFY_PATH_PATTERN.test(nested.pathname)
    );
  }
  return (
    nested.pathname === '/' &&
    nested.search === '' &&
    RETURN_HASH_PATTERN.test(nested.hash)
  );
}

export function validatePaymentRedirectTarget(
  value: string,
  hiddenOrigin: string,
  options: PaymentTargetValidationOptions = {}
): string {
  let target: URL;
  let hidden: URL;
  try {
    if (value !== value.trim()) return fail();
    target = new URL(value);
    hidden = new URL(hiddenOrigin);
  } catch {
    return fail();
  }

  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    !target.hostname ||
    isUnsafeHostname(target.hostname)
  ) {
    return fail();
  }

  const hiddenHostname = normalizeHostname(hidden.hostname);
  if (normalizeHostname(target.hostname) === hiddenHostname) {
    return fail();
  }

  if (
    !options.allowSignedV2BoardParameters &&
    containsHiddenHostname(target.href, hiddenHostname)
  ) {
    return fail();
  }
  if (
    containsHiddenHostname(target.pathname, hiddenHostname) ||
    containsHiddenHostname(target.hash, hiddenHostname)
  ) {
    return fail();
  }

  for (const [name, parameterValue] of target.searchParams) {
    if (containsHiddenHostname(name, hiddenHostname)) return fail();
    if (!containsHiddenHostname(parameterValue, hiddenHostname)) continue;
    if (
      !options.allowSignedV2BoardParameters ||
      !isAllowedSignedV2BoardUrl(name, parameterValue, hiddenHostname)
    ) {
      return fail();
    }
  }

  return options.allowSignedV2BoardParameters ? value : target.href;
}
