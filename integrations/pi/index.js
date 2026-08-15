import { appendHookInput } from '../../src/event-writer.js';

export function mapPiEvent(kind, event = {}, context = {}, state = new Map()) {
  const sessionId = context.sessionManager?.getSessionId?.() || event.sessionId || 'pi-session';
  const cwd = context.cwd || process.cwd();
  const common = { session_id: sessionId, cwd };

  if (kind === 'session_start') {
    return { ...common, hook_event_name: 'SessionStart', source: event.reason || 'startup' };
  }
  if (kind === 'before_agent_start') {
    return { ...common, hook_event_name: 'UserPromptSubmit', prompt: event.prompt || '' };
  }
  if (kind === 'tool_execution_start') {
    state.set(event.toolCallId, { tool_name: event.toolName, tool_input: event.args });
    return {
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: event.toolName,
      tool_use_id: event.toolCallId,
      tool_input: event.args,
    };
  }
  if (kind === 'tool_execution_end') {
    const pending = state.get(event.toolCallId) || {};
    state.delete(event.toolCallId);
    return {
      ...common,
      hook_event_name: 'PostToolUse',
      tool_name: event.toolName || pending.tool_name,
      tool_use_id: event.toolCallId,
      tool_input: pending.tool_input,
      tool_response: { result: event.result, isError: Boolean(event.isError) },
    };
  }
  if (kind === 'session_before_compact' || kind === 'session_compact') {
    return {
      ...common,
      hook_event_name: kind === 'session_before_compact' ? 'PreCompact' : 'PostCompact',
      trigger: event.reason || 'auto',
    };
  }
  if (kind === 'agent_settled') return { ...common, hook_event_name: 'Stop' };
  if (kind === 'session_shutdown') {
    return { ...common, hook_event_name: 'SessionEnd', reason: event.reason || 'quit' };
  }
  return null;
}

export default function activisualPiExtension(pi) {
  const pending = new Map();
  const emit = (kind) => async (event, context) => {
    const input = mapPiEvent(kind, event, context, pending);
    if (input) await appendHookInput(input, input.cwd);
  };

  pi.on('session_start', emit('session_start'));
  pi.on('before_agent_start', emit('before_agent_start'));
  pi.on('tool_execution_start', emit('tool_execution_start'));
  pi.on('tool_execution_end', emit('tool_execution_end'));
  pi.on('session_before_compact', emit('session_before_compact'));
  pi.on('session_compact', emit('session_compact'));
  pi.on('agent_settled', emit('agent_settled'));
  pi.on('session_shutdown', emit('session_shutdown'));
}
