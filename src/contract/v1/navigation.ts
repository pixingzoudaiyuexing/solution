import type { NavigationCoreTargetId } from '../../registry/modules/navigation';

export type NavigationItem =
  | { kind: 'core'; targetId: NavigationCoreTargetId; label: string }
  | { kind: 'custom-page'; itemId: string; label: string };

export interface NavigationSuccessResponse {
  ok: true;
  data: { items: NavigationItem[] };
  requestId: string;
}
