import type { NavigationItem } from '../contract/v1/navigation';
import type { CustomPagesSnapshotConfig } from '../registry/modules/custom-pages';
import {
  NAVIGATION_DEFAULT_LABELS,
  type NavigationCoreTargetId,
  type NavigationSnapshotConfig,
} from '../registry/modules/navigation';

const FALLBACK_CORE_TARGETS: NavigationCoreTargetId[] = [
  'dashboard', 'subscription', 'plans', 'resources', 'apple-id', 'orders',
  'wallet', 'notices', 'help-center', 'support', 'referrals',
];

function customById(custom: CustomPagesSnapshotConfig | null): Map<string, CustomPagesSnapshotConfig['items'][number]> {
  return new Map((custom?.items ?? []).map((item) => [item.id, item]));
}

function appendUnreferenced(
  output: NavigationItem[],
  custom: CustomPagesSnapshotConfig | null,
  referenced: Set<string>
): void {
  for (const page of custom?.items ?? []) {
    if (!referenced.has(page.id)) output.push({ kind: 'custom-page', itemId: page.id, label: page.title });
  }
}

export function compiledNavigationFallback(custom: CustomPagesSnapshotConfig | null): NavigationItem[] {
  const output = FALLBACK_CORE_TARGETS.map((targetId) => ({ kind: 'core' as const, targetId, label: NAVIGATION_DEFAULT_LABELS[targetId] }));
  appendUnreferenced(output, custom, new Set());
  return output;
}

export function resolveNavigation(
  navigation: NavigationSnapshotConfig | null,
  custom: CustomPagesSnapshotConfig | null
): NavigationItem[] {
  if (!navigation) return compiledNavigationFallback(custom);
  const pages = customById(custom);
  const referenced = new Set<string>();
  const output: NavigationItem[] = [];
  for (const item of navigation.items) {
    if (item.kind === 'core') {
      if (item.visible) output.push({ kind: item.kind, targetId: item.targetId, label: item.label ?? NAVIGATION_DEFAULT_LABELS[item.targetId] });
      continue;
    }
    referenced.add(item.itemId);
    const page = pages.get(item.itemId);
    if (item.visible && page) output.push({ kind: 'custom-page', itemId: item.itemId, label: item.label ?? page.title });
  }
  appendUnreferenced(output, custom, referenced);
  return output;
}
