#!/usr/bin/env node
// This file is copied into tracked projects by `activisual install`.
// Keep it dependency-free and fail-open: visualization must never block Codex.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REDACTED = '[redacted]';
const sensitiveKey = /(?:^|_)(?:api[_-]?key|authorization|cookie|credential|passwd|password|private[_-]?key|secret|session[_-]?token|token)(?:$|_)/i;

function redactText(value, maxLength = 12_000) {
  const clean = String(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, (match) => `${match.split('://')[0]}://${REDACTED}`)
    .replace(/\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1=[redacted]');
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}\n… [truncated]`;
}

function redact(value, depth = 0) {
  if (depth > 7) return '[depth limit]';
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitiveKey.test(key) ? REDACTED : redact(child, depth + 1)]));
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

function compact(input) {
  const event = String(input.hook_event_name || 'Unknown');
  const result = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    sessionId: safeId(input.session_id),
    turnId: input.turn_id ? safeId(input.turn_id) : null,
    event,
    cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    model: typeof input.model === 'string' ? input.model : null,
    permissionMode: typeof input.permission_mode === 'string' ? input.permission_mode : null,
  };
  if (['PreToolUse', 'PostToolUse'].includes(event)) {
    result.toolName = String(input.tool_name || 'tool');
    result.toolUseId = safeId(input.tool_use_id || result.id);
    result.toolInput = redact(input.tool_input);
    if (event === 'PostToolUse') result.toolResponse = redact(input.tool_response);
  } else if (event === 'PermissionRequest') {
    result.toolName = String(input.tool_name || 'tool');
    result.toolInput = redact(input.tool_input);
  } else if (event === 'UserPromptSubmit') {
    result.prompt = redactText(input.prompt || '', 4_000);
  } else if (event === 'SessionStart') result.source = String(input.source || 'startup');
  else if (event === 'SessionEnd') result.reason = String(input.reason || 'other');
  else if (event === 'SubagentStart' || event === 'SubagentStop') {
    result.agentId = safeId(input.agent_id || 'agent');
    result.agentType = String(input.agent_type || 'subagent');
  } else if (event === 'PreCompact' || event === 'PostCompact') result.trigger = String(input.trigger || input.source || 'auto');
  else if (event === 'Stop') result.stopHookActive = Boolean(input.stop_hook_active);
  else result.data = redact(input);
  return result;
}

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw || '{}');
  const root = path.resolve(input.cwd || process.cwd());
  const dataDir = path.join(root, '.activisual');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(dataDir, 'events.jsonl'), `${JSON.stringify(compact(input))}\n`, { encoding: 'utf8', mode: 0o600 });
} catch (error) {
  // Hooks are observational. Never affect the Codex operation they observe.
  if (process.env.ACTIVISUAL_DEBUG === '1') process.stderr.write(`${error.stack || error.message}\n`);
}
