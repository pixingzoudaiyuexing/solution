import { describe, expect, it } from 'vitest';
import { validateTrustedUserAgent } from '../src/security/user-agent';

describe('trusted User-Agent validation', () => {
  it('preserves a valid browser User-Agent exactly', () => {
    const userAgent = 'Mozilla/5.0 (Linux; Android 15) Mobile';
    expect(validateTrustedUserAgent(userAgent)).toBe(userAgent);
  });

  it.each([
    '',
    'a'.repeat(513),
    '界',
    '界'.repeat(171),
    'Mobile\r\nX-Attacker: injected',
    'Mobile\nInjected',
    'Mobile\tInjected',
    'Mobile\u0000Injected',
    'Mobile\u007fInjected',
    'Mobile\u0085Injected',
  ])('rejects an unsafe User-Agent', (userAgent) => {
    expect(() => validateTrustedUserAgent(userAgent)).toThrow(
      'Invalid trusted User-Agent'
    );
  });
});
