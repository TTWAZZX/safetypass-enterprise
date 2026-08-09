export const LIFF_ID = '2009323437-35Fcl1JT';
export const LIFF_ENDPOINT_ORIGIN = 'https://safetypass-enterprise.vercel.app';

type BrowserLocation = Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>;

/**
 * LINE only accepts a redirect URI at its configured LIFF endpoint or below
 * it. Preview deployments have changing origins and must never start LIFF.
 */
export const getLiffProfileSyncRedirectUri = (
  location: BrowserLocation,
): string | null => {
  if (location.origin !== LIFF_ENDPOINT_ORIGIN) return null;

  return `${LIFF_ENDPOINT_ORIGIN}${location.pathname}${location.search}${location.hash}`;
};
