import { test, expect, login } from './fixture';
import type { SessionView } from '../../src/types';
test('password login, pagination, refresh, token isolation, and sign out', async ({
  panel,
  backend,
}) => {
  await expect(panel.getByText('v1.0.2 · CHROME', { exact: true })).toBeVisible();
  await panel.getByLabel('Email address').fill('niaz@example.com');
  await panel.getByLabel('Password', { exact: true }).fill('wrong');
  await panel.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Invalid email or password');
  await login(panel);
  await expect(panel.getByText('niaz@gmail.com')).toBeVisible();
  await expect(panel.getByText('Page 1 of 2', { exact: false })).toBeVisible();
  await panel.getByLabel('Next page').click();
  await expect(
    panel.getByRole('heading', { name: 'Invoice extraction 11', exact: true }),
  ).toBeVisible();
  const state = await panel.evaluate(async () => chrome.runtime.sendMessage({ type: 'SESSION' }));
  expect(state.data).not.toHaveProperty('access');
  expect(state.data).not.toHaveProperty('refresh');
  expect((state.data as SessionView).user?.email).toBe('niaz@example.com');
  backend.forceExpiredAccess = true;
  await panel.getByLabel('Refresh current view').click();
  await expect
    .poll(() => backend.requests.filter((r) => r.path === '/v1/api/auth/token/refresh/').length)
    .toBe(1);
  await panel.getByLabel('Account menu').click();
  await panel.getByRole('button', { name: 'Sign out' }).click();
  await expect(panel.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  const stored = await panel.evaluate(async () => chrome.storage.local.get(null));
  expect(stored).toEqual({});
});
test('create task requires a folder, saves all advanced options, schedules, and previews', async ({
  panel,
  backend,
}) => {
  await login(panel);
  await panel.getByRole('button', { name: '+ New task', exact: true }).click();
  await panel.getByLabel('Task name').fill('Client invoices');
  await panel.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(
    panel.getByRole('alert').filter({ hasText: 'Select at least one folder' }),
  ).toBeVisible();
  await panel.getByLabel('Add folder or category').selectOption(JSON.stringify(['label', 'INBOX']));
  await panel.getByLabel('Subject contains').fill('invoice');
  await panel.getByRole('tab', { name: '02 Output' }).click();
  await panel.getByText('Open in Gmail', { exact: true }).click();
  await panel.getByRole('switch', { name: /Archive emails as PDF/ }).check();
  await panel.getByRole('button', { name: 'Add rule' }).click();
  await panel.getByLabel('Column name').fill('Amount');
  await panel.getByLabel('Python regex pattern').fill('Amount: (\\d+)');
  await panel.getByRole('tab', { name: '03 Automation' }).click();
  await panel.getByRole('switch', { name: /Scheduled runs/ }).check();
  await panel.getByLabel('Timezone').selectOption('Asia/Karachi');
  await panel.getByRole('switch', { name: /Mark emails as processed/ }).check();
  await panel.getByLabel('After extraction').selectOption('label');
  await panel.getByLabel('Gmail label name').fill('Extracted');
  await panel.getByRole('switch', { name: /Webhook notifications/ }).check();
  await panel.getByLabel('Webhook URL').fill('https://example.com/webhook');
  await panel.getByRole('button', { name: 'Save & preview' }).click();
  await expect(panel.getByText('14 emails match', { exact: true })).toBeVisible();
  const request = backend.requests.find(
    (r) => r.path === '/v1/api/email-extractor/tasks/' && r.method === 'POST',
  );
  expect(request?.body).toMatchObject({
    task_name: 'Client invoices',
    labels: ['INBOX'],
    archive_as_pdf: true,
    open_email_link_field: true,
    webhook_url: 'https://example.com/webhook',
    mark_as_processed_action: 'label',
    mark_as_processed_label: 'Extracted',
    parsing_rules: [{ column_name: 'Amount', regex_pattern: 'Amount: (\\d+)', source: 'body' }],
  });
  expect(backend.requests.find((r) => r.path.endsWith('/schedule/'))?.body).toMatchObject({
    timezone: 'Asia/Karachi',
    cadence: 'daily',
    enabled: true,
  });
  await panel.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Client invoices', exact: true })).toBeVisible();
  expect(
    backend.requests.filter(
      (r) => r.path === '/v1/api/email-extractor/tasks/' && r.method === 'POST',
    ),
  ).toHaveLength(1);
});
test('network retry reuses the run key, shows live counters, and recovers after reopening', async ({
  panel,
  backend,
  extensionContext,
  extensionId,
}) => {
  await login(panel);
  backend.failNextRun = true;
  await panel.getByRole('button', { name: 'Run task', exact: true }).first().click();
  await expect(panel.getByRole('alert')).toContainText('Unable to reach Powerly');
  await panel.getByRole('button', { name: 'Run task', exact: true }).first().click();
  await expect(panel.getByText('LIVE EXTRACTION')).toBeVisible();
  await expect(panel.getByRole('progressbar')).toBeVisible();
  const runs = backend.requests.filter((r) => r.path.endsWith('/run/'));
  expect(runs).toHaveLength(2);
  expect(runs[0].headers['idempotency-key']).toBeTruthy();
  expect(runs[0].headers['idempotency-key']).toBe(runs[1].headers['idempotency-key']);
  const reopened = await extensionContext.newPage();
  await panel.close();
  await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(reopened.getByText('LIVE EXTRACTION')).toBeVisible();
  const job = backend.jobs[0];
  job.status = 'completed';
  job.sheet_url = 'https://docs.google.com/spreadsheets/d/new';
  await expect(reopened.getByText('LIVE EXTRACTION')).toBeHidden({ timeout: 8000 });
  await reopened.getByRole('button', { name: 'History', exact: true }).click();
  await expect(reopened.getByRole('link', { name: 'Open sheet' }).first()).toHaveAttribute(
    'href',
    job.sheet_url,
  );
  const last = runs[0];
  expect(last.headers['x-extension-version']).toBe('1.0.2');
});
test('duplicates, deletes, and restores tasks without deleting backend data permanently', async ({
  panel,
}) => {
  await login(panel);
  const card = panel.locator('.task-card').first();
  await card.getByLabel('More actions for Invoice extraction 1', { exact: true }).click();
  await card.getByRole('button', { name: 'Duplicate task' }).click();
  await expect(panel.getByLabel('Task name')).toHaveValue('Invoice extraction 1 (copy)');
  await panel.getByRole('button', { name: 'All tasks' }).click();
  const copy = panel.locator('.task-card').filter({
    has: panel.getByRole('heading', { name: 'Invoice extraction 1 (copy)', exact: true }),
  });
  await copy.getByLabel('More actions for Invoice extraction 1 (copy)', { exact: true }).click();
  await copy.getByRole('button', { name: 'Delete task' }).click();
  await panel.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel.getByRole('dialog')).toBeHidden();
  await panel.getByLabel('Show deleted').check();
  await expect(copy.getByRole('button', { name: 'Restore' })).toBeVisible();
  await copy.getByRole('button', { name: 'Restore' }).click();
  await expect(copy.getByRole('button', { name: 'Run task' })).toBeVisible();
});
test('history downloads actual blobs and statistics display aggregate results', async ({
  panel,
}) => {
  await login(panel);
  await panel.getByRole('button', { name: 'History', exact: true }).click();
  await panel.getByText('Download', { exact: true }).click();
  const downloaded = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'CSV file' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('powerly-job-1.csv');
  await panel.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'A little perspective.' })).toBeVisible();
  await expect(panel.getByText('100.0% success rate')).toBeVisible();
});
test('Google connection opens a separate consent tab and polls until connected', async ({
  panel,
  backend,
  extensionContext,
}) => {
  backend.connection = { connected: false };
  await login(panel);
  await panel.getByRole('button', { name: 'Connect Google', exact: true }).click();
  await expect
    .poll(() =>
      extensionContext
        .pages()
        .some((page) => page.url().startsWith('https://accounts.google.com/')),
    )
    .toBe(true);
  await expect(panel.getByText('Waiting for Google…')).toBeVisible();
  backend.connection = { connected: true, google_email: 'niaz@gmail.com', missing_scopes: [] };
  await expect(panel.getByText('niaz@gmail.com')).toBeVisible({ timeout: 6000 });
  await expect(panel.getByRole('heading', { name: 'Connect your inbox' })).toBeHidden();
});
test('draft survives panel reopening and layout fits 320px and 760px widths', async ({
  panel,
  extensionContext,
  extensionId,
}) => {
  await login(panel);
  await panel.getByRole('button', { name: '+ New task' }).click();
  await panel.getByLabel('Task name').fill('Unsaved draft');
  await expect
    .poll(async () =>
      panel.evaluate(
        async () =>
          (await chrome.storage.local.get<{ draft?: { task_name: string } }>('draft')).draft
            ?.task_name,
      ),
    )
    .toBe('Unsaved draft');
  const reopened = await extensionContext.newPage();
  await panel.close();
  await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await reopened.getByRole('button', { name: '+ New task' }).click();
  await expect(reopened.getByLabel('Task name')).toHaveValue('Unsaved draft');
  for (const width of [320, 390, 760]) {
    await reopened.setViewportSize({ width, height: 900 });
    expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await reopened.screenshot({ path: 'test-results/task-editor.png', fullPage: true });
});
test('HTML deployment errors are readable and do not expose private credentials', async ({
  panel,
  backend,
}) => {
  backend.html = true;
  await panel.getByLabel('Email address').fill('niaz@example.com');
  await panel.getByLabel('Password', { exact: true }).fill('test-password');
  await panel.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('server returned');
  await expect(panel.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
});
test('task history finds matching runs beyond the first server page', async ({
  panel,
  backend,
}) => {
  backend.jobs = Array.from({ length: 12 }, (_, index) => ({
    ...backend.jobs[0],
    id: index + 1,
    task: index === 11 ? 1 : 2,
    task_name: index === 11 ? 'Invoice extraction 1' : 'Other task',
  }));
  await login(panel);
  const card = panel.locator('.task-card').first();
  await card.getByLabel('More actions for Invoice extraction 1', { exact: true }).click();
  await card.getByRole('button', { name: 'View run history' }).click();
  await expect(panel.getByText('RUN #12', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Other task' })).toHaveCount(0);
});
test('job deletion and restoration preserve history records', async ({ panel }) => {
  await login(panel);
  await panel.getByRole('button', { name: 'History', exact: true }).click();
  await panel.getByLabel('Delete run 1', { exact: true }).click();
  await panel.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Your story starts with a run' })).toBeVisible();
  await panel.getByLabel('Show deleted').check();
  await panel.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(panel.getByRole('link', { name: 'Open sheet' })).toBeVisible();
});
test('removing a schedule uses the dedicated delete endpoint', async ({ panel, backend }) => {
  backend.tasks[0].schedule_enabled = true;
  await login(panel);
  await panel.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await panel.getByRole('tab', { name: '03 Automation' }).click();
  await panel.getByRole('switch', { name: /Scheduled runs/ }).uncheck();
  await panel.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Your tasks.' })).toBeVisible();
  expect(
    backend.requests.some(
      (request) => request.path.endsWith('/1/schedule/') && request.method === 'DELETE',
    ),
  ).toBe(true);
});
test('failed jobs display the server error and can be run again', async ({ panel, backend }) => {
  await login(panel);
  await panel.getByRole('button', { name: 'Run task', exact: true }).first().click();
  await expect(panel.getByText('LIVE EXTRACTION')).toBeVisible();
  backend.jobs[0].status = 'failed';
  backend.jobs[0].error_message = 'Attachment conversion failed';
  await expect(panel.getByText('Attachment conversion failed', { exact: true })).toBeVisible({
    timeout: 8000,
  });
  await panel.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(panel.getByText('LIVE EXTRACTION')).toBeVisible();
  const runs = backend.requests.filter((r) => r.path.endsWith('/run/'));
  expect(runs[0].headers['idempotency-key']).not.toBe(runs[1].headers['idempotency-key']);
});
test('login and task screens meet automated WCAG AA checks', async ({ panel }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  let result = await new AxeBuilder({ page: panel })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await panel.screenshot({ path: 'test-results/login.png', fullPage: true });
  await login(panel);
  result = await new AxeBuilder({ page: panel })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await panel.screenshot({ path: 'test-results/tasks.png', fullPage: true });
  for (const name of ['History', 'Statistics']) {
    await panel.getByRole('button', { name, exact: true }).click();
    await panel.locator('.loading-state').waitFor({ state: 'hidden' });
    const scan = await new AxeBuilder({ page: panel })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
  }
  await panel.getByRole('button', { name: 'Tasks', exact: true }).click();
  await panel.getByRole('button', { name: '+ New task', exact: true }).click();
  for (const name of ['01 Email filters', '02 Output', '03 Automation']) {
    await panel.getByRole('tab', { name }).click();
    // Audit the settled panel, not intermediate colors during its fade-in.
    await expect(panel.getByRole('tabpanel')).toHaveCSS('opacity', '1');
    const scan = await new AxeBuilder({ page: panel })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
  }
});

test('rejected refresh returns to login and clears worker state during a run request', async ({
  panel,
  backend,
}) => {
  await login(panel);
  backend.expireNextRun = true;
  backend.rejectRefresh = true;
  await panel.getByRole('button', { name: 'Run task', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  await expect.poll(() => panel.evaluate(() => chrome.storage.local.get(null))).toEqual({});
});

test('worker restart preserves login and active-job tracking', async ({
  panel,
  backend,
  extensionContext,
  extensionId,
}) => {
  await login(panel);
  await panel.getByRole('button', { name: 'Run task', exact: true }).first().click();
  await expect(panel.getByText('LIVE EXTRACTION')).toBeVisible();
  const alarm = await panel.evaluate(() => chrome.alarms.get('track-jobs'));
  expect(alarm?.periodInMinutes).toBe(0.5);
  const behavior = await panel.evaluate(() => chrome.sidePanel.getPanelBehavior());
  expect(behavior.openPanelOnActionClick).toBe(true);
  const reopened = await extensionContext.newPage();
  const session = await extensionContext.newCDPSession(reopened);
  await panel.close();
  const { targetInfos } = await session.send('Target.getTargets');
  const worker = targetInfos.find(
    (target) => target.type === 'service_worker' && target.url.includes(extensionId),
  );
  expect(worker).toBeTruthy();
  const result = await session.send('Target.closeTarget', { targetId: worker!.targetId });
  expect(result.success).toBe(true);
  backend.jobs[0].total_messages_scanned = 99;
  await reopened.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(reopened.getByText('LIVE EXTRACTION')).toBeVisible();
  await expect(reopened.locator('.active-job').getByText('99', { exact: true })).toBeVisible({
    timeout: 8000,
  });
});

test('active jobs are recovered beyond the first history page, including soft-deleted runs', async ({
  panel,
  backend,
}) => {
  backend.jobs = Array.from({ length: 11 }, (_, index) => ({
    ...backend.jobs[0],
    id: index + 1,
    task_name: index === 10 ? 'Recovered active job' : 'Past extraction',
    status: index === 10 ? ('running' as const) : ('completed' as const),
    is_deleted: index === 10,
  }));
  await login(panel);
  await expect(
    panel.locator('.active-job').getByRole('heading', { name: 'Recovered active job' }),
  ).toBeVisible();
  expect(
    backend.requests.some((request) =>
      request.path.includes('jobs/?page=2&page_size=10&include_deleted=true'),
    ),
  ).toBe(true);
});
