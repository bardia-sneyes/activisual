import path from 'node:path';

const TEST_PATTERN = /(?:^|\s)(?:npm|pnpm|yarn|bun|cargo|go|pytest|python\s+-m\s+pytest|dotnet)\s+(?:run\s+)?test\b|\b(?:vitest|jest|playwright|mocha)\b/i;
const BUILD_PATTERN = /(?:^|\s)(?:npm|pnpm|yarn|bun|cargo|go|dotnet)\s+(?:run\s+)?build\b|\b(?:tsc|vite build|next build)\b/i;
const GIT_PATTERN = /(?:^|\s)git\s+(status|diff|add|commit|push|pull|merge|rebase|checkout|switch|branch)\b/i;
const READ_TOOL = /read|find|search|list|open|fetch|get_/i;
const WRITE_TOOL = /write|edit|patch|create|delete|update|apply/i;

export function buildSession(events, projectRoot = process.cwd()) {
  const ordered = [...events].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  const tools = new Map();
  const chunks = [];
  const fileMap = new Map();
  let status = 'idle';
  let startedAt = ordered[0]?.receivedAt ?? null;
  let endedAt = null;
  let lastTurnId = null;

  for (const event of ordered) {
    lastTurnId = event.turnId || lastTurnId;
    if (event.event === 'SessionStart') {
      status = 'active';
      startedAt ||= event.receivedAt;
      chunks.push(chunkFromLifecycle(event, 'Session started', `Codex ${event.source || 'startup'}`, 'session'));
    } else if (event.event === 'SessionEnd') {
      status = 'complete';
      endedAt = event.receivedAt;
      chunks.push(chunkFromLifecycle(event, 'Session ended', event.reason || 'other', 'session'));
    } else if (event.event === 'Stop') {
      status = 'idle';
      chunks.push(chunkFromLifecycle(event, 'Turn complete', 'Codex returned control', 'milestone'));
    } else if (event.event === 'UserPromptSubmit') {
      chunks.push({
        id: event.id,
        type: 'decision',
        status: 'complete',
        title: 'User direction',
        summary: summarize(event.prompt, 180),
        startedAt: event.receivedAt,
        endedAt: event.receivedAt,
        durationMs: 0,
        turnId: event.turnId,
        toolName: null,
        files: [],
        details: { prompt: event.prompt },
      });
    } else if (event.event === 'PermissionRequest') {
      chunks.push({
        id: event.id,
        type: 'decision',
        status: 'waiting',
        title: 'Approval requested',
        summary: `${displayTool(event.toolName)} needs permission`,
        startedAt: event.receivedAt,
        endedAt: null,
        durationMs: null,
        turnId: event.turnId,
        toolName: event.toolName,
        files: extractFiles(event.toolInput, projectRoot),
        details: event.toolInput,
      });
    } else if (event.event === 'PreToolUse') {
      const chunk = toolStart(event, projectRoot);
      tools.set(event.toolUseId, chunk);
      chunks.push(chunk);
    } else if (event.event === 'PostToolUse') {
      let chunk = tools.get(event.toolUseId);
      if (!chunk) {
        chunk = toolStart(event, projectRoot);
        chunks.push(chunk);
      }
      finishTool(chunk, event, projectRoot);
    } else if (event.event === 'SubagentStart' || event.event === 'SubagentStop') {
      const isStart = event.event === 'SubagentStart';
      chunks.push({
        id: event.id,
        type: 'agent',
        status: isStart ? 'running' : 'complete',
        title: isStart ? 'Agent branch started' : 'Agent branch finished',
        summary: event.agentType || 'subagent',
        startedAt: event.receivedAt,
        endedAt: isStart ? null : event.receivedAt,
        durationMs: null,
        turnId: event.turnId,
        agentId: event.agentId,
        files: [],
        details: { agentId: event.agentId, agentType: event.agentType },
      });
    } else if (event.event === 'PreCompact' || event.event === 'PostCompact') {
      chunks.push(chunkFromLifecycle(event, event.event === 'PreCompact' ? 'Compacting context' : 'Context compacted', event.trigger, 'milestone'));
    }
  }

  for (const chunk of chunks) {
    for (const file of chunk.files || []) {
      const existing = fileMap.get(file.path) || { ...file, reads: 0, writes: 0, chunkIds: [] };
      if (file.action === 'write') existing.writes += 1;
      else existing.reads += 1;
      existing.chunkIds.push(chunk.id);
      fileMap.set(file.path, existing);
    }
  }

  const completed = chunks.filter((chunk) => chunk.status === 'complete').length;
  const failed = chunks.filter((chunk) => chunk.status === 'error').length;
  const running = chunks.filter((chunk) => chunk.status === 'running').length;
  return {
    id: ordered[0]?.sessionId || 'unknown',
    project: path.basename(projectRoot),
    projectRoot,
    status,
    startedAt,
    endedAt,
    lastActivityAt: ordered.at(-1)?.receivedAt ?? null,
    model: [...ordered].reverse().find((event) => event.model)?.model ?? null,
    permissionMode: [...ordered].reverse().find((event) => event.permissionMode)?.permissionMode ?? null,
    lastTurnId,
    stats: { chunks: chunks.length, completed, failed, running, files: fileMap.size },
    chunks,
    files: [...fileMap.values()],
  };
}

function toolStart(event, projectRoot) {
  const command = getCommand(event.toolInput);
  const type = classifyTool(event.toolName, command);
  const files = extractFiles(event.toolInput, projectRoot).map((file) => ({
    ...file,
    action: inferFileAction(event.toolName, command),
  }));
  return {
    id: event.toolUseId || event.id,
    type,
    status: 'running',
    title: titleForTool(event.toolName, command, type),
    summary: summaryForTool(event.toolName, command, event.toolInput),
    startedAt: event.receivedAt,
    endedAt: null,
    durationMs: null,
    turnId: event.turnId,
    toolName: event.toolName,
    files,
    details: { input: event.toolInput },
  };
}

function finishTool(chunk, event, projectRoot) {
  chunk.endedAt = event.receivedAt;
  chunk.durationMs = Math.max(0, Date.parse(chunk.endedAt) - Date.parse(chunk.startedAt));
  chunk.status = responseFailed(event.toolResponse) ? 'error' : 'complete';
  chunk.details = { ...chunk.details, response: event.toolResponse };
  const newFiles = extractFiles(event.toolResponse, projectRoot).map((file) => ({
    ...file,
    action: inferFileAction(event.toolName, getCommand(event.toolInput)),
  }));
  chunk.files = dedupeFiles([...chunk.files, ...newFiles]);
  if (chunk.status === 'error') chunk.summary = failureSummary(event.toolResponse) || chunk.summary;
}

function chunkFromLifecycle(event, title, summary, type) {
  return {
    id: event.id,
    type,
    status: 'complete',
    title,
    summary: summary || '',
    startedAt: event.receivedAt,
    endedAt: event.receivedAt,
    durationMs: 0,
    turnId: event.turnId,
    files: [],
    details: {},
  };
}

export function classifyTool(toolName = '', command = '') {
  if (TEST_PATTERN.test(command)) return 'test';
  if (BUILD_PATTERN.test(command)) return 'build';
  if (GIT_PATTERN.test(command)) return 'git';
  if (/apply_patch|edit|write/i.test(toolName)) return 'write';
  if (/spawn_agent|agent/i.test(toolName)) return 'agent';
  if (/request_user_input/i.test(toolName)) return 'decision';
  return 'tool';
}

export function extractFiles(value, projectRoot = process.cwd()) {
  const seen = new Map();
  visit(value, (text) => {
    const candidates = text.match(/(?:^|[\s"'=(])((?:\.\.?\/|\/)?[\w@.-]+(?:\/[\w@.()-]+)+|[\w@.-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|html|py|rb|go|rs|java|kt|swift|toml|ya?ml|sql|sh))(?:[:#]\d+)?/g) || [];
    for (let candidate of candidates) {
      candidate = candidate.trim().replace(/^["'(=]+|["'),;]+$/g, '').replace(/[:#]\d+$/, '');
      if (!candidate || candidate.includes('://') || candidate.includes('node_modules/')) continue;
      const absolute = path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(projectRoot, candidate);
      const relative = path.relative(projectRoot, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      seen.set(relative || path.basename(absolute), { path: relative || path.basename(absolute), action: 'read' });
    }
  });
  return [...seen.values()].slice(0, 40);
}

function visit(value, callback, depth = 0) {
  if (depth > 5 || value == null) return;
  if (typeof value === 'string') return callback(value);
  if (Array.isArray(value)) return value.forEach((child) => visit(child, callback, depth + 1));
  if (typeof value === 'object') Object.values(value).forEach((child) => visit(child, callback, depth + 1));
}

function responseFailed(response) {
  if (response == null) return false;
  if (typeof response === 'string') return /(?:exit code|exited with code|error:|failed|isError["']?\s*[:=]\s*true)/i.test(response);
  if (typeof response === 'object') {
    if (response.isError === true || response.success === false || Number(response.exit_code) > 0) return true;
    return responseFailed(JSON.stringify(response));
  }
  return false;
}

function failureSummary(response) {
  const text = typeof response === 'string' ? response : JSON.stringify(response);
  const line = text.split('\n').find((item) => /error|fail|exit code/i.test(item));
  return line ? summarize(line, 180) : null;
}

function getCommand(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input.command || input.cmd || input.patch || '';
}

function inferFileAction(toolName, command) {
  if (WRITE_TOOL.test(toolName) || /(?:^|\s)(?:rm|mv|cp|touch|mkdir|sed\s+-i|git\s+(?:add|commit))\b/.test(command)) return 'write';
  return READ_TOOL.test(toolName) ? 'read' : 'read';
}

function titleForTool(toolName, command, type) {
  if (type === 'test') return 'Running tests';
  if (type === 'build') return 'Building project';
  if (type === 'git') {
    const action = command.match(GIT_PATTERN)?.[1] || 'operation';
    return `Git ${action}`;
  }
  if (type === 'write') return 'Updating files';
  return displayTool(toolName);
}

function summaryForTool(toolName, command, input) {
  if (command) return summarize(command.replace(/\s+/g, ' '), 180);
  const serialized = JSON.stringify(input);
  return serialized && serialized !== '{}' ? summarize(serialized, 180) : `Using ${displayTool(toolName)}`;
}

function displayTool(name = 'Tool') {
  return name.replace(/^mcp__/, '').replaceAll('__', ' · ').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarize(value, max) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function dedupeFiles(files) {
  return [...new Map(files.map((file) => [file.path, file])).values()];
}
