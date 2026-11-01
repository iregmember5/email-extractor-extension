import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useResource } from '../hooks';
import { api, download } from '../rpc';
import { dateTime } from '../task';
import type { AppError, Envelope, Job, Preview, Stats, Task } from '../types';
import { Badge, Confirm, Empty, ErrorBox, External, Pager, Spinner } from './ui';
export function JobCounters({ job }: { job: Job }) {
  return (
    <div className="job-counters">
      {[
        ['Scanned', job.total_messages_scanned],
        ['Found', job.total_emails_found],
        ['New emails', job.total_new_emails],
      ].map(([label, value]) => (
        <div key={label}>
          <strong>{Number(value || 0).toLocaleString()}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
export function ActiveJob({ job }: { job: Job }) {
  return (
    <div className="active-job">
      <div className="section-heading">
        <span className="eyebrow">
          <span className="live-dot" />
          LIVE EXTRACTION
        </span>
        <Badge status={job.status} />
      </div>
      <h3>{job.task_name || `Task #${job.task}`}</h3>
      <div className="indeterminate" role="progressbar" aria-label="Extraction in progress">
        <span />
      </div>
      <JobCounters job={job} />
      <p className="field-hint">Your extraction continues when you close this panel.</p>
    </div>
  );
}
interface ListProps {
  revision: number;
  onRun: (task: Pick<Task, 'id' | 'task_name'>) => Promise<void>;
  busy: boolean;
  canRun: boolean;
  changed: () => void;
}
export function TaskList({
  revision,
  onRun,
  busy,
  canRun,
  changed,
  onEdit,
  onHistory,
  onNew,
}: ListProps & {
  onEdit: (task: Task) => void;
  onHistory: (task: Task) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [deleted, setDeleted] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [remove, setRemove] = useState<Task | null>(null);
  const [preview, setPreview] = useState<{ name: string; data: Preview } | null>(null);
  const resource = useResource<Task[]>(
    `tasks/?page=${page}&page_size=10&search=${encodeURIComponent(query)}&ordering=-created_at&include_deleted=${deleted}`,
    revision,
  );
  async function action(work: () => Promise<void>) {
    setLocalBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e as AppError);
    } finally {
      setLocalBusy(false);
    }
  }
  const disabled = busy || localBusy;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LESS COPYING. MORE DOING.</span>
          <h1>
            Your tasks<span className="title-dot">.</span>
          </h1>
          <p>From your inbox to a little more organized.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          + New task
        </button>
      </div>
      <div className="list-toolbar">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search);
          }}
        >
          <Search size={16} />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) {
                setQuery('');
                setPage(1);
              }
            }}
          />
          <button type="submit" aria-label="Search" className="icon-button">
            <ArrowUpRight size={16} />
          </button>
        </form>
        <label className="check-label">
          <input
            type="checkbox"
            checked={deleted}
            onChange={(e) => {
              setDeleted(e.target.checked);
              setPage(1);
            }}
          />
          Show deleted
        </label>
      </div>
      <ErrorBox error={error} dismiss={() => setError(null)} />
      <ErrorBox error={resource.error} retry={resource.reload} />
      {preview && (
        <div className="preview-result" role="status">
          <div>
            <Eye size={18} />
            <strong>{preview.data.estimated_count.toLocaleString()} emails match</strong>
            <button
              className="icon-button"
              aria-label="Close preview"
              onClick={() => setPreview(null)}
            >
              ×
            </button>
          </div>
          <span>{preview.name}</span>
          <code>{preview.data.query}</code>
          {preview.data.hints?.map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
      )}
      {resource.loading ? (
        <div className="loading-state">
          <Spinner />
          Loading your tasks…
        </div>
      ) : resource.data?.data.length === 0 ? (
        <Empty
          title={query ? 'No matching tasks' : 'A clearer inbox starts here'}
          action={
            !query && (
              <button className="button primary" onClick={onNew}>
                Create your first task
                <ArrowUpRight size={16} />
              </button>
            )
          }
        >
          {query
            ? 'Try a different name or clear your search.'
            : 'Create an extraction task to turn emails into organized, useful data.'}
        </Empty>
      ) : (
        <div className="card-list">
          {resource.data?.data.map((task) => (
            <article className={`task-card ${task.is_deleted ? 'is-deleted' : ''}`} key={task.id}>
              <div className="task-top">
                <span className="task-icon">
                  <FileSpreadsheet size={21} />
                </span>
                <Badge status={task.is_deleted ? 'deleted' : task.status || 'pending'} />
              </div>
              <h3>{task.task_name}</h3>
              <div className="chips">
                {[...(task.labels || []), ...(task.categories || [])].map((label) => (
                  <span className="label-chip" key={label}>
                    {label.replace('CATEGORY_', '').replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
              <div className="task-meta">
                <span>
                  <span className="mode-dot" />
                  {task.write_mode || 'auto'} mode
                </span>
                <span>Last run: {dateTime(task.last_run_at)}</span>
              </div>
              {task.schedule_enabled && (
                <p className="schedule-meta">
                  <CalendarClock size={13} />
                  {task.schedule_cadence} · Next: {dateTime(task.next_run_at)}
                </p>
              )}
              <div className="card-actions">
                {task.is_deleted ? (
                  <button
                    className="button secondary small"
                    disabled={disabled}
                    onClick={() =>
                      void action(async () => {
                        await api(`tasks/${task.id}/restore/`, 'POST');
                        changed();
                      })
                    }
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                ) : (
                  <>
                    <button
                      className="button primary small"
                      disabled={disabled || !canRun}
                      onClick={() => void onRun(task)}
                    >
                      <Play size={13} />
                      Run task
                    </button>
                    <button
                      className="button secondary small"
                      disabled={disabled}
                      onClick={() => onEdit(task)}
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  </>
                )}
                <details className="action-menu">
                  <summary aria-label={`More actions for ${task.task_name}`}>
                    <MoreHorizontal size={18} />
                  </summary>
                  <div className="menu-content">
                    {!task.is_deleted && (
                      <>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void action(async () => {
                              const data = await api<Preview>(`tasks/${task.id}/preview/`, 'POST');
                              setPreview({ name: task.task_name, data: data.data });
                            })
                          }
                        >
                          <Eye size={14} />
                          Preview matches
                        </button>
                        <button
                          disabled={disabled}
                          onClick={() =>
                            void action(async () => {
                              const copy = await api<Task>(
                                `tasks/${task.id}/duplicate/`,
                                'POST',
                                {},
                              );
                              changed();
                              onEdit(copy.data);
                            })
                          }
                        >
                          <Copy size={14} />
                          Duplicate task
                        </button>
                      </>
                    )}
                    <button onClick={() => onHistory(task)}>
                      <History size={14} />
                      View run history
                    </button>
                    {!task.is_deleted && (
                      <button
                        className="danger-text"
                        disabled={disabled}
                        onClick={() => setRemove(task)}
                      >
                        <Trash2 size={14} />
                        Delete task
                      </button>
                    )}
                  </div>
                </details>
              </div>
              <External href={task.sheet_url || task.spreadsheet_url}>Open spreadsheet</External>
            </article>
          ))}
        </div>
      )}
      <Pager page={page} pagination={resource.data?.pagination} onChange={setPage} />
      {remove && (
        <Confirm
          title="Delete this task?"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api(`tasks/${remove.id}/`, 'DELETE');
            if (resource.data?.data.length === 1 && page > 1) setPage(page - 1);
            changed();
          }}
        >
          “{remove.task_name}” and its runs will move to deleted items. You can restore the task
          later. An active extraction may continue.
        </Confirm>
      )}
    </>
  );
}
export function HistoryList({
  revision,
  onRun,
  busy,
  canRun,
  changed,
  task,
  clearTask,
}: ListProps & { task: Task | null; clearTask: () => void }) {
  const [page, setPage] = useState(1);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [remove, setRemove] = useState<Job | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const resource = useJobHistory(page, deleted, task?.id, revision);
  useEffect(() => {
    setPage(1);
  }, [task?.id]);
  async function mutate(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      changed();
    } catch (e) {
      setError(e as AppError);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY RUN, IN ONE PLACE</span>
          <h1>
            Run history<span className="title-dot">.</span>
          </h1>
          <p>Keep track of what your inbox has delivered.</p>
        </div>
      </div>
      <div className="list-toolbar">
        <span className="muted">Latest extractions</span>
        <label className="check-label">
          <input
            type="checkbox"
            checked={deleted}
            onChange={(e) => {
              setDeleted(e.target.checked);
              setPage(1);
            }}
          />
          Show deleted
        </label>
      </div>
      {task && (
        <div className="notice info">
          Runs for “{task.task_name}”
          <button className="text-button" onClick={clearTask}>
            Show all runs
          </button>
        </div>
      )}
      <ErrorBox error={error} dismiss={() => setError(null)} />
      <ErrorBox error={resource.error} retry={resource.reload} />
      {resource.loading ? (
        <div className="loading-state">
          <Spinner />
          Loading run history…
        </div>
      ) : resource.data?.data.length === 0 ? (
        <Empty title="Your story starts with a run">
          Completed, failed, and active extractions will appear here.
        </Empty>
      ) : (
        <div className="card-list">
          {resource.data?.data.map((job) => (
            <article className={`history-card ${job.is_deleted ? 'is-deleted' : ''}`} key={job.id}>
              <div className="section-heading">
                <span className="run-id">RUN #{job.id}</span>
                <Badge status={job.is_deleted ? 'deleted' : job.status} />
              </div>
              <h3>{job.task_name || `Task #${job.task}`}</h3>
              <p className="muted small-text">
                {dateTime(job.created_at)}
                {job.completed_at && ` · Finished ${dateTime(job.completed_at)}`}
              </p>
              <JobCounters job={job} />
              {job.error_message && (
                <div className="notice error small-text">{job.error_message}</div>
              )}
              <div className="card-actions">
                {job.is_deleted ? (
                  <button
                    className="button secondary small"
                    onClick={() => void mutate(() => api(`jobs/${job.id}/restore/`, 'POST'))}
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                ) : (
                  <>
                    <External href={job.sheet_url} className="button secondary small">
                      <FileSpreadsheet size={14} />
                      Open sheet
                    </External>
                    {job.status === 'failed' && (
                      <button
                        className="button primary small"
                        disabled={busy || !canRun}
                        onClick={() => void onRun({ id: job.task, task_name: job.task_name })}
                      >
                        <RotateCcw size={14} />
                        Run again
                      </button>
                    )}
                    {job.status === 'completed' && job.sheet_url && (
                      <details className="action-menu export-menu">
                        <summary>
                          <Download size={14} />
                          {exporting === job.id ? 'Downloading…' : 'Download'}
                        </summary>
                        <div className="menu-content">
                          {(['csv', 'xlsx'] as const).map((format) => (
                            <button
                              key={format}
                              disabled={exporting !== null}
                              onClick={async () => {
                                setExporting(job.id);
                                setError(null);
                                try {
                                  await download(job.id, format);
                                } catch (e) {
                                  setError(e as AppError);
                                } finally {
                                  setExporting(null);
                                }
                              }}
                            >
                              {format === 'csv' ? 'CSV file' : 'Excel workbook (.xlsx)'}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                    <button
                      className="icon-button push-right"
                      aria-label={`Delete run ${job.id}`}
                      onClick={() => setRemove(job)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <Pager page={page} pagination={resource.data?.pagination} onChange={setPage} />
      {remove && (
        <Confirm
          title="Delete this run?"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api(`jobs/${remove.id}/`, 'DELETE');
            if (resource.data?.data.length === 1 && page > 1) setPage(page - 1);
            changed();
          }}
        >
          Run #{remove.id} will be hidden from history. You can restore it with “Show deleted”.
        </Confirm>
      )}
    </>
  );
}
export function Statistics({ revision }: { revision: number }) {
  const resource = useResource<Stats>('jobs/stats/', revision);
  const stats = resource.data?.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR INBOX, BY THE NUMBERS</span>
          <h1>
            A little perspective<span className="title-dot">.</span>
          </h1>
          <p>See the work happening behind the scenes.</p>
        </div>
      </div>
      <ErrorBox error={resource.error} retry={resource.reload} />
      {resource.loading ? (
        <div className="loading-state">
          <Spinner />
          Loading statistics…
        </div>
      ) : (
        stats && (
          <>
            <div className="stats-hero">
              <span className="eyebrow">EMAILS FOUND</span>
              <strong>{stats.total_emails_found.toLocaleString()}</strong>
              <p>Useful data, brought out of your inbox.</p>
              <div>
                <span>{stats.total_jobs.toLocaleString()} total runs</span>
                <span>{stats.success_rate.toFixed(1)}% success rate</span>
              </div>
            </div>
            <div className="stats-grid">
              {[
                ['Messages scanned', stats.total_messages_scanned],
                ['New emails', stats.total_new_emails],
                ['Average per run', stats.avg_emails_per_run],
                ['Completed runs', stats.completed],
              ].map(([label, count]) => (
                <div className="stat-card" key={label}>
                  <span>{label}</span>
                  <strong>
                    {Number(count).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </strong>
                </div>
              ))}
            </div>
            <div className="status-breakdown">
              {[
                ['Completed', stats.completed, 'completed'],
                ['Failed', stats.failed, 'failed'],
                ['Running', stats.running, 'running'],
                ['Pending', stats.pending, 'pending'],
              ].map(([label, count, status]) => (
                <div key={label}>
                  <Badge status={status as Job['status']} />
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            <div className="section-heading recent-heading">
              <h3>Recent runs</h3>
              <span className="muted">Last 5</span>
            </div>
            <div className="recent-runs">
              {stats.recent_runs.slice(0, 5).map((job) => (
                <div key={job.id}>
                  <span>
                    <strong>{job.task_name || `Run #${job.id}`}</strong>
                    <small>
                      {dateTime(job.created_at)} · {(job.total_emails_found || 0).toLocaleString()}{' '}
                      found
                    </small>
                  </span>
                  <Badge status={job.status} />
                </div>
              ))}
              {!stats.recent_runs.length && (
                <p className="muted">No runs yet. Your first extraction will appear here.</p>
              )}
            </div>
          </>
        )
      )}
    </>
  );
}

function useJobHistory(
  page: number,
  deleted: boolean,
  taskId: number | undefined,
  revision: number,
) {
  const [data, setData] = useState<Envelope<Job[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError(null);
    setData(null);
    async function load() {
      try {
        const result = await api<Job[]>(
          `jobs/?page=${taskId ? 1 : page}&page_size=10&include_deleted=${deleted}`,
        );
        if (taskId) {
          const all = [...result.data];
          const totalPages = result.pagination?.total_pages || 1;
          for (let cursor = 2; cursor <= totalPages; cursor++) {
            if (stopped) return;
            const next = await api<Job[]>(
              `jobs/?page=${cursor}&page_size=10&include_deleted=${deleted}`,
            );
            all.push(...next.data);
          }
          const matches = all.filter((job) => job.task === taskId);
          result.data = matches.slice((page - 1) * 10, page * 10);
          result.pagination = {
            count: matches.length,
            current_page: page,
            page_size: 10,
            total_pages: Math.ceil(matches.length / 10),
            next: null,
            previous: null,
          };
        }
        if (!stopped) setData(result);
      } catch (e) {
        if (!stopped) {
          setError(e as AppError);
          window.dispatchEvent(new Event('session-check'));
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, [page, deleted, taskId, revision, tick]);
  return { data, error, loading, reload: () => setTick((v) => v + 1) };
}
