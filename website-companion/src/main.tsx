import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import appConfig from './config';
import {
  approvedExtensionIds,
  connectExtension,
  googleAuthorizationUrl,
  googleCallbackCode,
  parseBridgeRequest,
  readPowerlySession,
  type BridgeRequest,
  type PowerlySession,
} from './bridge';
import './style.css';
function GoogleExtensionSignIn() {
  const [request] = useState<{ value?: BridgeRequest; error?: string }>(() => {
    try {
      return {
        value: parseBridgeRequest(
          location.href,
          approvedExtensionIds(import.meta.env.VITE_POWERLY_EXTENSION_IDS, import.meta.env.DEV),
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Invalid sign-in request.',
      };
    }
  });
  const [phase, setPhase] = useState<
    'ready' | 'google' | 'exchanging' | 'approve' | 'connecting' | 'done'
  >('ready');
  const [session, setSession] = useState<PowerlySession>();
  const [error, setError] = useState(request.error || '');
  const popup = useRef<Window | null>(null);
  const stopPolling = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const activeExchange = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const providerState = useRef('');
  const callbackClaimed = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearInterval(stopPolling.current);
      popup.current?.close();
      activeExchange.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!request.value || phase === 'done') return;
    const timer = setTimeout(
      () => {
        clearInterval(stopPolling.current);
        popup.current?.close();
        activeExchange.current?.abort();
        setSession(undefined);
        setPhase('ready');
        setError('This sign-in request expired. Start again from Email Extractor.');
      },
      Math.max(0, request.value.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [request.value, phase]);
  const exchange = useCallback(async (code: string) => {
    setPhase('exchanging');
    const controller = new AbortController();
    activeExchange.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(
        `${appConfig.baseURL.replace(/\/+$/, '')}/api/auth/google-site-login/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          credentials: 'omit',
          signal: controller.signal,
          body: JSON.stringify({
            code,
            redirect_uri: `${location.origin}/sign-in`,
          }),
        },
      );
      if (response.headers.get('content-type')?.includes('text/html'))
        throw new Error('Powerly sign-in is temporarily unavailable. Please try again later.');
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Google sign-in failed. Please try again.');
      const account = readPowerlySession(body);
      if (mounted.current) {
        setSession(account);
        setPhase('approve');
      }
    } catch (error) {
      if (mounted.current) {
        setError(
          error instanceof Error && error.name !== 'AbortError'
            ? error.message
            : 'Unable to reach Powerly. Please try again.',
        );
        setPhase('ready');
      }
    } finally {
      clearTimeout(timeout);
      activeExchange.current = undefined;
    }
  }, []);
  const receiveCallback = useCallback(
    (href: string) => {
      if (callbackClaimed.current || !providerState.current) return;
      try {
        const code = googleCallbackCode(href, location.origin, providerState.current);
        if (!code) return;
        callbackClaimed.current = true;
        clearInterval(stopPolling.current);
        popup.current?.close();
        void exchange(code);
      } catch (error) {
        callbackClaimed.current = true;
        clearInterval(stopPolling.current);
        popup.current?.close();
        setPhase('ready');
        setError(error instanceof Error ? error.message : 'Unable to verify Google sign-in.');
      }
    },
    [exchange],
  );
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== popup.current ||
        event.data?.type !== 'POWERLY_EXTENSION_GOOGLE_CALLBACK' ||
        typeof event.data.href !== 'string'
      )
        return;
      receiveCallback(event.data.href);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [receiveCallback]);
  function startGoogle() {
    if (!request.value || Date.now() >= request.value.expiresAt) return;
    setError('');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    providerState.current = state;
    callbackClaimed.current = false;
    try {
      const url = googleAuthorizationUrl(
        import.meta.env.VITE_REACT_APP_GOOGLE_CLIENT_ID || '',
        `${location.origin}/sign-in`,
        state,
      );
      popup.current = window.open(url, 'powerly-extension-google', 'popup,width=520,height=680');
      if (!popup.current) throw new Error('Allow popups for this site, then try again.');
      setPhase('google');
      stopPolling.current = setInterval(() => {
        if (callbackClaimed.current) {
          clearInterval(stopPolling.current);
          return;
        }
        if (!popup.current || popup.current.closed) {
          clearInterval(stopPolling.current);
          setPhase('ready');
          setError('Google sign-in was canceled.');
          return;
        }
        let href: string;
        try {
          href = popup.current.location.href;
        } catch {
          return;
        }
        receiveCallback(href);
      }, 200);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to start Google sign-in.');
    }
  }
  async function approve() {
    if (!request.value || !session) return;
    setPhase('connecting');
    setError('');
    try {
      await connectExtension(request.value, session);
      setSession(undefined);
      setPhase('done');
      history.replaceState(null, '', location.pathname);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to connect the extension.');
      setPhase('approve');
    }
  }
  const busy = ['google', 'exchanging', 'connecting'].includes(phase);
  return (
    <main className="auth-card">
      <div className="wordmark">
        powerly<span>.</span>
      </div>
      <p className="eyebrow">EMAIL EXTRACTOR · GOOGLE SIGN-IN</p>
      <h1>{phase === 'done' ? 'You’re connected.' : 'Your Powerly account, in your browser.'}</h1>
      <p className="description">
        {phase === 'done'
          ? 'Return to the Email Extractor side panel. You can close this tab.'
          : 'Sign in with Google on this Powerly site, then choose whether to connect your account to Email Extractor.'}
      </p>
      <div className="site">{location.origin}</div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {phase === 'done' ? (
        <div className="success" role="status">
          ✓ Sign-in complete. Your Powerly workspace is ready.
        </div>
      ) : session ? (
        <>
          <div className="account">
            <strong>
              {session.user.get_display_name || session.user.first_name || session.user.email}
            </strong>
            <span>{session.user.email}</span>
          </div>
          <p className="description small">
            Connect this Powerly account to the extension? Gmail access is requested separately when
            you connect your inbox.
          </p>
          <button disabled={busy} onClick={() => void approve()}>
            {phase === 'connecting' ? 'Connecting…' : 'Connect Email Extractor'}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setSession(undefined);
              setPhase('ready');
            }}
          >
            Use another Google account
          </button>
        </>
      ) : (
        <button
          disabled={!request.value || busy || request.value.expiresAt <= Date.now()}
          onClick={startGoogle}
        >
          <span aria-hidden="true" className="google-g">
            G
          </span>
          {phase === 'google'
            ? 'Waiting for Google…'
            : phase === 'exchanging'
              ? 'Signing in to Powerly…'
              : 'Continue with Google'}
        </button>
      )}
      <p className="privacy">
        Your password stays with Google. Credentials are never placed in a redirect URL.
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<GoogleExtensionSignIn />);
