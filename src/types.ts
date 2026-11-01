export type Status = 'pending' | 'running' | 'completed' | 'failed';
export interface User {
  id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  get_display_name?: string;
}
export interface Session {
  access: string;
  refresh: string;
  user: User;
}
export interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
  errors?: Record<string, unknown> | null;
  status_code?: number;
  pagination?: Pagination;
}
export interface Pagination {
  count: number;
  current_page: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  page_size: number;
}
export interface Rule {
  column_name: string;
  regex_pattern: string;
  source: 'body' | 'attachment';
}
export const OUTPUT_FIELDS = [
  ['from_field', 'From', 'From'],
  ['to_field', 'To', 'To'],
  ['cc_field', 'CC', 'CC'],
  ['bcc_field', 'BCC', 'BCC'],
  ['reply_to_field', 'Reply-To', 'Reply-To'],
  ['subject_field', 'Subject', 'Subject'],
  ['message_body_field', 'Body', 'Body'],
  ['attachment_field', 'Attachments', 'Attachment'],
  ['thread_id_field', 'Thread ID', 'Thread ID'],
  ['source_label_field', 'Source labels', 'Source Labels'],
  ['message_id_field', 'Message ID', 'Message ID'],
  ['open_email_link_field', 'Open in Gmail', 'Open in Gmail'],
] as const;
export type OutputKey = (typeof OUTPUT_FIELDS)[number][0];
export type TaskInput = Record<OutputKey, boolean> & {
  task_name: string;
  labels: string[];
  categories: string[];
  subject: string;
  searchon_word: string;
  sender_email: string;
  after_date: string | null;
  before_date: string | null;
  excluded_domains: string[];
  reply_tracking: boolean;
  expand_threads: boolean;
  write_mode: 'auto' | 'replace' | 'append' | 'upsert';
  sequence: string[];
  spreadsheet_id: string;
  schedule_enabled: boolean;
  schedule_cadence: string;
  schedule_time: string;
  schedule_timezone: string;
  mark_as_processed: boolean;
  mark_as_processed_action: string;
  mark_as_processed_label: string;
  webhook_url: string;
  parsing_rules: Rule[];
  archive_as_pdf: boolean;
};
export interface Task extends TaskInput {
  id: number;
  status: Status;
  query?: string;
  is_deleted: boolean;
  deleted_at?: string | null;
  created_at?: string;
  sheet_url?: string;
  spreadsheet_url?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
}
export interface Job {
  id: number;
  task: number;
  task_name: string;
  status: Status;
  is_deleted: boolean;
  sheet_url?: string | null;
  sheet_id?: string | null;
  total_messages_scanned: number;
  total_emails_found: number;
  total_new_emails: number;
  error_message?: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}
export interface Connection {
  connected: boolean;
  google_email?: string;
  needs_reauth?: boolean;
  needs_scope_upgrade?: boolean;
  missing_scopes?: string[];
  spreadsheet_url?: string;
}
export interface Labels {
  system_labels: string[];
  category_labels: string[];
  custom_labels: string[];
}
export interface Preview {
  estimated_count: number;
  query: string;
  labels: string[];
  hints: string[];
}
export interface Stats {
  total_jobs: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  success_rate: number;
  total_messages_scanned: number;
  total_emails_found: number;
  total_new_emails: number;
  avg_emails_per_run: number;
  recent_runs: Job[];
}
export interface AppError {
  message: string;
  status?: number;
  errors?: Record<string, unknown> | null;
}
export type RequestMessage =
  | { type: 'SESSION' }
  | { type: 'LOGIN'; username: string; password: string }
  | { type: 'LOGOUT' }
  | { type: 'GOOGLE_LOGIN'; site: string }
  | { type: 'CANCEL_GOOGLE_LOGIN' }
  | { type: 'API'; path: string; method?: string; body?: unknown }
  | { type: 'RUN'; id: number }
  | { type: 'POLL' }
  | { type: 'CONNECT' }
  | { type: 'EXPORT'; id: number; format: 'csv' | 'xlsx' }
  | { type: 'DRAFT'; value?: TaskInput | null };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: AppError };
export interface GoogleLoginView {
  origin: string;
  expiresAt: number;
}
export interface SessionView {
  user: User | null;
  jobs: Job[];
  oauthStarted?: number;
  draft?: TaskInput;
  signInSite?: string;
  googleLogin?: GoogleLoginView;
}
