export type DownloadPlatform = 'windows' | 'macos' | 'android' | 'linux';

export interface DownloadOption {
  id: string;
  label: string;
  url: string;
}

export interface DownloadItem {
  id: string;
  label: string;
  platform: DownloadPlatform;
  arch: string | null;
  version: string;
  publishedAt: string | null;
  filename: string;
  sizeBytes: number;
  downloads: [DownloadOption, DownloadOption];
}

export interface DownloadsSuccessResponse {
  ok: true;
  data: { items: DownloadItem[] };
  requestId: string;
}
