export interface DownloadMirror {
  id: string;
  label: string;
  url: string;
}

export interface DownloadItem {
  id: string;
  label: string;
  platform: string | null;
  arch: string | null;
  version: string;
  publishedAt: string | null;
  downloadUrl: string;
  filename: string;
  sizeBytes: number;
  mirrors: DownloadMirror[];
}

export interface DownloadsSuccessResponse {
  ok: true;
  data: { items: DownloadItem[] };
  requestId: string;
}
