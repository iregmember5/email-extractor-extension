import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Manifest and package versions must match');
assert(
  readFileSync('src/config.ts', 'utf8').includes(`VERSION = '${pkg.version}'`),
  'UI and manifest versions must match',
);
for (const file of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...Object.values(manifest.icons),
])
  assert(existsSync(`dist/${file}`), `Missing extension asset: ${file}`);
const html = readFileSync('dist/index.html', 'utf8');
assert(!/<script(?![^>]*src=)[^>]*>\s*\S/.test(html), 'Inline scripts violate extension CSP');
assert(!html.includes('http://localhost'), 'Development URL in production build');
assert.deepEqual(manifest.host_permissions, ['https://mypowerly.com/*']);
console.log('Manifest, packaged assets, and production HTML verified.');
