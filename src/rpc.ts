import type { AppError, Envelope, Reply, RequestMessage } from './types';
export class RemoteError extends Error implements AppError {
  constructor(error: AppError) {
    super(error.message);
    this.status = error.status;
    this.errors = error.errors;
  }
  status?: number;
  errors?: Record<string, unknown> | null;
}
export async function rpc<T>(message: RequestMessage): Promise<T> {
  if (!globalThis.chrome?.runtime?.id)
    throw new RemoteError({
      message:
        'Load the built extension in Chrome to connect to Powerly. See the setup instructions in README.md.',
    });
  let reply: Reply<T>;
  try {
    reply = await chrome.runtime.sendMessage(message);
  } catch {
    throw new RemoteError({
      message: 'The extension connection was interrupted. Reopen the side panel and try again.',
    });
  }
  if (!reply || !reply.ok)
    throw new RemoteError(
      reply && !reply.ok
        ? reply.error
        : { message: 'The background worker did not respond. Please reopen the panel.' },
    );
  return reply.data;
}
export function api<T>(path: string, method = 'GET', body?: unknown) {
  return rpc<Envelope<T>>({ type: 'API', path, method, body });
}
export async function download(id: number, format: 'csv' | 'xlsx') {
  const data = await rpc<{ bytes: number[]; contentType: string }>({ type: 'EXPORT', id, format });
  const blob = new Blob([new Uint8Array(data.bytes)], {
    type: data.contentType || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `powerly-job-${id}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
