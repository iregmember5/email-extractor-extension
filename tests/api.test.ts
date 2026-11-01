import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type AuthStore } from '../src/background/api';
import { API_BASE, AUTH_BASE } from '../src/config';
import type { Session } from '../src/types';
const session: Session = {
  access: 'old',
  refresh: 'refresh',
  user: { id: 1, email: 'test@example.com' },
};
function fixture(fetcher: typeof fetch) {
  let state: Session | undefined = structuredClone(session);
  const store: AuthStore = {
    get: async () => state,
    set: async (value) => {
      state = value;
    },
    clear: async () => {
      state = undefined;
    },
  };
  return { client: new ApiClient(store, fetcher), get: () => state };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
describe('Authenticated API transport', () => {
  it('uses the deployed /v1 backend and sends version and bearer headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ success: true, data: [] }));
    const { client } = fixture(fetcher);
    await client.request('tasks/?page=2&page_size=10');
    expect(API_BASE).toBe('https://mypowerly.com/v1/api/email-extractor/');
    expect(AUTH_BASE).toBe('https://mypowerly.com/v1/api/auth/');
    expect(fetcher.mock.calls[0][0]).toBe(`${API_BASE}tasks/?page=2&page_size=10`);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer old',
      'X-Extension-Version': '1.0.2',
    });
  });
  it('shares a refresh across concurrent requests and supports the raw token response', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === `${AUTH_BASE}token/refresh/`) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return json({ access: 'new' });
      }
      return (init?.headers as Record<string, string>).Authorization === 'Bearer new'
        ? json({ success: true, data: [] })
        : json({ message: 'expired' }, 401);
    });
    const { client, get } = fixture(fetcher);
    await Promise.all([client.request('tasks/'), client.request('jobs/')]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('refresh/'))).toHaveLength(1);
    expect(get()?.access).toBe('new');
  });
  it('does not log out a valid Powerly session when a Google request still returns 401', async () => {
    const { client, get } = fixture(
      vi.fn<typeof fetch>(async (url) =>
        String(url).includes('refresh/')
          ? json({ data: { access: 'new' }, success: true })
          : json({ message: 'Google account connection expired' }, 401),
      ),
    );
    await expect(client.request('tasks/1/run/', 'POST')).rejects.toMatchObject({
      status: 401,
      message: 'Google account connection expired',
    });
    expect(get()?.access).toBe('new');
  });
  it('clears tokens on rejected refresh', async () => {
    const { client, get } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'invalid token' }, 401)),
    );
    await expect(client.request('tasks/')).rejects.toMatchObject({ status: 401 });
    expect(get()).toBeUndefined();
  });
  it('preserves session when refresh fails because of temporary server errors', async () => {
    const { client, get } = fixture(
      vi.fn<typeof fetch>(async (url) =>
        json({ message: 'Unavailable' }, String(url).includes('refresh/') ? 503 : 401),
      ),
    );
    await expect(client.request('tasks/')).rejects.toMatchObject({ status: 503 });
    expect(get()).toBeDefined();
  });
  it('preserves field validation and permission scope details', async () => {
    const { client } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(
        json(
          {
            success: false,
            message: 'Additional permissions required',
            errors: { missing_scopes: ['gmail.modify'] },
          },
          409,
        ),
      ),
    );
    await expect(client.request('tasks/1/run/', 'POST')).rejects.toMatchObject({
      status: 409,
      errors: { missing_scopes: ['gmail.modify'] },
    });
  });
  it('preserves run idempotency across an authentication retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) =>
      String(url).includes('refresh/')
        ? json({ access: 'new' })
        : (init?.headers as Record<string, string>).Authorization === 'Bearer new'
          ? json({ success: true, data: { id: 1 } })
          : json({}, 401),
    );
    const { client } = fixture(fetcher);
    await client.request('tasks/1/run/', 'POST', {}, { 'Idempotency-Key': 'same-run' });
    for (const [, init] of fetcher.mock.calls.filter(([url]) => String(url).includes('/run/')))
      expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'same-run' });
  });
  it('blocks arbitrary URLs and non-contract routes before making requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { client } = fixture(fetcher);
    await expect(client.request('https://evil.example/')).rejects.toThrow('Unsupported API route');
    await expect(client.request('../auth/login/')).rejects.toThrow('Unsupported API route');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles binary exports and rejects JSON metadata as a download', async () => {
    const { client } = fixture(
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('a,b\n1,2', { headers: { 'Content-Type': 'text/csv' } }),
        )
        .mockResolvedValueOnce(
          json({ data: { sheet_url: 'https://docs.google.com' }, success: true }),
        ),
    );
    const binary = await client.request<{ bytes: number[] }>(
      'jobs/1/export/?format=csv',
      'GET',
      undefined,
      {},
      true,
    );
    expect(new TextDecoder().decode(new Uint8Array(binary.bytes))).toBe('a,b\n1,2');
    await expect(
      client.request('jobs/1/export/?format=xlsx', 'GET', undefined, {}, true),
    ).rejects.toThrow('export metadata');
  });
  it('never restores tokens after logout while a refresh is in flight', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshing!: () => void;
    const started = new Promise<void>((resolve) => {
      refreshing = resolve;
    });
    const { client, get } = fixture(
      vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes('refresh/')) {
          refreshing();
          await wait;
          return json({ access: 'new' });
        }
        return json({}, 401);
      }),
    );
    const request = client.request('tasks/');
    await started;
    await client.logout();
    release();
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(get()).toBeUndefined();
  });
});

describe('Malformed deployment responses', () => {
  it('rejects website HTML instead of downloading it as a CSV file', async () => {
    const { client } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<!doctype html><title>Powerly</title>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    await expect(
      client.request('jobs/1/export/?format=csv', 'GET', undefined, {}, true),
    ).rejects.toThrow('web page instead of API data');
  });
  it('rejects empty JSON without crashing the panel', async () => {
    const { client } = fixture(vi.fn<typeof fetch>().mockResolvedValue(json(null)));
    await expect(client.request('tasks/')).rejects.toThrow('incomplete API response');
  });
});

describe('Existing Powerly login compatibility', () => {
  it.each(['raw', 'envelope'])('accepts a %s JWT login response', async (format) => {
    const loginSession: Session = {
      access: 'access',
      refresh: 'refresh',
      user: { id: 2, email: 'member@example.com', first_name: 'Member' },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json(format === 'raw' ? loginSession : { success: true, data: loginSession }),
      );
    const { client, get } = fixture(fetcher);
    await expect(client.login('member@example.com', 'example-password')).resolves.toEqual(
      loginSession.user,
    );
    expect(get()).toEqual(loginSession);
    expect(fetcher.mock.calls[0][0]).toBe('https://mypowerly.com/v1/api/auth/login/');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      username: 'member@example.com',
      password: 'example-password',
    });
  });
});
