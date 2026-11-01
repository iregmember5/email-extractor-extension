# Google sign-in website companion

This small React page must be served from the Powerly tenant's website origin. It exchanges the Google authorization code through the existing `POST /v1/api/auth/google-site-login/` endpoint, preserving that website's browser Origin. After the user approves the displayed account, it sends the resulting Powerly session to the extension through Chrome external messaging.

## Local setup

From the repository root:

```bash
npm ci
npm run build
cp website-companion/.env.example website-companion/.env.local
```

Edit `website-companion/.env.local`:

- `VITE_REACT_APP_GOOGLE_CLIENT_ID`: the public Google OAuth client ID already configured for your Powerly backend. Never add a Google client secret.
- `VITE_POWERLY_EXTENSION_IDS`: the exact extension ID shown by `chrome://extensions`, or comma-separated approved IDs.
- `VITE_API_URL`: the backend base, normally `https://mypowerly.com/v1`.

The Google OAuth project's registered redirect URIs must include exactly `http://localhost:5173/sign-in`. Then run:

```bash
npm run dev:companion
```

The standalone companion listens on `127.0.0.1:5173`. That port must be available. If your existing Powerly web app already serves this companion at the same origin, continue using that app instead; do not launch a second server on its port.

Load the extension's `dist/` folder in Chrome, enter `http://localhost:5173` in **Powerly site**, and click **Continue with Google**. Complete Google sign-in on the website and approve **Connect Email Extractor**. The side panel updates automatically.

The site URL, including the port, matters to tenant selection. Do not change ports or substitute a different hostname without configuring the matching tenant and Google callback.

## Build and deploy

```bash
npm run build:companion
```

This emits `dist-companion/extension-auth.html`, `dist-companion/sign-in.html`, and `dist-companion/extension-auth-assets/`. Production builds require an explicit approved extension ID in the environment. The extension manifest separately approves Powerly HTTPS domains and loopback development origins; other custom domains require explicit manifest and site-validator approval.

### Deploy alongside an existing Powerly web app

Deploy `extension-auth.html` and `extension-auth-assets/` to the website root. Preserve the existing `/sign-in` route. Add this module before the SPA entry script in the existing website HTML:

```html
<script type="module" src="/extension-auth-assets/callback.js"></script>
```

It relays only same-origin authorization callbacks with the expected state shape to the opener. The companion independently validates the popup source and random provider state before exchanging the code. Running this before the SPA router prevents an already-authenticated web session from redirecting the popup before the code is received. Ordinary website navigation and login flows are ignored by the relay.

The existing e-signature checkout was integrated directly through its `src/main.tsx` and an additional Vite HTML entry. This repository contains the equivalent standalone source, so a clone does not need that separate checkout to build or test.

### Standalone deployment

Serve the generated output on the intended tenant origin. Configure an **internal rewrite** from `/sign-in` to `/sign-in.html`, preserving the browser URL and query string. Do not redirect the browser to `/sign-in.html`, and do not overwrite an existing Powerly login route. The Vite development and preview middleware already perform this internal rewrite.

Register `${siteOrigin}/sign-in` with Google and approve the published extension ID in `VITE_POWERLY_EXTENSION_IDS` before building. A public OAuth client ID and the backend's existing Google integration are required; this repository does not provision a Google Cloud project or change backend tenant configuration.

## Trust boundaries and verification

The extension validates a single-use request state, expiration, selected site origin, exact page path, browser tab, and top-level frame. The companion additionally requires the extension ID to be approved by the website. The Google provider state is separate from the extension handoff state. Tokens are never placed in redirect URLs or persisted by the companion page. Credentials remain in memory until explicit account approval.

Google identity sign-in and connecting Gmail/Sheets/Drive are separate flows. Backend APIs continue to verify the Powerly JWT; any extra origin-to-tenant mapping required by authenticated API middleware remains backend configuration.

From the repository root, `npm run check` builds both clients and runs unit and Chromium tests. `npm run test:google` runs only the Google integration tests. The tests mock provider consent and token exchange, cover both website and localhost origins, and do not use real account credentials.
