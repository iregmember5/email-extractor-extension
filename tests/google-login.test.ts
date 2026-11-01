import { describe, expect, it } from 'vitest';
import {
  signInOrigin,
  validateGoogleHandoff,
  type PendingGoogleLogin,
} from '../src/background/google-login';
const now = 1000;
const pending: PendingGoogleLogin = {
  state: 'a'.repeat(64),
  origin: 'http://localhost:5173',
  tabId: 4,
  expiresAt: now + 5000,
};
const sender = {
  frameId: 0,
  url: 'http://localhost:5173/extension-auth.html',
  origin: 'http://localhost:5173',
  tab: { id: 4 },
};
const session = {
  access: 'access',
  refresh: 'refresh',
  user: { id: 47, email: 'user@example.com', first_name: null },
};
const message = { type: 'POWERLY_GOOGLE_SIGN_IN', state: pending.state, session };
describe('Google sign-in trust boundary', () => {
  it('accepts a complete session only for the selected site, tab, state, and lifetime', () => {
    expect(validateGoogleHandoff(message, sender, pending, now)).toEqual(session);
  });
  it.each([
    { ...sender, origin: 'http://localhost:5174' },
    { ...sender, url: 'http://localhost:5173.evil.example/extension-auth.html' },
    { ...sender, url: 'http://localhost:5173/unrelated-page' },
    { ...sender, tab: { id: 5 } },
    { ...sender, frameId: 1 },
    { ...sender, id: 'another-extension' },
  ])('rejects a mismatched or untrusted source %#', (source) => {
    expect(() => validateGoogleHandoff(message, source, pending, now)).toThrow();
  });
  it('rejects expired, absent, replayed, and altered challenges', () => {
    expect(() => validateGoogleHandoff(message, sender, pending, pending.expiresAt)).toThrow(
      'expired',
    );
    expect(() => validateGoogleHandoff(message, sender, undefined, now)).toThrow('expired');
    expect(() =>
      validateGoogleHandoff({ ...message, state: 'b'.repeat(64) }, sender, pending, now),
    ).toThrow('verified');
  });
  it('rejects incomplete session data', () => {
    expect(() =>
      validateGoogleHandoff(
        { ...message, session: { ...session, refresh: '' } },
        sender,
        pending,
        now,
      ),
    ).toThrow('complete account');
  });
  it('limits selected login sites to Powerly domains or loopback development servers', () => {
    expect(signInOrigin('http://localhost:5173/sign-in')).toBe('http://localhost:5173');
    expect(signInOrigin('https://team.mypowerly.com/')).toBe('https://team.mypowerly.com');
    for (const site of [
      'https://mypowerly.com.evil.example',
      'http://mypowerly.com',
      'javascript:alert(1)',
      'https://user:pass@mypowerly.com',
      'http://localhost.evil.example',
    ])
      expect(() => signInOrigin(site)).toThrow();
  });
});
