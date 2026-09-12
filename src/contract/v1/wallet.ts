export interface Wallet {
  balanceMinor: number;
}

export interface WalletSuccessResponse {
  ok: true;
  data: Wallet;
  requestId: string;
}
