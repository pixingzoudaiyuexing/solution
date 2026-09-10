import { describe, expect, it } from 'vitest';
import { validatePaymentRedirectTarget } from '../src/security/payment-target';

const hiddenOrigin = 'https://private.example/api/v1/';

describe('payment redirect target validation', () => {
  it('accepts a legitimate HTTPS payment provider', () => {
    expect(
      validatePaymentRedirectTarget(
        'https://pay.example/checkout/session-1',
        hiddenOrigin
      )
    ).toBe('https://pay.example/checkout/session-1');
  });

  it.each([
    'http://pay.example/checkout',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///etc/passwd',
    'blob:https://pay.example/id',
    'https://localhost/checkout',
    'https://localhost./checkout',
    'https://service.local/checkout',
    'https://127.0.0.1/checkout',
    'https://10.0.0.1/checkout',
    'https://172.16.0.1/checkout',
    'https://192.168.0.1/checkout',
    'https://169.254.1.1/checkout',
    'https://[::1]/checkout',
    'https://[::c0a8:1]/checkout',
    'https://[fc00::1]/checkout',
    'https://[ff02::1]/checkout',
    'https://[2001:db8::1]/checkout',
    'https://private.example/payment',
    'not a url',
  ])('rejects unsafe target %s', (target) => {
    expect(() => validatePaymentRedirectTarget(target, hiddenOrigin)).toThrow(
      'Invalid payment redirect target'
    );
  });

  it('rejects a hidden origin embedded in a provider query', () => {
    expect(() =>
      validatePaymentRedirectTarget(
        'https://pay.example/checkout?return_url=https%3A%2F%2Fprivate.example%2Fdone',
        hiddenOrigin
      )
    ).toThrow('Invalid payment redirect target');
  });
});
