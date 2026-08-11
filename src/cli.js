#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createActivisualServer } from './server.js';
import { installHooks, hooksInstalled } from './install.js';
import { DEFAULT_PORT } from './config.js';

const [command = 'start', ...args] = process.argv.slice(2);

try {
  if (command === 'start') await start(args);
  else if (command === 'install') await install(args);
  else if (command === 'help' || command === '--help' || command === '-h') help();
  else {
    console.error(`Unknown command: ${command}\n`);
    help();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`activisual: ${error.message}`);
  process.exitCode = 1;
}

async function start(argv) {
  const projectRoot = path.resolve(readOption(argv, '--project') || process.cwd());
  const port = Number(readOption(argv, '--port') || DEFAULT_PORT);
  const shouldOpen = !argv.includes('--no-open');
  const installed = await hooksInstalled(projectRoot);
  const app = await createActivisualServer({ projectRoot, port });

  console.log(`\n  ACTIVISUAL // LOCAL TRACE ONLINE`);
  console.log(`  ${app.url}`);
  console.log(`  project: ${projectRoot}`);
  console.log(`  privacy: localhost only · 30-day retention · no telemetry\n`);
  if (!installed) console.log(`  Hooks are not installed. Run: activisual install --project "${projectRoot}"\n`);
  if (shouldOpen) openBrowser(app.url);

  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function install(argv) {
  const projectRoot = path.resolve(readOption(argv, '--project') || process.cwd());
  const result = await installHooks(projectRoot);
  console.log(`Activisual hooks installed for ${projectRoot}`);
  console.log(`Review and trust them with /hooks when Codex next starts.`);
  console.log(`Config: ${result.configPath}`);
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function help() {
  console.log(`Activisual — see a Codex session at a glance\n\nUsage:\n  activisual install [--project PATH]\n  activisual start [--project PATH] [--port ${DEFAULT_PORT}] [--no-open]\n\nCommands:\n  install   Add project-local Codex lifecycle hooks\n  start     Start the local dashboard and open it in your browser\n`);
}
