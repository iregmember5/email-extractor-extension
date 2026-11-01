import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  History,
  LayoutGrid,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
  BarChart3,
} from 'lucide-react';
import { api, rpc } from './rpc';
import { VERSION, WEB } from './config';
import type {
  AppError,
  Connection,
  Job,
  SessionView,
  Task,
  TaskInput,
  User,
  GoogleLoginView,
} from './types';
import { ActiveJob, HistoryList, JobCounters, Statistics, TaskList } from './components/Lists';
import { TaskForm } from './components/TaskForm';
import { Badge, Brand, ErrorBox, External, Spinner } from './components/ui';
function Login({
  onLogin,
  signInSite,
  pendingLogin,
}: {
  onLogin: (user: User) => void;
  signInSite?: string;
  pendingLogin?: GoogleLoginView;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState(signInSite || 'https://mypowerly.com');
  const [googlePending, setGooglePending] = useState<GoogleLoginView | undefined>(pendingLogin);
  useEffect(() => {
    if (!googlePending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function pollLogin() {
      try {
        const session = await rpc<SessionView>({ type: 'SESSION' });
        if (stopped) return;
        if (session.user) {
          onLogin(session.user);
          return;
        }
        if (!session.googleLogin || googlePending!.expiresAt <= Date.now()) {
          setGooglePending(undefined);
          setError({ message: 'Google sign-in was canceled or timed out. Please try again.' });
          void rpc({ type: 'CANCEL_GOOGLE_LOGIN' }).catch(() => {});
          return;
        }
      } catch (e) {
        if (!stopped) setError(e as AppError);
      }
      if (!stopped) timer = setTimeout(() => void pollLogin(), 2000);
    }
    void pollLogin();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [googlePending, onLogin]);
  async function googleSignIn() {
    setError(null);
    setBusy(true);
    try {
      setGooglePending(await rpc<GoogleLoginView>({ type: 'GOOGLE_LOGIN', site }));
    } catch (e) {
      setError(e as AppError);
    } finally {
      setBusy(false);
    }
  }
  async function cancelGoogle() {
    try {
      await rpc({ type: 'CANCEL_GOOGLE_LOGIN' });
      setGooglePending(undefined);
    } catch (e) {
      setError(e as AppError);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLogin(await rpc<User>({ type: 'LOGIN', username: email.trim(), password }));
    } catch (e) {
      setError(e as AppError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-top">
        <Brand />
        <span className="product-tag">v{VERSION} · CHROME</span>
      </div>
      <div className="login-art" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="art-mail">
          <Mail size={36} />
          <span className="art-count">+1</span>
        </div>
        <div className="art-sheet">
          <span />
          <span />
          <span />
          <span />
          <Check size={18} />
        </div>
        <span className="art-spark">
          <Sparkles size={20} />
        </span>
        <span className="art-caption">INBOX → INSIGHT</span>
      </div>
      <div className="login-intro">
        <span className="eyebrow">MAKE ROOM FOR WHAT MATTERS</span>
        <h1>
          Your inbox.
          <br />A little more powerful.
        </h1>
        <p>
          Turn emails into organized spreadsheets.
          <br />
          All from a corner of your browser.
        </p>
      </div>
      <ErrorBox error={error} dismiss={() => setError(null)} />
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span className="field-label">Email address</span>
          <input
            autoComplete="username"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            disabled={busy || !!googlePending}
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <span className="password-input">
            <input
              aria-label="Password"
              autoComplete="current-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              disabled={busy || !!googlePending}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <div className="forgot-link">
          <External href={WEB.forgot}>Forgot password?</External>
        </div>
        <button className="button primary login-submit" disabled={busy || !!googlePending}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              Log in
              <ArrowRight size={17} />
            </>
          )}
        </button>
      </form>
      <div className="google-login-section">
        <label className="field">
          <span className="field-label">Powerly site</span>
          <input
            type="url"
            aria-label="Powerly site"
            value={site}
            disabled={busy || !!googlePending}
            onChange={(event) => setSite(event.target.value)}
            placeholder="https://your-team.mypowerly.com"
          />
          <span className="field-hint">
            Use your white-label site. For local development: http://localhost:5173
          </span>
        </label>
        <button
          type="button"
          className="button google-sign-in"
          disabled={busy || !!googlePending}
          onClick={() => void googleSignIn()}
        >
          {googlePending ? (
            <Spinner />
          ) : (
            <span className="google-g" aria-hidden="true">
              G
            </span>
          )}
          {googlePending ? 'Waiting for Google sign-in…' : 'Continue with Google'}
          <ArrowRight size={15} />
        </button>
        {googlePending && (
          <div className="google-login-waiting" role="status">
            <p>
              Complete Google sign-in at {googlePending.origin}, then approve connecting Email
              Extractor. You can close and reopen this panel.
            </p>
            <button type="button" className="text-button" onClick={() => void cancelGoogle()}>
              Cancel sign-in
            </button>
          </div>
        )}
      </div>
      <p className="signup-prompt">
        New to Powerly? <External href={WEB.signup}>Create an account</External>
      </p>
      <div className="login-trust">
        <ShieldCheck size={14} />
        Your Gmail data is processed securely by Powerly.
      </div>
    </div>
  );
}
type View = 'tasks' | 'history' | 'stats' | 'editor';
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<AppError | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<View>('tasks');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [outcome, setOutcome] = useState<Job | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthStarted, setOauthStarted] = useState<number | undefined>();
  const [revision, setRevision] = useState(0);
  const [editTask, setEditTask] = useState<Task | undefined>();
  const [draft, setDraft] = useState<TaskInput | undefined>();
  const [signInSite, setSignInSite] = useState<string>();
  const [pendingLogin, setPendingLogin] = useState<GoogleLoginView>();
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const lastJobStates = useRef('');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const bootstrap = useCallback(async () => {
    setBooting(true);
    setBootstrapError(null);
    try {
      const session = await rpc<SessionView>({ type: 'SESSION' });
      setUser(session.user);
      setJobs(session.jobs);
      setOauthStarted(
        session.oauthStarted && Date.now() - session.oauthStarted < 120_000
          ? session.oauthStarted
          : undefined,
      );
      setDraft(session.draft);
      setSignInSite(session.signInSite);
      setPendingLogin(session.googleLogin);
    } catch (e) {
      setBootstrapError(e as AppError);
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    const checkSession = () => {
      void rpc<SessionView>({ type: 'SESSION' })
        .then((session) => {
          if (!session.user) {
            setUser(null);
            setConnection(null);
            setJobs([]);
            setOutcome(null);
            setOauthStarted(undefined);
            setHistoryTask(null);
            setToast('');
            lastJobStates.current = '';
            setDraft(undefined);
            setEditTask(undefined);
            setError(null);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('session-check', checkSession);
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('session-check', checkSession);
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const response = await api<Connection>('google/connection/');
      setConnection(response.data);
      return response.data;
    } catch (e) {
      setError(e as AppError);
      window.dispatchEvent(new Event('session-check'));
      return null;
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (user) void checkConnection();
  }, [user, checkConnection]);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const updated = await rpc<Job[]>({ type: 'POLL' });
        if (stopped) return;
        const state = updated.map((job) => `${job.id}:${job.status}`).join(',');
        if (lastJobStates.current && state !== lastJobStates.current) refresh();
        lastJobStates.current = state;
        setJobs((previous) => {
          const finished = updated.find(
            (job) =>
              ['completed', 'failed'].includes(job.status) &&
              previous.some(
                (old) => old.id === job.id && ['pending', 'running'].includes(old.status),
              ),
          );
          if (finished) setOutcome(finished);
          return updated;
        });
      } catch (e) {
        if (!stopped) {
          setError(e as AppError);
          window.dispatchEvent(new Event('session-check'));
        }
      } finally {
        if (!stopped) timer = setTimeout(() => void tick(), 2000);
      }
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [user, refresh]);
  useEffect(() => {
    if (!oauthStarted || !user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (Date.now() - oauthStarted! > 120_000) {
        setOauthStarted(undefined);
        setError({
          message: 'Google connection timed out. You can start again when you are ready.',
        });
        return;
      }
      try {
        const result = await api<Connection>('google/connection/');
        if (stopped) return;
        if (
          result.data.connected &&
          !result.data.needs_reauth &&
          !result.data.needs_scope_upgrade
        ) {
          setConnection(result.data);
          setOauthStarted(undefined);
          setToast('Google account connected. You’re ready to extract.');
          refresh();
          return;
        }
      } catch (e) {
        if (!stopped) setError(e as AppError);
      }
      if (!stopped) timer = setTimeout(() => void tick(), 2000);
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [oauthStarted, user, refresh]);
  async function connect() {
    if (busy || oauthStarted) return;
    setBusy(true);
    setError(null);
    try {
      setOauthStarted(await rpc<number>({ type: 'CONNECT' }));
    } catch (e) {
      setError(e as AppError);
    } finally {
      setBusy(false);
    }
  }
  async function run(task: Pick<Task, 'id' | 'task_name'>) {
    setBusy(true);
    setError(null);
    try {
      setOutcome(null);
      const job = await rpc<Job>({ type: 'RUN', id: task.id });
      setJobs((previous) => [
        ...previous.filter((j) => j.id !== job.id),
        { ...job, task_name: job.task_name || task.task_name },
      ]);
      setToast('Extraction started. You can keep browsing.');
      refresh();
    } catch (e) {
      setError(e as AppError);
      window.dispatchEvent(new Event('session-check'));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await rpc({ type: 'LOGOUT' });
      setUser(null);
      setPendingLogin(undefined);
      setJobs([]);
      setOutcome(null);
      setHistoryTask(null);
      setToast('');
      setConnection(null);
      setOauthStarted(undefined);
      setDraft(undefined);
      setEditTask(undefined);
      setError(null);
      setView('tasks');
      lastJobStates.current = '';
    } catch (e) {
      setError(e as AppError);
    } finally {
      setBusy(false);
    }
  }
  const active = jobs.filter((job) => job.status === 'pending' || job.status === 'running');
  const ready =
    !!connection?.connected && !connection.needs_reauth && !connection.needs_scope_upgrade;
  const canRun = ready && active.length === 0 && online;
  if (booting)
    return (
      <div className="boot-screen">
        <Brand />
        <Spinner />
        <span>Opening your workspace…</span>
      </div>
    );
  if (bootstrapError)
    return (
      <div className="setup-screen">
        <Brand />
        <span className="empty-icon">
          <CircleHelp size={28} />
        </span>
        <h1>
          Your inbox workspace,
          <br />
          right beside you.
        </h1>
        <p>This app runs as a Chrome side panel extension.</p>
        <ErrorBox error={bootstrapError} retry={() => void bootstrap()} />
        <ol>
          <li>
            Run <code>npm install</code> and <code>npm run build</code>.
          </li>
          <li>
            Open <code>chrome://extensions</code> and enable Developer mode.
          </li>
          <li>
            Choose “Load unpacked” and select the <code>dist</code> folder.
          </li>
          <li>Click the extension icon to open the side panel.</li>
        </ol>
      </div>
    );
  if (!user)
    return (
      <Login
        signInSite={signInSite}
        pendingLogin={pendingLogin}
        onLogin={(next) => {
          setUser(next);
          setPendingLogin(undefined);
          setView('tasks');
          setError(null);
        }}
      />
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <details className="account-menu">
          <summary aria-label="Account menu">
            <span className="avatar">{(user.first_name || user.email)[0].toUpperCase()}</span>
            <ChevronDown size={13} />
          </summary>
          <div className="menu-content">
            <strong>{user.get_display_name || user.first_name || 'Your account'}</strong>
            <span>{user.email}</span>
            <button disabled={busy} onClick={() => void logout()}>
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </details>
      </header>
      <div className="connection-strip">
        <span className={`connection-dot ${ready ? 'connected' : ''}`} />
        <span>
          {ready
            ? connection.google_email || 'Google connected'
            : checking
              ? 'Checking Google connection…'
              : 'Google account not connected'}
        </span>
        <button
          className="icon-button"
          aria-label="Refresh connection"
          disabled={checking}
          onClick={() => void checkConnection()}
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
        </button>
      </div>
      <nav className="main-nav" aria-label="Main navigation">
        {[
          ['tasks', LayoutGrid, 'Tasks'],
          ['history', History, 'History'],
          ['stats', BarChart3, 'Statistics'],
        ].map(([key, Icon, label]) => {
          const NavIcon = Icon as typeof LayoutGrid;
          return (
            <button
              key={key as string}
              aria-current={
                view === key || (key === 'tasks' && view === 'editor') ? 'page' : undefined
              }
              onClick={() => {
                setView(key as View);
                setError(null);
              }}
            >
              <NavIcon size={16} />
              {label as string}
            </button>
          );
        })}
        <button className="nav-refresh" aria-label="Refresh current view" onClick={refresh}>
          <RefreshCw size={15} />
        </button>
      </nav>
      <main>
        {!online && (
          <div className="notice warning">
            <WifiOff size={16} />
            You’re offline. Reconnect to manage your extractions.
          </div>
        )}
        <ErrorBox error={error} dismiss={() => setError(null)} reconnect={() => void connect()} />
        {!ready && !checking && (
          <div className="connect-card">
            <span className="google-g">G</span>
            <h3>
              {connection?.needs_reauth
                ? 'Reconnect your Google account'
                : connection?.needs_scope_upgrade
                  ? 'A little more permission needed'
                  : 'Connect your inbox'}
            </h3>
            <p>
              {connection?.needs_scope_upgrade
                ? 'Reconnect to grant the permissions required for your extraction.'
                : 'Link Google to extract emails into Sheets and save attachments to Drive.'}
            </p>
            {connection?.missing_scopes?.length ? (
              <p className="field-hint">Required: {connection.missing_scopes.join(', ')}</p>
            ) : null}
            <button
              className="button primary"
              disabled={busy || !!oauthStarted}
              onClick={() => void connect()}
            >
              {oauthStarted ? (
                <>
                  <Spinner />
                  Waiting for Google…
                </>
              ) : (
                <>
                  Connect Google
                  <ArrowRight size={16} />
                </>
              )}
            </button>
            {oauthStarted && (
              <p className="field-hint">
                Complete authorization in the new tab. This panel checks for up to two minutes.
              </p>
            )}
          </div>
        )}
        {active.map((job) => (
          <ActiveJob key={job.id} job={job} />
        ))}
        {outcome && (
          <div className="outcome-card" role="status">
            <div className="section-heading">
              <Badge status={outcome.status} />
              <button
                className="icon-button"
                aria-label="Dismiss run result"
                onClick={() => setOutcome(null)}
              >
                ×
              </button>
            </div>
            <h3>{outcome.task_name}</h3>
            <JobCounters job={outcome} />
            {outcome.status === 'completed' ? (
              <External href={outcome.sheet_url} className="button primary small">
                Open sheet
              </External>
            ) : (
              <>
                <p className="field-message">
                  {outcome.error_message || 'Extraction failed. Please try again.'}
                </p>
                <button
                  className="button primary small"
                  disabled={busy || !canRun}
                  onClick={() => void run({ id: outcome.task, task_name: outcome.task_name })}
                >
                  Run again
                </button>
              </>
            )}
          </div>
        )}
        {view === 'tasks' && (
          <TaskList
            revision={revision}
            onRun={run}
            busy={busy}
            canRun={canRun}
            changed={refresh}
            onNew={() => {
              setEditTask(undefined);
              setView('editor');
            }}
            onEdit={(task) => {
              setEditTask(task);
              setView('editor');
            }}
            onHistory={(task) => {
              setHistoryTask(task);
              setView('history');
            }}
          />
        )}
        {view === 'history' && (
          <HistoryList
            revision={revision}
            onRun={run}
            busy={busy}
            canRun={canRun}
            changed={refresh}
            task={historyTask}
            clearTask={() => setHistoryTask(null)}
          />
        )}
        {view === 'stats' && <Statistics revision={revision} />}
        {view === 'editor' && (
          <TaskForm
            key={editTask?.id || 'new'}
            initial={editTask}
            draft={draft}
            onClose={() => {
              setView('tasks');
              void rpc<SessionView>({ type: 'SESSION' })
                .then((s) => setDraft(s.draft))
                .catch((e) => setError(e as AppError));
            }}
            onSaved={(_, stay) => {
              refresh();
              setDraft(undefined);
              if (!stay) {
                setView('tasks');
                setToast('Task saved. Ready when you are.');
              }
            }}
          />
        )}
      </main>
      <footer className="app-footer">
        <ShieldCheck size={12} />
        <span>Powered by Powerly</span>
        <span className="footer-version">v{VERSION}</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
