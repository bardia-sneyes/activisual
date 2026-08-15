import assert from 'node:assert/strict';
import fs from 'node:fs';

const tag = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.ok(tag, 'Pass the release tag, for example: v1.2.3');
assert.equal(tag, `v${pkg.version}`, `Release tag ${tag} does not match package version ${pkg.version}`);
console.log(`Release tag ${tag} matches package.json.`);
