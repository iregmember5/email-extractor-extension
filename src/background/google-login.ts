import type { Session } from '../types';
import { ApiError } from './api';
export const GOOGLE_LOGIN_LIFETIME = 5 * 60_000;
export interface PendingGoogleLogin {
  state: string;
  origin: string;
  tabId: number;
  expiresAt: number;
}
export function signInOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError('Enter your Powerly site URL, such as https://your-team.mypowerly.com.');
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  const powerly = url.hostname === 'mypowerly.com' || url.hostname.endsWith('.mypowerly.com');
  if (
    url.username ||
    url.password ||
    (!local && (!powerly || url.protocol !== 'https:')) ||
    (local && !['http:', 'https:'].includes(url.protocol))
  ) {
    throw new ApiError(
      'Use an HTTPS Powerly domain or your localhost development site. Custom domains must first be approved for extension sign-in.',
    );
  }
  return url.origin;
}
export function validateGoogleHandoff(
  message: unknown,
  sender: { id?: string; url?: string; origin?: string; tab?: { id?: number }; frameId?: number },
  pending: PendingGoogleLogin | undefined,
  now = Date.now(),
): Session {
  if (!pending || pending.expiresAt <= now)
    throw new ApiError('This Google sign-in request expired. Start again from the extension.');
  if (sender.id || sender.frameId !== 0 || sender.tab?.id !== pending.tabId || !sender.url)
    throw new ApiError('This page cannot complete the sign-in request.');
  let source: URL;
  try {
    source = new URL(sender.url);
  } catch {
    throw new ApiError('Invalid sign-in source.');
  }
  if (
    source.origin !== pending.origin ||
    (sender.origin && sender.origin !== pending.origin) ||
    source.pathname !== '/extension-auth.html'
  )
    throw new ApiError('The sign-in page does not match your selected Powerly site.');
  const value = message as { type?: string; state?: string; session?: Session } | null;
  if (value?.type !== 'POWERLY_GOOGLE_SIGN_IN' || value.state !== pending.state)
    throw new ApiError('The sign-in request could not be verified.');
  const session = value.session;
  if (
    !session ||
    typeof session.access !== 'string' ||
    !session.access ||
    typeof session.refresh !== 'string' ||
    !session.refresh ||
    !session.user ||
    !Number.isSafeInteger(session.user.id) ||
    typeof session.user.email !== 'string' ||
    !session.user.email
  )
    throw new ApiError('Powerly did not return a complete account session.');
  // Only accept the documented session shape; never persist arbitrary external fields.
  return { access: session.access, refresh: session.refresh, user: session.user };
}
