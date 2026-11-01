import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, Plus, Save, Trash2 } from 'lucide-react';
import { api, rpc, RemoteError } from '../rpc';
import { emptyTask, taskPayload, validateTask } from '../task';
import {
  OUTPUT_FIELDS,
  type AppError,
  type Labels,
  type Preview,
  type Task,
  type TaskInput,
} from '../types';
import { ErrorBox, Field, Spinner, Toggle } from './ui';
import { useResource } from '../hooks';
interface Props {
  initial?: Task;
  draft?: TaskInput;
  onClose: () => void;
  onSaved: (task: Task, stay: boolean) => void;
}
export function TaskForm({ initial, draft, onClose, onSaved }: Props) {
  const [form, setForm] = useState<TaskInput>(() => ({ ...emptyTask(), ...(initial || draft) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [savedId, setSavedId] = useState<number | undefined>(initial?.id);
  const [webhook, setWebhook] = useState(Boolean(form.webhook_url));
  const [section, setSection] = useState('filters');
  const dirty = useRef(false);
  const scheduleWasEnabled = useRef(Boolean(initial?.schedule_enabled));
  const [excludedDomainsText, setExcludedDomainsText] = useState(form.excluded_domains.join(', '));
  const labels = useResource<Labels>('gmail/labels/');
  useEffect(() => {
    if (initial || !dirty.current) return;
    void rpc({ type: 'DRAFT', value: form }).catch(() => {});
  }, [form, initial]);
  function set<K extends keyof TaskInput>(key: K, value: TaskInput[K]) {
    dirty.current = true;
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setPreview(null);
  }
  async function save(event?: FormEvent, isPreview = false) {
    event?.preventDefault();
    const validation = validateTask(form);
    setErrors(validation);
    setError(null);
    if (Object.keys(validation).length) {
      setError({ message: 'Please correct the highlighted fields before continuing.' });
      if (
        validation.task_name ||
        validation.labels ||
        validation.before_date ||
        validation.sender_email
      )
        setSection('filters');
      else if (Object.keys(validation).some((key) => key.startsWith('rule_'))) setSection('output');
      else setSection('automation');
      return;
    }
    setBusy(isPreview ? 'preview' : 'save');
    try {
      const result = await api<Task>(
        savedId ? `tasks/${savedId}/` : 'tasks/',
        savedId ? 'PATCH' : 'POST',
        taskPayload(form),
      );
      setSavedId(result.data.id);
      if (form.schedule_enabled) {
        const scheduled = await api<Partial<Task>>(`tasks/${result.data.id}/schedule/`, 'POST', {
          enabled: true,
          cadence: form.schedule_cadence,
          time: form.schedule_time,
          timezone: form.schedule_timezone,
        });
        result.data = { ...result.data, ...scheduled.data };
      } else if (scheduleWasEnabled.current)
        await api(`tasks/${result.data.id}/schedule/`, 'DELETE');
      scheduleWasEnabled.current = form.schedule_enabled;
      await rpc({ type: 'DRAFT', value: null });
      if (isPreview) {
        const resultPreview = await api<Preview>(`tasks/${result.data.id}/preview/`, 'POST');
        setPreview(resultPreview.data);
        onSaved(result.data, true);
      } else onSaved(result.data, false);
    } catch (e) {
      setError(e as AppError);
      if (e instanceof RemoteError && e.errors) {
        const fieldErrors = Object.fromEntries(
          Object.entries(e.errors).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.join(' ')
              : typeof value === 'string'
                ? value
                : JSON.stringify(value),
          ]),
        );
        setErrors(fieldErrors);
        if (fieldErrors.labels || fieldErrors.categories || fieldErrors.task_name)
          setSection('filters');
      }
    } finally {
      setBusy(null);
    }
  }
  const selectedColumns = form.sequence.filter((name) =>
    OUTPUT_FIELDS.some(([key, , column]) => column === name && form[key]),
  );
  const timezoneOptions = [
    ...new Set(['UTC', form.schedule_timezone, ...Intl.supportedValuesOf('timeZone')]),
  ];
  return (
    <form className="editor" noValidate onSubmit={(event) => void save(event)}>
      <button type="button" className="text-button back" onClick={onClose} disabled={!!busy}>
        <ArrowLeft size={15} />
        All tasks
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR EXTRACTION RECIPE</span>
          <h1>{initial ? 'Edit task' : 'Create a task'}</h1>
          <p>Choose your emails. We’ll handle the rest.</p>
        </div>
      </div>
      <ErrorBox error={error} dismiss={() => setError(null)} />
      <div
        className="section-tabs"
        role="tablist"
        aria-label="Task settings"
        onKeyDown={(event) => {
          const tabs = ['filters', 'output', 'automation'];
          const current = tabs.indexOf(section);
          const next =
            event.key === 'ArrowRight'
              ? (current + 1) % 3
              : event.key === 'ArrowLeft'
                ? (current + 2) % 3
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 2
                    : -1;
          if (next >= 0) {
            event.preventDefault();
            setSection(tabs[next]);
            document.getElementById(`tab-${tabs[next]}`)?.focus();
          }
        }}
      >
        {[
          ['filters', '01', 'Email filters'],
          ['output', '02', 'Output'],
          ['automation', '03', 'Automation'],
        ].map(([key, num, label]) => (
          <button
            type="button"
            key={key}
            role="tab"
            tabIndex={section === key ? 0 : -1}
            aria-selected={section === key}
            aria-controls={`section-${key}`}
            id={`tab-${key}`}
            onClick={() => setSection(key)}
          >
            <small>{num}</small>
            {label}
          </button>
        ))}
      </div>
      <fieldset disabled={!!busy} className="form-fieldset">
        <div
          hidden={section !== 'filters'}
          role="tabpanel"
          id="section-filters"
          aria-labelledby="tab-filters"
          className="form-section"
        >
          <Field label="Task name" error={errors.task_name}>
            <input
              value={form.task_name}
              placeholder="e.g. Monthly invoices"
              onChange={(e) => set('task_name', e.target.value)}
              maxLength={255}
            />
          </Field>
          <div className={`field ${errors.labels ? 'field-error' : ''}`}>
            <span className="field-label">
              Folders & categories <span className="required">Required</span>
            </span>
            <ErrorBox error={labels.error} retry={labels.reload} />
            {labels.loading ? (
              <div className="loading-inline">
                <Spinner />
                Loading Gmail labels…
              </div>
            ) : (
              <select
                aria-label="Add folder or category"
                value=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  const [group, value] = JSON.parse(event.target.value) as [string, string];
                  const key = group === 'category' ? 'categories' : 'labels';
                  if (!form[key].includes(value)) set(key, [...form[key], value]);
                }}
              >
                <option value="" disabled>
                  Any — select at least one
                </option>
                {[
                  ['System labels', 'system_labels', 'label'],
                  ['Categories', 'category_labels', 'category'],
                  ['Custom labels', 'custom_labels', 'label'],
                ].map(([name, key, group]) => (
                  <optgroup label={name} key={key}>
                    {labels.data?.data[key as keyof Labels]?.map((value) => (
                      <option
                        key={value}
                        value={JSON.stringify([group, value])}
                        disabled={form.labels.includes(value) || form.categories.includes(value)}
                      >
                        {value.replace('CATEGORY_', '').replaceAll('_', ' ')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
            <div className="chips">
              {(['labels', 'categories'] as const).flatMap((key) =>
                form[key].map((value) => (
                  <button
                    type="button"
                    key={`${key}-${value}`}
                    className="chip"
                    onClick={() =>
                      set(
                        key,
                        form[key].filter((label) => label !== value),
                      )
                    }
                  >
                    {value.replace('CATEGORY_', '')}
                    <span aria-label={`Remove ${value}`}>×</span>
                  </button>
                )),
              )}
            </div>
            {errors.labels && (
              <span className="field-message" role="alert">
                {errors.labels}
              </span>
            )}
          </div>
          <Field label="Sender email" error={errors.sender_email}>
            <input
              type="email"
              placeholder="Anyone, or sender@example.com"
              value={form.sender_email}
              onChange={(e) => set('sender_email', e.target.value)}
            />
          </Field>
          <Field label="Subject contains" error={errors.subject}>
            <input
              placeholder="e.g. invoice"
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
            />
          </Field>
          <Field label="Body contains" error={errors.searchon_word}>
            <input
              placeholder="Words to look for in email content"
              value={form.searchon_word}
              onChange={(e) => set('searchon_word', e.target.value)}
            />
          </Field>
          <div className="two-columns">
            <Field label="After date" error={errors.after_date}>
              <input
                type="date"
                value={form.after_date || ''}
                onChange={(e) => set('after_date', e.target.value || null)}
              />
            </Field>
            <Field label="Before date" error={errors.before_date}>
              <input
                type="date"
                value={form.before_date || ''}
                onChange={(e) => set('before_date', e.target.value || null)}
              />
            </Field>
          </div>
          <Field
            label="Excluded domains"
            hint="Separate domains with commas, e.g. example.com, internal.org"
            error={errors.excluded_domains}
          >
            <input
              value={excludedDomainsText}
              onChange={(e) => {
                setExcludedDomainsText(e.target.value);
                set(
                  'excluded_domains',
                  e.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                );
              }}
              placeholder="No domains excluded"
            />
          </Field>
          <div className="settings-block">
            <Toggle
              label="Expand email threads"
              detail="Include the other messages in matching threads."
              checked={form.expand_threads}
              onChange={(value) => set('expand_threads', value)}
            />
            <Toggle
              label="Track replies"
              detail="Include reply tracking in your extraction."
              checked={form.reply_tracking}
              onChange={(value) => set('reply_tracking', value)}
            />
          </div>
        </div>
        <div
          hidden={section !== 'output'}
          role="tabpanel"
          id="section-output"
          aria-labelledby="tab-output"
          className="form-section"
        >
          <div>
            <h3>What goes into your sheet?</h3>
            <p className="muted">Select the email fields you want to extract.</p>
          </div>
          <div className="checkbox-grid">
            {OUTPUT_FIELDS.map(([key, label, column]) => (
              <label key={key} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    dirty.current = true;
                    setForm((previous) => ({
                      ...previous,
                      [key]: enabled,
                      sequence: enabled
                        ? [...previous.sequence.filter((name) => name !== column), column]
                        : previous.sequence.filter((name) => name !== column),
                    }));
                    setPreview(null);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <details className="details">
            <summary>
              Column order <span>{selectedColumns.length} fields</span>
            </summary>
            <div className="column-order">
              {selectedColumns.map((name, index) => (
                <div key={name}>
                  <span>
                    <small>{String(index + 1).padStart(2, '0')}</small>
                    {name}
                  </span>
                  <div>
                    {[-1, 1].map((direction) => (
                      <button
                        type="button"
                        key={direction}
                        className="icon-button"
                        aria-label={`Move ${name} ${direction === -1 ? 'up' : 'down'}`}
                        disabled={
                          index + direction < 0 || index + direction >= selectedColumns.length
                        }
                        onClick={() => {
                          const next = [...selectedColumns];
                          [next[index], next[index + direction]] = [
                            next[index + direction],
                            next[index],
                          ];
                          set('sequence', next);
                        }}
                      >
                        {direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
          <div className="divider" />
          <Field label="Write mode" error={errors.write_mode}>
            <select
              value={form.write_mode}
              onChange={(e) => set('write_mode', e.target.value as TaskInput['write_mode'])}
            >
              <option value="auto">Auto · let Powerly decide</option>
              <option value="append">Append · add new rows</option>
              <option value="upsert">Upsert · add or update rows</option>
              <option value="replace">Replace · overwrite sheet contents</option>
            </select>
          </Field>
          {form.write_mode === 'replace' && (
            <div className="notice warning">
              Replace mode overwrites the destination sheet. Use append or upsert to preserve
              existing rows.
            </div>
          )}
          <Field
            label="Spreadsheet ID"
            hint="Leave blank to let Powerly create a spreadsheet."
            error={errors.spreadsheet_id}
          >
            <input
              value={form.spreadsheet_id}
              onChange={(e) => set('spreadsheet_id', e.target.value)}
              placeholder="Optional Google spreadsheet ID"
            />
          </Field>
          <div className="settings-block">
            <Toggle
              label="Archive emails as PDF"
              detail="Save PDFs in Google Drive and add archive links to your sheet."
              checked={form.archive_as_pdf}
              onChange={(value) => set('archive_as_pdf', value)}
            />
          </div>
          <div className="divider" />
          <div className="section-heading">
            <div>
              <h3>Structured data</h3>
              <p className="muted">Turn email content into extra columns.</p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                set('parsing_rules', [
                  ...form.parsing_rules,
                  { column_name: '', regex_pattern: '', source: 'body' },
                ])
              }
            >
              <Plus size={14} />
              Add rule
            </button>
          </div>
          <p className="field-hint">
            Use Python regex. The first capture group becomes the value; without a group, the full
            match is used. Patterns are validated by the backend on save.
          </p>
          {form.parsing_rules.map((rule, index) => (
            <div className="rule-card" key={index}>
              <div className="section-heading">
                <span className="eyebrow">RULE {String(index + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() =>
                    set(
                      'parsing_rules',
                      form.parsing_rules.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <Field label="Column name" error={errors[`rule_${index}`]}>
                <input
                  value={rule.column_name}
                  placeholder="Invoice amount"
                  onChange={(event) =>
                    set(
                      'parsing_rules',
                      form.parsing_rules.map((r, i) =>
                        i === index ? { ...r, column_name: event.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Python regex pattern">
                <input
                  className="mono"
                  value={rule.regex_pattern}
                  placeholder={'Amount Due: \\$([\\d,]+\\.\\d{2})'}
                  onChange={(event) =>
                    set(
                      'parsing_rules',
                      form.parsing_rules.map((r, i) =>
                        i === index ? { ...r, regex_pattern: event.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Parse from">
                <select
                  value={rule.source}
                  onChange={(event) =>
                    set(
                      'parsing_rules',
                      form.parsing_rules.map((r, i) =>
                        i === index
                          ? { ...r, source: event.target.value as 'body' | 'attachment' }
                          : r,
                      ),
                    )
                  }
                >
                  <option value="body">Email body</option>
                  <option value="attachment">Attachment · PDF, CSV, DOCX, TXT, HTML</option>
                </select>
              </Field>
            </div>
          ))}
        </div>
        <div
          hidden={section !== 'automation'}
          role="tabpanel"
          id="section-automation"
          aria-labelledby="tab-automation"
          className="form-section"
        >
          <div className="settings-block">
            <Toggle
              label="Scheduled runs"
              detail="Run this extraction automatically."
              checked={form.schedule_enabled}
              onChange={(value) => set('schedule_enabled', value)}
            />
          </div>
          {form.schedule_enabled && (
            <div className="inset-form">
              <Field label="Frequency" error={errors.schedule_cadence}>
                <select
                  value={form.schedule_cadence}
                  onChange={(e) => set('schedule_cadence', e.target.value)}
                >
                  <option value="hourly">Every hour</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </Field>
              {form.schedule_cadence !== 'hourly' && (
                <Field label="Run at" error={errors.schedule_time}>
                  <input
                    type="time"
                    value={form.schedule_time}
                    onChange={(e) => set('schedule_time', e.target.value)}
                  />
                </Field>
              )}
              <Field label="Timezone" error={errors.schedule_timezone}>
                <select
                  value={form.schedule_timezone}
                  onChange={(e) => set('schedule_timezone', e.target.value)}
                >
                  {timezoneOptions.map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </select>
              </Field>
              <p className="field-hint">
                {form.schedule_cadence === 'hourly'
                  ? 'The first run is scheduled one hour from now.'
                  : 'The time uses your selected timezone.'}{' '}
                Scheduled runs may start up to five minutes after they become due. Your chosen write
                mode applies; append or upsert helps preserve data.
              </p>
            </div>
          )}
          <div className="settings-block">
            <Toggle
              label="Mark emails as processed"
              detail="Update matching emails after a successful sheet write."
              checked={form.mark_as_processed}
              onChange={(value) => set('mark_as_processed', value)}
            />
          </div>
          {form.mark_as_processed && (
            <div className="inset-form">
              <Field label="After extraction" error={errors.mark_as_processed_action}>
                <select
                  value={form.mark_as_processed_action}
                  onChange={(e) => set('mark_as_processed_action', e.target.value)}
                >
                  <option value="read">Mark as read</option>
                  <option value="label">Apply a Gmail label</option>
                </select>
              </Field>
              {form.mark_as_processed_action === 'label' && (
                <Field label="Gmail label name" error={errors.mark_as_processed_label}>
                  <input
                    placeholder="e.g. Extracted"
                    value={form.mark_as_processed_label}
                    onChange={(e) => set('mark_as_processed_label', e.target.value)}
                  />
                </Field>
              )}
              <p className="field-hint">
                Requires Gmail modify permission. You may be asked to reconnect Google.
              </p>
            </div>
          )}
          <div className="settings-block">
            <Toggle
              label="Webhook notifications"
              detail="Notify your service when a run completes or fails."
              checked={webhook}
              onChange={(value) => {
                setWebhook(value);
                if (!value) set('webhook_url', '');
              }}
            />
          </div>
          {webhook && (
            <Field label="Webhook URL" error={errors.webhook_url}>
              <input
                type="url"
                placeholder="https://your-service.com/webhook"
                value={form.webhook_url}
                onChange={(e) => set('webhook_url', e.target.value)}
              />
            </Field>
          )}
        </div>
      </fieldset>
      {preview && (
        <div className="preview-result" role="status">
          <div>
            <Eye size={20} />
            <strong>{preview.estimated_count.toLocaleString()} emails match</strong>
          </div>
          <code>{preview.query}</code>
          {preview.hints?.map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
          <span className="field-hint">
            <Check size={12} />
            Task saved. Preview does not extract or modify emails.
          </span>
        </div>
      )}
      <div className="editor-footer">
        <button
          type="button"
          className="button secondary"
          disabled={!!busy}
          onClick={() => void save(undefined, true)}
        >
          {busy === 'preview' ? <Spinner /> : <Eye size={16} />}Save & preview
        </button>
        <button type="submit" className="button primary" disabled={!!busy}>
          {busy === 'save' ? <Spinner /> : <Save size={16} />}Save task
        </button>
      </div>
    </form>
  );
}
