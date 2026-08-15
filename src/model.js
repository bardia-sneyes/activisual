import path from 'node:path';
import fs from 'node:fs';

const TEST_PATTERN = /(?:^|\s)(?:npm|pnpm|yarn|bun|cargo|go|pytest|python\s+-m\s+pytest|dotnet)\s+(?:run\s+)?test\b|\b(?:vitest|jest|playwright|mocha)\b/i;
const BUILD_PATTERN = /(?:^|\s)(?:npm|pnpm|yarn|bun|cargo|go|dotnet)\s+(?:run\s+)?build\b|\b(?:tsc|vite build|next build)\b/i;
const GIT_PATTERN = /(?:^|\s)git\s+(status|diff|add|commit|push|pull|merge|rebase|checkout|switch|branch)\b/i;
const READ_COMMAND_PATTERN = /(?:^|[;&|]\s*|\s)(?:Get-Content|Get-Item|Get-ChildItem|Select-String|Resolve-Path|Test-Path|rg|grep|cat|head|tail|findstr|ls|dir)\b/i;
const READ_TOOL = /read|find|search|list|open|fetch|get_/i;
const WRITE_TOOL = /write|edit|patch|create|delete|update|apply/i;

export function buildSession(events, projectRoot = process.cwd()) {
  const ordered = [...events].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  const tools = new Map();
  const pendingPermissions = [];
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
      chunks.push(chunkFromLifecycle(event, 'Session started', `Agent ${event.source || 'startup'}`, 'session'));
    } else if (event.event === 'SessionEnd') {
      status = 'complete';
      endedAt = event.receivedAt;
      chunks.push(chunkFromLifecycle(event, 'Session ended', event.reason || 'other', 'session'));
    } else if (event.event === 'Stop') {
      for (const [toolUseId, chunk] of tools) {
        if (chunk.status !== 'running' || event.turnId && chunk.turnId !== event.turnId) continue;
        chunk.endedAt = event.receivedAt;
        chunk.durationMs = Math.max(0, Date.parse(chunk.endedAt) - Date.parse(chunk.startedAt));
        chunk.status = 'complete';
        tools.delete(toolUseId);
      }
      status = 'idle';
      const response = String(event.assistantResponse || '').trim();
      const completion = chunkFromLifecycle(event, 'Turn complete', response ? summarize(response, 240) : 'Agent returned control', 'milestone');
      completion.details = response ? { response } : {};
      chunks.push(completion);
    } else if (event.event === 'UserPromptSubmit') {
      status = 'active';
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
      status = 'active';
      const permission = normalizePermission(event.permission, event.permissionMode, 'request');
      const permissionChunk = {
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
        toolUseId: event.toolUseId || null,
        files: extractFiles(event.toolInput, projectRoot),
        permission,
        details: { input: event.toolInput, permission },
      };
      chunks.push(permissionChunk);
      pendingPermissions.push({ event, chunk: permissionChunk });
    } else if (event.event === 'PreToolUse') {
      status = 'active';
      const chunk = toolStart(event, projectRoot);
      attachPendingPermission(chunk, event, pendingPermissions);
      tools.set(event.toolUseId, chunk);
      chunks.push(chunk);
    } else if (event.event === 'PostToolUse') {
      let chunk = tools.get(event.toolUseId);
      if (!chunk) {
        chunk = toolStart(event, projectRoot);
        attachPendingPermission(chunk, event, pendingPermissions);
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
    stats: {
      chunks: chunks.length, completed, failed, running, files: fileMap.size,
      permissionRequests: chunks.filter((chunk) => chunk.type === 'decision' && chunk.title === 'Approval requested').length,
    },
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
    diff: extractDiff(event.toolInput),
    permission: normalizePermission(event.permission, event.permissionMode),
    details: { input: event.toolInput },
  };
}

function finishTool(chunk, event, projectRoot) {
  chunk.endedAt = event.receivedAt;
  chunk.durationMs = Math.max(0, Date.parse(chunk.endedAt) - Date.parse(chunk.startedAt));
  chunk.status = responseFailed(event.toolResponse) ? 'error' : 'complete';
  chunk.details = { ...chunk.details, response: event.toolResponse };
  chunk.permission = mergePermission(chunk.permission, normalizePermission(event.permission, event.permissionMode));
  chunk.diff = mergeDiff(chunk.diff, extractDiff(event.toolResponse));
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
    diff: null,
    permission: null,
    details: {},
  };
}

export function classifyTool(toolName = '', command = '') {
  if (TEST_PATTERN.test(command)) return 'test';
  if (BUILD_PATTERN.test(command)) return 'build';
  if (GIT_PATTERN.test(command)) return 'git';
  if (/apply_patch|edit|write/i.test(toolName)) return 'write';
  if (READ_COMMAND_PATTERN.test(command)) return 'read';
  if (/spawn_agent|agent/i.test(toolName)) return 'agent';
  if (/request_user_input/i.test(toolName)) return 'decision';
  return 'tool';
}

export function extractFiles(value, projectRoot = process.cwd()) {
  const seen = new Map();
  visit(value, (text) => {
    if (isDiffText(text)) {
      for (const file of extractDiff(text)?.files || []) addFileCandidate(seen, file.path, projectRoot, true);
      return;
    }
    const candidates = text.match(/(?:^|[\s"'=(])((?:\.\.?\/|\/)?[\w@.-]+(?:\/[\w@.()-]+)+|[\w@.-]+\.(?:[cm]?[jt]sx?|json|md|css|scss|html|py|rb|go|rs|java|kt|swift|toml|ya?ml|sql|sh))(?:[:#]\d+)?/g) || [];
    for (let candidate of candidates) {
      candidate = candidate.trim().replace(/^["'(=]+|["'),;]+$/g, '').replace(/[:#]\d+$/, '');
      addFileCandidate(seen, candidate, projectRoot);
    }
  });
  return [...seen.values()].slice(0, 40);
}

function addFileCandidate(seen, candidate, projectRoot, allowMissing = false) {
  if (!isLikelyFileCandidate(candidate)) return;
  const normalized = String(candidate).replaceAll('\\', '/');
  const absolute = path.isAbsolute(normalized) ? path.normalize(normalized) : path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return;
  if (!allowMissing && fs.existsSync(projectRoot) && !fs.existsSync(absolute)) return;
  const portablePath = (relative || path.basename(absolute)).split(path.sep).join('/');
  seen.set(portablePath, { path: portablePath, action: 'read' });
}

function isLikelyFileCandidate(value) {
  const candidate = String(value || '').replaceAll('\\', '/').replace(/[:#]\d+$/, '');
  if (!candidate || candidate.includes('://') || candidate.includes('node_modules/')) return false;
  if (/^(?:application|audio|font|image|text|video)\//i.test(candidate)) return false;
  if (/^(?:\d{1,4}\/){2}\d{1,4}$/.test(candidate)) return false;
  const name = candidate.split('/').at(-1);
  return /\.(?:[cm]?[jt]sx?|json|md|css|scss|html|py|rb|go|rs|java|kt|swift|toml|ya?ml|sql|sh|ps1|cs|fs|vb|c|cc|cpp|h|hpp|xml|ini|env|lock|svg|wasm)$/i.test(name)
    || /^(?:Dockerfile|Containerfile|Makefile|Procfile|Jenkinsfile|Gemfile|Rakefile)$/i.test(name);
}

export function extractDiff(value) {
  const patches = [];
  visit(value, (text) => {
    if (!isDiffText(text)) return;
    const patch = String(text).trim();
    if (patch && !patches.includes(patch)) patches.push(patch);
  });
  if (!patches.length) return null;
  const text = patches.join('\n\n');
  const files = [];
  const seen = new Set();
  let additions = 0;
  let deletions = 0;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const apply = line.match(/^\*\*\* (Add|Update|Delete) File:\s+(.+)$/);
    const unified = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (apply || unified) {
      const pathName = (apply ? apply[2] : unified[2]).trim().replaceAll('\\', '/');
      const action = apply ? apply[1].toLowerCase() : 'update';
      current = { path: pathName, action, additions: 0, deletions: 0 };
      if (!seen.has(`${action}:${pathName}`)) {
        seen.add(`${action}:${pathName}`);
        files.push(current);
      } else current = files.find((file) => file.path === pathName && file.action === action);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('***')) {
      additions += 1;
      if (current) current.additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---') && !line.startsWith('***')) {
      deletions += 1;
      if (current) current.deletions += 1;
    }
  }
  return {
    text,
    files,
    additions,
    deletions,
    truncated: /… \[truncated(?:\s+\d+\s+chars)?\]|\[truncated\]/i.test(text),
  };
}

function visit(value, callback, depth = 0) {
  if (depth > 5 || value == null) return;
  if (typeof value === 'string') return callback(value);
  if (Array.isArray(value)) return value.forEach((child) => visit(child, callback, depth + 1));
  if (typeof value === 'object') Object.values(value).forEach((child) => visit(child, callback, depth + 1));
}

function isDiffText(value) {
  const text = String(value || '');
  return /(?:^|\n)\*\*\* Begin Patch(?:\r?\n|$)|(?:^|\n)diff --git a\/.+ b\/.+|(?:^|\n)@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text);
}

function mergeDiff(first, second) {
  if (!first) return second;
  if (!second || second.text === first.text) return first;
  return extractDiff({ first: first.text, second: second.text });
}

function normalizePermission(permission, mode, source = 'tool') {
  const raw = permission && typeof permission === 'object' ? permission : {};
  const resolvedMode = raw.mode || mode || null;
  const decision = raw.decision || null;
  const allowed = typeof raw.allowed === 'boolean'
    ? raw.allowed
    : decision ? /^(?:allow|allowed|approve|approved|accept|accepted|proceed)$/i.test(decision) ? true
      : /^(?:deny|denied|reject|rejected|block|blocked)$/i.test(decision) ? false : null
      : null;
  if (!resolvedMode && !decision && !raw.reason && !raw.risk && allowed == null) return null;
  return { mode: resolvedMode, decision, allowed, reason: raw.reason || null, risk: raw.risk || null, source };
}

function mergePermission(first, second) {
  if (!first) return second;
  if (!second) return first;
  return Object.fromEntries(Object.entries({
    ...first,
    ...Object.fromEntries(Object.entries(second).filter(([, value]) => value != null)),
  }).filter(([, value]) => value != null));
}

function attachPendingPermission(chunk, event, pendingPermissions) {
  const index = pendingPermissions.findLastIndex(({ event: request }) =>
    (!request.toolUseId || !event.toolUseId || request.toolUseId === event.toolUseId)
    && (!request.turnId || !event.turnId || request.turnId === event.turnId)
    && (!request.toolName || !event.toolName || request.toolName === event.toolName));
  if (index < 0) return;
  const [{ event: request, chunk: permissionChunk }] = pendingPermissions.splice(index, 1);
  const permission = normalizePermission(request.permission, request.permissionMode, 'request') || {};
  chunk.permission = mergePermission(chunk.permission, {
    ...permission,
    allowed: permission.allowed ?? true,
    decision: permission.decision || 'allowed',
    requestedAt: request.receivedAt,
  });
  permissionChunk.status = permission.allowed === false ? 'error' : 'complete';
  permissionChunk.endedAt = event.receivedAt;
  permissionChunk.durationMs = Math.max(0, Date.parse(event.receivedAt) - Date.parse(request.receivedAt));
  permissionChunk.relatedToolUseId = event.toolUseId || chunk.id;
  permissionChunk.permission = chunk.permission;
  permissionChunk.details = { ...permissionChunk.details, permission: chunk.permission };
}

function responseFailed(response) {
  if (response == null) return false;
  if (typeof response === 'string') {
    const exitCodes = [...response.matchAll(/(?:exit code\s*:?|exited with code)\s*(-?\d+)/gi)].map((match) => Number(match[1]));
    if (exitCodes.some((code) => code !== 0)) return true;
    if (/\bisError["']?\s*[:=]\s*true\b|\bsuccess["']?\s*[:=]\s*false\b/i.test(response)) return true;
    if (isDiffText(response)) return false;
    return /(?:^|\n)\s*(?:script|command|process|build|test)?\s*(?:error\s*:|failed\b)/i.test(response);
  }
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
  if (type === 'read') return 'Read';
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
