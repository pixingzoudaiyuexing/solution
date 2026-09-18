export type ExposureClass = 'public' | 'authenticated' | 'internal';

const EXPOSURE_RANK: Record<ExposureClass, number> = {
  public: 0,
  authenticated: 1,
  internal: 2,
};

export function narrowExposure(
  maximum: ExposureClass,
  requested: ExposureClass
): ExposureClass | null {
  return EXPOSURE_RANK[requested] >= EXPOSURE_RANK[maximum]
    ? requested
    : null;
}
