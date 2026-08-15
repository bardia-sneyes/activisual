import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
];
export const HARNESSES = ['codex', 'claude', 'pi', 'opencode', 'hermes'];

const PACKAGE_REFERENCE = 'activisual';
const HARNESS_ALIASES = new Map([
  ['claude-code', 'claude'],
  ['open-code', 'opencode'],
]);

export function normalizeHarness(value) {
  const input = String(value).toLowerCase();
  const normalized = HARNESS_ALIASES.get(input) || input;
  if (!HARNESSES.includes(normalized)) {
    throw new Error(`Unsupported harness: ${value}. Choose ${HARNESSES.join(', ')}, or all.`);
  }
  return normalized;
}

export async function installHarnesses(projectRoot, harnesses, options = {}) {
  const requested = harnesses.includes('all') ? HARNESSES : [...new Set(harnesses.map(normalizeHarness))];
  const results = [];
  for (const harness of requested) results.push(await installHarness(projectRoot, harness, options));
  return results;
}

export async function installHarness(projectRoot, harness, options = {}) {
  const id = normalizeHarness(harness);
  if (id === 'codex' || id === 'claude') return installCommandHooks(projectRoot, id, options);
  if (id === 'pi') return installPi(projectRoot, options);
  if (id === 'opencode') return installOpenCode(projectRoot, options);
  return installHermes(options);
}

// Backwards-compatible API for the original Codex-only installer.
export async function installHooks(projectRoot) {
  return installHarness(projectRoot, 'codex');
}

async function installCommandHooks(projectRoot, harness, options) {
  const homeRoot = options.homeRoot || os.homedir();
  const baseDir = options.global
    ? path.join(homeRoot, harness === 'codex' ? '.codex' : '.claude')
    : path.join(projectRoot, harness === 'codex' ? '.codex' : '.claude');
  const hookDir = path.join(baseDir, 'hooks');
  const configPath = path.join(baseDir, harness === 'codex' ? 'hooks.json' : 'settings.json');
  const runtimeSource = fileURLToPath(new URL('./hook-runtime.mjs', import.meta.url));
  const runtimeTarget = path.join(hookDir, 'activisual.mjs');
  const command = `node ${JSON.stringify(runtimeTarget.replaceAll('\\', '/'))}`;
  await fs.mkdir(hookDir, { recursive: true });

  const config = await readJson(configPath);
  if (harness === 'codex') config.description ||= 'Project lifecycle hooks.';
  config.hooks ||= {};

  for (const event of EVENTS) {
    config.hooks[event] ||= [];
    const installedGroup = config.hooks[event].find((group) =>
      group?.hooks?.some((hook) => isActivisualCommand(hook?.command)),
    );
    if (installedGroup) {
      for (const hook of installedGroup.hooks) {
        if (isActivisualCommand(hook?.command)) hook.command = command;
      }
    } else {
      config.hooks[event].push({
        hooks: [{ type: 'command', command, timeout: event === 'SessionEnd' ? 3 : 5 }],
      });
    }
  }

  await fs.copyFile(runtimeSource, runtimeTarget);
  await fs.chmod(runtimeTarget, 0o755);
  await writeJson(configPath, config);
  return { harness, scope: options.global ? 'user' : 'project', configPath, runtimeTarget };
}

async function installPi(projectRoot, options) {
  const configPath = options.global
    ? path.join(options.homeRoot || os.homedir(), '.pi', 'agent', 'settings.json')
    : path.join(projectRoot, '.pi', 'settings.json');
  const config = await readJson(configPath);
  config.packages ||= [];
  if (!config.packages.some((entry) => packageSource(entry) === `npm:${PACKAGE_REFERENCE}`)) {
    config.packages.push(`npm:${PACKAGE_REFERENCE}`);
  }
  await writeJson(configPath, config);
  return { harness: 'pi', scope: options.global ? 'user' : 'project', configPath };
}

async function installOpenCode(projectRoot, options) {
  const configPath = options.global
    ? path.join(options.homeRoot || os.homedir(), '.config', 'opencode', 'opencode.json')
    : path.join(projectRoot, 'opencode.json');
  const config = await readJson(configPath);
  config.$schema ||= 'https://opencode.ai/config.json';
  config.plugin ||= [];
  if (!config.plugin.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === PACKAGE_REFERENCE)) {
    config.plugin.push(PACKAGE_REFERENCE);
  }
  await writeJson(configPath, config);
  return { harness: 'opencode', scope: options.global ? 'user' : 'project', configPath };
}

async function installHermes(options) {
  // Hermes only loads arbitrary third-party plugins from its user plugin directory by default.
  const homeRoot = options.homeRoot || os.homedir();
  const pluginDir = path.join(homeRoot, '.hermes', 'plugins', 'activisual');
  const configPath = path.join(homeRoot, '.hermes', 'config.yaml');
  const manifestSource = fileURLToPath(new URL('../plugin.yaml', import.meta.url));
  const pluginSource = fileURLToPath(new URL('../__init__.py', import.meta.url));
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.copyFile(manifestSource, path.join(pluginDir, 'plugin.yaml'));
  await fs.copyFile(pluginSource, path.join(pluginDir, '__init__.py'));

  let source = '{}\n';
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const document = parseDocument(source || '{}\n');
  if (document.errors.length) throw new Error(`Cannot parse ${configPath}: ${document.errors[0].message}`);
  const enabledNode = document.getIn(['plugins', 'enabled']);
  const enabled = enabledNode?.toJSON?.() || [];
  if (!Array.isArray(enabled)) throw new Error(`${configPath}: plugins.enabled must be a list`);
  if (!enabled.includes('activisual')) document.setIn(['plugins', 'enabled'], [...enabled, 'activisual']);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, String(document), 'utf8');
  return { harness: 'hermes', scope: 'user', configPath, pluginDir };
}

export async function hooksInstalled(projectRoot, harness = 'codex', options = {}) {
  const id = normalizeHarness(harness);
  try {
    if (id === 'codex' || id === 'claude') {
      const homeRoot = options.homeRoot || os.homedir();
      const baseDir = options.global
        ? path.join(homeRoot, id === 'codex' ? '.codex' : '.claude')
        : path.join(projectRoot, id === 'codex' ? '.codex' : '.claude');
      const config = JSON.parse(await fs.readFile(path.join(baseDir, id === 'codex' ? 'hooks.json' : 'settings.json'), 'utf8'));
      return EVENTS.every((event) => config.hooks?.[event]?.some((group) =>
        group?.hooks?.some((hook) => isActivisualCommand(hook?.command)),
      ));
    }
    if (id === 'pi') {
      const configPath = options.global
        ? path.join(options.homeRoot || os.homedir(), '.pi', 'agent', 'settings.json')
        : path.join(projectRoot, '.pi', 'settings.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      return config.packages?.some((entry) => packageSource(entry) === `npm:${PACKAGE_REFERENCE}`) || false;
    }
    if (id === 'opencode') {
      const configPath = options.global
        ? path.join(options.homeRoot || os.homedir(), '.config', 'opencode', 'opencode.json')
        : path.join(projectRoot, 'opencode.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      return config.plugin?.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === PACKAGE_REFERENCE) || false;
    }
    await fs.access(path.join(options.homeRoot || os.homedir(), '.hermes', 'plugins', 'activisual', 'plugin.yaml'));
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Cannot parse ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isActivisualCommand(command) {
  return typeof command === 'string' && /(?:^|[\\/])activisual\.mjs(?:["']?$)/.test(command);
}

function packageSource(entry) {
  return typeof entry === 'string' ? entry : entry?.source;
}
