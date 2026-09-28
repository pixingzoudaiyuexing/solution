import { describe, expect, it } from 'vitest';
import type { DownloadItem } from '../src/contract/v1/downloads';
import { HELP_MAX_BODY_BYTES, parseHelpContent } from '../src/security/help-content';

const hiddenBase = 'https://private-v2board.example/api/v1/';
const download: DownloadItem = {
  id: 'android', label: 'Android', platform: 'android', arch: null,
  version: 'v1', publishedAt: null, filename: 'private.apk', sizeBytes: 1,
  downloads: [
    { id: 'first', label: 'Fast', url: 'https://provider.example/https://github.com/owner/repo/releases/download/v1/file.apk' },
    { id: 'second', label: 'Backup', url: 'https://backup.example/https://github.com/owner/repo/releases/download/v1/file.apk' },
  ],
};

describe('Help structured content', () => {
  it('converts supported elements and escapes markup into text nodes', async () => {
    expect(await parseHelpContent('<h1>Guide</h1><p>Hi <strong>bold <em>inside</em></strong><br><a href="https://example.org/x">docs</a><img src="https://cdn.example.org/x.png" alt="Screen"></p><ul><li>A</li><li>B</li></ul><ol><li>1</li></ol>&lt;script&gt;', hiddenBase, [])).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Guide' }] },
      { type: 'paragraph', children: [
        { type: 'text', text: 'Hi ' },
        { type: 'strong', children: [{ type: 'text', text: 'bold ' }, { type: 'emphasis', children: [{ type: 'text', text: 'inside' }] }] },
        { type: 'break' },
        { type: 'link', href: 'https://example.org/x', children: [{ type: 'text', text: 'docs' }] },
        { type: 'image', src: 'https://cdn.example.org/x.png', alt: 'Screen' },
      ] },
      { type: 'unordered-list', items: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]] },
      { type: 'ordered-list', items: [[{ type: 'text', text: '1' }]] },
      { type: 'paragraph', children: [{ type: 'text', text: '<script>' }] },
    ]);
  });

  it.each(['script', 'style', 'iframe', 'object', 'form', 'template', 'canvas', 'button'])('drops %s and its actual parsed descendants', async (tag) => {
    const result = await parseHelpContent(`<p>before</p><${tag}>SECRET_EXECUTABLE</${tag}><p>after</p>`, hiddenBase, []);
    expect(JSON.stringify(result)).not.toContain('SECRET_EXECUTABLE');
    expect(result).toHaveLength(2);
  });

  it.each(['svg', 'math'])('fails closed on %s even when HTML repair moves its children', async (tag) => {
    await expect(parseHelpContent(`<p>before</p><${tag}><p>SECRET_EXECUTABLE</p></${tag}><p>after</p>`, hiddenBase, []))
      .rejects.toThrow();
  });

  it('drops void embed/input elements without retaining executable attributes', async () => {
    expect(await parseHelpContent('<p>before<embed src="https://evil.example/x"><input value="SECRET_EXECUTABLE">after</p>', hiddenBase, []))
      .toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'before' }, { type: 'text', text: 'after' }] }]);
  });

  it.each([
    'http://example.com', 'javascript:alert(1)', 'data:text/html,hi', '//example.com/x',
    'blob:https://example.com/x', 'file:///etc/passwd', 'ftp://example.com/x',
    'https:example.com/x', 'https:///example.com/x', 'https://%65xample.com/x',
    'https://u:p@example.com/x', 'https://127.0.0.1/x', 'https://10.1.1.1/x',
    'https://192.168.1.1/x', 'https://169.254.1.1/x', 'https://[::1]/x',
    'https://private-v2board.example/x', 'https://private-v2board.example./x',
    'https://private-v2board.example:8443/x', ' /relative',
  ])('does not emit an unsafe URL %s', async (url) => {
    const result = await parseHelpContent(`<p><a href="${url}">safe text</a><img src="${url}" alt="bad"></p>`, hiddenBase, []);
    expect(result).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'safe text' }] }]);
  });

  it('unwraps unknown wrappers without retaining attributes or executable markup', async () => {
    expect(await parseHelpContent('<div><custom onclick="run()"><b>Visible</b></custom></div>', hiddenBase, [])).toEqual([
      { type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', text: 'Visible' }] }] },
    ]);
  });

  it('removes every complete access block before HTML parsing', async () => {
    const result = await parseHelpContent('<p>A</p><!--access start--><script>SECRET_ONE</script><!--access end--><p>B</p><!--access start-->SECRET_TWO<!--access end-->', hiddenBase, []);
    expect(result).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'B' }] },
    ]);
  });

  it.each([
    '<!--access start-->SECRET', '<!--access end-->SECRET',
    '<!--access start--><!--access start-->SECRET<!--access end-->',
    '<!--access start-->SECRET<!--access end--><!--access end-->',
    '<!-- access start -->SECRET<!--access end-->',
    '<!--access start-->SECRET<!--access en',
  ])('fails closed for malformed access markers', async (input) => {
    await expect(parseHelpContent(input, hiddenBase, [])).rejects.toThrow();
  });

  it('leaves credential placeholders literal and never substitutes secrets', async () => {
    const raw = '<p>{{subscribeUrl}} {{urlEncodeSubscribeUrl}} {{safeBase64SubscribeUrl}} {{subscribeToken}} {{siteName}}</p>';
    const result = await parseHelpContent(raw, hiddenBase, []);
    expect(JSON.stringify(result)).toContain('{{subscribeUrl}}');
    for (const forbidden of ['REAL_TOKEN_SECRET', 'https://private-v2board.example/client/subscribe?token=REAL_TOKEN_SECRET']) {
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it('resolves each available download slot through the existing item label and URL', async () => {
    const result = await parseHelpContent('<p>[[download:android:primary]] [[download:android:backup]]</p>', hiddenBase, [download]);
    expect(result).toEqual([{ type: 'paragraph', children: [
      { type: 'download', itemId: 'android', slot: 'primary', label: 'Android', href: download.downloads[0].url },
      { type: 'text', text: ' ' },
      { type: 'download', itemId: 'android', slot: 'backup', label: 'Android', href: download.downloads[1].url },
    ] }]);
    const wire = JSON.stringify(result);
    for (const forbidden of ['private.apk', '"version":', '"filename":', '"repository":', '"assetMatch":', '"baseUrl":']) expect(wire).not.toContain(forbidden);
  });

  it('omits unavailable references independently and preserves surrounding text', async () => {
    const onlyBackup: DownloadItem = { ...download, downloads: [null as never, download.downloads[1]] };
    const result = await parseHelpContent('<p>before [[download:android:primary]] middle [[download:android:backup]] after [[download:unknown:primary]]</p>', hiddenBase, [onlyBackup]);
    const wire = JSON.stringify(result);
    expect(wire).toContain('before ');
    expect(wire).toContain('Android');
    expect(wire).not.toContain('unknown');
    expect(wire).not.toContain('primary","label"');
    const onlyPrimary: DownloadItem = { ...download, downloads: [download.downloads[0], null as never] };
    const primary = await parseHelpContent('<p>[[download:android:primary]] [[download:android:backup]]</p>', hiddenBase, [onlyPrimary]);
    expect(JSON.stringify(primary)).toContain('"slot":"primary"');
    expect(JSON.stringify(primary)).not.toContain('"slot":"backup"');
    const neither = await parseHelpContent('<p>before [[download:android:primary]] after [[download:android:backup]]</p>', hiddenBase, []);
    expect(JSON.stringify(neither)).not.toContain('"type":"download"');
  });

  it('keeps repeated valid references independent and cannot accept author labels or URLs', async () => {
    const raw = '<p>[[download:android:primary]] [[download:android:primary]] [[download:android:backup:Injected]] [[download:android:primary:https://evil.example]]</p>';
    const result = await parseHelpContent(raw, hiddenBase, [download]);
    expect(JSON.stringify(result).match(/"type":"download"/g)).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('"label":"Injected"');
    expect(JSON.stringify(result)).not.toContain('"href":"https://evil.example"');
  });

  it.each(['[[download:Bad:primary]]', '[[download:android:wrong]]', '[[download:android:primary:https://evil.example]]',
    `[[download:${'x'.repeat(130)}:primary]]`, '[[download:android:<script>]]'])('keeps malformed download syntax as safe text %s', async (token) => {
    const result = await parseHelpContent(`<p>${token}</p>`, hiddenBase, [download]);
    expect(JSON.stringify(result)).not.toContain('"type":"download"');
  });

  it('enforces byte, AST, depth, text, link, image, download and block limits', async () => {
    const invalid = [
      'x'.repeat(HELP_MAX_BODY_BYTES + 1),
      '<span>'.repeat(34) + 'x' + '</span>'.repeat(34),
      '<p>x</p>'.repeat(2001),
      '<span>x</span>'.repeat(10_001),
      `<template>${'<span>x</span>'.repeat(10_001)}</template>`,
      `<p>${'x'.repeat(65_537)}</p>`,
      '<a href="https://example.org">x</a>'.repeat(101),
      '<img src="https://example.org/x">'.repeat(51),
      '[[download:android:primary]]'.repeat(51),
    ];
    for (const raw of invalid) await expect(parseHelpContent(raw, hiddenBase, [download])).rejects.toThrow();
  });

  it('is deterministic for malformed but non-executable HTML', async () => {
    const input = '<p><strong>One<p>Two <em>three';
    expect(await parseHelpContent(input, hiddenBase, [])).toEqual(await parseHelpContent(input, hiddenBase, []));
  });
});
