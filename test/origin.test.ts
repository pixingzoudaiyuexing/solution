import { describe, expect, it } from 'vitest';
import { validatedHttpsRequestOrigin } from '../src/security/origin';

describe('checkout request Origin validation', () => {
  it.each([
    'https://example.com',
    'https://example.com:8443',
  ])('accepts an exact HTTPS origin: %s', (origin) => {
    expect(validatedHttpsRequestOrigin(origin)).toBe(origin);
  });

  it.each([
    undefined,
    'http://example.com',
    'https://example.com/',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://user:pass@example.com',
    'javascript:alert(1)',
    'not-a-url',
  ])('rejects a non-exact HTTPS origin: %s', (origin) => {
    expect(validatedHttpsRequestOrigin(origin)).toBeUndefined();
  });
});
