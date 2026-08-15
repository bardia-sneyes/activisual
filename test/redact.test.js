import test from 'node:test';
import assert from 'node:assert/strict';
import { compactHookEvent, redactText, redactValue, REDACTED } from '../src/redact.js';

test('redacts common secrets from text and nested values', () => {
  const text = redactText('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz Bearer abc.def.ghi postgres://user:pass@localhost/db');
  assert.doesNotMatch(text, /abcdefghijklmnopqrstuvwxyz|abc\.def|user:pass/);
  assert.match(text, /\[redacted\]/);

  const value = redactValue({ password: 'hunter2', nested: { access_token: 'secret', safe: 'visible' } });
  assert.equal(value.password, REDACTED);
  assert.equal(value.nested.access_token, REDACTED);
  assert.equal(value.nested.safe, 'visible');
});

test('compacts hook payloads without persisting transcript paths', () => {
  const event = compactHookEvent({
    session_id: 'thr/123',
    turn_id: 'turn:1',
    hook_event_name: 'PostToolUse',
    cwd: '/tmp/project',
    transcript_path: '/private/transcript.jsonl',
    tool_name: 'Bash',
    tool_use_id: 'call/7',
    tool_input: { command: 'npm test' },
    tool_response: { exit_code: 0, authorization: 'Bearer secret' },
  }, '2026-08-11T10:00:00.000Z');

  assert.equal(event.sessionId, 'thr_123');
  assert.equal(event.toolUseId, 'call_7');
  assert.equal(event.toolResponse.authorization, REDACTED);
  assert.equal('transcript_path' in event, false);
});

test('captures the final assistant response on Stop', () => {
  const event = compactHookEvent({
    session_id: 'session-1',
    turn_id: 'turn-1',
    hook_event_name: 'Stop',
    last_assistant_message: 'Finished the requested work.',
  }, '2026-08-11T10:00:00.000Z');

  assert.equal(event.assistantResponse, 'Finished the requested work.');
});
