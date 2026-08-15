import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventStore } from '../src/store.js';

const event = (sessionId, receivedAt) => ({ sessionId, receivedAt, event: 'TestEvent' });

test('reads partial appends and resets cleanly after inbox truncation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-store-'));
  const store = new EventStore(root);
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

  await fs.mkdir(store.paths.dataDir, { recursive: true });
  const first = JSON.stringify(event('first-session-with-a-long-id', '2026-08-15T10:00:00.000Z'));
  const second = JSON.stringify(event('second-session', '2026-08-15T10:00:01.000Z'));
  const splitAt = Math.floor(second.length / 2);
  await fs.writeFile(store.paths.inboxPath, `${first}\n${second.slice(0, splitAt)}`, 'utf8');

  await store.readNew();
  assert.deepEqual(store.events.map((item) => item.sessionId), ['first-session-with-a-long-id']);

  await fs.appendFile(store.paths.inboxPath, `${second.slice(splitAt)}\n`, 'utf8');
  await store.readNew();
  assert.deepEqual(store.events.map((item) => item.sessionId), ['first-session-with-a-long-id', 'second-session']);

  const replacement = JSON.stringify(event('new', '2026-08-15T10:00:02.000Z'));
  await fs.writeFile(store.paths.inboxPath, `${replacement}\n`, 'utf8');
  await store.readNew();
  assert.deepEqual(store.events.map((item) => item.sessionId), ['new']);
});
