export interface NoticeSummary {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoticeDetail extends NoticeSummary {
  content: string;
}

export interface NoticePageRequest {
  page: number;
  pageSize: number;
}

export interface NoticePage extends NoticePageRequest {
  items: NoticeSummary[];
  total: number;
}

export interface NoticesSuccessResponse {
  ok: true;
  data: NoticePage;
  requestId: string;
}

export interface NoticeDetailSuccessResponse {
  ok: true;
  data: NoticeDetail;
  requestId: string;
}
