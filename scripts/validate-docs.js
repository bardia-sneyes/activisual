import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const documents = [
  'README.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'RELEASING.md',
  'docs/architecture.md',
  'docs/product-brief.md',
];

for (const document of documents) {
  const source = await fs.readFile(path.join(root, document), 'utf8');
  assert.doesNotMatch(source, /â€”|â€¦|Â·/, `${document} contains broken UTF-8 text`);

  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split(/\s+["']/)[0];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const relative = decodeURIComponent(target.split('#')[0]);
    const resolved = path.resolve(root, path.dirname(document), relative);
    await assert.doesNotReject(fs.access(resolved), `${document} links to missing file: ${relative}`);
  }
}

const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
assert.doesNotMatch(readme, /^## (?:Publishing|Releasing)$/m, 'maintainer release instructions do not belong in README.md');
assert.doesNotMatch(readme, /NPM_TOKEN|first npm release|private repository|\bMVP\b/i);
assert.equal((readme.match(/dashboard\.png/g) || []).length, 1, 'README.md must show one dashboard screenshot');
for (const harness of ['Codex', 'Claude Code', 'Pi', 'OpenCode', 'Hermes Agent']) {
  assert.match(readme, new RegExp(`\\b${harness.replace(' ', '\\s+')}\\b`), `README.md must document ${harness}`);
}

const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.ok(!packageJson.files.includes('RELEASING.md'), 'maintainer release instructions must stay out of the npm package');

console.log('Public documentation links, wording, and harness coverage are consistent.');
