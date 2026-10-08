import { describe, expect, it } from 'vitest';
import { formatRegistryHealth, healthCodeMessages, relativeTime } from '../src/telegram/messages';
import { health } from './helpers/telegram';

describe('Chinese Registry health messages', () => {
  it('shows all seven Chinese module names, status and relative check time', () => {
    const value = formatRegistryHealth(health(), health().checkedAt + 180_000);
    for (const name of ['运行设置', '自定义页面', '订阅入口', '分流规则', '公告', '下载中心配置', '导航']) expect(value).toContain(`${name}：正常`);
    expect(value).toContain('最近检查：3 分钟前');
    expect(value).toContain('整体状态：正常');
  });
  it.each([['ok', '正常'], ['disabled', '未启用'], ['degraded', '需要注意'], ['error', '异常']] as const)('translates %s', (status, chinese) => {
    expect(formatRegistryHealth(health(undefined, status))).toContain(`整体状态：${chinese}`);
  });
  it.each(Object.entries(healthCodeMessages))('renders %s without raw enums, keys, fingerprints or unknown module IDs', (code, message) => {
    const h = health(); h.source = { status: 'error', code: code as keyof typeof healthCodeMessages };
    h.modules[0].code = code as keyof typeof healthCodeMessages;
    h.modules.push({ ...h.modules[0], moduleId: 'secret-internal-module-id' });
    const output = formatRegistryHealth(h, h.checkedAt);
    expect(output).toContain(message);
    expect(output).not.toMatch(/[A-Z_]{3,}|registry:|secret-internal-module-id|runtime-settings/);
  });
  it('distinguishes available LKG from expired LKG without trusting the stale health status', () => {
    const h = health(undefined, 'degraded');
    h.modules[0].sourceClass = 'lkg'; h.modules[0].validatedAt = h.checkedAt;
    expect(formatRegistryHealth(h, h.checkedAt)).toContain('正在使用上一次有效配置');
    const stale = formatRegistryHealth(h, h.checkedAt + 8 * 86400_000);
    expect(stale).toContain('没有可用的旧有效配置');
    expect(stale).toContain('长时间未刷新');
    expect(stale).not.toContain('正在使用上一次有效配置');
  });
  it('handles missing health and missing module records in friendly Chinese', () => {
    expect(formatRegistryHealth(null)).toContain('暂时没有可用的健康记录');
    const h = health(); h.modules = [];
    expect(formatRegistryHealth(h, h.checkedAt)).toContain('导航：暂无健康记录');
  });
  it.each([[0, '刚刚'], [59_999, '刚刚'], [60_000, '1 分钟前'], [3_600_000, '1 小时前'], [86_400_000, '1 天前'], [-1, '时间记录异常']])('relative time %s', (age, expected) => {
    expect(relativeTime(100_000_000, 100_000_000 + Number(age))).toBe(expected);
  });
});
