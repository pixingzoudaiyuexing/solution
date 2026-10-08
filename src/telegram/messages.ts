import { registryOperationalDefinitions } from '../registry/definitions';
import { evaluateRegistryFreshness, type RegistryHealthCode, type RegistryHealthStatus, type RegistryOperationalHealth } from '../registry/operational';

const modules = [
  ['runtime-settings', '运行设置'], ['custom-pages', '自定义页面'],
  ['subscription-delivery', '订阅入口'], ['subscription-profile', '分流规则'],
  ['announcements', '公告'], ['download-center', '下载中心配置'], ['navigation', '导航'],
] as const;

const statusNames: Record<RegistryHealthStatus, string> = {
  ok: '正常', disabled: '未启用', degraded: '需要注意', error: '异常',
};

export const healthCodeMessages: Record<RegistryHealthCode, string> = {
  CONTROL_PLANE_AUTH_INVALID: '配置来源的访问凭据失效，请检查测试环境控制台的访问授权',
  CONTROL_PLANE_CONFIG_INVALID: '配置来源的连接设置不完整，请检查测试环境服务连接设置',
  CONTROL_PLANE_TIMEOUT: '读取配置超时，请检查配置来源的连接情况',
  CONTROL_PLANE_UPSTREAM_ERROR: '暂时无法读取配置来源，请检查测试环境控制台是否可用',
  KV_UNAVAILABLE: '健康记录暂时不可用，请检查测试环境服务的存储连接',
  VALID_ENABLED: '配置有效', VALID_DISABLED: '配置未启用',
  INVALID_SYNTAX: '配置格式无法识别，请检查知识库对应配置的格式',
  INVALID_SCHEMA: '配置内容不符合要求，请检查知识库对应配置的字段',
  UNSUPPORTED_VERSION: '配置版本不受支持，请检查知识库对应配置的版本',
  DUPLICATE_MODULE: '存在重复配置，请检查知识库并保留唯一有效配置',
  DEPENDENCY_INVALID: '关联配置不可用，请检查知识库中的关联配置',
  SECRET_UNRESOLVED: '配置所需的访问凭据不可用，请检查测试环境服务的凭据绑定',
  DUPLICATE_ITEM_ID: '配置中存在重复项目，请检查知识库对应配置',
  EXPOSURE_BROADENING: '配置的访问范围不符合安全要求，请检查知识库对应配置',
  IDENTITY_INVALID: '配置标识不符合要求，请检查知识库对应配置',
  REFERENCE_INVALID: '配置引用无效，请检查知识库中的关联项目',
  UNKNOWN_MODULE: '存在无法识别的配置，请检查知识库配置类型',
  MODULE_ABSENT: '尚未配置',
  REGISTRY_SOURCE_INVALID: '配置来源内容不符合要求，请检查测试环境知识库的配置条目',
  SNAPSHOT_PROJECTION_INVALID: '配置暂时无法生成有效结果，请检查知识库配置并联系维护人员',
};

export function relativeTime(timestamp: number, now: number): string {
  if (timestamp > now) return '时间记录异常';
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function formatRegistryHealth(health: RegistryOperationalHealth | null, now = Date.now()): string {
  if (!health) return '暂时没有可用的健康记录。请稍后重试，或发送 /check 检查一次。';
  const lines = [`整体状态：${statusNames[health.status]}`, `最近检查：${relativeTime(health.checkedAt, now)}`];
  if (now - health.checkedAt > 15 * 60_000) lines.push('长时间未刷新，请检查测试环境服务的定时检查是否正常运行。');
  if (health.source.code) lines.push(healthCodeMessages[health.source.code]);
  for (const [id, name] of modules) {
    const module = health.modules.find((item) => item.moduleId === id);
    if (!module) { lines.push(`${name}：暂无健康记录`); continue; }
    let detail = `${name}：${statusNames[module.status]}`;
    if (module.code) detail += `；${healthCodeMessages[module.code]}`;
    if (module.status === 'degraded' || module.status === 'error') {
      const policy = registryOperationalDefinitions.find((item) => item.registryDefinition.moduleId === id)!.freshness;
      const usable = module.sourceClass === 'lkg' && module.validatedAt !== undefined &&
        evaluateRegistryFreshness(module.validatedAt, policy, now).usable;
      detail += usable ? '；正在使用上一次有效配置' : '；没有可用的旧有效配置';
      if (module.validatedAt !== undefined && !evaluateRegistryFreshness(module.validatedAt, policy, now).usable) {
        detail += '；长时间未刷新';
      }
      if (!module.code) detail += '；请检查测试环境知识库对应配置';
    }
    lines.push(detail);
  }
  return lines.join('\n');
}

export const commandHelp = '可用命令：\n/health 查看健康状态\n/check 检查一次';
