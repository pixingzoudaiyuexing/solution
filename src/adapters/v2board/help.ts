import { z } from 'zod';
import type { HelpArticleSummary, HelpCategory } from '../../contract/v1/help';
import { readBoundedJson } from '../../http/bounded-json';
import { REGISTRY_CATEGORY } from '../../registry/kernel';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardAuthenticationError, V2BoardUpstreamError } from './errors';

const upstreamArticle = z.object({
  id: z.number().int().positive().max(2_147_483_647),
  title: z.string().min(1).max(255),
  category: z.string().min(1).max(255),
  updated_at: z.number().int().nonnegative().max(253_402_300_799),
}).strip();
const catalogResponse = z.object({ data: z.union([z.record(z.unknown()), z.tuple([])]) }).strip();
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export interface HelpCatalog {
  categories: HelpCategory[];
  items: HelpArticleSummary[];
}

export class V2BoardHelpAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) { super(client); }

  async catalog(authToken: string, keyword?: string): Promise<HelpCatalog> {
    const query = new URLSearchParams({ language: 'zh-CN' });
    if (keyword !== undefined) query.set('keyword', keyword);
    const response = await this.request(`user/knowledge/fetch?${query}`, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: authToken },
    });
    if (response.status === 401 || response.status === 403) throw new V2BoardAuthenticationError();
    if (!response.ok) throw new V2BoardUpstreamError();
    let payload: unknown;
    try { payload = await readBoundedJson(response, 1_048_576); }
    catch { throw new V2BoardUpstreamError(); }
    const parsed = catalogResponse.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();

    const categories: HelpCategory[] = [];
    const items: HelpArticleSummary[] = [];
    const ids = new Set<number>();
    const groups = Array.isArray(parsed.data.data) ? {} : parsed.data.data;
    for (const [category, group] of Object.entries(groups)) {
      if (category === REGISTRY_CATEGORY) continue;
      if (!category || category.length > 255 || CONTROL.test(category)) throw new V2BoardUpstreamError();
      if (categories.length >= 100) throw new V2BoardUpstreamError();
      const metadata = z.array(upstreamArticle).safeParse(group);
      if (!metadata.success) throw new V2BoardUpstreamError();
      let count = 0;
      for (const item of metadata.data) {
        if (item.category === REGISTRY_CATEGORY) continue;
        if (item.category !== category || CONTROL.test(item.title) || CONTROL.test(item.category) ||
            !item.title.trim() || ids.has(item.id) || items.length >= 500) throw new V2BoardUpstreamError();
        ids.add(item.id);
        items.push({ id: String(item.id), title: item.title, category, updatedAt: new Date(item.updated_at * 1000).toISOString() });
        count++;
      }
      if (count > 0) categories.push({ name: category, articleCount: count });
    }
    return { categories, items };
  }
}
