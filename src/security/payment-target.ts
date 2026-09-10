const INVALID_TARGET_ERROR = 'Invalid payment redirect target';

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

function decodedTarget(value: string): string {
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
  return decoded.toLowerCase();
}

export function validatePaymentRedirectTarget(
  value: string,
  hiddenOrigin: string
): string {
  let target: URL;
  let hidden: URL;
  try {
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
  if (
    normalizeHostname(target.hostname) === hiddenHostname ||
    decodedTarget(target.href).includes(hiddenHostname)
  ) {
    return fail();
  }

  return target.href;
}
