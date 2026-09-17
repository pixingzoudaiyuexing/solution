import { z } from 'zod';
import type {
  CustomPage,
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
    title: z.string().max(255),
    content: z.string().max(65_535),
    tags: tagsSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strip();
const noticesResponseSchema = z
  .object({
    data: z.array(noticeSchema).max(100),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strip();
const noticeResponseSchema = z.object({ data: noticeSchema }).strip();
const UPSTREAM_PAGE_SIZE = 100;
const RESERVED_TAG_PREFIX = 'aureole:';
const IFRAME_TAG = 'aureole:iframe';
const EXTERNAL_TAG = 'aureole:external';

type UpstreamNotice = z.infer<typeof noticeSchema>;

type NoticeClassification =
  | { kind: 'ordinary' }
  | { kind: 'invalid-reserved' }
  | { kind: 'custom-page'; page: CustomPage };

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function assertOrdinaryNotice(notice: UpstreamNotice): void {
  if (notice.title.length === 0 || notice.content.length === 0) {
    throw new V2BoardUpstreamError();
  }
}

function toPublicSummary(notice: UpstreamNotice): NoticeSummary {
  assertOrdinaryNotice(notice);
  return {
    id: String(notice.id),
    title: notice.title,
    tags: notice.tags,
    createdAt: toIsoTimestamp(notice.created_at),
    updatedAt: toIsoTimestamp(notice.updated_at),
  };
}

function isReservedNotice(notice: UpstreamNotice): boolean {
  return notice.tags.some((tag) => tag.startsWith(RESERVED_TAG_PREFIX));
}

function validCustomPageUrl(content: string): string | null {
  const candidate = content.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function classifyNotice(notice: UpstreamNotice): NoticeClassification {
  const reservedTags = notice.tags.filter((tag) =>
    tag.startsWith(RESERVED_TAG_PREFIX)
  );
  if (reservedTags.length === 0) return { kind: 'ordinary' };
  if (reservedTags.length !== 1) return { kind: 'invalid-reserved' };

  const reservedTag = reservedTags[0];
  const mode =
    reservedTag === IFRAME_TAG
      ? 'iframe'
      : reservedTag === EXTERNAL_TAG
        ? 'external'
        : null;
  if (mode === null) return { kind: 'invalid-reserved' };

  const title = notice.title.trim();
  const url = validCustomPageUrl(notice.content);
  if (!title || url === null) return { kind: 'invalid-reserved' };

  return {
    kind: 'custom-page',
    page: {
      id: `notice-${notice.id}`,
      title,
      url,
      mode,
    },
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
    const collection = await this.collectVisibleNotices(authToken);
    const ordinary = collection.filter(
      (notice) => classifyNotice(notice).kind === 'ordinary'
    );
    const start = (pagination.page - 1) * pagination.pageSize;
    return {
      items: ordinary
        .slice(start, start + pagination.pageSize)
        .map(toPublicSummary),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: ordinary.length,
    };
  }

  async customPages(authToken: string): Promise<CustomPage[]> {
    const collection = await this.collectVisibleNotices(authToken);
    const pages: CustomPage[] = [];
    for (const notice of collection) {
      const classification = classifyNotice(notice);
      if (classification.kind === 'custom-page') {
        pages.push(classification.page);
      }
    }
    return pages;
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
    if (isReservedNotice(parsed.data.data)) {
      throw new V2BoardNoticeNotFoundError();
    }
    return {
      ...toPublicSummary(parsed.data.data),
      content: parsed.data.data.content,
    };
  }

  private async collectVisibleNotices(
    authToken: string
  ): Promise<UpstreamNotice[]> {
    const collection: UpstreamNotice[] = [];
    const seenIds = new Set<number>();
    let expectedTotal: number | undefined;
    let current = 1;

    while (true) {
      const query = new URLSearchParams({
        current: String(current),
        pageSize: String(UPSTREAM_PAGE_SIZE),
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
      if (expectedTotal === undefined) {
        expectedTotal = parsed.data.total;
      } else if (parsed.data.total !== expectedTotal) {
        throw new V2BoardUpstreamError();
      }

      const expectedPages = Math.max(
        1,
        Math.ceil(expectedTotal / UPSTREAM_PAGE_SIZE)
      );
      if (current > expectedPages) throw new V2BoardUpstreamError();
      const expectedPageItems =
        current < expectedPages
          ? UPSTREAM_PAGE_SIZE
          : expectedTotal - (current - 1) * UPSTREAM_PAGE_SIZE;
      if (parsed.data.data.length !== expectedPageItems) {
        throw new V2BoardUpstreamError();
      }

      for (const notice of parsed.data.data) {
        if (!isReservedNotice(notice)) assertOrdinaryNotice(notice);
        if (seenIds.has(notice.id)) throw new V2BoardUpstreamError();
        seenIds.add(notice.id);
        collection.push(notice);
      }

      if (collection.length > expectedTotal) throw new V2BoardUpstreamError();
      if (collection.length === expectedTotal) return collection;
      if (parsed.data.data.length === 0) throw new V2BoardUpstreamError();

      if (current >= expectedPages) throw new V2BoardUpstreamError();
      current += 1;
    }
  }
}
