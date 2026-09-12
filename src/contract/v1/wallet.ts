export interface Wallet {
  balanceMinor: number;
}

export interface WalletSuccessResponse {
  ok: true;
  data: Wallet;
  requestId: string;
}

export interface CreateWalletDepositRequest {
  amountMinor: number;
}

export interface WalletDepositCreated {
  id: string;
}

export interface WalletDepositCreatedSuccessResponse {
  ok: true;
  data: WalletDepositCreated;
  requestId: string;
}
