import { describe, expect, it } from 'vitest';
import {
  getLiffProfileSyncRedirectUri,
  LIFF_ENDPOINT_ORIGIN,
} from '../utils/liffProfileSync';

describe('LINE profile sync redirect guard', () => {
  it('keeps a production redirect URI under the configured LIFF endpoint', () => {
    expect(getLiffProfileSyncRedirectUri({
      origin: LIFF_ENDPOINT_ORIGIN,
      pathname: '/profile/settings',
      search: '?source=profile-sync',
      hash: '#avatar',
    })).toBe(`${LIFF_ENDPOINT_ORIGIN}/profile/settings?source=profile-sync#avatar`);
  });

  it('does not start LIFF on preview, local, or other origins', () => {
    for (const origin of [
      'https://safetypass-enterprise-axbc6t2ut-181125411998s-projects.vercel.app',
      'http://127.0.0.1:4179',
      'https://example.com',
    ]) {
      expect(getLiffProfileSyncRedirectUri({
        origin,
        pathname: '/',
        search: '',
        hash: '',
      })).toBeNull();
    }
  });
});
