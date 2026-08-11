import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installHooks, hooksInstalled } from '../src/install.js';

test('installs idempotent hooks while preserving existing hook groups', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-install-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } }));

  await installHooks(root);
  await installHooks(root);
  const config = JSON.parse(await fs.readFile(path.join(root, '.codex', 'hooks.json'), 'utf8'));
  assert.equal(config.hooks.Stop.filter((group) => group.hooks?.some((hook) => hook.command.includes('activisual.mjs'))).length, 1);
  assert.equal(config.hooks.Stop.some((group) => group.hooks?.some((hook) => hook.command === 'echo existing')), true);
  assert.equal(await hooksInstalled(root), true);

  const runtime = await fs.readFile(path.join(root, '.codex', 'hooks', 'activisual.mjs'), 'utf8');
  assert.match(runtime, /Never affect the Codex operation/);
});
