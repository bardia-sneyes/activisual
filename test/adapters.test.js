import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mapPiEvent } from '../integrations/pi/index.js';
import { mapOpenCodeBusEvent, mapOpenCodeToolEvent } from '../integrations/opencode/index.js';

const piContext = {
  cwd: '/work/pi',
  sessionManager: { getSessionId: () => 'pi-session' },
};

test('Pi lifecycle payloads match the canonical Activisual hook schema', () => {
  const pending = new Map();
  assert.deepEqual(mapPiEvent('session_start', { reason: 'startup' }, piContext, pending), {
    session_id: 'pi-session', cwd: '/work/pi', hook_event_name: 'SessionStart', source: 'startup',
  });
  assert.deepEqual(mapPiEvent('tool_execution_start', {
    toolCallId: 'call-1', toolName: 'bash', args: { command: 'npm test' },
  }, piContext, pending), {
    session_id: 'pi-session', cwd: '/work/pi', hook_event_name: 'PreToolUse',
    tool_name: 'bash', tool_use_id: 'call-1', tool_input: { command: 'npm test' },
  });
  assert.deepEqual(mapPiEvent('tool_execution_end', {
    toolCallId: 'call-1', toolName: 'bash', result: { output: 'ok' }, isError: false,
  }, piContext, pending), {
    session_id: 'pi-session', cwd: '/work/pi', hook_event_name: 'PostToolUse',
    tool_name: 'bash', tool_use_id: 'call-1', tool_input: { command: 'npm test' },
    tool_response: { result: { output: 'ok' }, isError: false },
  });
});

test('OpenCode tool and session payloads match documented plugin fields', () => {
  assert.deepEqual(mapOpenCodeBusEvent({
    type: 'session.created',
    properties: { info: { id: 'ses-1', directory: '/work/open' } },
  }, '/fallback'), {
    session_id: 'ses-1', cwd: '/work/open', hook_event_name: 'SessionStart', source: 'startup',
  });
  assert.deepEqual(mapOpenCodeToolEvent('before', {
    tool: 'bash', sessionID: 'ses-1', callID: 'call-7',
  }, { args: { command: 'git status' } }, '/work/open'), {
    session_id: 'ses-1', cwd: '/work/open', hook_event_name: 'PreToolUse',
    tool_name: 'bash', tool_use_id: 'call-7', tool_input: { command: 'git status' },
  });
  assert.deepEqual(mapOpenCodeToolEvent('after', {
    tool: 'bash', sessionID: 'ses-1', callID: 'call-7', args: { command: 'git status' },
  }, { title: 'status', output: 'clean', metadata: {} }, '/work/open'), {
    session_id: 'ses-1', cwd: '/work/open', hook_event_name: 'PostToolUse',
    tool_name: 'bash', tool_use_id: 'call-7', tool_input: { command: 'git status' },
    tool_response: { title: 'status', output: 'clean', metadata: {} },
  });
});

test('Hermes adapter registers the documented observer hooks', async () => {
  const source = await fs.readFile(path.resolve('__init__.py'), 'utf8');
  for (const hook of [
    'on_session_start', 'pre_llm_call', 'pre_tool_call', 'post_tool_call',
    'pre_approval_request', 'on_session_end', 'on_session_finalize',
    'subagent_start', 'subagent_stop',
  ]) {
    assert.match(source, new RegExp(`register_hook\\(\\"${hook}\\"`));
  }
  assert.match(source, /def _pre_tool\(tool_name: str, args: Any, task_id:/);
  assert.match(source, /def _post_tool\(tool_name: str, args: Any, result: Any, task_id:/);
  assert.match(source, /def _approval\(command: str, description: str, session_key: str/);
});
