export interface TrafficLogEntry {
  uploadedBytes: number;
  downloadedBytes: number;
  recordedAt: string;
  rateMultiplier: number;
}

export interface TrafficLogsSuccessResponse {
  ok: true;
  data: { entries: TrafficLogEntry[] };
  requestId: string;
}
