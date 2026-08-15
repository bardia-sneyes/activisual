import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { EVENTS, HARNESSES, installHarnesses, hooksInstalled } from '../src/install.js';

test('installs every harness idempotently while preserving existing config', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-install-'));
  const homeRoot = path.join(root, 'home');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'hooks.json'), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
  }));
  await fs.writeFile(path.join(root, 'opencode.json'), JSON.stringify({ plugin: ['existing-plugin'] }));
  await fs.mkdir(path.join(homeRoot, '.hermes'), { recursive: true });
  await fs.writeFile(path.join(homeRoot, '.hermes', 'config.yaml'), 'model: test\nplugins:\n  enabled:\n    - existing\n');

  await installHarnesses(root, ['all'], { homeRoot });
  await installHarnesses(root, ['all'], { homeRoot });

  const codex = JSON.parse(await fs.readFile(path.join(root, '.codex', 'hooks.json'), 'utf8'));
  const claude = JSON.parse(await fs.readFile(path.join(root, '.claude', 'settings.json'), 'utf8'));
  for (const config of [codex, claude]) {
    assert.deepEqual(Object.keys(config.hooks).sort(), [...EVENTS].sort());
    for (const event of EVENTS) {
      assert.equal(config.hooks[event].filter((group) => group.hooks?.some((hook) => /activisual\.mjs/.test(hook.command))).length, 1);
    }
  }
  assert.equal(codex.hooks.Stop.some((group) => group.hooks?.some((hook) => hook.command === 'echo existing')), true);

  const pi = JSON.parse(await fs.readFile(path.join(root, '.pi', 'settings.json'), 'utf8'));
  assert.deepEqual(pi.packages, ['npm:activisual']);

  const opencode = JSON.parse(await fs.readFile(path.join(root, 'opencode.json'), 'utf8'));
  assert.deepEqual(opencode.plugin, ['existing-plugin', 'activisual']);
  assert.equal(opencode.$schema, 'https://opencode.ai/config.json');

  const hermes = parse(await fs.readFile(path.join(homeRoot, '.hermes', 'config.yaml'), 'utf8'));
  assert.deepEqual(hermes.plugins.enabled, ['existing', 'activisual']);
  assert.equal(hermes.model, 'test');
  assert.match(await fs.readFile(path.join(homeRoot, '.hermes', 'plugins', 'activisual', '__init__.py'), 'utf8'), /register_hook/);

  for (const harness of HARNESSES) assert.equal(await hooksInstalled(root, harness, { homeRoot }), true);
});

test('global installs target each harness user configuration directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-global-'));
  const homeRoot = path.join(root, 'home');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const results = await installHarnesses(root, ['codex', 'claude', 'pi', 'opencode'], { global: true, homeRoot });
  assert.equal(results.every((result) => result.scope === 'user'), true);
  assert.equal(await hooksInstalled(root, 'codex', { global: true, homeRoot }), true);
  assert.equal(await hooksInstalled(root, 'claude', { global: true, homeRoot }), true);
  assert.equal(await hooksInstalled(root, 'pi', { global: true, homeRoot }), true);
  assert.equal(await hooksInstalled(root, 'opencode', { global: true, homeRoot }), true);
});
