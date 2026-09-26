import { isAlias, isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml';
import type { SubscriptionProfileConfig } from '../registry/modules/subscription-profile';
import { CC_MAX_YAML_BYTES } from './cc-profile-limits';

export { CC_MAX_YAML_BYTES } from './cc-profile-limits';
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
const MAX_SCALAR_LENGTH = 1024 * 1024;
const MAX_MAP_ENTRIES = 4_096;
const PROBE_URL = 'https://www.gstatic.com/generate_204';
const DUSTIN = 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/';

type RuleId = 'private' | 'privateip' | 'ads' | 'youtube' | 'google' | 'ai' |
  'netflix' | 'disney' | 'tiktok' | 'bilibili' | 'cn' | 'cnip' | 'proxy';

export const CC_RULE_CATALOG: Record<RuleId, { url: string; behavior: 'domain' | 'ipcidr' }> = {
  private: { url: `${DUSTIN}private.mrs`, behavior: 'domain' },
  privateip: { url: `${DUSTIN}privateip.mrs`, behavior: 'ipcidr' },
  ads: { url: `${DUSTIN}ads.mrs`, behavior: 'domain' },
  youtube: { url: `${DUSTIN}youtube.mrs`, behavior: 'domain' },
  google: { url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs', behavior: 'domain' },
  ai: { url: `${DUSTIN}ai.mrs`, behavior: 'domain' },
  netflix: { url: `${DUSTIN}netflix.mrs`, behavior: 'domain' },
  disney: { url: `${DUSTIN}disney.mrs`, behavior: 'domain' },
  tiktok: { url: `${DUSTIN}tiktok.mrs`, behavior: 'domain' },
  bilibili: { url: `${DUSTIN}bilibili.mrs`, behavior: 'domain' },
  cn: { url: `${DUSTIN}cn.mrs`, behavior: 'domain' },
  cnip: { url: `${DUSTIN}cnip.mrs`, behavior: 'ipcidr' },
  proxy: { url: `${DUSTIN}proxy.mrs`, behavior: 'domain' },
};

const SAFE_TOP_LEVEL = new Set([
  'proxies', 'proxy-groups', 'rules', 'rule-providers', 'port', 'socks-port',
  'mixed-port', 'redir-port', 'tproxy-port', 'allow-lan', 'bind-address',
  'mode', 'log-level', 'ipv6', 'dns', 'hosts', 'profile', 'find-process-mode',
  'global-client-fingerprint', 'geodata-mode', 'unified-delay',
  'tcp-concurrent', 'keep-alive-interval', 'keep-alive-idle', 'external-controller',
]);
const RESERVED_NAMES = new Set(['DIRECT', 'REJECT', 'GLOBAL', 'PASS']);
const GROUP_TYPES = new Set(['select', 'url-test', 'fallback', 'load-balance', 'relay']);
const REMOTE_PROXY_TYPES = new Set(['ss', 'vmess', 'vless', 'trojan', 'tuic', 'anytls', 'hysteria', 'hysteria2']);
const SPECIAL_PROXY_TYPES = new Set(['direct', 'reject', 'reject-drop', 'pass', 'dns']);
const SAFE_GROUP_FIELDS = new Set([
  'name', 'type', 'proxies', 'url', 'interval', 'lazy', 'default-selected',
  'empty-fallback', 'timeout', 'max-failed-times', 'disable-udp',
  'interface-name', 'routing-mark', 'expected-status', 'hidden',
  'strategy', 'tolerance',
]);

type Data = Record<string, unknown>;

function object(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function name(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function validateSafeSettings(input: Data): void {
  for (const key of ['port', 'socks-port', 'mixed-port', 'redir-port', 'tproxy-port']) {
    if (key in input && (!Number.isInteger(input[key]) || (input[key] as number) < 1 || (input[key] as number) > 65_535)) {
      throw new Error('Invalid Clash setting');
    }
  }
  for (const key of ['allow-lan', 'ipv6', 'geodata-mode', 'unified-delay', 'tcp-concurrent']) {
    if (key in input && typeof input[key] !== 'boolean') throw new Error('Invalid Clash setting');
  }
  for (const key of ['keep-alive-interval', 'keep-alive-idle']) {
    if (key in input && (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0)) {
      throw new Error('Invalid Clash setting');
    }
  }
  if ('dns' in input && !object(input.dns)) throw new Error('Invalid DNS');
  if ('hosts' in input && !object(input.hosts)) throw new Error('Invalid hosts');
  for (const key of ['bind-address', 'log-level', 'find-process-mode', 'global-client-fingerprint']) {
    if (key in input && (typeof input[key] !== 'string' || (input[key] as string).length > 256)) {
      throw new Error('Invalid Clash setting');
    }
  }
}

function validateDnsDependencies(value: unknown): void {
  if (typeof value === 'string') {
    if (/rule-set\s*:/i.test(value)) throw new Error('DNS provider dependency');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateDnsDependencies(item);
    return;
  }
  if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateDnsDependencies(key);
      validateDnsDependencies(item);
    }
  }
}

function assertYamlTree(node: unknown): void {
  let count = 0;
  const walk = (value: unknown, depth: number): void => {
    if (++count > MAX_NODES || depth > MAX_DEPTH || isAlias(value)) throw new Error('Unsafe YAML');
    if (value === null) return;
    if (!isMap(value) && !isSeq(value) && !isScalar(value)) throw new Error('Unsafe YAML');
    if (value.tag || value.anchor) throw new Error('Unsafe YAML');
    if (isScalar(value)) {
      if (typeof value.value === 'string' && value.value.length > MAX_SCALAR_LENGTH) throw new Error('Unsafe YAML');
      return;
    }
    if (isSeq(value)) {
      for (const item of value.items) walk(item, depth + 1);
      return;
    }
    if (value.items.length > MAX_MAP_ENTRIES) throw new Error('Unsafe YAML');
    const keys = new Set<string>();
    for (const pair of value.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string' ||
          ['__proto__', 'prototype', 'constructor', '<<'].includes(pair.key.value)) throw new Error('Unsafe YAML');
      walk(pair.key, depth + 1);
      if (keys.has(pair.key.value)) throw new Error('Duplicate YAML key');
      keys.add(pair.key.value);
      walk(pair.value, depth + 1);
    }
  };
  walk(node, 0);
}

function validateNames(proxies: Data[], groups: Data[]): string[] {
  if (proxies.length === 0 || proxies.length > 512 || groups.length > 128) throw new Error('Invalid Clash structure');
  const proxyNames: string[] = [];
  const all = new Set<string>(RESERVED_NAMES);
  for (const proxy of proxies) {
    if (!object(proxy) || !name(proxy.name) || !name(proxy.type) || all.has(proxy.name) ||
        'dialer-proxy' in proxy ||
        (!REMOTE_PROXY_TYPES.has(proxy.type) && !SPECIAL_PROXY_TYPES.has(proxy.type))) throw new Error('Invalid proxy');
    all.add(proxy.name);
    if (REMOTE_PROXY_TYPES.has(proxy.type)) proxyNames.push(proxy.name);
  }
  if (proxyNames.length === 0) throw new Error('No usable proxy');
  const groupNames = new Set<string>();
  for (const group of groups) {
    if (!object(group) || !name(group.name) || group.name.includes(',') || !GROUP_TYPES.has(String(group.type)) ||
        all.has(group.name) || !Array.isArray(group.proxies) || group.proxies.length === 0 ||
        group.proxies.length > 640 || group.proxies.some((item) => !name(item)) ||
        'use' in group || 'include-all' in group || 'filter' in group || 'exclude-filter' in group) {
      throw new Error('Invalid proxy group');
    }
    all.add(group.name);
    groupNames.add(group.name);
  }
  for (const group of groups) {
    for (const target of group.proxies as string[]) {
      if (!all.has(target) || (RESERVED_NAMES.has(target) && target !== 'DIRECT' && target !== 'REJECT')) {
        throw new Error('Invalid group target');
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byName = new Map(groups.map((group) => [group.name as string, group]));
  const visit = (groupName: string): void => {
    if (visiting.has(groupName)) throw new Error('Group cycle');
    if (visited.has(groupName)) return;
    visiting.add(groupName);
    for (const target of byName.get(groupName)?.proxies as string[] ?? []) {
      if (groupNames.has(target)) visit(target);
    }
    visiting.delete(groupName);
    visited.add(groupName);
  };
  for (const groupName of groupNames) visit(groupName);
  return proxyNames;
}

function preserveSafeGroup(group: Data, proxyNames: Set<string>): Data {
  const health = group.type === 'url-test' || group.type === 'fallback' || group.type === 'load-balance';
  if (Object.keys(group).some((key) => !SAFE_GROUP_FIELDS.has(key))) throw new Error('Unsupported group field');
  const safe: Data = { name: group.name, type: group.type, proxies: [...group.proxies as string[]] };
  if (health) safe.url = PROBE_URL;
  else if ('url' in group) throw new Error('Invalid group field');
  if ('url' in group && (typeof group.url !== 'string' || group.url.length > 2048)) throw new Error('Invalid group field');
  for (const key of ['lazy', 'disable-udp', 'hidden']) {
    if (key in group) {
      if (typeof group[key] !== 'boolean') throw new Error('Invalid group field');
      safe[key] = group[key];
    }
  }
  for (const [key, max] of [
    ['interval', 604_800], ['timeout', 60_000], ['max-failed-times', 100], ['tolerance', 60_000],
  ] as const) {
    if (key in group) {
      if (!health || (key === 'tolerance' && group.type !== 'url-test') ||
          !Number.isSafeInteger(group[key]) || (group[key] as number) < (key === 'interval' || key === 'tolerance' ? 0 : 1) ||
          (group[key] as number) > max) throw new Error('Invalid group field');
      safe[key] = group[key];
    }
  }
  if ('default-selected' in group) {
    if (!name(group['default-selected']) || !(group.proxies as string[]).includes(group['default-selected'])) {
      throw new Error('Invalid group selection');
    }
    safe['default-selected'] = group['default-selected'];
  }
  if ('empty-fallback' in group) {
    if (!name(group['empty-fallback']) || !proxyNames.has(group['empty-fallback'])) throw new Error('Invalid group fallback');
    safe['empty-fallback'] = group['empty-fallback'];
  }
  if ('strategy' in group) {
    if (group.type !== 'load-balance' ||
        !['consistent-hashing', 'round-robin', 'sticky-sessions'].includes(String(group.strategy))) {
      throw new Error('Invalid group strategy');
    }
    safe.strategy = group.strategy;
  }
  if ('expected-status' in group) {
    const status = String(group['expected-status']);
    if (!health || status.length > 128 || !/^(?:\*|[1-5]\d\d(?:[-/][1-5]\d\d)*)$/.test(status)) {
      throw new Error('Invalid group status');
    }
    safe['expected-status'] = group['expected-status'];
  }
  if ('interface-name' in group) {
    if (!name(group['interface-name']) || group['interface-name'].length > 128) throw new Error('Invalid group interface');
    safe['interface-name'] = group['interface-name'];
  }
  if ('routing-mark' in group) {
    if (!Number.isSafeInteger(group['routing-mark']) || (group['routing-mark'] as number) < 0 ||
        (group['routing-mark'] as number) > 2_147_483_647) throw new Error('Invalid group routing mark');
    safe['routing-mark'] = group['routing-mark'];
  }
  return safe;
}

export function transformCcProfile(yaml: string, config: SubscriptionProfileConfig): string {
  if (!config.enabled || config.profileId !== 'cc' || new TextEncoder().encode(yaml).byteLength > CC_MAX_YAML_BYTES) {
    throw new Error('Invalid CC input');
  }
  const document = parseDocument(yaml, { version: '1.2', uniqueKeys: false });
  if (document.errors.length || !isMap(document.contents)) throw new Error('Invalid YAML');
  assertYamlTree(document.contents);
  const input: unknown = document.toJS({ maxAliasCount: 0 });
  if (!object(input) || Object.keys(input).some((key) => !SAFE_TOP_LEVEL.has(key))) throw new Error('Unsupported Clash structure');
  validateSafeSettings(input);
  if (input.dns !== undefined) validateDnsDependencies(input.dns);
  if (input.mode !== undefined && input.mode !== 'rule') throw new Error('Unsupported Clash mode');
  if (input.profile !== undefined &&
      (!object(input.profile) || Object.keys(input.profile).some((key) => !['store-selected', 'store-fake-ip'].includes(key)) ||
       Object.values(input.profile).some((value) => typeof value !== 'boolean'))) {
    throw new Error('Unsupported Clash profile');
  }
  if ('external-controller' in input &&
      (typeof input['external-controller'] !== 'string' ||
       !/^127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(input['external-controller']) ||
       Number(input['external-controller'].slice('127.0.0.1:'.length)) > 65_535)) {
    throw new Error('Unsafe controller');
  }
  if (!Array.isArray(input.proxies) || !Array.isArray(input['proxy-groups'])) throw new Error('Invalid Clash structure');
  const proxies = input.proxies as Data[];
  const upstreamGroups = input['proxy-groups'] as Data[];
  const proxyNames = validateNames(proxies, upstreamGroups);

  const active = config.groups.filter((group) => group.enabled);
  const existing = new Set([...proxyNames, ...upstreamGroups.map((group) => group.name as string)]);
  for (const group of active) {
    if (existing.has(group.label.default) || RESERVED_NAMES.has(group.label.default)) throw new Error('Managed name collision');
    existing.add(group.label.default);
  }

  const allProxyNames = new Set(proxies.map((proxy) => proxy.name as string));
  const groups = upstreamGroups.map((group) => preserveSafeGroup(group, allProxyNames));
  const byName = new Map(groups.map((group) => [group.name as string, group]));
  const proxySet = new Set(proxyNames);
  const reachable = new Map<string, boolean>();
  const selectsOnlyNodes = (group: Data): boolean => {
    const groupName = group.name as string;
    if (reachable.has(groupName)) return reachable.get(groupName)!;
    const valid = (group.proxies as string[]).every((target) =>
      proxySet.has(target) || (byName.has(target) && selectsOnlyNodes(byName.get(target)!))
    );
    reachable.set(groupName, valid);
    return valid;
  };
  let auto = byName.get('自动选择');
  let fallback = byName.get('故障转移');
  if (auto && (auto.type !== 'url-test' || auto.hidden === true || !selectsOnlyNodes(auto))) {
    throw new Error('Managed name collision');
  }
  if (fallback && (fallback.type !== 'fallback' || fallback.hidden === true || !selectsOnlyNodes(fallback))) {
    throw new Error('Managed name collision');
  }
  if (!auto) {
    if (existing.has('自动选择')) throw new Error('Managed name collision');
    auto = { name: '自动选择', type: 'url-test', proxies: proxyNames, url: PROBE_URL, interval: 300 };
    groups.push(auto);
    existing.add('自动选择');
  }
  if (!fallback) {
    if (existing.has('故障转移')) throw new Error('Managed name collision');
    fallback = { name: '故障转移', type: 'fallback', proxies: proxyNames, url: PROBE_URL, interval: 300 };
    groups.push(fallback);
    existing.add('故障转移');
  }
  const autoName = '自动选择';
  const fallbackName = '故障转移';
  const managed = active.map((group) => ({
    name: group.label.default,
    type: 'select',
    proxies: group.defaultPolicy === 'direct'
      ? ['DIRECT', autoName, fallbackName, ...proxyNames]
      : [autoName, fallbackName, ...proxyNames],
  }));
  const orderedGroups = [auto, fallback, ...managed, ...groups.filter((group) => group !== auto && group !== fallback)];

  const usedRules: RuleId[] = ['private', 'privateip', 'ads', ...active.map((group) => group.id), 'cn', 'cnip', 'proxy'];
  const providers: Data = {};
  for (const id of usedRules) {
    const source = CC_RULE_CATALOG[id];
    providers[`cc-${id}`] = {
      type: 'http', behavior: source.behavior, format: 'mrs',
      path: `./ruleset/cc-${id}.mrs`, url: source.url, interval: 86_400,
    };
  }
  const rules = [
    'RULE-SET,cc-private,DIRECT',
    'RULE-SET,cc-privateip,DIRECT,no-resolve',
    'RULE-SET,cc-ads,REJECT',
    ...active.map((group) => `RULE-SET,cc-${group.id},${group.label.default}`),
    'RULE-SET,cc-cn,DIRECT',
    'RULE-SET,cc-cnip,DIRECT,no-resolve',
    `RULE-SET,cc-proxy,${autoName}`,
    `MATCH,${autoName}`,
  ];
  const output: Data = { ...input, mode: 'rule', proxies, 'proxy-groups': orderedGroups, 'rule-providers': providers, rules };
  const serialized = stringify(output, { lineWidth: 0 });
  if (new TextEncoder().encode(serialized).byteLength > MAX_OUTPUT_BYTES) throw new Error('CC output too large');
  return serialized;
}
