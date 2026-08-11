import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVENTS = [
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
const COMMAND = 'node "$(git rev-parse --show-toplevel)/.codex/hooks/activisual.mjs"';

export async function installHooks(projectRoot) {
  const codexDir = path.join(projectRoot, '.codex');
  const hookDir = path.join(codexDir, 'hooks');
  const configPath = path.join(codexDir, 'hooks.json');
  const runtimeSource = fileURLToPath(new URL('./hook-runtime.mjs', import.meta.url));
  const runtimeTarget = path.join(hookDir, 'activisual.mjs');
  await fs.mkdir(hookDir, { recursive: true });

  let config = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot parse ${configPath}: ${error.message}`);
  }
  config.description ||= 'Project lifecycle hooks.';
  config.hooks ||= {};

  for (const event of EVENTS) {
    config.hooks[event] ||= [];
    const alreadyInstalled = config.hooks[event].some((group) =>
      group?.hooks?.some((hook) => hook?.command === COMMAND),
    );
    if (!alreadyInstalled) {
      config.hooks[event].push({
        hooks: [{ type: 'command', command: COMMAND, timeout: event === 'SessionEnd' ? 3 : 5 }],
      });
    }
  }

  await fs.copyFile(runtimeSource, runtimeTarget);
  await fs.chmod(runtimeTarget, 0o755);
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { configPath, runtimeTarget };
}

export async function hooksInstalled(projectRoot) {
  try {
    const config = JSON.parse(await fs.readFile(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8'));
    return EVENTS.every((event) => config.hooks?.[event]?.some((group) =>
      group?.hooks?.some((hook) => hook?.command === COMMAND),
    ));
  } catch {
    return false;
  }
}
