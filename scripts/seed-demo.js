const endpoint = process.argv[2] || 'http://127.0.0.1:4319/api/events';
const session_id = 'activisual-demo';
const cwd = process.cwd();
const at = (seconds) => new Date(Date.UTC(2026, 7, 15, 7, 15, seconds)).toISOString();
const common = { session_id, turn_id: 'turn-dashboard', cwd, model: 'gpt-5.6-codex' };
const events = [
  { ...common, hook_event_name: 'SessionStart', source: 'startup', received_at: at(0) },
  { ...common, hook_event_name: 'UserPromptSubmit', prompt: 'Ship one-command installation for every supported coding harness', received_at: at(2) },
  { ...common, hook_event_name: 'PreToolUse', tool_use_id: 'research', tool_name: 'WebSearch', tool_input: { query: 'agentic coding hooks plugin installation patterns' }, received_at: at(4) },
  { ...common, hook_event_name: 'PostToolUse', tool_use_id: 'research', tool_name: 'WebSearch', tool_input: { query: 'agentic coding hooks plugin installation patterns' }, tool_response: { sources: 14 }, received_at: at(11) },
  { ...common, hook_event_name: 'SubagentStart', agent_id: 'compatibility-review', agent_type: 'explorer', received_at: at(13) },
  { ...common, hook_event_name: 'PreToolUse', tool_use_id: 'manifest', tool_name: 'apply_patch', tool_input: { command: '*** Update File: package.json\n*** Add File: .codex-plugin/plugin.json\n*** Add File: .claude-plugin/plugin.json' }, received_at: at(16) },
  { ...common, hook_event_name: 'PostToolUse', tool_use_id: 'manifest', tool_name: 'apply_patch', tool_input: { command: '*** Update File: package.json\n*** Add File: .codex-plugin/plugin.json\n*** Add File: .claude-plugin/plugin.json' }, tool_response: 'Done!', received_at: at(21) },
  { ...common, hook_event_name: 'PreToolUse', tool_use_id: 'adapters', tool_name: 'apply_patch', tool_input: { command: '*** Add File: integrations/pi/index.js\n*** Add File: integrations/opencode/index.js\n*** Add File: plugin.yaml' }, received_at: at(24) },
  { ...common, hook_event_name: 'PostToolUse', tool_use_id: 'adapters', tool_name: 'apply_patch', tool_input: { command: '*** Add File: integrations/pi/index.js\n*** Add File: integrations/opencode/index.js\n*** Add File: plugin.yaml' }, tool_response: 'Done!', received_at: at(32) },
  { ...common, hook_event_name: 'PermissionRequest', tool_use_id: 'publish-check', tool_name: 'Bash', tool_input: { command: 'npm view activisual version' }, received_at: at(35) },
  { ...common, hook_event_name: 'PreToolUse', tool_use_id: 'tests', tool_name: 'Bash', tool_input: { command: 'npm run verify' }, received_at: at(38) },
  { ...common, hook_event_name: 'PostToolUse', tool_use_id: 'tests', tool_name: 'Bash', tool_input: { command: 'npm run verify' }, tool_response: { exit_code: 0, summary: '10 tests passed' }, received_at: at(49) },
  { ...common, hook_event_name: 'SubagentStop', agent_id: 'compatibility-review', received_at: at(51) },
  { ...common, hook_event_name: 'Stop', stop_hook_active: false, received_at: at(55) },
];

for (const event of events) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`Failed to seed ${event.hook_event_name}: ${response.status}`);
}

console.log(`Seeded ${events.length} demo events into ${endpoint}`);
