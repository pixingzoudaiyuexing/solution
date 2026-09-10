export interface CurrentUserResponseData {
  email: string;
}

export interface CurrentUserSuccessResponse {
  ok: true;
  data: CurrentUserResponseData;
  requestId: string;
}
