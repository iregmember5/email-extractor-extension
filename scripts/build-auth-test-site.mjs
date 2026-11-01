import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const extensionId = createHash('sha256')
  .update(resolve('dist'))
  .digest()
  .subarray(0, 16)
  .toString('hex')
  .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)));
const result = spawnSync('npm', ['run', 'build:companion'], {
  cwd: resolve('.'),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_API_URL: 'https://mypowerly.com/v1',
    VITE_POWERLY_EXTENSION_IDS: extensionId,
    VITE_REACT_APP_GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com',
    EXTENSION_AUTH_OUT_DIR: resolve('.test-auth-site'),
  },
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Built mock-configured sign-in companion for test extension ${extensionId}.`);
