import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSession, classifyTool, extractDiff, extractFiles } from '../src/model.js';

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
  assert.equal(classifyTool('Bash', 'Get-Content src/model.js; rg --files'), 'read');
  assert.deepEqual(extractFiles('node src/cli.js docs/product-brief.md /outside/secret.txt', '/work/app'), [
    { path: 'src/cli.js', action: 'read' },
    { path: 'docs/product-brief.md', action: 'read' },
  ]);
});

test('does not classify a successful textual exit code as an error', () => {
  const common = { sessionId: 'session-2', cwd: '/work/app', turnId: 'turn-1', toolName: 'apply_patch' };
  const session = buildSession([
    { ...common, id: 'pre-ok', event: 'PreToolUse', toolUseId: 'call-ok', toolInput: { command: '*** Update File: src/app.js' }, receivedAt: at(1) },
    { ...common, id: 'post-ok', event: 'PostToolUse', toolUseId: 'call-ok', toolInput: { command: '*** Update File: src/app.js' }, toolResponse: 'Exit code: 0\nSuccess. Updated the following files.', receivedAt: at(2) },
    { ...common, id: 'pre-fail', event: 'PreToolUse', toolUseId: 'call-fail', toolInput: { command: '*** Update File: src/bad.js' }, receivedAt: at(3) },
    { ...common, id: 'post-fail', event: 'PostToolUse', toolUseId: 'call-fail', toolInput: { command: '*** Update File: src/bad.js' }, toolResponse: 'Script failed\nExit code: 1', receivedAt: at(4) },
  ], '/work/app');

  assert.equal(session.chunks.find((chunk) => chunk.id === 'call-ok').status, 'complete');
  assert.equal(session.chunks.find((chunk) => chunk.id === 'call-fail').status, 'error');
});

test('labels Bash file inspection as Read', () => {
  const common = { sessionId: 'session-3', cwd: '/work/app', turnId: 'turn-1', toolName: 'Bash' };
  const session = buildSession([
    { ...common, id: 'pre', event: 'PreToolUse', toolUseId: 'call-read', toolInput: { command: 'Get-Content src/model.js; rg --files test' }, receivedAt: at(1) },
    { ...common, id: 'post', event: 'PostToolUse', toolUseId: 'call-read', toolInput: { command: 'Get-Content src/model.js; rg --files test' }, toolResponse: 'Exit code: 0', receivedAt: at(2) },
  ], '/work/app');

  const chunk = session.chunks[0];
  assert.equal(chunk.type, 'read');
  assert.equal(chunk.title, 'Read');
  assert.equal(chunk.status, 'complete');
});

test('captures complete patch metadata without treating prose or mime types as files', () => {
  const patch = `*** Begin Patch
*** Update File: src/app.js
@@
-const oldValue = true;
+const newValue = true;
*** Add File: docs/new.md
+# New document
*** End Patch`;
  assert.deepEqual(extractDiff({ patch }), {
    text: patch,
    files: [
      { path: 'src/app.js', action: 'update', additions: 1, deletions: 1 },
      { path: 'docs/new.md', action: 'add', additions: 1, deletions: 0 },
    ],
    additions: 2,
    deletions: 1,
    truncated: false,
  });
  assert.deepEqual(extractFiles(`text/css agent/task 8/13/2026 ${patch}`, '/work/app'), [
    { path: 'src/app.js', action: 'read' },
    { path: 'docs/new.md', action: 'read' },
  ]);
});

test('associates permission requests with the tool call that was allowed', () => {
  const common = { sessionId: 'session-permission', cwd: '/work/app', turnId: 'turn-1', toolName: 'Bash' };
  const session = buildSession([
    { ...common, id: 'permission', event: 'PermissionRequest', toolUseId: 'call-1', permissionMode: 'guardian-approvals', permission: { risk: 'medium' }, toolInput: { command: 'npm test' }, receivedAt: at(1) },
    { ...common, id: 'pre', event: 'PreToolUse', toolUseId: 'call-1', permissionMode: 'guardian-approvals', toolInput: { command: 'npm test' }, receivedAt: at(2) },
    { ...common, id: 'post', event: 'PostToolUse', toolUseId: 'call-1', permissionMode: 'guardian-approvals', toolInput: { command: 'npm test' }, toolResponse: 'Exit code: 0', receivedAt: at(3) },
  ], '/work/app');
  const request = session.chunks.find((chunk) => chunk.title === 'Approval requested');
  const tool = session.chunks.find((chunk) => chunk.id === 'call-1');
  assert.equal(request.status, 'complete');
  assert.equal(request.relatedToolUseId, 'call-1');
  assert.equal(tool.permission.allowed, true);
  assert.equal(tool.permission.mode, 'guardian-approvals');
  assert.equal(tool.permission.risk, 'medium');
});
