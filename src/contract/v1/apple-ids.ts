export interface AppleIdAccount {
  username: string;
  status: boolean;
  lastCheck: string;
  remark: string | null;
}

export interface AppleIdsSuccessResponse {
  ok: true;
  data: { items: AppleIdAccount[] };
  requestId: string;
}

export interface AppleIdRevealSuccessResponse {
  ok: true;
  data: AppleIdAccount & { password: string };
  requestId: string;
}
