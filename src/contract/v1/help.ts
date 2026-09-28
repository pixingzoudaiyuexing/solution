export interface HelpCategory {
  name: string;
  articleCount: number;
}

export interface HelpArticleSummary {
  id: string;
  title: string;
  category: string;
  updatedAt: string;
}

export type HelpInline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'emphasis'; children: HelpInline[] }
  | { type: 'link'; href: string; children: HelpInline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'download'; itemId: string; slot: 'primary' | 'backup'; label: string; href: string }
  | { type: 'break' };

export type HelpBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: HelpInline[] }
  | { type: 'paragraph'; children: HelpInline[] }
  | { type: 'unordered-list' | 'ordered-list'; items: HelpInline[][] };

export interface HelpArticleDetail extends HelpArticleSummary {
  blocks: HelpBlock[];
}

export interface HelpCategoriesSuccessResponse {
  ok: true;
  data: { categories: HelpCategory[] };
  requestId: string;
}

export interface HelpArticlesSuccessResponse {
  ok: true;
  data: { items: HelpArticleSummary[]; page: number; pageSize: number; total: number };
  requestId: string;
}

export interface HelpArticleSuccessResponse {
  ok: true;
  data: { article: HelpArticleDetail };
  requestId: string;
}
