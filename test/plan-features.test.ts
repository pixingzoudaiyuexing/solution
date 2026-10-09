import { describe, expect, it } from 'vitest';
import {
  PLAN_FEATURES_MAX_CONTENT_LENGTH,
  PLAN_FEATURES_MAX_ITEMS,
  PLAN_FEATURES_MAX_TEXT_LENGTH,
  parsePlanFeatures,
} from '../src/adapters/v2board/plan-features';

const supported = { feature: '每年600GB流量', support: true };
const unsupported = { feature: '精品线路', support: false };

describe('V2Board JSON plan features', () => {
  it('keeps original order, duplicate labels and both actual boolean states', () => {
    const items = [unsupported, supported, supported, { feature: '  原文保留  ', support: false }];
    expect(parsePlanFeatures(JSON.stringify(items))).toEqual(items);
  });

  it('transmits special characters and HTML-looking feature text literally without parsing or generating markup', () => {
    const items = [{ feature: '<script>alert("x")</script> & <img src="https://example.com"> 中文\n说明', support: false }];
    expect(parsePlanFeatures(JSON.stringify(items))).toEqual(items);
  });

  it.each([undefined, null, '', ' \t\n ', [], {}, 7, true, '[]', 'null', 'true', '17',
    '"text"', '{}', '<p>旧 HTML 描述</p>', '[', '[{"feature":"x","support":flase}]'].map((content) => ({ content })))
    ('omits absent, non-string, old HTML and invalid JSON/shape input %#', ({ content }) => {
      expect(parsePlanFeatures(content)).toBeUndefined();
    });

  it.each(['true', 'false', 1, 0, null, undefined, [], {}].map((support) => ({ support })))
    ('does not coerce support %# to a boolean', ({ support }) => {
      expect(parsePlanFeatures(JSON.stringify([{ feature: 'text', support }]))).toBeUndefined();
    });

  it.each([
    [{ feature: 'text' }], [{ support: true }], [{ feature: '', support: true }],
    [{ feature: ' \t\n ', support: true }], [{ feature: 7, support: true }],
    [{ feature: null, support: true }], [{ feature: ['text'], support: true }],
    [{ feature: { private: 'PRIVATE' }, support: true }], [null], [true], ['text'], [[supported]],
    [{ ...supported, amountMinor: 0 }], [{ ...supported, private_metadata: 'PRIVATE' }],
    [supported, { feature: 'bad', support: 'true' }],
  ].map((items) => ({ items })))('rejects the entire array for any invalid item or unknown field %#', ({ items }) => {
    expect(parsePlanFeatures(JSON.stringify(items))).toBeUndefined();
  });

  it.each(['__proto__', 'constructor', 'prototype', 'token', 'id', 'available'])
    ('rejects unknown or prototype-shaped item key %s', (key) => {
      const content = `[{"feature":"text","support":true,"${key}":{"private":"PRIVATE"}}]`;
      expect(parsePlanFeatures(content)).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('private');
    });

  it('bounds original content length before JSON parsing', () => {
    const content = JSON.stringify([supported]);
    expect(parsePlanFeatures(content.padEnd(PLAN_FEATURES_MAX_CONTENT_LENGTH, ' '))).toEqual([supported]);
    expect(parsePlanFeatures(content.padEnd(PLAN_FEATURES_MAX_CONTENT_LENGTH + 1, ' '))).toBeUndefined();
  });

  it('bounds array length without deleting false or validating a partial prefix', () => {
    const items = Array.from({ length: PLAN_FEATURES_MAX_ITEMS }, () => unsupported);
    expect(parsePlanFeatures(JSON.stringify(items))).toEqual(items);
    expect(parsePlanFeatures(JSON.stringify([...items, supported]))).toBeUndefined();
  });

  it('bounds the original feature text in UTF-16 units including whitespace and multibyte characters', () => {
    for (const feature of ['x'.repeat(256), '中'.repeat(256), '😀'.repeat(128)]) {
      expect(feature.length).toBe(PLAN_FEATURES_MAX_TEXT_LENGTH);
      expect(parsePlanFeatures(JSON.stringify([{ feature, support: true }]))).toEqual([{ feature, support: true }]);
      expect(parsePlanFeatures(JSON.stringify([{ feature: feature + 'x', support: true }]))).toBeUndefined();
    }
    expect(parsePlanFeatures(JSON.stringify([{ feature: 'x' + ' '.repeat(256), support: true }]))).toBeUndefined();
  });

  it('safely omits extreme JSON nesting and recovers without exposing errors', () => {
    expect(parsePlanFeatures('['.repeat(5000) + '0' + ']'.repeat(5000))).toBeUndefined();
    expect(parsePlanFeatures(JSON.stringify([unsupported]))).toEqual([unsupported]);
  });

  it('does not accept a double-encoded array or a last duplicate non-boolean value', () => {
    expect(parsePlanFeatures(JSON.stringify(JSON.stringify([supported])))).toBeUndefined();
    expect(parsePlanFeatures('[{"feature":"text","support":true,"support":"false"}]')).toBeUndefined();
  });

  it('keeps seeded invalid combinations fail-closed and valid feature arrays ordered', () => {
    let seed = 0x51f01;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const bad = [null, true, 7, 'text', { feature: 'x', support: 'true' }, { feature: 'x', support: 0 },
      { feature: '', support: false }, { feature: 'x', support: true, price: 0 }];
    for (let attempt = 0; attempt < 200; attempt++) {
      const items = Array.from({ length: next() % 20 + 1 }, (_, index) => ({
        feature: `功能 ${index} " <script> & 中文`, support: next() % 2 === 0,
      }));
      expect(parsePlanFeatures(JSON.stringify(items))).toEqual(items);
      const position = next() % items.length;
      const invalid: unknown[] = [...items];
      invalid[position] = bad[next() % bad.length];
      expect(parsePlanFeatures(JSON.stringify(invalid))).toBeUndefined();
    }
  });
});
