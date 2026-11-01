import { API_BASE, AUTH_BASE, VERSION } from '../config';
import type { AppError, Envelope, Session } from '../types';
export class ApiError extends Error implements AppError {
  constructor(
    message: string,
    public status = 0,
    public errors?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface AuthStore {
  get(): Promise<Session | undefined>;
  set(session: Session): Promise<void>;
  clear(): Promise<void>;
}
export class ApiClient {
  private refreshing?: Promise<string>;
  private generation = 0;
  constructor(
    private store: AuthStore,
    private transport: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  async logout() {
    this.generation++;
    await this.store.clear();
  }
  async login(username: string, password: string) {
    const epoch = ++this.generation;
    const response = await this.send(`${AUTH_BASE}login/`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    const result = await this.json<Session>(response);
    // The Powerly web app consumes raw JWT login data; some deployments wrap it.
    const session = result.data || (result as unknown as Session);
    if (!session?.access || !session.refresh || !session.user)
      throw new ApiError('The server returned an incomplete login response.');
    if (epoch !== this.generation) throw new ApiError('Sign-in was superseded. Please try again.');
    await this.store.set(session);
    return session.user;
  }
  async acceptGoogleSession(session: Session) {
    const epoch = ++this.generation;
    await this.store.clear();
    if (epoch !== this.generation)
      throw new ApiError('Sign-in was canceled. Please try again.', 401);
    await this.store.set(session);
    return session.user;
  }
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.transport(url, {
        ...init,
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Version': VERSION,
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError('Unable to reach Powerly. Check your connection and try again.');
    }
  }
  private async json<T>(response: Response): Promise<Envelope<T>> {
    if (response.headers.get('content-type')?.includes('text/html'))
      throw new ApiError(
        'The server returned a web page instead of API data. Powerly’s API routing needs attention. Please try again later.',
        response.status,
      );
    let body: Envelope<T>;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        response.ok
          ? 'The server returned an unreadable response.'
          : `Request failed (${response.status}). Please try again.`,
        response.status,
      );
    }
    if (!body || typeof body !== 'object')
      throw new ApiError('The server returned an incomplete API response. Please try again.');
    if (!response.ok || body.success === false)
      throw new ApiError(
        body.message || `Request failed (${response.status}).`,
        response.status,
        body.errors,
      );
    return body;
  }
  private async refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const epoch = this.generation;
    this.refreshing = (async () => {
      const session = await this.store.get();
      if (!session?.refresh) throw new ApiError('Please sign in to continue.', 401);
      const response = await this.send(`${AUTH_BASE}token/refresh/`, {
        method: 'POST',
        body: JSON.stringify({ refresh: session.refresh }),
      });
      if (response.status === 401 || response.status === 400 || response.status === 403) {
        if (epoch === this.generation) await this.logout();
        throw new ApiError('Your session expired. Please sign in again.', 401);
      }
      const result = await this.json<{ access: string; refresh?: string }>(response);
      const tokens = (result.data || result) as { access?: string; refresh?: string };
      if (!tokens.access) throw new ApiError('The server did not return a new access token.');
      if (epoch !== this.generation)
        throw new ApiError('Your session changed. Please sign in again.', 401);
      await this.store.set({
        ...session,
        access: tokens.access,
        refresh: tokens.refresh || session.refresh,
      });
      return tokens.access;
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
    binary = false,
  ): Promise<T> {
    // Only documented extractor routes can cross the worker boundary.
    if (
      !/^(?:google\/connection\/|google-connection\/authorize\/|gmail\/labels\/|tasks\/(?:\d+\/(?:restore\/|run\/|preview\/|duplicate\/|schedule\/)?)?|jobs\/(?:stats\/|\d+\/(?:restore\/|export\/)?)?)(?:\?[^#]*)?$/.test(
        path,
      )
    )
      throw new ApiError('Unsupported API route.');
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method))
      throw new ApiError('Unsupported API method.');
    const session = await this.store.get();
    if (!session) throw new ApiError('Please sign in to continue.', 401);
    const epoch = this.generation;
    const init = (access: string): RequestInit => ({
      method,
      headers: { ...headers, Authorization: `Bearer ${access}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let response = await this.send(API_BASE + path, init(session.access));
    if (response.status === 401) {
      const latest = await this.store.get();
      const access =
        latest && latest.access !== session.access ? latest.access : await this.refresh();
      response = await this.send(API_BASE + path, init(access));
    }
    if (epoch !== this.generation)
      throw new ApiError('Your session changed. Please sign in again.', 401);
    if (binary && response.ok && !/json|html/.test(response.headers.get('content-type') || '')) {
      return {
        bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        contentType: response.headers.get('content-type'),
      } as T;
    }
    const result = await this.json<unknown>(response);
    if (result.success !== true || !('data' in result))
      throw new ApiError('The server returned an incomplete API response. Please try again.');
    if (binary)
      throw new ApiError(
        'The server returned export metadata instead of a file. Open the Google Sheet to export it.',
      );
    return result as T;
  }
}
