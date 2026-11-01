export interface BridgeRequest {
  extensionId: string;
  state: string;
  expiresAt: number;
}
export interface PowerlySession {
  access: string;
  refresh: string;
  user: {
    id: number;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    get_display_name?: string;
  };
}
export const LOCAL_EXTENSION_ID = 'jbnedbbnphkjgbafhcmahfidlgdkoelb';
export function approvedExtensionIds(
  configured: string | undefined,
  development: boolean,
): string[] {
  return [
    ...new Set([
      ...(configured || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      ...(development ? [LOCAL_EXTENSION_ID] : []),
    ]),
  ];
}
export function parseBridgeRequest(
  href: string,
  approved: string[],
  now = Date.now(),
): BridgeRequest {
  const url = new URL(href);
  const extensionId = url.searchParams.get('extension_id') || '';
  const state = url.searchParams.get('state') || '';
  const expiresAt = Number(url.searchParams.get('expires_at'));
  if (!/^[a-p]{32}$/.test(extensionId) || !approved.includes(extensionId))
    throw new Error(
      'This extension is not approved by your Powerly site. Ask your administrator to enable Email Extractor.',
    );
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + 5 * 60_000
  )
    throw new Error(
      'This sign-in request is invalid or expired. Start again from Email Extractor.',
    );
  return { extensionId, state, expiresAt };
}
export function googleAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new Error(
      'Google sign-in is not configured for this Powerly site. Please contact your administrator.',
    );
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
  }))
    url.searchParams.set(key, value);
  return url.href;
}
export function googleCallbackCode(
  href: string,
  origin: string,
  state: string,
): string | undefined {
  const url = new URL(href);
  if (url.origin !== origin || url.pathname !== '/sign-in') return;
  if (url.searchParams.get('state') !== state)
    throw new Error('Google sign-in could not be verified. Please try again.');
  if (url.searchParams.get('error'))
    throw new Error(
      url.searchParams.get('error') === 'access_denied'
        ? 'Google sign-in was canceled.'
        : 'Google could not complete sign-in. Please try again.',
    );
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Google did not return an authorization code.');
  return code;
}
export function readPowerlySession(value: unknown): PowerlySession {
  if (!value || typeof value !== 'object')
    throw new Error('Powerly returned an incomplete account session.');
  const outer = value as Record<string, any>;
  if (outer.success === false)
    throw new Error(typeof outer.message === 'string' ? outer.message : 'Google sign-in failed.');
  const data = outer.data || outer;
  const tokens = data.tokens || data;
  if (
    typeof tokens.access !== 'string' ||
    !tokens.access ||
    typeof tokens.refresh !== 'string' ||
    !tokens.refresh ||
    !data.user ||
    !Number.isSafeInteger(data.user.id) ||
    typeof data.user.email !== 'string' ||
    !data.user.email
  )
    throw new Error('Powerly returned an incomplete account session.');
  return { access: tokens.access, refresh: tokens.refresh, user: data.user };
}
export async function connectExtension(
  request: BridgeRequest,
  session: PowerlySession,
): Promise<void> {
  if (Date.now() >= request.expiresAt)
    throw new Error('This sign-in request expired. Start again from Email Extractor.');
  type Runtime = {
    lastError?: { message?: string };
    sendMessage: (
      id: string,
      message: unknown,
      callback: (response?: { ok?: boolean; error?: { message?: string } }) => void,
    ) => void;
  };
  const runtime = (globalThis as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  if (!runtime?.sendMessage)
    throw new Error(
      'Email Extractor is unavailable. Reload the extension in Chrome, then start sign-in again.',
    );
  await new Promise<void>((resolve, reject) => {
    runtime.sendMessage(
      request.extensionId,
      { type: 'POWERLY_GOOGLE_SIGN_IN', state: request.state, session },
      (response) => {
        const browserError = runtime.lastError;
        if (browserError || !response?.ok)
          reject(
            new Error(
              response?.error?.message ||
                'Unable to connect Email Extractor. Reopen the extension and start sign-in again.',
            ),
          );
        else resolve();
      },
    );
  });
}

export function relayGoogleCallback(
  href: string,
  opener: {
    postMessage: (message: unknown, targetOrigin: string) => void;
  } | null,
): boolean {
  if (!opener) return false;
  const source = new URL(href);
  const state = source.searchParams.get('state') || '';
  if (
    source.pathname !== '/sign-in' ||
    !/^[a-f0-9]{64}$/.test(state) ||
    (!source.searchParams.get('code') && !source.searchParams.get('error'))
  )
    return false;
  const callback = new URL('/sign-in', source.origin);
  for (const key of ['state', 'code', 'error']) {
    const value = source.searchParams.get(key);
    if (value) callback.searchParams.set(key, value);
  }
  // Run before the SPA router can redirect an already-authenticated popup.
  // Never forward arbitrary query parameters or send to a wildcard origin.
  opener.postMessage(
    { type: 'POWERLY_EXTENSION_GOOGLE_CALLBACK', href: callback.href },
    source.origin,
  );
  return true;
}
