import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { emptyTask } from '../../src/task';
import type { Connection, Job, Task } from '../../src/types';
interface Recorded {
  path: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
export class Backend {
  requests: Recorded[] = [];
  connection: Connection = { connected: true, google_email: 'niaz@gmail.com', missing_scopes: [] };
  tasks: Task[] = Array.from({ length: 11 }, (_, index) => ({
    ...emptyTask(),
    id: index + 1,
    task_name: `Invoice extraction ${index + 1}`,
    labels: ['INBOX'],
    is_deleted: false,
    status: 'completed',
    last_run_at: '2026-10-28T12:00:00Z',
  }));
  jobs: Job[] = [
    {
      id: 1,
      task: 1,
      task_name: 'Invoice extraction 1',
      status: 'completed',
      is_deleted: false,
      sheet_url: 'https://docs.google.com/spreadsheets/d/example',
      total_messages_scanned: 25,
      total_emails_found: 12,
      total_new_emails: 10,
      created_at: '2026-10-28T12:00:00Z',
      completed_at: '2026-10-28T12:01:00Z',
    },
  ];
  failNextRun = false;
  forceExpiredAccess = false;
  expireNextRun = false;
  rejectRefresh = false;
  html = false;
  badGoogleState = false;
  fastGoogleRedirect = false;
  async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() || {};
    } catch {
      /* No request body. */
    }
    const headers = request.headers();
    const path = url.pathname.replace('/v1/api/email-extractor/', '');
    this.requests.push({ path: url.pathname + url.search, method, body, headers });
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
        },
        body: JSON.stringify(data),
      });
    const ok = (data: unknown, status = 200) =>
      json({ success: true, data, message: 'Success' }, status);
    if (method === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
        },
      });
    if (this.html)
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Powerly website</title>',
      });
    if (url.pathname === '/v1/api/auth/login/') {
      if (body.password !== 'test-password')
        return json({ success: false, message: 'Invalid email or password' }, 401);
      // Match the existing web app's raw login payload.
      return json({
        access: 'test-access',
        refresh: 'test-refresh',
        user: { id: 1, first_name: 'Niaz', email: 'niaz@example.com' },
      });
    }
    if (url.pathname === '/v1/api/auth/google-site-login/')
      return json({
        success: true,
        data: {
          tokens: { access: 'google-access', refresh: 'google-refresh' },
          user: { id: 47, first_name: 'Google', email: 'google-user@example.com' },
        },
      });
    if (url.pathname === '/v1/api/auth/token/refresh/')
      return this.rejectRefresh
        ? json({ success: false, message: 'Refresh expired' }, 401)
        : json({ access: 'refreshed-access' });
    if (this.expireNextRun && /^tasks\/\d+\/run\/$/.test(path)) {
      this.expireNextRun = false;
      this.forceExpiredAccess = true;
      return json({ success: false, message: 'Token expired' }, 401);
    }
    if (this.forceExpiredAccess && headers.authorization !== 'Bearer refreshed-access')
      return json({ success: false, message: 'Token expired' }, 401);
    if (!headers.authorization) return json({ success: false, message: 'Unauthorized' }, 401);
    if (path === 'google/connection/') return ok(this.connection);
    if (path === 'google-connection/authorize/')
      return ok({ authorization_url: 'https://accounts.google.com/o/oauth2/auth?state=test' });
    if (path === 'gmail/labels/')
      return ok({
        system_labels: ['INBOX', 'SENT', 'UNREAD'],
        category_labels: ['CATEGORY_UPDATES'],
        custom_labels: ['Client Email'],
      });
    if (path === 'jobs/stats/')
      return ok({
        total_jobs: this.jobs.length,
        completed: 1,
        failed: 0,
        running: 0,
        pending: 0,
        success_rate: 100,
        total_messages_scanned: 25,
        total_emails_found: 12,
        total_new_emails: 10,
        avg_emails_per_run: 12,
        recent_runs: this.jobs,
      });
    if (path === 'tasks/' || path === 'jobs/') {
      if (method === 'POST' && path === 'tasks/') {
        const task = {
          ...emptyTask(),
          ...body,
          id: 100 + this.tasks.length,
          status: 'pending',
          is_deleted: false,
        } as Task;
        this.tasks.unshift(task);
        return ok(task, 201);
      }
      const all = path === 'tasks/' ? this.tasks : this.jobs;
      const includeDeleted = url.searchParams.get('include_deleted') === 'true';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const list = all.filter(
        (item) =>
          (includeDeleted || !item.is_deleted) &&
          (!search || item.task_name.toLowerCase().includes(search)),
      );
      const page = Number(url.searchParams.get('page') || 1);
      const total = Math.ceil(list.length / 10);
      return json({
        success: true,
        data: list.slice((page - 1) * 10, page * 10),
        pagination: {
          count: list.length,
          current_page: page,
          total_pages: total,
          page_size: 10,
          next: page < total ? 'next' : null,
          previous: page > 1 ? 'prev' : null,
        },
      });
    }
    const match = path.match(/^(tasks|jobs)\/(\d+)\/(.*)$/);
    if (match) {
      const [, type, id, action] = match;
      if (type === 'tasks') {
        const task = this.tasks.find((item) => item.id === Number(id));
        if (!task) return json({ success: false, message: 'Task not found' }, 404);
        if (action === 'run/') {
          if (this.failNextRun) {
            this.failNextRun = false;
            return route.abort('failed');
          }
          if (this.jobs.some((job) => ['pending', 'running'].includes(job.status)))
            return json(
              { success: false, message: 'Another extraction task is already running.' },
              409,
            );
          const job: Job = {
            id: 100 + this.jobs.length,
            task: task.id,
            task_name: task.task_name,
            status: 'running',
            is_deleted: false,
            total_messages_scanned: 5,
            total_emails_found: 2,
            total_new_emails: 2,
            created_at: new Date().toISOString(),
          };
          this.jobs.unshift(job);
          return ok(job);
        }
        if (action === 'preview/')
          return ok({
            estimated_count: 14,
            query: 'label:inbox AND subject:invoice',
            labels: ['INBOX'],
            hints: [],
          });
        if (action === 'duplicate/') {
          const copy = {
            ...task,
            id: 100 + this.tasks.length,
            task_name: `${task.task_name} (copy)`,
          };
          this.tasks.unshift(copy);
          return ok(copy, 201);
        }
        if (action === 'restore/') task.is_deleted = false;
        else if (action === 'schedule/') {
          task.schedule_enabled = method !== 'DELETE';
          task.schedule_cadence = String(body.cadence || '');
          task.schedule_timezone = String(body.timezone || 'UTC');
          task.next_run_at = '2026-11-02T09:00:00Z';
        } else if (method === 'PATCH') Object.assign(task, body);
        else if (method === 'DELETE') task.is_deleted = true;
        return ok(task);
      }
      const job = this.jobs.find((item) => item.id === Number(id));
      if (!job) return json({ success: false, message: 'Job not found' }, 404);
      if (action === 'export/')
        return route.fulfill({
          contentType:
            url.searchParams.get('format') === 'csv'
              ? 'text/csv'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: 'From,Subject\nsender@example.com,Invoice',
          headers: { 'Content-Disposition': 'attachment; filename="emails.csv"' },
        });
      if (action === 'restore/') job.is_deleted = false;
      else if (method === 'DELETE') job.is_deleted = true;
      return ok(job);
    }
    return json({ success: false, message: `Unmocked route: ${path}` }, 404);
  }
}
export const test = base.extend<{
  panel: Page;
  backend: Backend;
  extensionContext: BrowserContext;
  extensionId: string;
}>({
  backend: async ({}, use) => {
    await use(new Backend());
  },
  extensionContext: async ({ backend }, use) => {
    const dir = await mkdtemp(resolve(tmpdir(), 'powerly-extension-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 390, height: 850 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--no-sandbox',
      ],
    });
    await context.route('https://mypowerly.com/**', (route) => backend.handle(route));
    const siteBuild = resolve('.test-auth-site');
    const serveWebsite = async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/sign-in' && backend.fastGoogleRedirect)
        return route.fulfill({
          contentType: 'text/html',
          body: `<script>window.opener.postMessage({type:'POWERLY_EXTENSION_GOOGLE_CALLBACK',href:location.href},location.origin);history.replaceState(null,'','/workspace-management');</script><p>Redirecting an existing website session…</p>`,
        });
      if (url.pathname === '/sign-in')
        return route.fulfill({
          contentType: 'text/html',
          body: '<p>Returning Google authorization to Powerly…</p>',
        });
      const file =
        url.pathname === '/extension-auth.html'
          ? resolve(siteBuild, 'extension-auth.html')
          : url.pathname.startsWith('/extension-auth-assets/')
            ? resolve(siteBuild, 'extension-auth-assets', basename(url.pathname))
            : '';
      if (!file || !existsSync(file))
        return route.fulfill({ status: 404, body: 'Build the test sign-in companion first.' });
      return route.fulfill({
        contentType: file.endsWith('.html')
          ? 'text/html'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
        body: readFileSync(file),
      });
    };
    await context.route('https://mypowerly.com/extension-auth.html**', serveWebsite);
    await context.route('https://mypowerly.com/extension-auth-assets/**', serveWebsite);
    await context.route('https://mypowerly.com/sign-in**', serveWebsite);
    await context.route('http://localhost:5173/**', serveWebsite);
    // The provider and token exchange are isolated from real accounts in tests.
    await context.route('https://accounts.google.com/**', (route) => {
      const url = new URL(route.request().url());
      const redirect = url.searchParams.get('redirect_uri');
      if (!redirect)
        return route.fulfill({ contentType: 'text/html', body: '<h1>Test Google consent</h1>' });
      const callback = new URL(redirect);
      callback.searchParams.set('code', 'test-google-code');
      callback.searchParams.set(
        'state',
        backend.badGoogleState ? 'wrong-state' : url.searchParams.get('state') || '',
      );
      return route.fulfill({
        contentType: 'text/html',
        body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Use test Google account</a>`,
      });
    });
    await use(context);
    await context.close();
    await rm(dir, { recursive: true, force: true });
  },
  extensionId: async ({ extensionContext }, use) => {
    const worker =
      extensionContext.serviceWorkers()[0] ||
      (await extensionContext.waitForEvent('serviceworker'));
    await use(new URL(worker.url()).hostname);
  },
  panel: async ({ extensionContext, extensionId }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await use(page);
  },
});
export { expect } from '@playwright/test';
export async function login(page: Page) {
  await page.getByLabel('Email address').fill('niaz@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('heading', { name: 'Your tasks.' }).waitFor();
}
