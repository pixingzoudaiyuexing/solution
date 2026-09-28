import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { DownloadItem } from '../contract/v1/downloads';
import type { HelpBlock, HelpInline } from '../contract/v1/help';
import { isStableId } from '../registry/stable-id';

export const HELP_MAX_BODY_BYTES = 512 * 1024;
const FORBIDDEN = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'svg', 'math', 'template', 'link', 'meta', 'canvas']);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type DraftInline =
  | { type: 'text'; text: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'download'; itemId: string; slot: 'primary' | 'backup'; label: string; href: string }
  | { type: 'break' }
  | { type: 'strong' | 'emphasis'; children: DraftInline[] }
  | { type: 'link'; href: string; children: DraftInline[] }
  | { type: 'download-ref'; itemId: string; slot: 'primary' | 'backup' };
type DraftBlock = { type: 'paragraph'; children: DraftInline[] } |
  { type: 'heading'; level: 1 | 2 | 3; children: DraftInline[] } |
  { type: 'unordered-list'; items: DraftInline[][] } |
  { type: 'ordered-list'; items: DraftInline[][] };

function stripAccessBlocks(body: string): string {
  const start = '<!--access start-->';
  const end = '<!--access end-->';
  let position = 0;
  let output = '';
  let comment = body.indexOf('<!--');
  while (comment >= 0) {
    const close = body.indexOf('-->', comment + 4);
    if (close < 0) {
      if (/^\s*access\b/i.test(body.slice(comment + 4, comment + 32))) throw new Error('Malformed access marker');
      break;
    }
    const value = body.slice(comment, close + 3);
    if (/^\s*access\b/i.test(value.slice(4)) && value !== start && value !== end) {
      throw new Error('Malformed access marker');
    }
    comment = body.indexOf('<!--', close + 3);
  }
  for (;;) {
    const marker = body.indexOf('<!--access', position);
    if (marker < 0) break;
    if (!body.startsWith(start, marker)) throw new Error('Malformed access block');
    output += body.slice(position, marker);
    const closing = body.indexOf(end, marker + start.length);
    const nested = body.indexOf('<!--access', marker + start.length);
    if (closing < 0 || (nested >= 0 && nested < closing)) throw new Error('Malformed access block');
    position = closing + end.length;
  }
  output += body.slice(position);
  if (output.includes(end)) throw new Error('Malformed access block');
  return output;
}

function safeContentUrl(value: string | undefined, upstreamBase: string | undefined): string | null {
  if (!value || value.length > 2048 || value !== value.trim() || CONTROL.test(value) || value.includes('\\')) return null;
  if (value.slice(0, 8).toLowerCase() !== 'https://') return null;
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes('%') || authority.includes('@')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (upstreamBase) {
      const base = new URL(upstreamBase);
      const baseHost = base.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
      if (host === baseHost) return null;
    }
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    const octets = host.split('.');
    if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part))) {
      const [a, b] = octets.map(Number);
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 ||
          a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 ||
          a === 100 && b >= 64 && b <= 127 || a >= 224) return null;
    }
    if (host.includes(':')) {
      const first = Number.parseInt(host.split(':')[0] || '0', 16);
      if (host === '::' || host === '::1' || host.includes('::ffff:') ||
          (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 ||
          (first & 0xffc0) === 0xfec0) return null;
    }
    return url.toString();
  } catch { return null; }
}

function tag(node: Node): string | null {
  return 'tagName' in node ? node.tagName : null;
}

function children(node: Node | DefaultTreeAdapterTypes.DocumentFragment): Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function attr(node: Element, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value;
}

export async function parseHelpContent(
  raw: string,
  upstreamBase: string | undefined,
  availableDownloads: readonly DownloadItem[]
): Promise<HelpBlock[]> {
  if (new TextEncoder().encode(raw).length > HELP_MAX_BODY_BYTES) throw new Error('Oversized article');
  const fragment = parseFragment(stripAccessBlocks(raw));
  let nodes = 0;
  const bound = (node: Node, depth: number): void => {
    if (++nodes > 10_000 || depth > 32) throw new Error('Article tree bound');
    if ('value' in node && node.value.length > 65_536) throw new Error('Article text bound');
    // HTML tree repair can relocate malformed foreign-content children outside svg/math.
    if (tag(node) === 'svg' || tag(node) === 'math') throw new Error('Unsupported foreign content');
    for (const child of children(node)) bound(child, depth + 1);
    if (tag(node) === 'template' && 'content' in node) {
      for (const child of children(node.content as DefaultTreeAdapterTypes.DocumentFragment)) bound(child, depth + 1);
    }
  };
  for (const node of fragment.childNodes) bound(node, 1);

  let links = 0;
  let images = 0;
  let references = 0;
  const textParts = (value: string): DraftInline[] => {
    const result: DraftInline[] = [];
    let cursor = 0;
    while (cursor < value.length) {
      const start = value.indexOf('[[download:', cursor);
      if (start < 0) { result.push({ type: 'text', text: value.slice(cursor) }); break; }
      if (start > cursor) result.push({ type: 'text', text: value.slice(cursor, start) });
      const end = value.indexOf(']]', start + 11);
      if (end < 0) { result.push({ type: 'text', text: value.slice(start) }); break; }
      const token = value.slice(start, end + 2);
      const parts = token.slice(11, -2).split(':');
      if (token.length <= 128 && parts.length === 2 && isStableId(parts[0]) &&
          (parts[1] === 'primary' || parts[1] === 'backup')) {
        if (++references > 50) throw new Error('Too many download references');
        result.push({ type: 'download-ref', itemId: parts[0], slot: parts[1] });
      } else result.push({ type: 'text', text: token });
      cursor = end + 2;
    }
    return result;
  };
  const inline = (node: Node): DraftInline[] => {
    if ('value' in node) return textParts(node.value);
    const name = tag(node);
    if (!name || FORBIDDEN.has(name)) return [];
    if (name === 'br') return [{ type: 'break' }];
    if (name === 'img') {
      if (++images > 50) throw new Error('Too many images');
      const src = safeContentUrl(attr(node as Element, 'src'), upstreamBase);
      return src ? [{ type: 'image', src, alt: (attr(node as Element, 'alt') ?? '').slice(0, 512) }] : [];
    }
    const inner = children(node).flatMap(inline);
    if (name === 'strong' || name === 'b') return [{ type: 'strong', children: inner }];
    if (name === 'em' || name === 'i') return [{ type: 'emphasis', children: inner }];
    if (name === 'a') {
      if (++links > 100) throw new Error('Too many links');
      const href = safeContentUrl(attr(node as Element, 'href'), upstreamBase);
      return href ? [{ type: 'link', href, children: inner }] : inner;
    }
    return inner;
  };

  const draft: DraftBlock[] = [];
  const push = (block: DraftBlock): void => {
    if (++blockCount > 2_000) throw new Error('Too many blocks');
    draft.push(block);
  };
  let blockCount = 0;
  const blocks = (items: Node[]): void => {
    let pending: DraftInline[] = [];
    const flush = () => { if (pending.length) { push({ type: 'paragraph', children: pending }); pending = []; } };
    for (const node of items) {
      const name = tag(node);
      if (name && FORBIDDEN.has(name)) continue;
      if (name === 'h1' || name === 'h2' || name === 'h3') {
        flush(); push({ type: 'heading', level: Number(name[1]) as 1 | 2 | 3, children: children(node).flatMap(inline) });
      } else if (name === 'p') {
        flush(); push({ type: 'paragraph', children: children(node).flatMap(inline) });
      } else if (name === 'ul' || name === 'ol') {
        flush(); push({ type: name === 'ul' ? 'unordered-list' : 'ordered-list',
          items: children(node).filter((item) => tag(item) === 'li').map((item) => children(item).flatMap(inline)) });
      } else if (name && ['div', 'section', 'article', 'main', 'body'].includes(name)) {
        flush(); blocks(children(node));
      } else pending.push(...inline(node));
    }
    flush();
  };
  blocks(fragment.childNodes);

  const downloads = new Map(availableDownloads.map((item) => [item.id, item]));
  const resolve = (values: DraftInline[]): HelpInline[] => values.flatMap((value): HelpInline[] => {
    if (value.type === 'download-ref') {
      const item = downloads.get(value.itemId);
      const option = item?.downloads[value.slot === 'primary' ? 0 : 1];
      return option ? [{ type: 'download', itemId: value.itemId, slot: value.slot, label: item!.label, href: option.url }] : [];
    }
    if ('children' in value) {
      return [{ ...value, children: resolve(value.children) }];
    }
    return [value];
  });
  return draft.map((block) => block.type === 'unordered-list' || block.type === 'ordered-list'
    ? { ...block, items: block.items.map(resolve) }
    : { ...block, children: resolve(block.children) }) as HelpBlock[];
}
