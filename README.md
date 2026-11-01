# Powerly Email Extractor

A Manifest V3 Chrome side panel extension built with React, TypeScript, Tailwind CSS, and Vite. Extension API calls and stored credentials live in the extension service worker. The Google sign-in companion performs its authentication exchange from the selected website to preserve that tenant’s origin. No content scripts or Gmail DOM scraping are used.

## Run it

Use Node 24 LTS (Node 22.12+ is supported). A project-local Node 24 binary is also installed with the development dependencies so npm scripts can run on this machine’s older system Node.

```bash
cd email-extractor-extension
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome 120 or newer.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `the repository’s dist/ directory`.
4. Pin the extension and click its icon. The side panel opens beside any tab.
5. Sign in with your Powerly email/password, then connect Google.

After rebuilding, click **Reload** on the extension card and reopen the panel. The login screen should show **v1.0.2 · CHROME**. If it does not, Chrome is using an older build: remove the old extension card and load the exact `dist` folder shown above again. Login requests must target `/v1/api/auth/login/`, not `/api/auth/login/`. `npm run dev` provides a browser preview with setup instructions; API features intentionally require an installed extension and its worker.

The extension ID appears on the extension card. Give that exact ID to the backend team for `EXTENSION_ALLOWED_IDS`. An unpacked extension’s ID depends on its installation path; the Chrome Web Store supplies the published ID. CORS configuration does not replace authentication.

## Commands

| Command               | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `npm run build`       | Strict TypeScript check, production build, manifest/asset checks           |
| `npm test`            | API transport and task contract tests                                      |
| `npm run test:google` | Build and test the Google sign-in companion against the packaged extension |
| `npm run test:e2e`    | Packaged extension tests in Chromium with an isolated mock backend         |
| `npm run check`       | Build and both test suites                                                 |
| `npm run package`     | Build and create `powerly-email-extractor-1.0.2.zip`                       |
| `npm run dev`         | Vite preview of the extension setup screen                                 |

Google tests build the bundled companion automatically through `npm run check` or `npm run test:google`. Before the first browser test, run `npx playwright install chromium`. On a minimal Linux image, Playwright may also need its documented OS dependencies. Tests use temporary browser profiles, fake credentials, and mocked HTTPS responses; they do not log in to real accounts or mutate production data.

## Features

- Google sign-in through your selected Powerly site, with an approved website companion and explicit account consent.
- Embedded password login; persistent login; shared refresh for concurrent requests; sign-out clears extension-owned credentials, drafts, and job caches.
- Google OAuth in a new tab with connection polling every two seconds for up to two minutes; reconnect prompts for expired consent and missing scopes.
- Paginated task list (10 records per page), search, create, edit, duplicate, soft delete, and restore.
- Grouped system/category/custom Gmail labels with an empty required selection by default.
- Sender, subject, body, dates, excluded domains, thread expansion, and reply tracking.
- Every documented output field, reorderable columns, write modes, optional spreadsheet, and PDF archival.
- Python regex parsing rules for email bodies or attachment text, with backend validation.
- Scheduled runs with cadence/time/IANA timezone and dedicated schedule creation/removal endpoints.
- Mark as read/apply label after extraction, and webhook configuration.
- Save-and-preview with estimated counts, the Gmail query, and backend hints. Preview saves the task first because the preview endpoint requires a task ID.
- Run requests with persistent idempotency keys. Network/server-error retries reuse the original key; successful runs and definitive 4xx failures release it.
- Live scanned/found/new counters, an indeterminate progress indicator, completion/failure results, and sheet links.
- Paginated history, per-task history across all server pages, job soft delete/restore, and CSV/XLSX Blob downloads.
- Aggregate statistics, status counts, success rate, and recent runs.
- New-task draft recovery, responsive side panel layouts, keyboard navigation, reduced-motion support, and error boundaries.

## Verification

Verified on November 1, 2026:

- Production build, strict TypeScript checking, manifest assets, and ZIP integrity pass.
- 38 unit tests (including the website companion) and 23 Chromium extension/integration tests pass.
- Browser tests cover worker termination/restart, persisted login and active jobs, safe run retries, both kinds of soft deletion, pagination, per-task history, scheduling, Google connection, CSV download, statistics, and draft recovery.
- Automated WCAG A/AA checks pass on login, tasks, history, statistics, and each task editor section. Automated checks do not replace a complete manual accessibility audit.
- Responsive overflow checks pass at 320px, 390px, and 760px.
- `npm audit` reports no known vulnerabilities at verification time.
- Source formatting checks pass.

Screenshots: [Login](docs/previews/login.png), [Tasks](docs/previews/tasks.png), [Task editor](docs/previews/task-editor.png).

## Architecture

```text
src/
  background/api.ts     Authentication, refresh, route allowlist, HTTP errors
  background/index.ts   RPC, token storage, run keys, polling, Chrome alarms
  components/TaskForm.tsx
  components/Lists.tsx  Tasks, history, run progress, statistics
  components/ui.tsx     Shared accessible controls and dialogs
  App.tsx               Session, connection, navigation, live outcomes
  task.ts               Task defaults, validation, payload normalization
  rpc.ts                Typed panel-to-worker messaging and file downloads
  types.ts              Backend and extension contracts
  config.ts             API bases, web links, version
public/
  manifest.json         MV3 permissions, side panel, module worker, strict CSP
scripts/
  verify-build.mjs      Packaged manifest/assets/CSP checks
  package.py            Deterministic-path distributable ZIP
```

Tokens are stored only in `chrome.storage.local` with `TRUSTED_CONTEXTS` access, never in web page storage. `SESSION` responses give the UI user details, not JWTs. Panel messages must originate from this extension. HTTP routes are restricted to documented extractor paths. Links must use HTTPS; OAuth URLs must belong to `accounts.google.com`.

The service worker performs every backend call. The panel requests a status update every two seconds, waiting for the previous update to finish. Pending/running jobs survive panel closure in extension storage. Chrome alarms wake the worker every 30 seconds when the panel is closed. When no cached run is active, the worker discovers backend-created/scheduled runs every 30 seconds and paginates until it finds an active job or reaches the end. Deleted jobs are included in discovery because soft deletion does not cancel an extraction. Cached active jobs are polled directly. Chrome can defer alarms while asleep; backend extractions continue independently. Discovery does not assume a server sort order; very large histories require more list calls. Completed/failed jobs stop status polling.

Concurrent status updates are serialized when writing the job cache. Authentication refresh is shared, and an in-flight refresh cannot restore credentials after sign-out. A Google-related 401 after successful JWT refresh does not sign the user out of Powerly. Temporary refresh network/server failures preserve the session for retry.

The extension requests only `storage`, `sidePanel`, and `alarms`, plus host access to `https://mypowerly.com/*`. Opening authorization tabs does not require the broad `tabs` permission. No `activeTab`, content-script, or Gmail-host access is needed.

## Backend integration status

The client uses the deployed API mount used by the existing Powerly web application:

- Extractor: `https://mypowerly.com/v1/api/email-extractor/`
- Authentication: `https://mypowerly.com/v1/api/auth/`

The original guide explicitly omitted `/v1`, but production serves the web app HTML at those unprefixed URLs. Inspection of `~/ESignature-FrontendBugFix-by-Ssemugabi/src/configs/app.config.ts` and its active login service confirmed the web app combines `https://mypowerly.com/v1` with `/api/auth/login/`. The extension now uses that same deployed base for authentication and extraction.

Unauthenticated production checks on November 1, 2026 confirmed JSON responses at the `/v1` routes: login GET returns 405, while task and Google-connection GET requests return 401. Both wrapped and raw JWT login responses are supported; the existing web app consumes raw login data. A live check from the rebuilt, installed extension sent empty login fields and received HTTP 400 JSON validation errors from Django, confirming that Chrome can reach the corrected login endpoint without a local server or account credentials. Tokens remain in extension storage rather than web-page cookies or localStorage.

**No local development server is required** to use the built extension: Chrome loads the files from `dist` and the worker calls the remote HTTPS backend directly. After rebuilding, reload the extension in `chrome://extensions` and reopen the panel. Use credentials belonging to the intended white-label tenant. Matching the backend URL alone does not establish the same tenant context as the web app.

Live authenticated Gmail/Sheets extraction and the published extension’s CORS allowlist still require validation with a real account. Browser tests validate frontend behavior against an isolated backend using the corrected production URL prefix and raw login responses. The client continues to detect HTML responses rather than treating them as API data.

### Google sign-in and white-label tenant context

**Continue with Google is implemented.** Enter your Powerly site on the extension login screen. The extension opens that site's `/extension-auth.html`; the user signs in with Google there and explicitly approves connecting the account to Email Extractor. The companion exchanges the Google code using the existing `/v1/api/auth/google-site-login/` endpoint from the website origin, preserving the white-label tenant context. It returns the Powerly session through Chrome external messaging with request-state, origin, page, tab, frame, and expiry validation. No token is placed in a redirect URL.

The complete companion source is included in [`website-companion/`](website-companion/README.md). It builds with this repository's dependencies and does not require the original e-signature checkout.

For local setup, copy `website-companion/.env.example` to `website-companion/.env.local`, provide your site's public Google client ID and the exact unpacked extension ID, then run:

```bash
npm run dev:companion
```

Enter `http://localhost:5173` in **Powerly site**, then continue with Google and approve the account on the website page. This website-mediated localhost sign-in requires the local web server to be running. If your existing Powerly application already serves the companion on this origin, use that application instead of starting another server on the same port.

Google must allow the exact `http://localhost:5173/sign-in` callback. Production requires deploying the companion to the selected site, approving the published extension ID through `VITE_POWERLY_EXTENSION_IDS`, and registering the site's `/sign-in` URI with Google. See the companion README for integration into an existing web app or a standalone deployment. Real account consent and external Google Cloud settings are not verified by mocked tests.

Currently the extension approves `mypowerly.com`, its HTTPS subdomains, and loopback development hosts. Other custom domains require explicit manifest and site-validator approval. An unapproved or missing companion cannot complete sign-in.

Password login remains a direct extension request, so its previously identified tenant-origin mapping requirement is unchanged. CORS allowlisting and tenant resolution are separate concerns. Protected extractor APIs still enforce the resulting JWT, and any extra backend extension-origin mapping requirement must be configured server-side.

### Contract gaps handled explicitly

1. **Google sign-in versus Gmail connection:** Google sign-in uses the existing website `google-site-login` flow and the new companion page. The extractor authorize/status endpoints still serve the separate, authenticated Gmail/Sheets/Drive connection. They are not called as unauthenticated login endpoints.
2. **Cancellation:** There is no cancellation endpoint. The UI does not imply closing the panel or deleting a record cancels an active backend job.
3. **Percentage progress:** No total work count is supplied. Progress is indeterminate with accurate backend counters.
4. **Python regex sample testing:** There is no test endpoint. Browser JavaScript regex is not equivalent to Python regex. Patterns are sent unchanged and validated by the backend on save; the UI does not present a misleading JavaScript test as Python behavior.
5. **Export discrepancy:** Explicit `?format=csv|xlsx` downloads take precedence over the older metadata-only example. JSON metadata is never downloaded as a CSV/XLSX file; sheet links remain available.
6. **Schedule discrepancy:** The editor sends the chosen timezone to the dedicated schedule endpoint and uses the configured write mode. Append/upsert are recommended for preserving data; replace displays an overwrite warning. The backend’s returned `next_run_at` is authoritative. Weekly scheduling has no weekday input in the contract, so none is invented.
7. **Per-task history:** No task filter is documented for the jobs endpoint. The client reads paginated history and filters it by task locally. Large histories will require more API calls; a documented server filter would improve this.
8. **Spreadsheet overrides:** The per-task spreadsheet setting is supported. Manual runs use that stored configuration with `sheet_name: "Extracted Emails"`; no undocumented run control is invented.

## Sources checked

- [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [React versions](https://react.dev/versions)
- [Tailwind CSS Vite setup](https://tailwindcss.com/docs/installation/using-vite)

Dependency versions are resolved in `package-lock.json`. The implementation used npm’s latest stable releases at setup, including React 19.3.1, TypeScript 7.0.2, Tailwind CSS 4.3.3, and Vite 8.3.5.
