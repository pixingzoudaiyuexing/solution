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

export type CustomPageMode = 'external' | 'iframe';

export interface CustomPage {
  id: string;
  title: string;
  url: string;
  mode: CustomPageMode;
}

export interface CustomPages {
  items: CustomPage[];
}

export interface CustomPagesSuccessResponse {
  ok: true;
  data: CustomPages;
  requestId: string;
}
