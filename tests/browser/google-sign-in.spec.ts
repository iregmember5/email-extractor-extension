import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixture';
const built = existsSync(resolve('.test-auth-site/extension-auth.html'));
async function startWebsite(panel: Page, context: BrowserContext, site: string) {
  await panel.getByLabel('Powerly site', { exact: true }).fill(site);
  const opened = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const page = await opened;
  await page.waitForURL(`${site}/extension-auth.html?**`);
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeEnabled();
  return page;
}
async function authorize(page: Page) {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const provider = await opened;
  await provider.getByRole('link', { name: 'Use test Google account' }).click();
  await expect(
    page.getByRole('button', { name: 'Connect Email Extractor', exact: true }),
  ).toBeVisible();
}
test.describe('Google website sign-in', () => {
  test.skip(!built, 'Run npm run test:google to build the companion web page first.');
  for (const site of ['https://mypowerly.com', 'http://localhost:5173']) {
    test(`signs in through ${site} and requires explicit account approval`, async ({
      panel,
      extensionContext,
      backend,
    }) => {
      const website = await startWebsite(panel, extensionContext, site);
      await authorize(website);
      await expect(website.getByText('google-user@example.com', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
      expect(
        await panel.evaluate(async () => (await chrome.storage.local.get('session')).session),
      ).toBeUndefined();
      const exchange = backend.requests.find(
        (request) => request.path === '/v1/api/auth/google-site-login/',
      );
      expect(exchange?.headers.origin).toBe(site);
      expect(exchange?.body).toEqual({ code: 'test-google-code', redirect_uri: `${site}/sign-in` });
      expect(exchange?.headers.authorization).toBeUndefined();
      await website.getByRole('button', { name: 'Connect Email Extractor', exact: true }).click();
      await expect(website.getByRole('heading', { name: 'You’re connected.' })).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Your tasks.' })).toBeVisible({
        timeout: 8000,
      });
      await panel.getByLabel('Account menu').click();
      await expect(panel.getByText('google-user@example.com', { exact: true })).toBeVisible();
      for (const page of extensionContext.pages()) {
        expect(page.url()).not.toContain('google-access');
        expect(page.url()).not.toContain('google-refresh');
      }
    });
  }
  test('receives the code before an existing website session redirects the popup', async ({
    panel,
    extensionContext,
    backend,
  }) => {
    backend.fastGoogleRedirect = true;
    const website = await startWebsite(panel, extensionContext, 'https://mypowerly.com');
    await authorize(website);
    await website.getByRole('button', { name: 'Connect Email Extractor', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Your tasks.' })).toBeVisible({
      timeout: 8000,
    });
    expect(
      backend.requests.filter((request) => request.path === '/v1/api/auth/google-site-login/'),
    ).toHaveLength(1);
  });
  test('rejects a forged nonce and a second tab, then consumes a successful handoff once', async ({
    panel,
    extensionContext,
    extensionId,
  }) => {
    const website = await startWebsite(panel, extensionContext, 'https://mypowerly.com');
    const state = new URL(website.url()).searchParams.get('state')!;
    const fakeSession = {
      access: 'fake-access',
      refresh: 'fake-refresh',
      user: { id: 47, email: 'forged@example.com' },
    };
    const wrong = await website.evaluate(
      async ({ id, session }) =>
        chrome.runtime.sendMessage(id, { type: 'POWERLY_GOOGLE_SIGN_IN', state: 'wrong', session }),
      { id: extensionId, session: fakeSession },
    );
    expect(wrong.ok).toBe(false);
    const other = await extensionContext.newPage();
    await other.goto(website.url());
    const wrongTab = await other.evaluate(
      async ({ id, state, session }) =>
        chrome.runtime.sendMessage(id, { type: 'POWERLY_GOOGLE_SIGN_IN', state, session }),
      { id: extensionId, state, session: fakeSession },
    );
    expect(wrongTab.ok).toBe(false);
    await authorize(website);
    await website.getByRole('button', { name: 'Connect Email Extractor', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Your tasks.' })).toBeVisible({
      timeout: 8000,
    });
    const replay = await website.evaluate(
      async ({ id, state, session }) =>
        chrome.runtime.sendMessage(id, { type: 'POWERLY_GOOGLE_SIGN_IN', state, session }),
      { id: extensionId, state, session: fakeSession },
    );
    expect(replay.ok).toBe(false);
  });
  test('rejects a mismatched Google provider state before exchanging any code', async ({
    panel,
    extensionContext,
    backend,
  }) => {
    backend.badGoogleState = true;
    const website = await startWebsite(panel, extensionContext, 'https://mypowerly.com');
    const opened = website.waitForEvent('popup');
    await website.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    const provider = await opened;
    await provider.getByRole('link', { name: 'Use test Google account' }).click();
    await expect(website.getByRole('alert')).toContainText('could not be verified');
    expect(
      backend.requests.some((request) => request.path === '/v1/api/auth/google-site-login/'),
    ).toBe(false);
  });
  test('canceling sign-in invalidates the website request', async ({
    panel,
    extensionContext,
    extensionId,
  }) => {
    const website = await startWebsite(panel, extensionContext, 'https://mypowerly.com');
    const state = new URL(website.url()).searchParams.get('state')!;
    await panel.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Continue with Google', exact: true }),
    ).toBeEnabled();
    const result = await website.evaluate(
      async ({ id, state }) =>
        chrome.runtime.sendMessage(id, {
          type: 'POWERLY_GOOGLE_SIGN_IN',
          state,
          session: { access: 'fake', refresh: 'fake', user: { id: 1, email: 'test@example.com' } },
        }),
      { id: extensionId, state },
    );
    expect(result.ok).toBe(false);
    expect(
      await panel.evaluate(async () => (await chrome.storage.local.get('session')).session),
    ).toBeUndefined();
  });
  test('login can finish after the side panel closes and reopens', async ({
    panel,
    extensionContext,
    extensionId,
  }) => {
    const website = await startWebsite(panel, extensionContext, 'https://mypowerly.com');
    await panel.close();
    await authorize(website);
    await website.getByRole('button', { name: 'Connect Email Extractor', exact: true }).click();
    await expect(website.getByRole('heading', { name: 'You’re connected.' })).toBeVisible();
    const reopened = await extensionContext.newPage();
    await reopened.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(reopened.getByRole('heading', { name: 'Your tasks.' })).toBeVisible();
  });
});
