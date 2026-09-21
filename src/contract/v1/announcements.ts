export interface Announcement {
  id: string;
  title: string;
  body: string;
}

export interface AnnouncementsSuccessResponse {
  ok: true;
  data: { items: Announcement[] };
  requestId: string;
}
