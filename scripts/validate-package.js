import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EVENTS } from '../src/install.js';

const root = path.resolve(import.meta.dirname, '..');
const json = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));

const packageJson = await json('package.json');
assert.equal(packageJson.private, undefined, 'package must be publishable');
assert.equal(packageJson.bin.activisual, 'src/cli.js');
assert.deepEqual(packageJson.pi.extensions, ['./integrations/pi/index.js']);
assert.equal(packageJson.exports['.'], './integrations/opencode/index.js');

for (const manifestPath of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
  const manifest = await json(manifestPath);
  assert.equal(manifest.name, 'activisual');
  assert.equal(manifest.version, packageJson.version);
}

const hooks = await json('hooks/hooks.json');
assert.deepEqual(Object.keys(hooks.hooks), EVENTS);
for (const event of EVENTS) {
  const command = hooks.hooks[event][0].hooks[0].command;
  assert.match(command, /CLAUDE_PLUGIN_ROOT/);
  assert.match(command, /hook-runtime\.mjs/);
}

const hermes = await fs.readFile(path.join(root, 'plugin.yaml'), 'utf8');
assert.match(hermes, /^name: activisual$/m);
assert.match(hermes, new RegExp(`^version: "${packageJson.version.replaceAll('.', '\\.')}"$`, 'm'));

console.log('Package manifests and native hook declarations are consistent.');
