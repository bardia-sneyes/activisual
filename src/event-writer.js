import fs from 'node:fs/promises';
import path from 'node:path';
import { compactHookEvent } from './redact.js';

export async function appendHookInput(input, projectRoot = input.cwd || process.cwd()) {
  try {
    const root = path.resolve(projectRoot || process.cwd());
    const dataDir = path.join(root, '.activisual');
    const event = compactHookEvent({ ...input, cwd: input.cwd || root });
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fs.appendFile(path.join(dataDir, 'events.jsonl'), `${JSON.stringify(event)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return event;
  } catch (error) {
    if (process.env.ACTIVISUAL_DEBUG === '1') process.stderr.write(`${error.stack || error.message}\n`);
    return null;
  }
}
