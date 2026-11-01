import { ApiClient, ApiError } from './api';
import { WEB } from '../config';
import { safeUrl } from '../task';
import {
  GOOGLE_LOGIN_LIFETIME,
  signInOrigin,
  validateGoogleHandoff,
  type PendingGoogleLogin,
} from './google-login';
import type {
  Envelope,
  Job,
  RequestMessage,
  Session,
  SessionView,
  TaskInput,
  Connection,
} from '../types';
const keys: (keyof Stored)[] = ['session', 'activeJobs', 'runKeys', 'oauthStarted', 'draft'];
interface Stored {
  session?: Session;
  activeJobs?: Job[];
  runKeys?: Record<string, string>;
  oauthStarted?: number;
  draft?: TaskInput;
}
let accountEpoch = 0;
const authStore = {
  async get(): Promise<Session | undefined> {
    return (await chrome.storage.local.get<{ session?: Session }>('session')).session;
  },
  async set(session: Session) {
    await chrome.storage.local.set({ session });
  },
  async clear() {
    accountEpoch++;
    await chrome.storage.local.remove(keys);
    await chrome.storage.session.remove('googleLogin');
  },
};
const api = new ApiClient(authStore);
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let polling: Promise<Job[]> | undefined;
let runLock = false;
let discoveredAt = 0;
let jobWrites = Promise.resolve();
function updateJobs(change: (jobs: Job[]) => Job[]): Promise<void> {
  const epoch = accountEpoch;
  const work = jobWrites.then(async () => {
    if (!(await authStore.get()) || epoch !== accountEpoch) return;
    const jobs = await activeJobs();
    if (epoch === accountEpoch)
      await chrome.storage.local.set({ activeJobs: change(jobs).slice(-10) });
  });
  jobWrites = work.catch(() => {});
  return work;
}
async function activeJobs(): Promise<Job[]> {
  return (await chrome.storage.local.get<{ activeJobs?: Job[] }>('activeJobs')).activeJobs || [];
}
async function track(job: Job) {
  await updateJobs((jobs) => [...jobs.filter((j) => j.id !== job.id), job]);
}

async function poll(): Promise<Job[]> {
  if (polling) return polling;
  polling = (async () => {
    const cached = await activeJobs();
    if (
      Date.now() - discoveredAt > 30_000 &&
      !cached.some((job) => ['pending', 'running'].includes(job.status))
    ) {
      let page = 1;
      let totalPages = 1;
      do {
        const result = await api.request<Envelope<Job[]>>(
          `jobs/?page=${page}&page_size=10&include_deleted=true`,
        );
        const active = result.data.filter(
          (job) => job.status === 'running' || job.status === 'pending',
        );
        for (const job of active) await track(job);
        if (active.length) break; // The backend allows one active extraction per user.
        totalPages = result.pagination?.total_pages || 1;
        page++;
      } while (page <= totalPages);
      discoveredAt = Date.now();
    }
    const jobs = await activeJobs();
    const updated = await Promise.all(
      jobs.map(async (job) => {
        if (job.status !== 'pending' && job.status !== 'running') return job;
        const response = await api.request<Envelope<Job>>(`jobs/${job.id}/`);
        return response.data;
      }),
    );
    await updateJobs((current) =>
      current.map((job) => updated.find((update) => update.id === job.id) || job),
    );
    return activeJobs();
  })().finally(() => {
    polling = undefined;
  });
  return polling;
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get('track-jobs')))
    await chrome.alarms.create('track-jobs', { periodInMinutes: 0.5 });
}
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void ensureAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'track-jobs')
    void (async () => {
      if (await authStore.get()) await poll();
    })().catch(() => {
      /* The panel displays actionable errors on its next refresh. */
    });
});
async function handle(message: RequestMessage): Promise<unknown> {
  await ready;
  const epoch = accountEpoch;
  if (
    !['SESSION', 'LOGIN', 'LOGOUT', 'GOOGLE_LOGIN', 'CANCEL_GOOGLE_LOGIN'].includes(message.type) &&
    (!(await authStore.get()) || epoch !== accountEpoch)
  )
    throw new ApiError('Please sign in to continue.', 401);
  switch (message.type) {
    case 'SESSION': {
      await ensureAlarm();
      const data = await chrome.storage.local.get<Stored>(keys);
      const preference = await chrome.storage.local.get<{ signInSite?: string }>('signInSite');
      let pending = (
        await chrome.storage.session.get<{ googleLogin?: PendingGoogleLogin }>('googleLogin')
      ).googleLogin;
      if (pending) {
        try {
          if (pending.expiresAt <= Date.now()) throw new Error('expired');
          await chrome.tabs.get(pending.tabId);
        } catch {
          await chrome.storage.session.remove('googleLogin');
          pending = undefined;
        }
      }
      return {
        signInSite: preference.signInSite,
        googleLogin: pending ? { origin: pending.origin, expiresAt: pending.expiresAt } : undefined,
        user: data.session?.user || null,
        jobs: data.activeJobs || [],
        oauthStarted: data.oauthStarted,
        draft: data.draft,
      } satisfies SessionView;
    }
    case 'GOOGLE_LOGIN': {
      const origin = signInOrigin(message.site);
      if (await authStore.get())
        throw new ApiError('Sign out before switching your Powerly account.');
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
      if (tab.id === undefined) throw new ApiError('Unable to open the Powerly sign-in page.');
      const pending: PendingGoogleLogin = {
        state,
        origin,
        tabId: tab.id,
        expiresAt: Date.now() + GOOGLE_LOGIN_LIFETIME,
      };
      await chrome.storage.local.set({ signInSite: origin });
      await chrome.storage.session.set({ googleLogin: pending });
      const url = new URL('/extension-auth.html', origin);
      url.searchParams.set('extension_id', chrome.runtime.id);
      url.searchParams.set('state', state);
      url.searchParams.set('expires_at', String(pending.expiresAt));
      try {
        await chrome.tabs.update(tab.id, { url: url.href });
      } catch {
        await chrome.storage.session.remove('googleLogin');
        throw new ApiError('Unable to open your Powerly site.');
      }
      return { origin, expiresAt: pending.expiresAt };
    }
    case 'CANCEL_GOOGLE_LOGIN':
      await chrome.storage.session.remove('googleLogin');
      return null;
    case 'LOGIN':
      await chrome.storage.session.remove('googleLogin');
      accountEpoch++;
      discoveredAt = 0;
      return api.login(message.username, message.password);
    case 'LOGOUT':
      await api.logout();
      discoveredAt = 0;
      return null;
    case 'API': {
      const result = await api.request<Envelope<unknown>>(
        message.path,
        message.method,
        message.body,
      );
      if (/^jobs\/\d+\/$/.test(message.path) && (!message.method || message.method === 'GET'))
        await track(result.data as Job);
      if (message.path === 'google/connection/') {
        const connection = result.data as Connection;
        if (connection.connected && !connection.needs_reauth && !connection.needs_scope_upgrade)
          await chrome.storage.local.remove('oauthStarted');
      }
      return result;
    }
    case 'DRAFT':
      if (message.value === null) await chrome.storage.local.remove('draft');
      else if (message.value) await chrome.storage.local.set({ draft: message.value });
      return (await chrome.storage.local.get('draft')).draft as TaskInput | undefined;
    case 'POLL':
      return poll();
    case 'CONNECT': {
      const result = await api.request<Envelope<{ authorization_url: string }>>(
        'google-connection/authorize/',
        'POST',
        { redirect_to: WEB.success },
      );
      const url = safeUrl(result.data.authorization_url, ['accounts.google.com']);
      if (!url) throw new ApiError('The server returned an invalid Google authorization URL.');
      await chrome.tabs.create({ url });
      await chrome.storage.local.set({ oauthStarted: Date.now() });
      return Date.now();
    }
    case 'RUN': {
      if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new ApiError('Invalid task.');
      if (runLock) throw new ApiError('An extraction is already being started. Please wait.', 409);
      runLock = true;
      try {
        const stored = await chrome.storage.local.get<Stored>('runKeys');
        const runKeys: Record<string, string> = stored.runKeys || {};
        const key = runKeys[message.id] || crypto.randomUUID();
        runKeys[message.id] = key;
        await chrome.storage.local.set({ runKeys });
        try {
          const result = await api.request<Envelope<Job>>(
            `tasks/${message.id}/run/`,
            'POST',
            { sheet_name: 'Extracted Emails' },
            { 'Idempotency-Key': key },
          );
          await track(result.data);
          delete runKeys[message.id];
          if (epoch === accountEpoch && (await authStore.get()))
            await chrome.storage.local.set({ runKeys });
          return result.data;
        } catch (error) {
          // Keep the same key after network/5xx errors: the server may have accepted the run.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            delete runKeys[message.id];
            if (epoch === accountEpoch && (await authStore.get()))
              await chrome.storage.local.set({ runKeys });
          }
          throw error;
        }
      } finally {
        runLock = false;
      }
    }
    case 'EXPORT': {
      if (!Number.isSafeInteger(message.id) || !['csv', 'xlsx'].includes(message.format))
        throw new ApiError('Invalid export request.');
      return api.request(
        `jobs/${message.id}/export/?format=${message.format}`,
        'GET',
        undefined,
        {},
        true,
      );
    }
    default:
      throw new ApiError('Unsupported extension request.');
  }
}
chrome.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))
    return false;
  handle(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error: unknown) => {
      const e =
        error instanceof Error ? error : new Error('Something went wrong. Please try again.');
      sendResponse({
        ok: false,
        error: {
          message: e.message,
          status: e instanceof ApiError ? e.status : 0,
          errors: e instanceof ApiError ? e.errors : null,
        },
      });
    });
  return true;
});
// Reconcile alarms every time the worker starts, including after suspension.
void ensureAlarm();

let claimingGoogleSession = false;
chrome.runtime.onMessageExternal.addListener((message: unknown, sender, respond) => {
  void (async () => {
    await ready;
    if (claimingGoogleSession) throw new ApiError('A Google sign-in is already being completed.');
    claimingGoogleSession = true;
    try {
      const { googleLogin } = await chrome.storage.session.get<{
        googleLogin?: PendingGoogleLogin;
      }>('googleLogin');
      const session = validateGoogleHandoff(message, sender, googleLogin);
      // Consume before persisting credentials so simultaneous/replayed messages cannot win.
      await chrome.storage.session.remove('googleLogin');
      await api.acceptGoogleSession(session);
      discoveredAt = 0;
      respond({ ok: true });
    } finally {
      claimingGoogleSession = false;
    }
  })().catch((error) =>
    respond({
      ok: false,
      error: {
        message: error instanceof Error ? error.message : 'Unable to complete Google sign-in.',
      },
    }),
  );
  return true;
});
