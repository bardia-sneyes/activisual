#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createActivisualServer } from './server.js';
import { HARNESSES, installHarnesses, hooksInstalled } from './install.js';
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
  const installed = (await Promise.all(HARNESSES.flatMap((harness) => [
    hooksInstalled(projectRoot, harness),
    hooksInstalled(projectRoot, harness, { global: true }),
  ]))).some(Boolean);
  const app = await createActivisualServer({ projectRoot, port });

  console.log(`\n  ACTIVISUAL // LOCAL TRACE ONLINE`);
  console.log(`  ${app.url}`);
  console.log(`  project: ${projectRoot}`);
  console.log(`  privacy: localhost only · 30-day retention · no telemetry\n`);
  if (!installed) console.log(`  No Activisual integration found. Run: activisual install --harness all --project "${projectRoot}"\n`);
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
  const requested = (readOption(argv, '--harness') || 'codex')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const results = await installHarnesses(projectRoot, requested, { global: argv.includes('--global') });

  console.log(`Activisual installed for ${results.map((result) => result.harness).join(', ')}.`);
  for (const result of results) console.log(`  ${result.harness}: ${result.configPath}`);
  if (results.some((result) => result.harness === 'codex')) {
    console.log(`Review and trust the hooks with /hooks when Codex next starts.`);
  }
  if (results.some((result) => result.harness === 'claude')) {
    console.log(`Review the installed hooks with /hooks when Claude Code next starts.`);
  }
  if (results.some((result) => result.harness === 'hermes')) {
    console.log(`Restart Hermes to load the enabled Activisual plugin.`);
  }
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

function openBrowser(url) {
  const platform = process.platform;
  const commandName = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const commandArgs = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(commandName, commandArgs, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function help() {
  console.log(`Activisual — see agent work at a glance\n\nUsage:\n  activisual install [--harness NAME|all] [--project PATH] [--global]\n  activisual start [--project PATH] [--port ${DEFAULT_PORT}] [--no-open]\n\nHarnesses:\n  ${HARNESSES.join(', ')}\n\nCommands:\n  install   Install lifecycle capture for one harness (Codex by default)\n  start     Start the local dashboard and open it in your browser\n`);
}
