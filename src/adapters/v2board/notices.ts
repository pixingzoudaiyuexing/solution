import { z } from 'zod';
import type {
  NoticeDetail,
  NoticePage,
  NoticePageRequest,
  NoticeSummary,
} from '../../contract/v1/notices';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardNoticeNotFoundError,
  V2BoardUpstreamError,
} from './errors';

const upstreamIdSchema = z.number().int().positive().max(2_147_483_647);
const timestampSchema = z.number().int().nonnegative().max(253_402_300_799);
const tagsSchema = z
  .union([
    z.array(z.string().max(255)).max(255),
    z.null(),
  ])
  .transform((tags) => tags ?? []);
const noticeSchema = z
  .object({
    id: upstreamIdSchema,
    title: z.string().min(1).max(255),
    content: z.string().min(1).max(65_535),
    tags: tagsSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strip();
const noticesResponseSchema = z
  .object({
    data: z.array(noticeSchema),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strip();
const noticeResponseSchema = z.object({ data: noticeSchema }).strip();

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function toPublicSummary(notice: z.infer<typeof noticeSchema>): NoticeSummary {
  return {
    id: String(notice.id),
    title: notice.title,
    tags: notice.tags,
    createdAt: toIsoTimestamp(notice.created_at),
    updatedAt: toIsoTimestamp(notice.updated_at),
  };
}

export class V2BoardNoticesAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async notices(
    authToken: string,
    pagination: NoticePageRequest
  ): Promise<NoticePage> {
    const query = new URLSearchParams({
      current: String(pagination.page),
      pageSize: String(pagination.pageSize),
    });
    const { response, payload } = await this.requestJson(
      `user/notice/fetch?${query.toString()}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthorizedResponse(response);

    const parsed = noticesResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      items: parsed.data.data.map(toPublicSummary),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: parsed.data.total,
    };
  }

  async notice(authToken: string, id: string): Promise<NoticeDetail> {
    const { response, payload } = await this.requestJson(
      `user/notice/fetch?id=${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthenticatedResponse(response);
    if (response.status === 404) throw new V2BoardNoticeNotFoundError();
    if (!response.ok) throw new V2BoardUpstreamError();

    const parsed = noticeResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return {
      ...toPublicSummary(parsed.data.data),
      content: parsed.data.data.content,
    };
  }
}
