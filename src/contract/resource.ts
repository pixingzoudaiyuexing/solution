export interface PublicResource {
  id: string;
  name: string;
  category: string;
  status: 'offline' | 'online';
}

export interface ResourcesSuccessResponse {
  ok: true;
  data: { resources: PublicResource[] };
  requestId: string;
}
