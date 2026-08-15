const SENSITIVE_KEY = /(?:^|_)(?:api[_-]?key|authorization|cookie|credential|passwd|password|private[_-]?key|secret|session[_-]?token|token)(?:$|_)/i;
const SENSITIVE_ASSIGNMENT = /\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const OPENAI_KEY = /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const CONNECTION_STRING = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;

export const REDACTED = '[redacted]';

export function redactText(value, maxLength = 12_000) {
  if (typeof value !== 'string') return value;
  const clean = value
    .replace(PRIVATE_KEY, REDACTED)
    .replace(OPENAI_KEY, REDACTED)
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(CONNECTION_STRING, (match) => `${match.split('://')[0]}://${REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT, '$1=[redacted]');
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}\n… [truncated ${clean.length - maxLength} chars]`;
}

export function redactValue(value, options = {}, depth = 0) {
  const maxDepth = options.maxDepth ?? 7;
  const maxArray = options.maxArray ?? 50;
  const maxText = options.maxText ?? 12_000;

  if (depth > maxDepth) return '[depth limit]';
  if (typeof value === 'string') return redactText(value, maxText);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map((item) => redactValue(item, options, depth + 1));
    if (value.length > maxArray) items.push(`[${value.length - maxArray} more items]`);
    return items;
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(child, options, depth + 1);
  }
  return result;
}

export function compactHookEvent(input, receivedAt = new Date().toISOString()) {
  const base = {
    id: crypto.randomUUID(),
    receivedAt,
    sessionId: safeId(input.session_id || 'unknown'),
    turnId: input.turn_id ? safeId(input.turn_id) : null,
    event: String(input.hook_event_name || 'Unknown'),
    cwd: typeof input.cwd === 'string' ? input.cwd : null,
    model: typeof input.model === 'string' ? input.model : null,
    permissionMode: typeof input.permission_mode === 'string' ? input.permission_mode : null,
  };

  switch (base.event) {
    case 'PreToolUse':
    case 'PostToolUse':
      return {
        ...base,
        toolName: String(input.tool_name || 'tool'),
        toolUseId: safeId(input.tool_use_id || base.id),
        // Patches and command payloads are the primary forensic artifact in the UI.
        // Keep them complete for realistic edits while retaining a hard ceiling for
        // pathological payloads. The HTTP adapter separately caps the full request.
        toolInput: redactValue(input.tool_input, { maxText: 2_000_000, maxArray: 100 }),
        permission: compactPermission(input),
        ...(base.event === 'PostToolUse'
          ? { toolResponse: redactValue(input.tool_response, { maxText: 2_000_000, maxArray: 100 }) }
          : {}),
      };
    case 'PermissionRequest':
      return {
        ...base,
        toolName: String(input.tool_name || 'tool'),
        toolUseId: input.tool_use_id ? safeId(input.tool_use_id) : null,
        toolInput: redactValue(input.tool_input, { maxText: 2_000_000, maxArray: 100 }),
        permission: compactPermission(input),
      };
    case 'UserPromptSubmit':
      return { ...base, prompt: redactText(String(input.prompt || ''), 4_000) };
    case 'SessionStart':
      return { ...base, source: String(input.source || 'startup') };
    case 'SessionEnd':
      return { ...base, reason: String(input.reason || 'other') };
    case 'SubagentStart':
    case 'SubagentStop':
      return {
        ...base,
        agentId: safeId(input.agent_id || 'agent'),
        agentType: String(input.agent_type || 'subagent'),
      };
    case 'PreCompact':
    case 'PostCompact':
      return { ...base, trigger: String(input.trigger || input.source || 'auto') };
    case 'Stop':
      return {
        ...base,
        stopHookActive: Boolean(input.stop_hook_active),
        assistantResponse: redactText(String(input.last_assistant_message || input.assistant_response || ''), 16_000),
      };
    default:
      return { ...base, data: redactValue(input, { maxText: 2_000 }) };
  }
}

function compactPermission(input) {
  const source = input.permission || input.permission_request || {};
  const pick = (...keys) => keys.map((key) => input[key] ?? source?.[key]).find((value) => value != null);
  const mode = pick('permission_mode', 'mode');
  const decision = pick('permission_decision', 'decision', 'outcome', 'result');
  const reason = pick('permission_reason', 'reason', 'message');
  const risk = pick('risk_level', 'risk');
  const allowed = pick('allowed', 'is_allowed', 'approved');
  if (mode == null && decision == null && reason == null && risk == null && allowed == null) return null;
  return redactValue({
    mode: mode == null ? null : String(mode),
    decision: decision == null ? null : String(decision),
    reason: reason == null ? null : String(reason),
    risk: risk == null ? null : String(risk),
    allowed: typeof allowed === 'boolean' ? allowed : null,
  }, { maxText: 4_000 });
}

export function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'unknown';
}
