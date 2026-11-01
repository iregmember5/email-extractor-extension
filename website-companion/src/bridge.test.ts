import { describe, expect, it } from 'vitest';
import {
  approvedExtensionIds,
  googleAuthorizationUrl,
  googleCallbackCode,
  LOCAL_EXTENSION_ID,
  parseBridgeRequest,
  readPowerlySession,
  relayGoogleCallback,
} from './bridge';
const now = 1000;
const href = `https://team.mypowerly.com/extension-auth.html?extension_id=${LOCAL_EXTENSION_ID}&state=${'a'.repeat(64)}&expires_at=${now + 10000}`;
describe('Powerly website Google companion', () => {
  it('requires an explicitly approved extension and a short-lived request', () => {
    expect(parseBridgeRequest(href, [LOCAL_EXTENSION_ID], now).extensionId).toBe(
      LOCAL_EXTENSION_ID,
    );
    expect(() => parseBridgeRequest(href, [], now)).toThrow('not approved');
    expect(() => parseBridgeRequest(href, [LOCAL_EXTENSION_ID], now + 10001)).toThrow('expired');
    expect(() =>
      parseBridgeRequest(href.replace('a'.repeat(64), 'wrong'), [LOCAL_EXTENSION_ID], now),
    ).toThrow('invalid');
  });
  it('does not enable the local development extension in production implicitly', () => {
    expect(approvedExtensionIds(undefined, false)).toEqual([]);
    expect(approvedExtensionIds(undefined, true)).toEqual([LOCAL_EXTENSION_ID]);
    expect(approvedExtensionIds(LOCAL_EXTENSION_ID, false)).toEqual([LOCAL_EXTENSION_ID]);
  });
  it('uses the registered website callback and identity-only Google scopes', () => {
    const url = new URL(
      googleAuthorizationUrl(
        '123-test.apps.googleusercontent.com',
        'http://localhost:5173/sign-in',
        'nonce',
      ),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/sign-in');
    expect(url.searchParams.get('state')).toBe('nonce');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
  it('checks provider state and callback origin before exchanging the code', () => {
    expect(
      googleCallbackCode(
        'https://accounts.google.com/consent',
        'https://team.mypowerly.com',
        'nonce',
      ),
    ).toBeUndefined();
    expect(
      googleCallbackCode(
        'https://team.mypowerly.com/sign-in?code=code&state=nonce',
        'https://team.mypowerly.com',
        'nonce',
      ),
    ).toBe('code');
    expect(() =>
      googleCallbackCode(
        'https://team.mypowerly.com/sign-in?code=code&state=wrong',
        'https://team.mypowerly.com',
        'nonce',
      ),
    ).toThrow('verified');
    expect(() =>
      googleCallbackCode(
        'https://team.mypowerly.com/sign-in?error=access_denied&state=nonce',
        'https://team.mypowerly.com',
        'nonce',
      ),
    ).toThrow('canceled');
  });
  const session = {
    access: 'access',
    refresh: 'refresh',
    user: { id: 47, email: 'user@example.com' },
  };
  it.each([
    session,
    { success: true, data: session },
    {
      success: true,
      data: {
        tokens: { access: 'access', refresh: 'refresh' },
        user: session.user,
      },
    },
  ])('accepts the supported Powerly response shapes', (response) => {
    expect(readPowerlySession(response)).toEqual(session);
  });
  it('rejects missing tokens and backend errors', () => {
    expect(() => readPowerlySession({ success: false, message: 'Wrong tenant' })).toThrow(
      'Wrong tenant',
    );
    expect(() => readPowerlySession({ access: 'access', user: session.user })).toThrow(
      'incomplete',
    );
  });
});

describe('Google callback relay before SPA navigation', () => {
  it('relays only the authorization callback to the exact website origin', () => {
    let result: unknown;
    let target = '';
    const opener = {
      postMessage(message: unknown, origin: string) {
        result = message;
        target = origin;
      },
    };
    expect(
      relayGoogleCallback(
        `http://localhost:5173/sign-in?code=test-code&state=${'a'.repeat(64)}&access=must-not-forward`,
        opener,
      ),
    ).toBe(true);
    expect(target).toBe('http://localhost:5173');
    expect(result).toEqual({
      type: 'POWERLY_EXTENSION_GOOGLE_CALLBACK',
      href: `http://localhost:5173/sign-in?state=${'a'.repeat(64)}&code=test-code`,
    });
  });
  it('ignores ordinary website navigation and missing openers', () => {
    const opener = {
      postMessage() {
        throw new Error('Must not relay');
      },
    };
    expect(relayGoogleCallback('https://mypowerly.com/sign-in?code=test-code', opener)).toBe(false);
    expect(
      relayGoogleCallback(
        `https://mypowerly.com/sign-in?code=test-code&state=${'a'.repeat(64)}`,
        null,
      ),
    ).toBe(false);
    expect(
      relayGoogleCallback(
        `https://mypowerly.com/workspace?code=test-code&state=${'a'.repeat(64)}`,
        opener,
      ),
    ).toBe(false);
  });
});
