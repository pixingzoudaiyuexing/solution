import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardHelpAdapter } from '../../adapters/v2board/help';
import { V2BoardAuthenticationError } from '../../adapters/v2board/errors';
import { createV2BoardControlPlaneClient } from '../../adapters/v2board/control-plane';
import { GatewayError, HelpError } from '../../contract/error';
import type {
  HelpArticleDetail,
  HelpArticleSuccessResponse,
  HelpArticlesSuccessResponse,
  HelpCategoriesSuccessResponse,
} from '../../contract/v1/help';
import { requestId } from '../../http/request-id';
import { readAvailableDownloads } from '../../registry/download-center-resolved';
import { REGISTRY_CATEGORY } from '../../registry/kernel';
import { parseHelpContent, HELP_MAX_BODY_BYTES } from '../../security/help-content';
import { requireAuthorization, type GatewayContext } from '../../security/authorization';

const helpRouter = new Hono<GatewayContext>();
const integer = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive());
const querySchema = z.object({
  category: z.string().trim().min(1).max(255).refine((v) => !/[\u0000-\u001f\u007f-\u009f]/.test(v)).optional(),
  q: z.string().trim().min(1).max(128).refine((v) => !/[\u0000-\u001f\u007f-\u009f]/.test(v)).optional(),
  page: integer.pipe(z.number().max(10_000)).optional(),
  pageSize: integer.pipe(z.number().max(50)).optional(),
}).strict();
const idSchema = z.string().regex(/^[1-9]\d*$/).refine((v) => Number(v) <= 2_147_483_647);

function query(url: string, keys: readonly string[]): Record<string, string> {
  const entries = [...new URL(url).searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length ||
      entries.some(([key]) => !keys.includes(key))) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  return Object.fromEntries(entries);
}

function adapter(c: { env: GatewayContext['Bindings'] }): V2BoardHelpAdapter {
  return new V2BoardHelpAdapter(createV2BoardClient(c.env));
}

async function helpOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof GatewayError || error instanceof HelpError || error instanceof V2BoardAuthenticationError) throw error;
    throw new HelpError(503, 'HELP_UNAVAILABLE');
  }
}

helpRouter.get('/categories', requireAuthorization, async (c) => helpOperation(async () => {
  query(c.req.url, []);
  const catalog = await adapter(c).catalog(c.get('authToken'));
  const response: HelpCategoriesSuccessResponse = {
    ok: true, data: { categories: catalog.categories }, requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
}));

helpRouter.get('/articles', requireAuthorization, async (c) => helpOperation(async () => {
  const parsed = querySchema.safeParse(query(c.req.url, ['category', 'q', 'page', 'pageSize']));
  if (!parsed.success) throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  const { category, q, page = 1, pageSize = 20 } = parsed.data;
  const catalog = await adapter(c).catalog(c.get('authToken'), q);
  const items = category === undefined ? catalog.items : catalog.items.filter((item) => item.category === category);
  const response: HelpArticlesSuccessResponse = {
    ok: true,
    data: { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
}));

helpRouter.get('/articles/:id', requireAuthorization, async (c) => helpOperation(async () => {
  query(c.req.url, []);
  const id = c.req.param('id');
  if (!idSchema.safeParse(id).success) throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  const catalog = await adapter(c).catalog(c.get('authToken'));
  const summary = catalog.items.find((item) => item.id === id);
  if (!summary) throw new HelpError(404, 'HELP_ARTICLE_NOT_FOUND');

  const raw = await createV2BoardControlPlaneClient(c.env).readRawKnowledgeDetail(Number(id));
  if (raw.id !== Number(id) || raw.show !== 1 || raw.category === REGISTRY_CATEGORY ||
      raw.title !== summary.title || raw.category !== summary.category ||
      new Date(raw.updated_at * 1000).toISOString() !== summary.updatedAt) {
    throw new HelpError(404, 'HELP_ARTICLE_NOT_FOUND');
  }
  if (new TextEncoder().encode(raw.body).length > HELP_MAX_BODY_BYTES) throw new HelpError(503, 'HELP_UNAVAILABLE');
  let downloads: Awaited<ReturnType<typeof readAvailableDownloads>> = [];
  if (c.env.REGISTRY_KV) {
    try { downloads = await readAvailableDownloads(c.env.REGISTRY_KV, Date.now()); }
    catch { /* An unavailable download does not suppress the article. */ }
  }
  const article: HelpArticleDetail = { ...summary, blocks: await parseHelpContent(raw.body, c.env.V2BOARD_BASE_URL, downloads) };
  const response: HelpArticleSuccessResponse = { ok: true, data: { article }, requestId: requestId(c) };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
}));

export { helpRouter };
