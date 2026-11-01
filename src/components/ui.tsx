import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  Mail,
  X,
} from 'lucide-react';
import type { AppError, Pagination, Status } from '../types';
import { safeUrl } from '../task';
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Mail size={20} />
      </span>
      <div>
        <strong>
          powerly<span className="brand-dot">.</span>
        </strong>
        {!compact && <span className="brand-caption">EMAIL EXTRACTOR</span>}
      </div>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="animate-spin" aria-label="Loading" />;
}
export function Badge({ status }: { status: Status | 'deleted' }) {
  return (
    <span className={`badge badge-${status}`}>
      <span />
      {status}
    </span>
  );
}
export function ErrorBox({
  error,
  retry,
  dismiss,
  reconnect,
}: {
  error: AppError | null;
  retry?: () => void;
  dismiss?: () => void;
  reconnect?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <div>
        <strong>{error.message}</strong>
        {error.errors && (
          <ul>
            {Object.entries(error.errors).map(([key, value]) => (
              <li key={key}>
                {key.replaceAll('_', ' ')}:{' '}
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </li>
            ))}
          </ul>
        )}
        {error.status === 429 && (
          <p>Run requests are limited to 10 per hour. Wait before trying again.</p>
        )}
        {(error.errors?.missing_scopes || error.message.toLowerCase().includes('google')) &&
          reconnect && (
            <button className="text-button" onClick={reconnect}>
              Reconnect Google
            </button>
          )}
        {retry && (
          <button className="text-button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
      {dismiss && (
        <button className="icon-button" aria-label="Dismiss error" onClick={dismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function External({
  href,
  children,
  className = 'text-link',
}: {
  href?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const url = safeUrl(href);
  return url ? (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={13} />
    </a>
  ) : null;
}
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? 'field-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-message" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
export function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Mail size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Pager({
  pagination,
  page,
  onChange,
}: {
  pagination?: Pagination;
  page: number;
  onChange: (page: number) => void;
}) {
  if (!pagination || pagination.count === 0) return null;
  return (
    <div className="pager">
      <span>
        {pagination.count} {pagination.count === 1 ? 'result' : 'results'} · Page{' '}
        {pagination.current_page || page} of {Math.max(1, pagination.total_pages)}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page >= pagination.total_pages}
          onClick={() => onChange(page + 1)}
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
export function Confirm({
  title,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-body">
        <span className="eyebrow">PLEASE CONFIRM</span>
        <h2>{title}</h2>
        <p>{children}</p>
        <ErrorBox error={error} />
        <div className="button-row">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Keep it
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(e as AppError);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : <Check size={16} />}Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}
