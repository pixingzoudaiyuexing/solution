import { describe, expect, it } from 'vitest';
import { validatePaymentRedirectTarget } from '../src/security/payment-target';

const hiddenOrigin = 'https://private.example/api/v1/';
const signedTarget =
  'https://pay.example/submit.php?money=10.00&name=order-001&notify_url=https%3A%2F%2Fprivate.example%2Fapi%2Fv1%2Fguest%2Fpayment%2Fnotify%2FEPay%2F123e4567-e89b-12d3-a456-426614174000&return_url=https%3A%2F%2Fprivate.example%2F%23%2Forder%2Forder-001&out_trade_no=order-001&pid=1000&type=alipay&sign=abc123&sign_type=MD5';

describe('payment redirect target validation', () => {
  it('accepts a legitimate HTTPS payment provider', () => {
    expect(
      validatePaymentRedirectTarget(
        'https://pay.example/checkout/session-1',
        hiddenOrigin
      )
    ).toBe('https://pay.example/checkout/session-1');
  });

  it('preserves an EPay signed target with official callback and return parameters', () => {
    expect(
      validatePaymentRedirectTarget(signedTarget, hiddenOrigin, {
        allowSignedV2BoardParameters: true,
      })
    ).toBe(signedTarget);
  });

  it('accepts the official hidden callback without requiring a return URL', () => {
    const target =
      'https://pay.example/submit.php?notify_url=https%3A%2F%2Fprivate.example%2Fapi%2Fv1%2Fguest%2Fpayment%2Fnotify%2FEPay%2Fpayment-uuid&sign=abc';

    expect(
      validatePaymentRedirectTarget(target, hiddenOrigin, {
        allowSignedV2BoardParameters: true,
      })
    ).toBe(target);
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

  it.each([
    [
      'arbitrary query field',
      'https://pay.example/checkout?foo=https%3A%2F%2Fprivate.example%2Fapi%2Fv1%2Fguest%2Fpayment%2Fnotify%2FEPay%2Fuuid',
    ],
    [
      'arbitrary hostname value',
      'https://pay.example/checkout?x=private.example',
    ],
    [
      'double-encoded arbitrary query field',
      'https://pay.example/checkout?next=https%253A%252F%252Fprivate.example%252Fapi%252Fv1%252Fguest%252Fpayment%252Fnotify%252FEPay%252Fuuid',
    ],
    [
      'hidden hostname below an unrelated return host',
      'https://pay.example/checkout?return_url=https%3A%2F%2Fevil.example%2F%3Fx%3Dprivate.example',
    ],
    [
      'fake callback path',
      'https://pay.example/checkout?notify_url=https%3A%2F%2Fprivate.example%2Farbitrary%2Finternal%2Fpath',
    ],
    [
      'fake return path',
      'https://pay.example/checkout?return_url=https%3A%2F%2Fprivate.example%2Farbitrary%2Fpath',
    ],
    ['outer path component', 'https://pay.example/private.example/checkout'],
    ['outer fragment component', 'https://pay.example/checkout#private.example'],
  ])('rejects hidden V2Board data in %s', (_case, target) => {
    expect(() =>
      validatePaymentRedirectTarget(target, hiddenOrigin, {
        allowSignedV2BoardParameters: true,
      })
    ).toThrow('Invalid payment redirect target');
  });

  it('does not grant the signed exception to strict asset validation', () => {
    expect(() => validatePaymentRedirectTarget(signedTarget, hiddenOrigin)).toThrow(
      'Invalid payment redirect target'
    );
    expect(() =>
      validatePaymentRedirectTarget(
        'https://cdn.example/icon.png#https://private.example/asset',
        hiddenOrigin
      )
    ).toThrow('Invalid payment redirect target');
  });
});
