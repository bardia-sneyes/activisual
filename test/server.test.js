import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createActivisualServer } from '../src/server.js';

test('accepts local hook events, serves a grouped session, and deletes it', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-server-'));
  const app = await createActivisualServer({ projectRoot: root, port: 0 });
  t.after(async () => { await app.close(); await fs.rm(root, { recursive: true, force: true }); });

  const hookEvent = {
    session_id: 'server-test',
    turn_id: 'turn-1',
    hook_event_name: 'UserPromptSubmit',
    cwd: root,
    prompt: 'Build the dashboard',
  };
  const accepted = await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hookEvent) });
  assert.equal(accepted.status, 202);

  const sessionsResponse = await fetch(`${app.url}/api/sessions`);
  assert.match(sessionsResponse.headers.get('content-security-policy'), /default-src 'self'/);
  const sessions = await sessionsResponse.json();
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].id, 'server-test');

  const detail = await (await fetch(`${app.url}/api/sessions/server-test`)).json();
  assert.equal(detail.session.chunks[0].type, 'decision');
  assert.equal(detail.session.chunks[0].summary, 'Build the dashboard');

  const exported = await fetch(`${app.url}/api/sessions/server-test/export`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /activisual-server-test\.json/);
  assert.equal((await exported.json()).session.id, 'server-test');

  const removed = await fetch(`${app.url}/api/sessions/server-test`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await (await fetch(`${app.url}/api/sessions`)).json()).sessions.length, 0);
});

test('session deletion preserves concurrently appended events across restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'activisual-rotation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let app = await createActivisualServer({ projectRoot: root, port: 0 });
  const event = (sessionId, prompt) => ({
    session_id: sessionId,
    turn_id: 'turn-1',
    hook_event_name: 'UserPromptSubmit',
    cwd: root,
    prompt,
  });
  const post = (payload) => fetch(`${app.url}/api/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });

  await post(event('delete-me', 'temporary'));
  const [removed, preserved] = await Promise.all([
    fetch(`${app.url}/api/sessions/delete-me`, { method: 'DELETE' }),
    post(event('keep-me', 'must survive rotation')),
  ]);
  assert.equal(removed.status, 200);
  assert.equal(preserved.status, 202);
  assert.deepEqual((await (await fetch(`${app.url}/api/sessions`)).json()).sessions.map((session) => session.id), ['keep-me']);

  await app.close();
  app = await createActivisualServer({ projectRoot: root, port: 0 });
  assert.deepEqual((await (await fetch(`${app.url}/api/sessions`)).json()).sessions.map((session) => session.id), ['keep-me']);
  await app.close();
});
