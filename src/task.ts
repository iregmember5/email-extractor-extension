import { OUTPUT_FIELDS, type TaskInput } from './types';
export function emptyTask(): TaskInput {
  return {
    task_name: '',
    labels: [],
    categories: [],
    subject: '',
    searchon_word: '',
    sender_email: '',
    after_date: null,
    before_date: null,
    excluded_domains: [],
    from_field: true,
    to_field: true,
    cc_field: false,
    bcc_field: false,
    reply_to_field: false,
    subject_field: true,
    message_body_field: true,
    attachment_field: true,
    thread_id_field: false,
    source_label_field: true,
    message_id_field: true,
    open_email_link_field: false,
    reply_tracking: false,
    expand_threads: false,
    write_mode: 'auto',
    sequence: ['From', 'To', 'Subject', 'Body', 'Attachment', 'Source Labels', 'Message ID'],
    spreadsheet_id: '',
    schedule_enabled: false,
    schedule_cadence: 'daily',
    schedule_time: '09:00',
    schedule_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    mark_as_processed: false,
    mark_as_processed_action: 'read',
    mark_as_processed_label: '',
    webhook_url: '',
    parsing_rules: [],
    archive_as_pdf: false,
  };
}
export function taskPayload(task: TaskInput): TaskInput {
  const result = Object.fromEntries(
    Object.keys(emptyTask()).map((key) => [key, task[key as keyof TaskInput]]),
  ) as TaskInput;
  const enabled = OUTPUT_FIELDS.filter(([key]) => result[key]).map(([, , name]) => name as string);
  result.sequence = [
    ...result.sequence.filter((name) => enabled.includes(name)),
    ...enabled.filter((name) => !result.sequence.includes(name)),
  ];
  return {
    ...result,
    task_name: result.task_name.trim(),
    after_date: result.after_date || null,
    before_date: result.before_date || null,
    schedule_cadence: result.schedule_enabled ? result.schedule_cadence : '',
    schedule_time: result.schedule_enabled ? result.schedule_time : '',
    mark_as_processed_action: result.mark_as_processed ? result.mark_as_processed_action : '',
    mark_as_processed_label:
      result.mark_as_processed && result.mark_as_processed_action === 'label'
        ? result.mark_as_processed_label.trim()
        : '',
  };
}
export function validateTask(task: TaskInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!task.task_name.trim()) errors.task_name = 'Give this task a name.';
  if (task.sender_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(task.sender_email))
    errors.sender_email = 'Enter a valid sender email address.';
  if (!task.labels.length && !task.categories.length)
    errors.labels = 'Select at least one folder or category.';
  if (task.after_date && task.before_date && task.after_date > task.before_date)
    errors.before_date = 'Choose a date on or after the start date.';
  if (
    task.mark_as_processed &&
    task.mark_as_processed_action === 'label' &&
    !task.mark_as_processed_label.trim()
  )
    errors.mark_as_processed_label = 'Enter a Gmail label name.';
  if (task.schedule_enabled) {
    if (!['hourly', 'daily', 'weekly'].includes(task.schedule_cadence))
      errors.schedule_cadence = 'Choose a schedule cadence.';
    if (task.schedule_cadence !== 'hourly' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.schedule_time))
      errors.schedule_time = 'Choose a valid time.';
    try {
      new Intl.DateTimeFormat('en', { timeZone: task.schedule_timezone });
    } catch {
      errors.schedule_timezone = 'Enter a valid IANA timezone.';
    }
  }
  if (task.webhook_url) {
    try {
      const u = new URL(task.webhook_url);
      if (!['https:', 'http:'].includes(u.protocol)) throw Error();
    } catch {
      errors.webhook_url = 'Enter a valid HTTP or HTTPS URL.';
    }
  }
  task.parsing_rules.forEach((rule, i) => {
    if (!rule.column_name.trim() || !rule.regex_pattern.trim())
      errors[`rule_${i}`] = 'Column name and Python regex pattern are required.';
    if (
      task.parsing_rules.some(
        (other, j) =>
          j !== i &&
          other.column_name.trim().toLowerCase() === rule.column_name.trim().toLowerCase(),
      )
    )
      errors[`rule_${i}`] = 'Use a unique column name.';
  });
  return errors;
}
export function safeUrl(value: string | null | undefined, hosts?: string[]): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && (!hosts || hosts.includes(url.hostname))) return url.href;
  } catch {
    /* Invalid backend URL. */
  }
}
export function dateTime(value?: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unknown date'
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}
