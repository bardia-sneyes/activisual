import { appendHookInput } from '../../src/event-writer.js';

export function mapOpenCodeBusEvent(event, directory) {
  const properties = event?.properties || {};
  if (event?.type === 'session.created') {
    return {
      session_id: properties.info?.id,
      cwd: properties.info?.directory || directory,
      hook_event_name: 'SessionStart',
      source: properties.info?.parentID ? 'subagent' : 'startup',
    };
  }
  if (event?.type === 'session.idle') {
    return { session_id: properties.sessionID, cwd: directory, hook_event_name: 'Stop' };
  }
  if (event?.type === 'session.compacted') {
    return { session_id: properties.sessionID, cwd: directory, hook_event_name: 'PostCompact', trigger: 'auto' };
  }
  if (event?.type === 'session.deleted') {
    return {
      session_id: properties.info?.id,
      cwd: properties.info?.directory || directory,
      hook_event_name: 'SessionEnd',
      reason: 'deleted',
    };
  }
  return null;
}

export function mapOpenCodeToolEvent(phase, input, output, directory) {
  return {
    session_id: input.sessionID,
    cwd: directory,
    hook_event_name: phase === 'before' ? 'PreToolUse' : 'PostToolUse',
    tool_name: input.tool,
    tool_use_id: input.callID,
    tool_input: phase === 'before' ? output.args : input.args,
    ...(phase === 'after' ? { tool_response: output } : {}),
  };
}

function promptText(parts = []) {
  return parts.filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n');
}

export const ActivisualPlugin = async ({ directory }) => ({
  event: async ({ event }) => {
    const input = mapOpenCodeBusEvent(event, directory);
    if (input) await appendHookInput(input, input.cwd);
  },
  'chat.message': async (input, output) => {
    await appendHookInput({
      session_id: input.sessionID,
      turn_id: input.messageID,
      cwd: directory,
      model: input.model?.modelID,
      hook_event_name: 'UserPromptSubmit',
      prompt: promptText(output.parts),
    }, directory);
  },
  'tool.execute.before': async (input, output) => {
    await appendHookInput(mapOpenCodeToolEvent('before', input, output, directory), directory);
  },
  'tool.execute.after': async (input, output) => {
    await appendHookInput(mapOpenCodeToolEvent('after', input, output, directory), directory);
  },
  'permission.ask': async (input) => {
    await appendHookInput({
      session_id: input.sessionID,
      cwd: directory,
      hook_event_name: 'PermissionRequest',
      tool_name: input.permission || input.type || 'tool',
      tool_input: input,
    }, directory);
  },
  'experimental.session.compacting': async (input) => {
    await appendHookInput({
      session_id: input.sessionID,
      cwd: directory,
      hook_event_name: 'PreCompact',
      trigger: 'auto',
    }, directory);
  },
});
