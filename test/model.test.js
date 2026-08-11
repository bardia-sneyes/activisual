import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, classifyTool, extractFiles } from '../src/model.js';

const at = (second) => `2026-08-11T10:00:${String(second).padStart(2, '0')}.000Z`;

test('pairs tool lifecycle events into meaningful work chunks', () => {
  const common = { sessionId: 'session-1', model: 'codex-model', cwd: '/work/app' };
  const session = buildSession([
    { ...common, id: 'start', event: 'SessionStart', source: 'startup', receivedAt: at(0) },
    { ...common, id: 'prompt', event: 'UserPromptSubmit', turnId: 'turn-1', prompt: 'Implement the product brief', receivedAt: at(1) },
    { ...common, id: 'pre-test', event: 'PreToolUse', turnId: 'turn-1', toolUseId: 'call-1', toolName: 'Bash', toolInput: { command: 'npm test' }, receivedAt: at(2) },
    { ...common, id: 'post-test', event: 'PostToolUse', turnId: 'turn-1', toolUseId: 'call-1', toolName: 'Bash', toolInput: { command: 'npm test' }, toolResponse: { exit_code: 0 }, receivedAt: at(4) },
    { ...common, id: 'pre-write', event: 'PreToolUse', turnId: 'turn-1', toolUseId: 'call-2', toolName: 'apply_patch', toolInput: { command: '*** Update File: src/app.js' }, receivedAt: at(5) },
    { ...common, id: 'post-write', event: 'PostToolUse', turnId: 'turn-1', toolUseId: 'call-2', toolName: 'apply_patch', toolInput: { command: '*** Update File: src/app.js' }, toolResponse: 'Done!', receivedAt: at(6) },
    { ...common, id: 'stop', event: 'Stop', turnId: 'turn-1', receivedAt: at(7) },
  ], '/work/app');

  const testChunk = session.chunks.find((chunk) => chunk.id === 'call-1');
  const writeChunk = session.chunks.find((chunk) => chunk.id === 'call-2');
  assert.equal(testChunk.type, 'test');
  assert.equal(testChunk.status, 'complete');
  assert.equal(testChunk.durationMs, 2000);
  assert.equal(writeChunk.type, 'write');
  assert.deepEqual(writeChunk.files, [{ path: 'src/app.js', action: 'write' }]);
  assert.equal(session.stats.completed, 5);
  assert.equal(session.status, 'idle');
});

test('classifies failures, builds, git operations, and project files', () => {
  assert.equal(classifyTool('Bash', 'npm run build'), 'build');
  assert.equal(classifyTool('Bash', 'git commit -m test'), 'git');
  assert.deepEqual(extractFiles('node src/cli.js docs/product-brief.md /outside/secret.txt', '/work/app'), [
    { path: 'src/cli.js', action: 'read' },
    { path: 'docs/product-brief.md', action: 'read' },
  ]);
});
