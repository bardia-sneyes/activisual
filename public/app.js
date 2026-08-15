const LANES = [
  { id: 'prompt', label: 'USER PROMPT', hint: 'command starts here', color: '#ffd166', y: 92 },
  { id: 'inspect', label: 'INSPECT', hint: 'read and understand', color: '#79d9ff', y: 232 },
  { id: 'change', label: 'CHANGE', hint: 'write and delegate', color: '#b39cff', y: 372 },
  { id: 'verify', label: 'VERIFY', hint: 'test and build', color: '#71f7a8', y: 512 },
  { id: 'result', label: 'RESULT', hint: 'current outcome', color: '#71f7a8', y: 652 },
];
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GRAPH_FONT = '"Cascadia Code", "SFMono-Regular", "Roboto Mono", Consolas, monospace';
const PROMPT_CARD_MIN_HEIGHT = 104;
const PROMPT_CARD_MAX_HEIGHT = 142;
const CARD_ENTER_MS = 560;
const CARD_EXIT_MS = 440;
const GRAPH_ANIMATION_FRAME_MS = 1000 / 30;
const ACTIVE_RANGE_MIN_MS = 5000;

const $ = (selector) => document.querySelector(selector);
const elements = {
  sessionSelect: $('#session-select'),
  connectionDot: $('#connection-dot'), connectionLabel: $('#connection-label'), clock: $('#clock'),
  statusIcon: $('#status-icon'), statusLabel: $('#status-label'), missionTitle: $('#mission-title'), missionSummary: $('#mission-summary'),
  missionProject: $('#mission-project'), missionSession: $('#mission-session'), missionId: $('#mission-id'), missionBar: $('.mission-bar'),
  metricEvents: $('#metric-events'), metricFiles: $('#metric-files'), metricFailures: $('#metric-failures'), metricElapsed: $('#metric-elapsed'),
  modeLive: $('#mode-live'), modeReview: $('#mode-review'), deleteSession: $('#delete-session'),
  exportSession: $('#export-session'),
  canvas: $('#work-graph'), graphWrap: $('#graph-wrap'), graphEmpty: $('#graph-empty'), graphMeta: $('#graph-meta'), graphSummary: $('#graph-summary'), tooltip: $('#graph-tooltip'),
  graphHint: $('#graph-hint'), layoutOrbit: $('#layout-orbit'), layoutFlow: $('#layout-flow'),
  graphZoomOut: $('#graph-zoom-out'), graphZoomIn: $('#graph-zoom-in'), graphFit: $('#graph-fit'), graphReset: $('#graph-reset'),
  inspector: $('#inspector'), inspectorTitle: $('#inspector-title'), inspectorBody: $('#inspector-body'), inspectorClose: $('#inspector-close'), scrim: $('#scrim'),
};

const state = {
  sessions: [], session: null, selectedId: null, selectedNodeId: null, hoveredNodeId: null,
  graphModel: null, graphHits: [], graphSignature: '',
  graphView: { scale: 1, scaleY: 1, offsetX: 0, offsetY: 0, pointer: null, animation: null },
  viewMode: 'live', layoutMode: localStorage.getItem('activisual:layout') === 'flow' ? 'flow' : 'orbit', livePhase: 0, liveFrame: null,
  nodeMotion: new Map(), exitingNodes: [], motionContext: '', activeRangeEdge: null,
  inspectorReturnFocus: null,
};

setInterval(() => {
  elements.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });
  if (state.session?.chunks?.some((chunk) => chunk.status === 'running' || chunk.status === 'waiting')) {
    renderMission(state.session, state.session.chunks);
  }
}, 1000);
elements.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });

elements.sessionSelect.addEventListener('change', () => selectSession(elements.sessionSelect.value));
elements.modeLive.addEventListener('click', enterLive);
elements.modeReview.addEventListener('click', enterReview);
elements.deleteSession.addEventListener('click', deleteCurrentSession);
elements.exportSession.addEventListener('click', exportCurrentSession);
elements.inspectorClose.addEventListener('click', closeInspector);
elements.scrim.addEventListener('click', closeInspector);
elements.graphZoomOut.addEventListener('click', () => { enterReview(); zoomGraph(.78); });
elements.graphZoomIn.addEventListener('click', () => { enterReview(); zoomGraph(1.22); });
elements.graphFit.addEventListener('click', () => { enterReview(); fitGraph(); });
elements.graphReset.addEventListener('click', () => { enterReview(); resetGraph(); });
elements.layoutOrbit.addEventListener('click', () => setLayoutMode('orbit'));
elements.layoutFlow.addEventListener('click', () => setLayoutMode('flow'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeInspector(); });
window.addEventListener('scroll', () => enterReview(), { passive: true });

const resizeObserver = new ResizeObserver(() => {
  // A viewport resize must never alter the user's zoom level.
  if (state.viewMode === 'live') followLatest(false);
  else drawGraph();
});
resizeObserver.observe(elements.graphWrap);

elements.canvas.addEventListener('pointerdown', (event) => {
  elements.canvas.setPointerCapture(event.pointerId);
  state.graphView.pointer = {
    id: event.pointerId, x: event.clientX, y: event.clientY,
    offsetX: state.graphView.offsetX, offsetY: state.graphView.offsetY, moved: false,
  };
  elements.canvas.classList.add('dragging');
});

elements.canvas.addEventListener('pointermove', (event) => {
  const pointer = state.graphView.pointer;
  if (pointer) {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) pointer.moved = true;
    if (pointer.moved) {
      enterReview();
      state.graphView.offsetX = pointer.offsetX + dx;
      state.graphView.offsetY = pointer.offsetY + dy;
      constrainGraphView();
      elements.tooltip.hidden = true;
      drawGraph();
    }
    return;
  }
  showGraphHover(event);
});

elements.canvas.addEventListener('pointerup', (event) => {
  const pointer = state.graphView.pointer;
  if (!pointer) return;
  elements.canvas.releasePointerCapture(event.pointerId);
  state.graphView.pointer = null;
  elements.canvas.classList.remove('dragging');
  if (!pointer.moved) {
    const hit = graphHitAt(event.offsetX, event.offsetY);
    if (hit) openInspector(hit.node, hit.kind);
  }
});

elements.canvas.addEventListener('pointerleave', () => {
  elements.tooltip.hidden = true;
  if (!state.graphView.pointer && state.hoveredNodeId) {
    state.hoveredNodeId = null;
    drawGraph();
  }
});

elements.canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  enterReview();
  zoomGraph(event.deltaY < 0 ? 1.12 : .89, event.offsetX, event.offsetY);
}, { passive: false });

elements.canvas.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    enterReview();
    selectGraphNode(1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    enterReview();
    selectGraphNode(-1);
  } else if (event.key === 'Enter') {
    const hit = state.graphHits.find((item) => item.id === state.selectedNodeId);
    if (hit) openInspector(hit.node, hit.kind);
  } else if (event.key === '+' || event.key === '=') { enterReview(); zoomGraph(1.22); }
  else if (event.key === '-') { enterReview(); zoomGraph(.78); }
  else if (event.key === '0') { enterReview(); fitGraph(); }
});

await loadSessions();
connectStream();

async function loadSessions(preferredId = state.selectedId) {
  try {
    const response = await fetch('/api/sessions');
    const data = await response.json();
    state.sessions = data.sessions || [];
    renderSessionOptions();
    const id = preferredId && state.sessions.some((item) => item.id === preferredId) ? preferredId : state.sessions[0]?.id;
    if (id) await selectSession(id, false);
    else {
      state.session = null;
      state.selectedId = null;
      render();
    }
  } catch {
    setConnection(false);
  }
}

async function selectSession(id) {
  if (!id) return;
  const changedSession = state.selectedId !== id;
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!response.ok) return loadSessions();
  const data = await response.json();
  state.session = data.session;
  state.selectedId = id;
  state.selectedNodeId = null;
  if (changedSession) state.graphSignature = '';
  elements.sessionSelect.value = id;
  render();
}

function renderSessionOptions() {
  elements.sessionSelect.replaceChildren();
  if (!state.sessions.length) {
    elements.sessionSelect.add(new Option('No sessions captured', ''));
    elements.sessionSelect.disabled = true;
    return;
  }
  elements.sessionSelect.disabled = false;
  for (const session of state.sessions) {
    const label = `${shortId(session.id)} · ${relativeTime(session.lastActivityAt)} · ${session.status.toUpperCase()}`;
    elements.sessionSelect.add(new Option(label, session.id));
  }
}

function render() {
  const session = state.session;
  const chunks = session?.chunks || [];
  elements.deleteSession.disabled = !session;
  elements.exportSession.disabled = !session;
  updateModeControl();
  updateLayoutControl();
  renderMission(session, chunks);
  const nextGraphModel = buildGraphModel(chunks, session);
  syncGraphNodeMotion(state.graphModel, nextGraphModel, `${state.layoutMode}:${state.selectedId || ''}`);
  state.graphModel = nextGraphModel;
  const signature = `${state.layoutMode}:${state.selectedId || ''}:${chunks.map((chunk) => `${chunk.id}:${chunk.status}:${chunk.files?.length || 0}`).join('|')}`;
  const shouldFit = signature !== state.graphSignature;
  const hadGraph = Boolean(state.graphSignature);
  state.graphSignature = signature;
  if (state.viewMode === 'live') followLatest(shouldFit && hadGraph);
  else if (!hadGraph) fitGraph();
  else drawGraph();
  syncLiveAnimation();
}

function renderMission(session, chunks) {
  elements.missionBar.classList.remove('state-empty', 'state-progress', 'state-result', 'state-issues');
  if (!session) {
    elements.missionBar.classList.add('state-empty');
    elements.missionProject.textContent = '—';
    elements.missionSession.textContent = '—';
    elements.missionId.textContent = '—';
    elements.missionId.removeAttribute('title');
    elements.statusLabel.textContent = 'AWAITING SIGNAL';
    elements.missionTitle.textContent = 'No agent session captured yet';
    elements.missionSummary.textContent = 'Start a supported coding agent in this project after installing Activisual.';
    elements.metricEvents.textContent = '000'; elements.metricFiles.textContent = '00'; elements.metricFailures.textContent = '00'; elements.metricElapsed.textContent = '00:00';
    return;
  }

  const turns = commandTurns(chunks);
  const lastTurn = turns.at(-1);
  const running = chunks.findLast((chunk) => chunk.status === 'running' || chunk.status === 'waiting');
  const turnInProgress = Boolean(lastTurn && !lastTurn.complete && session.status === 'active');
  const sessionName = promptTextFor(turns[0]?.prompt) || `${session.project || 'Coding agent'} session`;
  const fullId = String(session.id || '—');

  elements.missionProject.textContent = session.project || 'Unknown project';
  elements.missionSession.textContent = ellipsize(sessionName.replace(/\s+/g, ' ').trim(), 58);
  elements.missionId.textContent = fullId;
  elements.missionId.title = fullId;

  if (running || turnInProgress) renderMissionProgress(running, lastTurn);
  else renderMissionResult(lastTurn, session, chunks);
  elements.metricEvents.textContent = String(chunks.length).padStart(3, '0');
  elements.metricFiles.textContent = String(filesFor(chunks).length).padStart(2, '0');
  elements.metricFailures.textContent = String(chunks.filter((chunk) => chunk.status === 'error').length).padStart(2, '0');
  elements.metricElapsed.textContent = elapsed(session.startedAt, chunks.at(-1)?.endedAt || chunks.at(-1)?.startedAt);
}

function renderMissionProgress(running, turn) {
  elements.missionBar.classList.add('state-progress');
  elements.statusLabel.textContent = 'WORK IN PROGRESS';
  elements.missionTitle.textContent = 'Agent is working';
  const activityStartedAt = running?.startedAt || turn?.chunks.at(-1)?.endedAt || turn?.prompt?.startedAt;
  const age = Math.max(0, Date.now() - Date.parse(activityStartedAt || new Date().toISOString()));
  const activity = document.createElement('span');
  activity.className = 'progress-activity';
  const pulse = document.createElement('i');
  pulse.setAttribute('aria-hidden', 'true');
  const label = document.createElement('strong');
  label.textContent = `${running?.title || 'Thinking'} · ${formatDuration(age)}`.toUpperCase();
  activity.append(pulse, label);
  const detail = document.createElement('span');
  detail.className = 'progress-detail';
  const prompt = promptTextFor(turn?.prompt);
  detail.textContent = prompt
    ? `Working on “${ellipsize(prompt, 120)}”`
    : 'Processing the current command';
  elements.missionSummary.replaceChildren(activity, detail);
}

function renderMissionResult(turn, session, chunks) {
  elements.missionBar.classList.add('state-result');
  if (!turn) {
    elements.statusLabel.textContent = session.status === 'complete' ? 'SESSION COMPLETE' : 'AGENT STANDING BY';
    elements.missionTitle.textContent = `${session.project || 'Coding agent'} session`;
    elements.missionSummary.textContent = chunks.at(-1)?.summary || 'Waiting for the first user prompt.';
    return;
  }

  const failures = turn.chunks.filter((chunk) => chunk.status === 'error').length;
  const changes = turnChangeStats(turn);
  elements.missionBar.classList.toggle('state-issues', failures > 0);
  elements.statusLabel.textContent = failures ? 'LAST RESULT · COMPLETED WITH ISSUES' : 'LAST RESULT · COMPLETE';
  elements.missionTitle.textContent = failures ? 'Completed with issues' : 'Command complete';

  const summary = document.createElement('div');
  summary.className = 'result-change-summary';
  const files = document.createElement('span');
  files.className = 'result-files';
  files.textContent = `${changes.files} ${changes.files === 1 ? 'file' : 'files'} changed`;
  const additions = document.createElement('span');
  additions.className = 'result-additions';
  additions.textContent = `+${changes.additions.toLocaleString()}`;
  const deletions = document.createElement('span');
  deletions.className = 'result-deletions';
  deletions.textContent = `−${changes.deletions.toLocaleString()}`;
  summary.append(files, additions, deletions);
  elements.missionSummary.replaceChildren(summary);
}

function turnChangeStats(turn) {
  const paths = new Set();
  let additions = 0;
  let deletions = 0;
  for (const chunk of turn?.chunks || []) {
    if (chunk.type !== 'write') continue;
    const patch = patchTextFor(chunk);
    let foundPatchFile = false;
    if (patch) {
      for (const line of patch.split(/\r?\n/)) {
        const fileMatch = line.match(/^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/) || line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (fileMatch) {
          paths.add((fileMatch[2] || fileMatch[1]).trim());
          foundPatchFile = true;
          continue;
        }
        if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
      }
    }
    if (!foundPatchFile) {
      for (const file of chunk.files || []) {
        if (file.action === 'write' && isCredibleProjectPath(file.path)) paths.add(file.path);
      }
    }
  }
  return { files: paths.size, additions, deletions };
}

function patchTextFor(chunk) {
  const input = chunk?.details?.input;
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'patch', 'content']) {
    if (typeof input[key] === 'string' && (/\*\*\* Begin Patch|^diff --git/m.test(input[key]))) return input[key];
  }
  return '';
}

function promptTextFor(prompt) {
  const raw = String(prompt?.details?.prompt || prompt?.summary || '');
  const requestMarker = raw.match(/(?:^|\n)#{1,3}\s*My request:\s*/i);
  const request = requestMarker ? raw.slice(requestMarker.index + requestMarker[0].length) : raw;
  return request
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function promptAttachmentsFor(prompt) {
  const raw = String(prompt?.details?.prompt || '');
  const attachments = new Map();
  const add = (value) => {
    const name = String(value || '').replaceAll('\\', '/').split('/').at(-1)?.trim();
    if (!name || name.toLowerCase() === 'my request') return;
    attachments.set(name.toLowerCase(), {
      name,
      kind: /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(name) ? 'image' : 'file',
    });
  };
  for (const match of raw.matchAll(/^#{2,4}\s+([^:\r\n]+):\s+([^\r\n]+)$/gm)) add(match[1]);
  for (const match of raw.matchAll(/<(?:image|file)\b[^>]*\bpath=["']([^"']+)["'][^>]*>/gi)) add(match[1]);
  return [...attachments.values()];
}

function buildGraphModel(chunks, session) {
  const turns = commandTurns(chunks);
  if (!turns.length) return { nodes: [], links: [], activeRange: null, groupedCount: 0, sourceCount: 0, stepCount: 0, commandCount: 0, fileCount: 0, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
  const work = [];
  let activeRange = null;
  let groupedCount = 0;
  let sourceCount = 0;
  turns.forEach((turn, index) => {
    const promptText = promptTextFor(turn.prompt);
    const prompt = {
      ...turn.prompt,
      type: 'prompt',
      title: promptText || 'User prompt',
      attachments: promptAttachmentsFor(turn.prompt),
      sourceIds: [turn.prompt.id],
      sourceCount: 1,
    };
    const grouped = groupChunks(turn.chunks);
    const result = turnResultNode(turn, session, index === turns.length - 1);
    const turnWork = [prompt, ...grouped];
    work.push(...turnWork);
    const retainUntil = Date.parse(prompt.startedAt) + ACTIVE_RANGE_MIN_MS;
    if (result.inProgress || Date.now() < retainUntil) {
      activeRange = {
        promptId: prompt.id,
        nodeIds: turnWork.map((item) => item.id),
        turnId: turn.id,
        expiresAt: result.inProgress ? null : retainUntil,
      };
    }
    if (!result.inProgress) work.push(result);
    groupedCount += 1 + grouped.length;
    sourceCount += 1 + turn.chunks.length;
  });
  const nodes = [];
  const links = [];
  const spacing = 250;

  work.forEach((data, index) => {
    const lane = laneFor(data);
    const laneDefinition = LANES.find((item) => item.id === lane);
    const attachedFiles = dedupeGraphFiles(data.files || []).filter((file) => isCredibleProjectPath(file.path));
    const hasFileList = attachedFiles.length > 0;
    const isPrompt = data.type === 'prompt';
    const visibleFiles = attachedFiles.slice(0, 4);
    const diffStats = data.type === 'write' && data.diff ? {
      additions: Math.max(0, Number(data.diff.additions) || 0),
      deletions: Math.max(0, Number(data.diff.deletions) || 0),
    } : null;
    const overflowCount = Math.max(0, attachedFiles.length - visibleFiles.length);
    const fileFooterHeight = (overflowCount ? 14 : 0) + (diffStats ? 18 : 0);
    const fileCardHeight = hasFileList
      ? visibleFiles.length * 18 + Math.max(0, visibleFiles.length - 1) * 4 + fileFooterHeight
      : 0;
    const stackGap = 10;
    const cardHeight = isPrompt ? promptCardHeight(data) : data.type === 'result' ? 72 : 68;
    const node = {
      id: data.id, kind: 'chunk', x: 150 + index * spacing,
      y: laneDefinition.y - (hasFileList ? (fileCardHeight + stackGap) / 2 : 0),
      w: isPrompt ? 252 : data.type === 'result' || data.sourceCount > 1 ? 190 : 168,
      h: cardHeight,
      lane, data,
    };
    nodes.push(node);
    if (index) {
      const previous = work[index - 1];
      if (previous.type !== 'result' || data.type === 'prompt') {
        links.push({ from: previous.id, to: data.id, kind: previous.type === 'result' ? 'handoff' : 'sequence' });
      }
    }

    if (hasFileList) {
      const attachment = {
        id: `files:${data.id}`, type: 'files', title: `${attachedFiles.length} affected files`, files: attachedFiles,
        visibleFiles, overflowCount, diffStats,
        parentTitle: data.title, status: 'file', sourceCount: attachedFiles.length,
      };
      nodes.push({
        id: attachment.id, kind: 'files', x: node.x,
        y: laneDefinition.y + (cardHeight + stackGap) / 2, w: 148,
        h: fileCardHeight, lane, data: attachment,
      });
      links.push({ from: data.id, to: attachment.id, kind: 'attachment' });
    }
  });

  if (state.layoutMode === 'orbit') layoutConstellation(nodes, links);
  const bounds = graphBounds(nodes, state.layoutMode === 'orbit' ? 120 : 38);
  return {
    nodes, links, activeRange, groupedCount, sourceCount, stepCount: work.length, commandCount: turns.length,
    fileCount: filesFor(chunks).length,
    bounds,
  };
}

function layoutConstellation(nodes, links) {
  const chunks = nodes.filter((node) => node.kind === 'chunk');
  const filesByParent = new Map(nodes.filter((node) => node.kind === 'files').map((node) => [node.id.slice(6), node]));
  const chunksById = new Map(chunks.map((node) => [node.id, node]));
  const incomingById = new Map(links.filter((link) => link.kind !== 'attachment').map((link) => [link.to, link.from]));
  const placed = [];
  const placedEdges = [];

  chunks.forEach((node, index) => {
    if (!index) {
      node.x = 0;
      node.y = 0;
      placed.push(node);
      return;
    }
    const linkedParent = chunksById.get(incomingById.get(node.id));
    const parent = placed.includes(linkedParent) ? linkedParent : placed.at(-1);
    const preferredAngle = constellationRandom(node.id, 11) * Math.PI * 2 + index * 2.399963229728653;
    const preferredDistance = 238 + constellationRandom(node.id, 29) * 138;
    let best = null;
    for (let ring = 0; ring < 4; ring += 1) {
      const distance = preferredDistance * (.82 + ring * .17);
      for (let option = 0; option < 20; option += 1) {
        const angle = preferredAngle + option * 2.399963229728653 + ring * .19;
        const candidate = {
          ...node,
          x: parent.x + Math.cos(angle) * distance,
          y: parent.y + Math.sin(angle) * distance,
        };
        const score = constellationPlacementScore(candidate, parent, placed, placedEdges, preferredDistance)
          + option * 1.4 + ring * 4;
        if (!best || score < best.score) best = { candidate, score };
      }
    }
    node.x = best.candidate.x;
    node.y = best.candidate.y;
    placedEdges.push({ from: parent, to: node });
    placed.push(node);
  });

  for (const parent of chunks) {
    const files = filesByParent.get(parent.id);
    if (!files) continue;
    const preferredAngle = constellationRandom(files.id, 47) * Math.PI * 2 + .37;
    const distance = Math.max((parent.w + files.w) / 2 + 32, (parent.h + files.h) / 2 + 42);
    let best = null;
    for (let option = 0; option < 18; option += 1) {
      const angle = preferredAngle + option * 2.399963229728653;
      const candidate = {
        ...files,
        x: parent.x + Math.cos(angle) * distance,
        y: parent.y + Math.sin(angle) * distance,
      };
      const score = constellationPlacementScore(candidate, parent, placed, placedEdges, distance, 20) + option;
      if (!best || score < best.score) best = { candidate, score };
    }
    files.x = best.candidate.x;
    files.y = best.candidate.y;
    placedEdges.push({ from: parent, to: files });
    placed.push(files);
  }
}

function constellationPlacementScore(candidate, parent, placed, edges, preferredDistance, padding = 42) {
  let score = Math.abs(Math.hypot(candidate.x - parent.x, candidate.y - parent.y) - preferredDistance) * 3;
  score += Math.hypot(candidate.x * .72, candidate.y * 1.45) * 1.6;
  for (const other of placed) {
    const overlapX = (candidate.w + other.w) / 2 + padding - Math.abs(candidate.x - other.x);
    const overlapY = (candidate.h + other.h) / 2 + padding - Math.abs(candidate.y - other.y);
    if (overlapX > 0 && overlapY > 0) score += 1_000_000 + overlapX * overlapY * 180;
    else {
      const clearance = Math.hypot(candidate.x - other.x, candidate.y - other.y);
      score += Math.max(0, 210 - clearance) * 8;
    }
    if (other !== parent && segmentIntersectsRect(parent, candidate, other, 24)) score += 260_000;
  }
  for (const edge of edges) {
    if (segmentIntersectsRect(edge.from, edge.to, candidate, 24)) score += 220_000;
    if (edge.from === parent || edge.to === parent) continue;
    if (segmentsCross(parent, candidate, edge.from, edge.to)) score += 90_000;
  }
  return score;
}

function segmentsCross(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function constellationRandom(value, salt = 0) {
  let hash = (2166136261 ^ salt) >>> 0;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function graphBounds(nodes, padding = 60) {
  if (!nodes.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...nodes.map((node) => node.x - node.w / 2)) - padding,
    maxX: Math.max(...nodes.map((node) => node.x + node.w / 2)) + padding,
    minY: Math.min(...nodes.map((node) => node.y - node.h / 2)) - padding,
    maxY: Math.max(...nodes.map((node) => node.y + node.h / 2)) + padding,
  };
}

function commandTurns(chunks) {
  const turns = [];
  const byId = new Map();
  for (const chunk of chunks) {
    if (isUserPromptChunk(chunk)) {
      const id = chunk.turnId || `prompt:${chunk.id}`;
      const turn = { id, prompt: chunk, chunks: [], complete: false, endedAt: null };
      turns.push(turn);
      byId.set(id, turn);
      continue;
    }
    const turn = byId.get(chunk.turnId);
    if (!turn) continue;
    if (chunk.type === 'milestone' && chunk.title === 'Turn complete') {
      turn.complete = true;
      turn.endedAt = chunk.endedAt || chunk.startedAt;
      turn.agentResponse = chunk.details?.response || '';
      continue;
    }
    if (chunk.type === 'session') continue;
    turn.chunks.push(chunk);
  }
  return turns;
}

function isUserPromptChunk(chunk) {
  return chunk?.type === 'prompt' || chunk?.type === 'decision' && (chunk.title === 'User direction' || typeof chunk.details?.prompt === 'string');
}

function groupChunks(chunks) {
  const groups = [];
  let previousKey = null;
  for (const chunk of chunks) {
    const key = groupKey(chunk);
    const existing = key && key === previousKey ? groups.at(-1) : null;
    if (!existing) {
      const copy = {
        ...chunk,
        files: dedupeGraphFiles(chunk.files || []),
        sourceIds: [chunk.id],
        sourceCount: 1,
        operations: [operationSnapshot(chunk)],
      };
      groups.push(copy);
      previousKey = key;
      continue;
    }
    existing.sourceIds.push(chunk.id);
    existing.sourceCount += 1;
    existing.files = dedupeGraphFiles([...existing.files, ...(chunk.files || [])]);
    existing.endedAt = chunk.endedAt || chunk.startedAt || existing.endedAt;
    existing.durationMs = (existing.durationMs || 0) + (chunk.durationMs || 0);
    existing.status = combinedStatus(existing.status, chunk.status);
    existing.summary = `${existing.sourceCount} consecutive calls grouped · latest: ${chunk.summary || chunk.title}`;
    existing.operations.push(operationSnapshot(chunk));
    existing.diff = mergeGraphDiffs(existing.operations.map((operation) => operation.diff).filter(Boolean));
    existing.permission = chunk.permission || existing.permission;
    existing.details = { groupedOperations: existing.sourceCount };
    previousKey = key;
  }
  return groups;
}

function operationSnapshot(chunk) {
  return {
    id: chunk.id,
    title: chunk.title,
    summary: chunk.summary,
    status: chunk.status,
    toolName: chunk.toolName,
    startedAt: chunk.startedAt,
    durationMs: chunk.durationMs,
    details: chunk.details,
    diff: chunk.diff,
    permission: chunk.permission,
  };
}

function mergeGraphDiffs(diffs) {
  if (!diffs.length) return null;
  return {
    text: diffs.map((diff) => diff.text).join('\n\n'),
    files: diffs.flatMap((diff) => diff.files || []),
    additions: diffs.reduce((sum, diff) => sum + (diff.additions || 0), 0),
    deletions: diffs.reduce((sum, diff) => sum + (diff.deletions || 0), 0),
    truncated: diffs.some((diff) => diff.truncated),
  };
}

function groupKey(chunk) {
  const toolName = String(chunk.toolName || '').trim().toLowerCase();
  return toolName ? `${chunk.type || 'tool'}:${toolName}` : null;
}

function combinedStatus(first, second) {
  const rank = { complete: 0, waiting: 1, running: 2, error: 3 };
  return (rank[second] || 0) > (rank[first] || 0) ? second : first;
}

function turnResultNode(turn, session, isLastTurn) {
  const failures = turn.chunks.filter((chunk) => chunk.status === 'error').length;
  const sessionActive = session?.status === 'active';
  const running = sessionActive && turn.chunks.some((chunk) => chunk.status === 'running' || chunk.status === 'waiting');
  const active = sessionActive && (running || isLastTurn && !turn.complete);
  const files = filesFor(turn.chunks).length;
  const completed = turn.chunks.filter((chunk) => chunk.status === 'complete').length;
  const response = String(turn.agentResponse || '').trim();
  const title = active ? 'Work in progress' : response ? summarizeGraphText(response, 76) : failures ? 'Completed with issues' : 'Command complete';
  const status = active ? 'running' : failures ? 'error' : 'complete';
  return {
    id: `result:${turn.id}`, type: 'result', status, title, inProgress: active,
    summary: response || `${completed} completed · ${failures} failed · ${files} project files`,
    startedAt: turn.endedAt || turn.chunks.at(-1)?.endedAt || turn.chunks.at(-1)?.startedAt || turn.prompt.startedAt,
    endedAt: turn.endedAt || turn.chunks.at(-1)?.endedAt || null, durationMs: null, turnId: turn.id,
    toolName: null, files: [], sourceIds: [], sourceCount: 1,
    details: { prompt: turn.prompt.summary, response: response || null, completed, failures, files, turnStatus: active ? 'active' : 'complete' },
  };
}

function summarizeGraphText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function laneFor(node) {
  if (node.type === 'result') return 'result';
  if (isUserPromptChunk(node)) return 'prompt';
  if (node.type === 'write' || node.type === 'agent' || node.type === 'decision') return 'change';
  if (node.type === 'test' || node.type === 'build') return 'verify';
  return 'inspect';
}

function enterLive() {
  if (state.layoutMode === 'orbit') state.graphView.scale = Math.max(state.graphView.scale, .58);
  if (state.viewMode === 'live') return followLatest(true);
  state.viewMode = 'live';
  state.selectedNodeId = null;
  updateModeControl();
  followLatest(true);
  syncLiveAnimation();
}

function enterReview() {
  if (state.viewMode === 'review') return;
  state.viewMode = 'review';
  cancelCameraAnimation();
  updateModeControl();
  syncLiveAnimation();
  drawGraph();
}

function updateModeControl() {
  const live = state.viewMode === 'live';
  elements.modeLive.classList.toggle('active', live);
  elements.modeReview.classList.toggle('active', !live);
  elements.modeLive.setAttribute('aria-pressed', String(live));
  elements.modeReview.setAttribute('aria-pressed', String(!live));
}

function setLayoutMode(mode) {
  if (mode === state.layoutMode) return;
  state.layoutMode = mode;
  localStorage.setItem('activisual:layout', mode);
  state.graphSignature = '';
  state.graphView.scale = 1;
  state.graphView.offsetX = 0;
  state.graphView.offsetY = 0;
  render();
  fitGraph();
}

function updateLayoutControl() {
  const orbit = state.layoutMode === 'orbit';
  elements.layoutOrbit.classList.toggle('active', orbit);
  elements.layoutFlow.classList.toggle('active', !orbit);
  elements.layoutOrbit.setAttribute('aria-pressed', String(orbit));
  elements.layoutFlow.setAttribute('aria-pressed', String(!orbit));
  elements.graphHint.textContent = orbit ? 'OMNI-DIRECTIONAL CHRONOLOGY // DRAG TO PAN' : 'LEFT → RIGHT CHRONOLOGY // DRAG TO PAN';
  elements.canvas.setAttribute('aria-label', orbit
    ? 'Omni-directional constellation graph of commands, decisions, files, and results'
    : 'Chronological graph of commands arranged in user prompt, inspect, change, verify, and result lanes');
}

function followLatest(animated = true) {
  const model = state.graphModel;
  const rect = elements.canvas.getBoundingClientRect();
  if (!model?.nodes.length || !rect.width || !rect.height) return drawGraph();
  const latest = model.nodes.filter((node) => node.kind === 'chunk').at(-1);
  const worldWidth = model.bounds.maxX - model.bounds.minX;
  const worldHeight = model.bounds.maxY - model.bounds.minY;
  const gutter = laneGutter();
  const orbitFit = Math.min((rect.width - gutter - 48) / worldWidth, (rect.height - 48) / worldHeight);
  const scale = state.layoutMode === 'orbit' ? clamp(Math.min(state.graphView.scale, Math.max(orbitFit, .58)), .28, 1.1) : state.graphView.scale;
  const scaleY = state.layoutMode === 'orbit' ? scale : verticalScaleFor(rect.height, worldHeight);
  const contentFits = worldWidth * scale <= rect.width - gutter - 48 && worldHeight * scaleY <= rect.height - 32;
  const offsetX = contentFits ? gutter + (rect.width - gutter - worldWidth * scale) / 2 - model.bounds.minX * scale : gutter + (rect.width - gutter) * .76 - latest.x * scale;
  const offsetY = contentFits ? (rect.height - worldHeight * scaleY) / 2 - model.bounds.minY * scaleY : rect.height * .5 - latest.y * scaleY;
  const target = { scale, scaleY, offsetX, offsetY };
  if (animated) animateGraphViewTo(target);
  else {
    cancelCameraAnimation();
    Object.assign(state.graphView, target);
    constrainGraphView();
    drawGraph();
  }
}

function animateGraphViewTo(target) {
  cancelCameraAnimation();
  if (REDUCED_MOTION) {
    Object.assign(state.graphView, target);
    drawGraph();
    return;
  }
  const start = {
    scale: state.graphView.scale,
    scaleY: state.graphView.scaleY,
    offsetX: state.graphView.offsetX,
    offsetY: state.graphView.offsetY,
    at: performance.now(),
  };
  const duration = 520;
  const tick = (now) => {
    const progress = clamp((now - start.at) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    state.graphView.scale = mix(start.scale, target.scale, eased);
    state.graphView.scaleY = mix(start.scaleY, target.scaleY, eased);
    state.graphView.offsetX = mix(start.offsetX, target.offsetX, eased);
    state.graphView.offsetY = mix(start.offsetY, target.offsetY, eased);
    constrainGraphView();
    drawGraph();
    if (progress < 1 && state.viewMode === 'live') state.graphView.animation = requestAnimationFrame(tick);
    else state.graphView.animation = null;
  };
  state.graphView.animation = requestAnimationFrame(tick);
}

function cancelCameraAnimation() {
  if (state.graphView.animation) cancelAnimationFrame(state.graphView.animation);
  state.graphView.animation = null;
}

function syncGraphNodeMotion(previousModel, nextModel, context) {
  if (REDUCED_MOTION) {
    state.nodeMotion.clear();
    state.exitingNodes = [];
    state.motionContext = context;
    return;
  }
  const now = performance.now();
  const reset = state.motionContext !== context;
  if (reset) {
    state.nodeMotion.clear();
    state.exitingNodes = [];
    state.motionContext = context;
  }
  const nextIds = new Set(nextModel.nodes.map((node) => node.id));
  nextModel.nodes.forEach((node, index) => {
    if (!state.nodeMotion.has(node.id)) {
      state.nodeMotion.set(node.id, { enteredAt: now + Math.min(index * 18, 280) });
    }
  });
  if (!reset && previousModel) {
    for (const node of previousModel.nodes) {
      if (!nextIds.has(node.id)) state.exitingNodes.push({ node, removedAt: now });
    }
  }
  for (const id of state.nodeMotion.keys()) {
    if (!nextIds.has(id)) state.nodeMotion.delete(id);
  }
  state.exitingNodes = state.exitingNodes.filter((item) => now - item.removedAt < CARD_EXIT_MS);
}

function nodeEnterProgress(id, now = performance.now()) {
  if (REDUCED_MOTION) return 1;
  const motion = state.nodeMotion.get(id);
  if (!motion) return 1;
  return clamp((now - motion.enteredAt) / CARD_ENTER_MS, 0, 1);
}

function hasPendingCardMotion(now = performance.now()) {
  if (state.exitingNodes.some((item) => now - item.removedAt < CARD_EXIT_MS && isGraphNodeVisible(item.node, 80))) return true;
  return Boolean(state.graphModel?.nodes.some((node) => {
    const motion = state.nodeMotion.get(node.id);
    return motion && now < motion.enteredAt + CARD_ENTER_MS && isGraphNodeVisible(node, 80);
  }));
}

function hasVisibleInProgressCards() {
  if (state.graphModel?.nodes.some((node) => node.kind === 'chunk' && isInProgressNode(node.data) && isGraphNodeVisible(node, 100))) return true;
  const range = state.graphModel?.activeRange;
  return Boolean(range && (!range.expiresAt || Date.now() < range.expiresAt)
    && state.graphModel.nodes.some((node) => range.nodeIds.includes(node.id) && isGraphNodeVisible(node, 100)));
}

function isInProgressNode(data) {
  return data?.status === 'running' || data?.status === 'waiting';
}

function syncLiveAnimation() {
  const shouldAnimate = !REDUCED_MOTION && (hasPendingCardMotion() || hasVisibleInProgressCards());
  if (!shouldAnimate && state.liveFrame) {
    cancelAnimationFrame(state.liveFrame);
    state.liveFrame = null;
    return;
  }
  if (!shouldAnimate || state.liveFrame) return;
  let previous = performance.now();
  const tick = (now) => {
    if (now - previous < GRAPH_ANIMATION_FRAME_MS) {
      state.liveFrame = requestAnimationFrame(tick);
      return;
    }
    state.livePhase = (state.livePhase + (now - previous) * .045) % 1000;
    previous = now;
    drawGraph();
    if (hasPendingCardMotion(now) || hasVisibleInProgressCards()) state.liveFrame = requestAnimationFrame(tick);
    else state.liveFrame = null;
  };
  state.liveFrame = requestAnimationFrame(tick);
}

function fitGraph() {
  const model = state.graphModel;
  const rect = elements.canvas.getBoundingClientRect();
  if (!model?.nodes.length || !rect.width || !rect.height) return drawGraph();
  const worldWidth = model.bounds.maxX - model.bounds.minX;
  const worldHeight = model.bounds.maxY - model.bounds.minY;
  const gutter = laneGutter();
  const scale = clamp(Math.min((rect.width - gutter - 48) / worldWidth, state.layoutMode === 'orbit' ? (rect.height - 48) / worldHeight : Infinity), .28, 1.1);
  const scaleY = state.layoutMode === 'orbit' ? scale : verticalScaleFor(rect.height, worldHeight);
  cancelCameraAnimation();
  state.graphView.scale = scale;
  state.graphView.scaleY = scaleY;
  state.graphView.offsetX = gutter + 28 - model.bounds.minX * scale;
  state.graphView.offsetY = (rect.height - worldHeight * scaleY) / 2 - model.bounds.minY * scaleY;
  constrainGraphView();
  drawGraph();
}

function resetGraph() {
  if (state.layoutMode === 'orbit') return fitGraph();
  const rect = elements.canvas.getBoundingClientRect();
  cancelCameraAnimation();
  state.graphView.scale = 1;
  state.graphView.scaleY = verticalScaleFor(rect.height, 680);
  state.graphView.offsetX = laneGutter() + 28;
  state.graphView.offsetY = (rect.height - 680 * state.graphView.scaleY) / 2 - 30 * state.graphView.scaleY;
  constrainGraphView();
  drawGraph();
}

function zoomGraph(factor, centerX = laneGutter() + (elements.graphWrap.clientWidth - laneGutter()) / 2, centerY = elements.graphWrap.clientHeight / 2) {
  const view = state.graphView;
  const oldScale = view.scale;
  const nextScale = clamp(oldScale * factor, minimumGraphScale(), Math.max(1.8, minimumGraphScale()));
  const zoomRatio = nextScale / oldScale;
  const worldX = (centerX - view.offsetX) / oldScale;
  const oldScaleY = view.scaleY;
  const worldY = (centerY - view.offsetY) / oldScaleY;
  view.scale = nextScale;
  view.scaleY = clamp(oldScaleY * zoomRatio, .12, 1.8);
  view.offsetX = centerX - worldX * nextScale;
  view.offsetY = centerY - worldY * view.scaleY;
  constrainGraphView();
  drawGraph();
}

function minimumGraphScale() {
  const model = state.graphModel;
  const rect = elements.canvas.getBoundingClientRect();
  if (!model?.nodes.length || !rect.width || !rect.height) return .28;
  const contentBounds = graphBounds(model.nodes, 0);
  const worldWidth = Math.max(1, contentBounds.maxX - contentBounds.minX);
  const worldHeight = Math.max(1, contentBounds.maxY - contentBounds.minY);
  const availableWidth = Math.max(1, rect.width - laneGutter());
  const widthMinimum = availableWidth * .5 / worldWidth;
  if (state.layoutMode !== 'orbit') return Math.max(.28, widthMinimum);
  const heightMinimum = rect.height * .5 / worldHeight;
  return Math.max(.28, widthMinimum, heightMinimum);
}

function constrainGraphView() {
  const model = state.graphModel;
  const rect = elements.canvas.getBoundingClientRect();
  if (!model?.nodes.length || !rect.width || !rect.height) return;
  const view = state.graphView;
  const contentBounds = graphBounds(model.nodes, 0);
  const minimumScale = minimumGraphScale();
  if (view.scale < minimumScale) {
    const centerX = laneGutter() + (rect.width - laneGutter()) / 2;
    const worldX = (centerX - view.offsetX) / view.scale;
    const centerY = rect.height / 2;
    const worldY = (centerY - view.offsetY) / view.scaleY;
    const zoomRatio = minimumScale / view.scale;
    view.scale = minimumScale;
    view.scaleY = clamp(view.scaleY * zoomRatio, .12, 1.8);
    view.offsetX = centerX - worldX * view.scale;
    view.offsetY = centerY - worldY * view.scaleY;
  }
  const gutter = laneGutter();
  const middleX = gutter + (rect.width - gutter) / 2;
  const middleY = rect.height / 2;
  const minOffsetX = middleX - contentBounds.maxX * view.scale;
  const maxOffsetX = middleX - contentBounds.minX * view.scale;
  const minOffsetY = middleY - contentBounds.maxY * view.scaleY;
  const maxOffsetY = middleY - contentBounds.minY * view.scaleY;
  view.offsetX = clamp(view.offsetX, minOffsetX, maxOffsetX);
  view.offsetY = clamp(view.offsetY, minOffsetY, maxOffsetY);
}

function verticalScaleFor(height, worldHeight) {
  return clamp((height - 34) / worldHeight, state.layoutMode === 'orbit' ? .28 : .76, 1);
}

function drawGraph() {
  const model = state.graphModel;
  const canvas = elements.canvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, rect.width);
  const height = Math.max(430, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  state.graphHits = [];
  elements.graphEmpty.hidden = Boolean(model?.nodes.length);
  if (!model?.nodes.length) {
    elements.graphMeta.textContent = '0 STEPS · 0 LINKS';
    elements.graphSummary.textContent = state.layoutMode === 'orbit' ? 'CONSTELLATION MAP' : 'CHRONOLOGICAL LANES';
    return;
  }

  drawGrid(ctx, width, height);
  if (state.layoutMode === 'flow') drawLaneBands(ctx, width);
  else drawConstellationField(ctx, width, height);
  const now = performance.now();
  const screenNodes = model.nodes.map(projectNode);
  const byId = new Map(screenNodes.map((node) => [node.id, node]));
  const visibleNodes = screenNodes.filter((node) => isScreenNodeVisible(node, width, height, 110));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinkKeys = new Set();
  const visibleLinks = model.links.filter((link) => {
    if (!visibleIds.has(link.from) || !visibleIds.has(link.to)) return false;
    const key = `${link.from}:${link.to}:${link.kind}`;
    if (visibleLinkKeys.has(key)) return false;
    visibleLinkKeys.add(key);
    return true;
  });
  const linkRoutes = allocateLinkRoutes(visibleLinks, byId, visibleNodes);
  const related = relatedNodeIds(model);
  const focusId = state.hoveredNodeId || state.selectedNodeId;
  const latestSequence = [...model.links].reverse().find((link) => link.kind === 'sequence');
  const liveHeadId = state.viewMode === 'live' && state.session?.status === 'active' ? latestSequence?.to : null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(laneGutter(), 0, Math.max(0, width - laneGutter()), height);
  ctx.clip();
  drawActiveWorkRange(ctx, model.activeRange, byId, width, height);
  for (const link of visibleLinks) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    const emphasized = !focusId || related.has(link.from) && related.has(link.to);
    const motionOpacity = Math.min(nodeEnterProgress(link.from, now), nodeEnterProgress(link.to, now));
    drawLink(
      ctx, from, to, link.kind, (emphasized ? 1 : .12) * motionOpacity,
      link === latestSequence && Boolean(liveHeadId), linkRoutes.get(link), itemDurationLabel(to.data),
    );
  }
  drawExitingCards(ctx, now);
  for (const node of visibleNodes) {
    const progress = nodeEnterProgress(node.id, now);
    const animatedNode = animateCardEntrance(node, progress);
    const opacity = (!focusId || related.has(node.id) ? 1 : .16) * smoothstep(progress);
    if (progress < 1) drawMaterializationHalo(ctx, animatedNode, progress);
    if (node.kind === 'files') drawFileNode(ctx, animatedNode, opacity);
    else drawWorkNode(ctx, animatedNode, opacity, node.id === liveHeadId);
  }
  ctx.restore();
  if (state.layoutMode === 'flow') drawLaneHeaders(ctx, height);

  state.graphHits = visibleNodes.filter((node) => node.x + node.w / 2 >= laneGutter()).map((node) => ({ ...node, node: node.data }));
  const collapsed = Math.max(0, model.sourceCount - model.groupedCount);
  elements.graphSummary.textContent = collapsed ? `${collapsed} REPEATED STEP${collapsed === 1 ? '' : 'S'} COLLAPSED` : state.layoutMode === 'orbit' ? 'CONSTELLATION MAP' : 'CHRONOLOGICAL LANES';
  elements.graphMeta.textContent = `${model.commandCount} COMMAND${model.commandCount === 1 ? '' : 'S'} · ${model.stepCount} STEPS · ${model.fileCount} FILES`;
  if (!state.liveFrame && !REDUCED_MOTION && (hasPendingCardMotion(now) || hasVisibleInProgressCards())) syncLiveAnimation();
}

function projectNode(node) {
  const scale = state.graphView.scale;
  const scaleY = state.graphView.scaleY;
  const visualScale = scale;
  const x = state.graphView.offsetX + node.x * scale;
  const laneY = LANES.find((lane) => lane.id === node.lane)?.y || 0;
  const y = state.layoutMode === 'orbit'
    ? state.graphView.offsetY + node.y * scale
    : state.graphView.offsetY + laneY * scaleY + (node.y - laneY) * visualScale;
  return {
    ...node, x, y, visualScale,
    w: node.w * visualScale,
    h: node.h * visualScale,
  };
}

function drawLaneBands(ctx, width) {
  const gutter = laneGutter();
  for (const lane of LANES) {
    const y = state.graphView.offsetY + lane.y * state.graphView.scaleY;
    ctx.save();
    ctx.fillStyle = 'rgba(9,18,16,.22)';
    ctx.fillRect(gutter, y - 70 * state.graphView.scaleY, width - gutter, 140 * state.graphView.scaleY);
    ctx.strokeStyle = 'rgba(161,188,177,.09)';
    ctx.beginPath(); ctx.moveTo(gutter, y + 70 * state.graphView.scaleY); ctx.lineTo(width, y + 70 * state.graphView.scaleY); ctx.stroke();
    ctx.restore();
  }
}

function drawLaneHeaders(ctx, height) {
  const gutter = laneGutter();
  const labelX = gutter < 120 ? 14 : 18;
  const stats = laneStats();
  ctx.save();
  ctx.fillStyle = 'rgba(5,10,9,.97)';
  ctx.fillRect(0, 0, gutter, height);
  ctx.strokeStyle = 'rgba(161,188,177,.18)';
  ctx.beginPath(); ctx.moveTo(gutter - .5, 0); ctx.lineTo(gutter - .5, height); ctx.stroke();
  ctx.beginPath(); ctx.rect(0, 0, gutter - 1, height); ctx.clip();
  for (const lane of LANES) {
    const y = state.graphView.offsetY + lane.y * state.graphView.scaleY;
    const laneStat = stats.get(lane.id);
    ctx.strokeStyle = 'rgba(161,188,177,.07)';
    ctx.beginPath(); ctx.moveTo(0, y + 70 * state.graphView.scaleY); ctx.lineTo(gutter, y + 70 * state.graphView.scaleY); ctx.stroke();
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = .72;
    ctx.font = `700 9px ${GRAPH_FONT}`;
    ctx.fillText(lane.label, labelX, y - 8);
    ctx.fillStyle = '#82968e';
    ctx.font = `${gutter < 120 ? 7 : 8}px ${GRAPH_FONT}`;
    if (lane.id === 'prompt') {
      ctx.fillText(`${laneStat.count} PROMPT${laneStat.count === 1 ? '' : 'S'} · ${formatLaneDuration(laneStat.durationMs)}`, labelX, y + 8);
    } else if (lane.id === 'result') {
      ctx.fillText(`${laneStat.count} RESULT${laneStat.count === 1 ? '' : 'S'} · ${formatLaneDuration(laneStat.durationMs)}`, labelX, y + 8);
      ctx.fillStyle = '#60756d';
      ctx.fillText(`IDLE · ${formatLaneDuration(stats.get('idle').durationMs)}`, labelX, y + 24);
    } else {
      ctx.fillText(`${formatLaneDuration(laneStat.durationMs)} · ${laneStat.percentage}%`, labelX, y + 8);
    }
  }
  ctx.restore();
}

function laneStats() {
  const chunks = state.session?.chunks || [];
  const now = Date.now();
  const stats = new Map(LANES.map((lane) => [lane.id, { durationMs: 0, percentage: 0, count: 0 }]));
  const turnEnds = turnCompletionTimes(chunks);
  for (const chunk of chunks) {
    if (chunk.type === 'session' || chunk.type === 'milestone' && chunk.title === 'Turn complete') continue;
    const lane = laneFor(chunk);
    const stat = stats.get(lane);
    if (!stat || lane === 'result') continue;
    stat.durationMs += measuredDuration(chunk, now, turnEnds);
    stat.count += 1;
  }
  const midLanes = new Set(['inspect', 'change', 'verify']);
  const totalDuration = [...stats.entries()].filter(([lane]) => midLanes.has(lane)).reduce((sum, [, stat]) => sum + stat.durationMs, 0);
  for (const [lane, stat] of stats) {
    if (lane === 'result') {
      stat.durationMs = totalDuration;
      stat.count = stats.get('prompt').count;
    } else if (midLanes.has(lane)) {
      stat.percentage = totalDuration > 0 ? Math.round(stat.durationMs / totalDuration * 100) : 0;
    }
  }
  stats.set('idle', { durationMs: idleDuration(chunks, now, state.session?.endedAt), percentage: 0, count: 0 });
  return stats;
}

function measuredDuration(chunk, now, turnEnds = new Map()) {
  if (Number.isFinite(chunk.durationMs)) return Math.max(0, chunk.durationMs);
  if ((chunk.status === 'running' || chunk.status === 'waiting') && chunk.startedAt) {
    const turnEnd = turnEnds.get(chunk.turnId);
    return Math.max(0, Math.min(now, turnEnd || now) - Date.parse(chunk.startedAt));
  }
  return 0;
}

function turnCompletionTimes(chunks) {
  const ends = new Map();
  for (const chunk of chunks) {
    if (chunk.type !== 'milestone' || chunk.title !== 'Turn complete' || !chunk.turnId || ends.has(chunk.turnId)) continue;
    ends.set(chunk.turnId, Date.parse(chunk.endedAt || chunk.startedAt));
  }
  return ends;
}

function idleDuration(chunks, now, sessionEndedAt) {
  let total = 0;
  let idleStartedAt = null;
  for (const chunk of chunks) {
    if (chunk.type === 'milestone' && chunk.title === 'Turn complete') {
      idleStartedAt ??= Date.parse(chunk.endedAt || chunk.startedAt);
    } else if (isUserPromptChunk(chunk) && idleStartedAt != null) {
      total += Math.max(0, Date.parse(chunk.startedAt) - idleStartedAt);
      idleStartedAt = null;
    }
  }
  if (idleStartedAt != null) {
    const idleEnd = sessionEndedAt ? Date.parse(sessionEndedAt) : now;
    total += Math.max(0, idleEnd - idleStartedAt);
  }
  return total;
}

function drawGrid(ctx, width, height) {
  const gutter = laneGutter();
  const step = Math.max(34, 52 * state.graphView.scale);
  const startX = ((state.graphView.offsetX % step) + step) % step;
  ctx.strokeStyle = 'rgba(140,170,158,.035)'; ctx.lineWidth = 1;
  for (let x = startX; x < width; x += step) {
    if (x < gutter) continue;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  if (state.layoutMode === 'orbit') {
    const startY = ((state.graphView.offsetY % step) + step) % step;
    for (let y = startY; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(gutter, y); ctx.lineTo(width, y); ctx.stroke();
    }
  }
}

function drawConstellationField(ctx, width, height) {
  const originX = state.graphView.offsetX;
  const originY = state.graphView.offsetY;
  const scale = (state.graphView.scale + state.graphView.scaleY) / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(121,217,255,.075)';
  ctx.fillStyle = 'rgba(121,217,255,.32)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  for (let ring = 1; ring <= 6; ring += 1) {
    const radius = ring * 218 * scale;
    if (radius > Math.max(width, height) * 1.2) break;
    ctx.beginPath(); ctx.arc(originX, originY, radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(originX, originY, 3, 0, Math.PI * 2); ctx.fill();
  ctx.font = `700 7px ${GRAPH_FONT}`;
  ctx.fillText('ORIGIN // T+0', originX + 9, originY - 9);
  ctx.strokeStyle = 'rgba(113,247,168,.07)';
  ctx.beginPath(); ctx.moveTo(laneGutter(), originY); ctx.lineTo(width, originY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(originX, 0); ctx.lineTo(originX, height); ctx.stroke();
  ctx.restore();
}

function drawLink(ctx, from, to, kind, opacity, active = false, route = null, durationLabel = '') {
  const linkScale = Math.max(.01, (from.visualScale + to.visualScale) / 2);
  const strokeScale = graphStrokeScale(linkScale);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = kind === 'attachment' ? 'rgba(121,217,255,.48)' : kind === 'handoff' ? 'rgba(255,209,102,.54)' : active ? 'rgba(113,247,168,.88)' : 'rgba(113,247,168,.42)';
  ctx.lineWidth = (kind === 'attachment' ? 1 : active ? 2 : 1.35) * strokeScale;
  if (kind === 'attachment') ctx.setLineDash([3 * strokeScale, 5 * strokeScale]);
  if (active) { ctx.setLineDash([8 * strokeScale, 8 * strokeScale]); ctx.lineDashOffset = -state.livePhase * strokeScale; }
  const ports = route?.ports || linkPorts(from, to, [], kind);
  const start = portPoint(from, ports.from, route?.fromOffset || 0);
  const end = portPoint(to, ports.to, route?.toOffset || 0);
  const startNormal = portNormal(ports.from);
  const endNormal = portNormal(ports.to);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const verticalDistance = Math.abs(end.y - start.y);
  const curve = clamp(Math.max(distance * .28, verticalDistance * .24), 34 * linkScale, 126 * linkScale);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  if (portsFaceDirectly(ports, start, end)) {
    ctx.lineTo(end.x, end.y);
  } else {
    ctx.bezierCurveTo(
      start.x + startNormal.x * curve,
      start.y + startNormal.y * curve,
      end.x + endNormal.x * curve,
      end.y + endNormal.y * curve,
      end.x,
      end.y,
    );
  }
  ctx.stroke();
  if (kind === 'sequence' || kind === 'handoff') {
    drawArrowHead(ctx, end.x, end.y, kind === 'handoff' ? '#ffd166' : 'rgba(113,247,168,.72)', ports.to, strokeScale);
    if (durationLabel && to.visualScale >= .48) drawLinkDuration(ctx, end, endNormal, durationLabel, kind, strokeScale);
  }
  ctx.restore();
}

function drawLinkDuration(ctx, end, endNormal, label, kind, scale) {
  const fontSize = clamp(7.5 * scale, 7.5, 10.5);
  const perpendicular = { x: -endNormal.y, y: endNormal.x };
  const x = end.x + endNormal.x * 22 * scale + perpendicular.x * 9 * scale;
  const y = end.y + endNormal.y * 22 * scale + perpendicular.y * 9 * scale;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${GRAPH_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(label).width + 10 * scale;
  const height = fontSize + 6 * scale;
  ctx.fillStyle = 'rgba(5,12,10,.94)';
  ctx.strokeStyle = kind === 'handoff' ? 'rgba(255,209,102,.46)' : 'rgba(113,247,168,.38)';
  ctx.lineWidth = Math.max(1, scale);
  roundedRect(ctx, x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = kind === 'handoff' ? '#ffd166' : '#9bcbb5';
  ctx.fillText(label, x, y + .3);
  ctx.restore();
}

function portsFaceDirectly(ports, start, end) {
  const vertical = (ports.from === 'top' && ports.to === 'bottom' || ports.from === 'bottom' && ports.to === 'top')
    && Math.abs(start.x - end.x) < .5;
  const horizontal = (ports.from === 'left' && ports.to === 'right' || ports.from === 'right' && ports.to === 'left')
    && Math.abs(start.y - end.y) < .5;
  return vertical || horizontal;
}

function allocateLinkRoutes(links, byId, nodes) {
  const routes = new Map();
  const usages = new Map();
  for (const link of links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    const ports = linkPorts(from, to, nodes, link.kind);
    const route = { ports, fromOffset: 0, toOffset: 0 };
    routes.set(link, route);
    addPortUsage(usages, from, ports.from, to, route, 'fromOffset');
    addPortUsage(usages, to, ports.to, from, route, 'toOffset');
  }
  for (const group of usages.values()) distributePortUsages(group);
  return routes;
}

function addPortUsage(usages, node, port, other, route, offsetKey) {
  const key = `${node.id}:${port}`;
  const group = usages.get(key) || { node, port, items: [] };
  group.items.push({ other, route, offsetKey });
  usages.set(key, group);
}

function distributePortUsages({ node, port, items }) {
  if (items.length < 2) return;
  const verticalEdge = port === 'top' || port === 'bottom';
  items.sort((a, b) => verticalEdge ? a.other.x - b.other.x || a.other.y - b.other.y : a.other.y - b.other.y || a.other.x - b.other.x);
  const edgeLength = verticalEdge ? node.w : node.h;
  const edgePadding = Math.min(14 * node.visualScale, edgeLength * .25);
  const usableSpan = Math.max(0, edgeLength - edgePadding * 2);
  const spacing = Math.min(18 * node.visualScale, usableSpan / (items.length - 1));
  const start = -spacing * (items.length - 1) / 2;
  items.forEach((item, index) => { item.route[item.offsetKey] = start + index * spacing; });
}

function linkPorts(from, to, nodes, kind = 'sequence') {
  const ports = ['top', 'right', 'bottom', 'left'];
  const routeScale = Math.max(.01, (from.visualScale + to.visualScale) / 2);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const centerDistance = Math.max(1, Math.hypot(dx, dy));
  const direction = { x: dx / centerDistance, y: dy / centerDistance };
  const candidates = [];
  for (const fromPort of ports) {
    for (const toPort of ports) {
      const startNormal = portNormal(fromPort);
      const endNormal = portNormal(toPort);
      const sourceFacing = startNormal.x * direction.x + startNormal.y * direction.y;
      const targetFacing = endNormal.x * -direction.x + endNormal.y * -direction.y;
      if (sourceFacing < -.05 || targetFacing < -.05) continue;
      const start = portPoint(from, fromPort);
      const end = portPoint(to, toPort);
      const endpointDistance = Math.hypot(end.x - start.x, end.y - start.y);
      const alignmentPenalty = (2 - sourceFacing - targetFacing) * (kind === 'attachment' ? 32 : 46) * routeScale;
      const turnPenalty = fromPortAxis(fromPort) === fromPortAxis(toPort) ? 0 : 9 * routeScale;
      const corridorPenalty = (portCorridorClear(from, fromPort, to, nodes) ? 0 : 440 * routeScale)
        + (portCorridorClear(to, toPort, from, nodes) ? 0 : 440 * routeScale);
      const crossingPenalty = linkPassesThroughNode(start, end, from, to, nodes) ? 900 * routeScale : 0;
      candidates.push({
        from: fromPort,
        to: toPort,
        score: endpointDistance + alignmentPenalty + turnPenalty + corridorPenalty + crossingPenalty,
      });
    }
  }
  return candidates.sort((a, b) => a.score - b.score)[0] || {
    from: dx >= 0 ? 'right' : 'left',
    to: dx >= 0 ? 'left' : 'right',
  };
}

function fromPortAxis(port) { return port === 'top' || port === 'bottom' ? 'vertical' : 'horizontal'; }

function portCorridorClear(node, port, counterpart, nodes) {
  const point = portPoint(node, port);
  const normal = portNormal(port);
  const scale = Math.max(.01, node.visualScale || 1);
  const corridorEnd = { x: point.x + normal.x * 54 * scale, y: point.y + normal.y * 54 * scale };
  return !nodes.some((other) => other.id !== node.id && other.id !== counterpart.id
    && segmentIntersectsRect(point, corridorEnd, other, 5 * scale));
}

function linkPassesThroughNode(start, end, from, to, nodes) {
  const scale = Math.max(.01, (from.visualScale + to.visualScale) / 2);
  return nodes.some((node) => node.id !== from.id && node.id !== to.id && segmentIntersectsRect(start, end, node, 9 * scale));
}

function segmentIntersectsRect(start, end, node, padding = 0) {
  const left = node.x - node.w / 2 - padding;
  const right = node.x + node.w / 2 + padding;
  const top = node.y - node.h / 2 - padding;
  const bottom = node.y + node.h / 2 + padding;
  let minimum = 0;
  let maximum = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  for (const [origin, delta, min, max] of [[start.x, dx, left, right], [start.y, dy, top, bottom]]) {
    if (Math.abs(delta) < .001) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return false;
  }
  return true;
}

function portPoint(node, port, offset = 0) {
  if (port === 'top') return { x: node.x + offset, y: node.y - node.h / 2 };
  if (port === 'bottom') return { x: node.x + offset, y: node.y + node.h / 2 };
  if (port === 'left') return { x: node.x - node.w / 2, y: node.y + offset };
  return { x: node.x + node.w / 2, y: node.y + offset };
}

function portNormal(port) {
  if (port === 'top') return { x: 0, y: -1 };
  if (port === 'bottom') return { x: 0, y: 1 };
  if (port === 'left') return { x: -1, y: 0 };
  return { x: 1, y: 0 };
}

function drawArrowHead(ctx, x, y, color, port = 'left', scale = 1) {
  const angle = port === 'top' ? Math.PI / 2 : port === 'bottom' ? -Math.PI / 2 : port === 'right' ? Math.PI : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-7 * scale, -4 * scale);
  ctx.lineTo(-7 * scale, 4 * scale);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawWorkNode(ctx, node, opacity, liveHead = false) {
  const { x, y, data } = node;
  const visualScale = Math.max(.01, node.visualScale || 1);
  const w = node.w / visualScale;
  const h = node.h / visualScale;
  const color = nodeColor(data);
  const inProgress = isInProgressNode(data);
  const selected = state.selectedNodeId === data.id || state.hoveredNodeId === data.id;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.scale(visualScale, visualScale);
  ctx.fillStyle = data.type === 'result' ? 'rgba(12,28,21,.98)' : 'rgba(8,17,14,.96)';
  ctx.strokeStyle = color;
  ctx.lineWidth = (selected ? 2 : 1) * graphStrokeScale(visualScale) / visualScale;
  if (liveHead || inProgress) {
    const pulse = .32 + (Math.sin(state.livePhase * .045) + 1) * .14;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 + pulse * 14;
  }
  roundedRect(ctx, -w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color; ctx.fillRect(-w / 2, -h / 2, 3 * graphStrokeScale(visualScale) / visualScale, h);
  if (inProgress) drawInProgressMagic(ctx, w, h, color, visualScale);
  const detailFontSize = (data.type === 'prompt' ? 10 : 11) * visualScale;
  if (node.h < 36 || node.w < 72) {
    drawCompactNodeTitle(ctx, node, data.type.toUpperCase(), color);
    ctx.restore();
    return;
  }
  if (detailFontSize < 8) {
    if (data.type === 'prompt') drawCondensedPromptNode(ctx, node, data, color);
    else drawCondensedWorkNode(ctx, node, data, color);
    ctx.restore();
    return;
  }
  if (data.type === 'prompt') {
    drawPromptNodeContent(ctx, data, w, h, color);
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.font = `700 8px ${GRAPH_FONT}`;
  ctx.fillText(data.type.toUpperCase().slice(0, 12), -w / 2 + 12, -14);
  ctx.fillStyle = '#eef6f1';
  ctx.font = `600 11px ${GRAPH_FONT}`;
  ctx.fillText(fitNodeTitle(data, Math.max(11, Math.floor((w - 24) / 6.7))), -w / 2 + 12, 5);
  ctx.fillStyle = '#789087';
  ctx.font = `8px ${GRAPH_FONT}`;
  ctx.fillText(cardTimingText(data), -w / 2 + 12, h / 2 - 9);
  if (data.permission && w >= 116) {
    const gate = data.permission.allowed === false ? 'DENY' : data.permission.allowed === true ? 'ALLOW' : 'GATE';
    ctx.fillStyle = data.permission.allowed === false ? '#ff646d' : data.permission.allowed === true ? '#71f7a8' : '#ffd166';
    ctx.font = `700 7px ${GRAPH_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`◇ ${gate}`, w / 2 - 9, h / 2 - 9);
  }
  ctx.restore();
}

function drawPromptNodeContent(ctx, data, w, h, color) {
  const left = -w / 2 + 13;
  const top = -h / 2;
  const right = w / 2 - 13;
  ctx.fillStyle = color;
  ctx.font = `700 8px ${GRAPH_FONT}`;
  ctx.fillText('PROMPT', left, top + 17);

  ctx.fillStyle = '#f4f1df';
  ctx.font = `600 10px ${GRAPH_FONT}`;
  const titleTop = top + 39;
  const titleBottom = data.attachments?.length ? h / 2 - 48 : h / 2 - 23;
  const maxLines = clamp(Math.floor((titleBottom - titleTop) / 14) + 1, 1, 3);
  const lines = wrapCanvasText(ctx, data.title || 'User prompt', w - 26, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, left, top + 39 + index * 14));

  if (data.attachments?.length) {
    const attachment = data.attachments[0];
    const dividerY = h / 2 - 42;
    ctx.strokeStyle = 'rgba(255,209,102,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, dividerY); ctx.lineTo(right, dividerY); ctx.stroke();
    drawAttachmentIcon(ctx, left, h / 2 - 28, attachment.kind, color);
    ctx.fillStyle = '#c9d7d1';
    ctx.font = `8px ${GRAPH_FONT}`;
    const countLabel = data.attachments.length > 1 ? `+${data.attachments.length - 1}` : '';
    const countWidth = countLabel ? ctx.measureText(countLabel).width + 10 : 0;
    ctx.fillText(fitCanvasText(ctx, attachment.name, w - 47 - countWidth), left + 18, h / 2 - 24);
    if (countLabel) {
      ctx.fillStyle = color;
      ctx.font = `700 8px ${GRAPH_FONT}`;
      ctx.fillText(countLabel, right - ctx.measureText(countLabel).width, h / 2 - 24);
    }
  }

  ctx.fillStyle = '#789087';
  ctx.font = `8px ${GRAPH_FONT}`;
  ctx.fillText(cardTimingText(data), left, h / 2 - 9);
}

function drawCondensedPromptNode(ctx, node, data, color) {
  const visualScale = Math.max(.01, node.visualScale || 1);
  const w = node.w / visualScale;
  const h = node.h / visualScale;
  const padding = 10 / visualScale;
  const headerSize = 7 / visualScale;
  const bodySize = 9 / visualScale;
  const lineHeight = 12 / visualScale;
  const left = -w / 2 + padding;
  const top = -h / 2 + padding;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.font = `700 ${headerSize}px ${GRAPH_FONT}`;
  ctx.fillText('PROMPT', left, top);
  const bodyTop = top + headerSize + 6 / visualScale;
  const availableHeight = h / 2 - padding - bodyTop;
  const maxLines = clamp(Math.floor(availableHeight / lineHeight), 1, 2);
  ctx.fillStyle = '#f4f1df';
  ctx.font = `600 ${bodySize}px ${GRAPH_FONT}`;
  const lines = wrapCanvasText(ctx, data.title || 'User prompt', w - padding * 2, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, left, bodyTop + index * lineHeight));
}

function drawCondensedWorkNode(ctx, node, data, color) {
  const visualScale = Math.max(.01, node.visualScale || 1);
  const w = node.w / visualScale;
  const h = node.h / visualScale;
  const padding = 9 / visualScale;
  const left = -w / 2 + padding;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = `700 ${7 / visualScale}px ${GRAPH_FONT}`;
  ctx.fillText(data.type.toUpperCase().slice(0, 12), left, -6 / visualScale);
  ctx.fillStyle = '#eef6f1';
  ctx.font = `600 ${9 / visualScale}px ${GRAPH_FONT}`;
  ctx.fillText(fitCanvasText(ctx, displayNodeTitle(data), w - padding * 2), left, 8 / visualScale);
}

function drawAttachmentIcon(ctx, x, y, kind, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  if (kind === 'image') {
    ctx.strokeRect(x, y - 6, 12, 10);
    ctx.beginPath(); ctx.arc(x + 9, y - 3, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 5, y - 1); ctx.lineTo(x + 8, y + 2); ctx.lineTo(x + 10, y); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + 1, y - 6); ctx.lineTo(x + 8, y - 6); ctx.lineTo(x + 12, y - 2); ctx.lineTo(x + 12, y + 4); ctx.lineTo(x + 1, y + 4); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 8, y - 6); ctx.lineTo(x + 8, y - 2); ctx.lineTo(x + 12, y - 2); ctx.stroke();
  }
  ctx.restore();
}

function wrapCanvasText(ctx, value, maxWidth, maxLines) {
  const words = String(value || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let index = 0;
  let overflow = false;
  for (; index < words.length; index += 1) {
    const candidate = current ? `${current} ${words[index]}` : words[index];
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    const fitted = fitCanvasText(ctx, current, maxWidth);
    if (fitted !== current) overflow = true;
    lines.push(fitted);
    current = words[index];
    if (lines.length === maxLines) { overflow = true; break; }
  }
  if (lines.length < maxLines && current) {
    const fitted = fitCanvasText(ctx, current, maxWidth);
    if (fitted !== current) overflow = true;
    lines.push(fitted);
  }
  if (index < words.length) overflow = true;
  if (overflow && lines.length) lines[lines.length - 1] = fitCanvasText(ctx, lines.at(-1), maxWidth, true);
  return lines.slice(0, maxLines);
}

function fitCanvasText(ctx, value, maxWidth, forceEllipsis = false) {
  let text = String(value || '');
  if (forceEllipsis) text = text.replace(/…$/, '');
  const suffix = forceEllipsis || ctx.measureText(text).width > maxWidth ? '…' : '';
  while (text && ctx.measureText(`${text}${suffix}`).width > maxWidth) text = text.slice(0, -1);
  return `${text.trimEnd()}${suffix}`;
}

function drawFileNode(ctx, node, opacity) {
  const { x, y, data } = node;
  const visualScale = Math.max(.01, node.visualScale || 1);
  const screenWidth = node.w;
  const w = node.w / visualScale;
  const h = node.h / visualScale;
  const selected = state.selectedNodeId === data.id || state.hoveredNodeId === data.id;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.scale(visualScale, visualScale);
  if (screenWidth < 64 || visualScale < .65) {
    ctx.fillStyle = 'rgba(7,16,18,.96)';
    ctx.strokeStyle = selected ? '#79d9ff' : 'rgba(121,217,255,.58)';
    ctx.lineWidth = (selected ? 1.8 : 1) * graphStrokeScale(visualScale) / visualScale;
    roundedRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#aac0ba';
    ctx.font = `700 ${compactNodeFontSize(node) / visualScale}px ${GRAPH_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(data.files.length), 1 / visualScale, 0);
    ctx.restore();
    return;
  }
  const maxChars = Math.max(8, Math.floor((w - 34) / 6.2));
  const overflowHeight = data.overflowCount ? 14 : 0;
  const diffHeight = data.diffStats ? 18 : 0;
  const fileRowsHeight = h - overflowHeight - diffHeight;
  const gap = Math.min(4, fileRowsHeight / 18);
  const rowHeight = (fileRowsHeight - gap * Math.max(0, data.visibleFiles.length - 1)) / data.visibleFiles.length;
  data.visibleFiles.forEach((file, index) => {
    const rowY = -h / 2 + rowHeight / 2 + index * (rowHeight + gap);
    const actionColor = file.action === 'write' ? '#b39cff' : '#79d9ff';
    ctx.fillStyle = 'rgba(7,16,18,.96)';
    ctx.strokeStyle = selected ? actionColor : `${actionColor}88`;
    ctx.lineWidth = (selected ? 1.5 : 1) * graphStrokeScale(visualScale) / visualScale;
    roundedRect(ctx, -w / 2, rowY - rowHeight / 2, w, rowHeight, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = actionColor;
    ctx.beginPath(); ctx.arc(-w / 2 + 11, rowY, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c4d4ce';
    ctx.font = `${Math.max(9.5, 8 / visualScale)}px ${GRAPH_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(file.path.split('/').at(-1), maxChars), -w / 2 + 21, rowY);
  });
  let footerTop = -h / 2 + fileRowsHeight;
  if (data.overflowCount) {
    ctx.fillStyle = '#60756d';
    ctx.font = `8px ${GRAPH_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${data.overflowCount} more`, -w / 2 + 21, footerTop + overflowHeight / 2);
    footerTop += overflowHeight;
  }
  if (data.diffStats) {
    ctx.strokeStyle = 'rgba(161,188,177,.14)';
    ctx.lineWidth = graphStrokeScale(visualScale) / visualScale;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 10, footerTop); ctx.lineTo(w / 2 - 10, footerTop); ctx.stroke();
    const fontSize = Math.max(9.5, 8 / visualScale);
    const additions = `+${data.diffStats.additions}`;
    const deletions = `−${data.diffStats.deletions}`;
    ctx.font = `700 ${fontSize}px ${GRAPH_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#71f7a8';
    ctx.fillText(additions, -w / 2 + 21, footerTop + diffHeight / 2);
    ctx.fillStyle = '#ff646d';
    ctx.fillText(deletions, -w / 2 + 27 + ctx.measureText(additions).width, footerTop + diffHeight / 2);
  }
  ctx.restore();
}

function drawInProgressMagic(ctx, w, h, color, visualScale) {
  const phase = state.livePhase;
  const pulse = .5 + Math.sin(phase * .055) * .5;
  const sweep = -w / 2 - 44 + (phase * 1.7 % (w + 88));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha *= .12 + pulse * .08;
  roundedRect(ctx, -w / 2, -h / 2, w, h, 4);
  ctx.clip();
  const gradient = ctx.createLinearGradient(sweep - 34, 0, sweep + 34, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(.5, color);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(sweep - 34, -h / 2, 68, h);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= .24 + pulse * .2;
  ctx.strokeStyle = color;
  ctx.lineWidth = (1.1 + pulse * .7) * graphStrokeScale(visualScale) / visualScale;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8 + pulse * 10;
  roundedRect(ctx, -w / 2 - 2 / visualScale, -h / 2 - 2 / visualScale, w + 4 / visualScale, h + 4 / visualScale, 5);
  ctx.stroke();
  for (let index = 0; index < 3; index += 1) {
    const angle = phase * .028 + index * Math.PI * 2 / 3;
    const moteX = Math.cos(angle) * (w / 2 + 5 / visualScale);
    const moteY = Math.sin(angle) * (h / 2 + 5 / visualScale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(moteX, moteY, (1.2 + pulse) / visualScale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function nodeColor(data) {
  if (data.status === 'error') return '#ff646d';
  if (data.type === 'prompt') return '#ffd166';
  if (data.type === 'decision') return '#b39cff';
  if (data.type === 'result') return data.status === 'running' ? '#ffd166' : '#71f7a8';
  if (data.type === 'write' || data.type === 'agent') return '#b39cff';
  if (data.type === 'test' || data.type === 'build') return '#71f7a8';
  return '#79d9ff';
}

function drawCompactNodeTitle(ctx, node, label, color) {
  const visualScale = Math.max(.01, node.visualScale || 1);
  const w = node.w / visualScale;
  const fontSize = compactNodeFontSize(node);
  ctx.fillStyle = color;
  ctx.font = `700 ${fontSize / visualScale}px ${GRAPH_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitCanvasText(ctx, label, w * .8), 1 / visualScale, 0);
}

function compactNodeFontSize(node) {
  return clamp(Math.min(node.w * .16, node.h * .46), 6, 10);
}

function promptCardHeight(data) {
  const estimatedLines = clamp(Math.ceil(String(data.title || '').length / 36), 1, 3);
  const attachmentHeight = data.attachments?.length ? 28 : 0;
  return clamp(66 + estimatedLines * 14 + attachmentHeight, PROMPT_CARD_MIN_HEIGHT, PROMPT_CARD_MAX_HEIGHT);
}

function graphStrokeScale(scale) {
  return clamp(scale, .65, 1.8);
}

function relatedNodeIds(model) {
  const focusId = state.hoveredNodeId || state.selectedNodeId;
  if (!focusId) return new Set(model.nodes.map((node) => node.id));
  const related = new Set([focusId]);
  for (const link of model.links) {
    if (link.from === focusId || link.to === focusId) {
      related.add(link.from);
      related.add(link.to);
    }
  }
  return related;
}

function showGraphHover(event) {
  const hit = graphHitAt(event.offsetX, event.offsetY);
  const nextId = hit?.id || null;
  if (nextId !== state.hoveredNodeId) {
    state.hoveredNodeId = nextId;
    drawGraph();
  }
  if (!hit) {
    elements.tooltip.hidden = true;
    return;
  }
  elements.tooltip.hidden = false;
  elements.tooltip.textContent = hit.kind === 'files'
    ? `FILES // ${hit.node.files.length} attached to ${hit.node.parentTitle}`
    : `${hit.node.type.toUpperCase()} // ${displayNodeTitle(hit.node)}${hit.node.permission ? ` // ${permissionLabel(hit.node.permission)}` : ''}`;
  elements.tooltip.style.left = `${Math.max(8, Math.min(event.offsetX + 14, elements.graphWrap.clientWidth - 236))}px`;
  elements.tooltip.style.top = `${Math.max(8, event.offsetY - 38)}px`;
}

function graphHitAt(x, y) {
  if (x < laneGutter()) return null;
  return [...state.graphHits].reverse().find((hit) => x >= hit.x - hit.w / 2 && x <= hit.x + hit.w / 2 && y >= hit.y - hit.h / 2 && y <= hit.y + hit.h / 2);
}

function selectGraphNode(direction) {
  if (!state.graphHits.length) return;
  const index = state.graphHits.findIndex((hit) => hit.id === state.selectedNodeId);
  const next = state.graphHits[(index + direction + state.graphHits.length) % state.graphHits.length];
  state.selectedNodeId = next.id;
  drawGraph();
}

function openInspector(node, kind) {
  enterReview();
  state.inspectorReturnFocus = document.activeElement;
  state.selectedNodeId = node.id || node.path;
  elements.inspectorTitle.textContent = kind === 'files' ? 'FILE ATTACHMENTS' : node.type === 'result' ? 'COMMAND RESULT' : node.type === 'prompt' ? 'USER PROMPT' : 'WORK STEP';
  elements.inspectorBody.replaceChildren();
  const status = document.createElement('span');
  status.className = `inspect-status ${node.status || ''}`;
  status.textContent = kind === 'files' ? 'FILES' : (node.status || kind).toUpperCase();
  const title = document.createElement('h3'); title.className = 'inspect-title'; title.textContent = kind === 'files' ? node.path : displayNodeTitle(node);
  const summary = document.createElement('p'); summary.className = 'inspect-summary';
  summary.textContent = kind === 'files' ? `${node.files.length} project files linked to ${node.parentTitle}` : node.summary;
  elements.inspectorBody.append(status, title, summary);
  const metadata = kind === 'files' ? {
    FILES: node.files.length,
    READS: node.files.filter((file) => file.action !== 'write').length,
    WRITES: node.files.filter((file) => file.action === 'write').length,
    PARENT: node.parentTitle,
  } : {
    LANE: laneFor(node).toUpperCase(), TYPE: node.type, TOOL: node.toolName || '—', STARTED: timeOnly(node.startedAt),
    DURATION: formatDuration(node.durationMs), OPERATIONS: node.sourceCount || 1, FILES: node.files?.length || 0,
  };
  const dl = document.createElement('dl'); dl.className = 'inspect-grid';
  for (const [key, value] of Object.entries(metadata)) {
    const wrap = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = String(value); wrap.append(dt, dd); dl.append(wrap);
  }
  elements.inspectorBody.append(dl);
  if (kind === 'files') addInspectSection('PROJECT FILES', node.files.map((file) => `${file.action.toUpperCase().padEnd(5)} ${file.path}`).join('\n'));
  else if (node.files?.length) addInspectSection('AFFECTED FILES', node.files.map((file) => `${file.action.toUpperCase().padEnd(5)} ${file.path}`).join('\n'));
  if (kind !== 'files' && node.diff) addDiffSection(node.diff);
  if (kind !== 'files') addReadableToolDetails(node);
  elements.inspector.classList.add('open'); elements.inspector.setAttribute('aria-hidden', 'false'); elements.scrim.hidden = false;
  requestAnimationFrame(() => elements.inspectorClose.focus());
  drawGraph();
}

function addInspectSection(label, value) {
  const section = document.createElement('section'); section.className = 'inspect-section';
  const heading = document.createElement('h3'); heading.textContent = label;
  const pre = document.createElement('pre'); pre.className = 'inspect-code'; pre.textContent = value;
  section.append(heading, pre); elements.inspectorBody.append(section);
}

function addDiffSection(diff) {
  const section = document.createElement('section'); section.className = 'inspect-section diff-section';
  const header = document.createElement('div'); header.className = 'inspect-section-header';
  const heading = document.createElement('h3'); heading.textContent = diff.truncated ? 'FILE DIFF · CAPTURE LIMIT REACHED' : 'COMPLETE FILE DIFF';
  const stats = document.createElement('div'); stats.className = 'diff-stats';
  stats.append(diffStat(`${diff.files?.length || 0} FILES`, 'files'), diffStat(`+${diff.additions || 0}`, 'add'), diffStat(`−${diff.deletions || 0}`, 'del'));
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-button'; copy.textContent = 'COPY';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(diff.text); copy.textContent = 'COPIED'; }
    catch { copy.textContent = 'COPY FAILED'; }
    setTimeout(() => { copy.textContent = 'COPY'; }, 1400);
  });
  header.append(heading, stats, copy);
  const view = document.createElement('pre'); view.className = 'diff-view';
  const lines = String(diff.text || '').split(/\r?\n/);
  if (lines.length > 4_000) {
    view.classList.add('diff-plain');
    view.textContent = diff.text;
  } else {
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
    const row = document.createElement('span');
    row.className = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add'
      : line.startsWith('-') && !line.startsWith('---') ? 'diff-del'
        : line.startsWith('@@') ? 'diff-hunk'
          : /^(?:diff --git|\*\*\* (?:Begin|End|Add|Update|Delete)|--- |\+\+\+ )/.test(line) ? 'diff-meta' : '';
      row.textContent = `${line}\n`; fragment.append(row);
    }
    view.append(fragment);
  }
  section.append(header, view); elements.inspectorBody.append(section);
}

function diffStat(text, type) {
  const span = document.createElement('span'); span.className = type; span.textContent = text; return span;
}

function addReadableToolDetails(node) {
  const operations = node.operations?.length > 1 ? node.operations : [{ title: node.title, details: node.details, permission: node.permission }];
  operations.forEach((operation, index) => {
    const details = operation.details || {};
    if (!Object.keys(details).length) return;
    const section = document.createElement('section'); section.className = 'inspect-section readable-event';
    const heading = document.createElement('h3');
    heading.textContent = operations.length > 1 ? `OPERATION ${String(index + 1).padStart(2, '0')} · ${operation.title || 'TOOL CALL'}` : 'TOOL CALL';
    section.append(heading);
    if ('input' in details) appendReadableValue(section, details.input, 'INPUT', 0, Boolean(operation.diff || node.diff));
    if ('response' in details) appendReadableValue(section, details.response, 'RESPONSE', 0, false);
    const extras = Object.fromEntries(Object.entries(details).filter(([key]) => !['input', 'response', 'permission', 'groupedOperations'].includes(key)));
    if (Object.keys(extras).length) appendReadableValue(section, extras, 'DETAILS', 0, false);
    elements.inspectorBody.append(section);
  });
}

function appendReadableValue(container, value, label, depth = 0, omitDiff = false) {
  const block = document.createElement('div'); block.className = `readable-block depth-${Math.min(depth, 3)}`;
  const title = document.createElement('div'); title.className = 'readable-label'; title.textContent = humanizeKey(label); block.append(title);
  if (value == null) {
    const empty = document.createElement('span'); empty.className = 'readable-empty'; empty.textContent = 'not reported'; block.append(empty);
  } else if (typeof value === 'string') {
    const embeddedFile = parseEmbeddedDataUrl(value, label);
    const isPatch = /(?:^|\n)(?:\*\*\* Begin Patch|diff --git a\/)/m.test(value);
    if (embeddedFile) {
      appendEmbeddedFile(block, embeddedFile);
    } else if (omitDiff && isPatch) {
      const linked = document.createElement('span'); linked.className = 'readable-empty'; linked.textContent = 'Rendered in the complete file diff above.'; block.append(linked);
    } else {
      const text = document.createElement(value.includes('\n') || value.length > 140 ? 'pre' : 'p');
      text.className = value.includes('\n') || value.length > 140 ? 'readable-code' : 'readable-text'; text.textContent = value; block.append(text);
    }
  } else if (typeof value !== 'object') {
    const text = document.createElement('p'); text.className = 'readable-text'; text.textContent = String(value); block.append(text);
  } else if (Array.isArray(value)) {
    const list = document.createElement('ol'); list.className = 'readable-list';
    value.forEach((item, index) => {
      const li = document.createElement('li');
      if (item && typeof item === 'object') appendReadableValue(li, item, `ITEM ${index + 1}`, depth + 1, omitDiff);
      else li.textContent = String(item); list.append(li);
    });
    block.append(list);
  } else {
    const fields = document.createElement('div'); fields.className = 'readable-fields';
    for (const [key, child] of Object.entries(value)) appendReadableValue(fields, child, key, depth + 1, omitDiff);
    block.append(fields);
  }
  container.append(block);
}

function parseEmbeddedDataUrl(value, label = 'attachment') {
  const text = String(value || '');
  if (!text.startsWith('data:')) return null;
  const comma = text.indexOf(',');
  if (comma < 6) return null;
  const metadata = text.slice(5, comma);
  if (!/(?:^|;)base64(?:;|$)/i.test(metadata)) return null;
  const payload = text.slice(comma + 1).replace(/\s/g, '');
  if (!payload) return null;
  const validPayload = /^[a-z0-9+/]*={0,2}$/i.test(payload);
  const capturedPayload = validPayload ? payload : payload.split(/…|\[truncated/i)[0].replace(/[^a-z0-9+/=]/gi, '');
  const declaredMime = metadata.split(';')[0].toLowerCase() || 'application/octet-stream';
  const detectedImageMime = detectRasterMime(capturedPayload);
  const safeImageMime = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp))$/.test(declaredMime) ? declaredMime : detectedImageMime;
  const dataUrl = validPayload ? safeImageMime && safeImageMime !== declaredMime ? `data:${safeImageMime};base64,${payload}` : text : null;
  const padding = (capturedPayload.match(/=*$/)?.[0].length || 0);
  const size = Math.max(0, Math.floor(capturedPayload.length * 3 / 4) - padding);
  return {
    dataUrl,
    mime: safeImageMime || declaredMime,
    image: Boolean(safeImageMime),
    size,
    name: embeddedFileName(label, safeImageMime || declaredMime),
    truncated: !validPayload,
  };
}

function isGraphNodeVisible(node, margin = 0) {
  const rect = elements.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  return isScreenNodeVisible(projectNode(node), rect.width, rect.height, margin);
}

function isScreenNodeVisible(node, width, height, margin = 0) {
  return node.x + node.w / 2 >= laneGutter() - margin
    && node.x - node.w / 2 <= width + margin
    && node.y + node.h / 2 >= -margin
    && node.y - node.h / 2 <= height + margin;
}

function drawActiveWorkRange(ctx, range, byId, width, height) {
  if (!range || range.expiresAt && Date.now() >= range.expiresAt) {
    state.activeRangeEdge = null;
    return;
  }
  const rangeNodes = range.nodeIds.map((id) => byId.get(id)).filter(Boolean);
  const prompt = byId.get(range.promptId);
  if (!prompt || !rangeNodes.length) return;
  const scale = Math.max(.28, state.graphView.scale);
  let left;
  let targetRight;
  let top;
  let bottom;
  if (state.layoutMode === 'flow') {
    left = prompt.x + prompt.w / 2 + 18 * scale;
    targetRight = Math.max(left + 72 * scale, ...rangeNodes.map((node) => node.x + node.w / 2 + 30 * scale));
    top = state.graphView.offsetY + (LANES[0].y - 66) * state.graphView.scaleY;
    bottom = state.graphView.offsetY + (LANES.at(-1).y + 66) * state.graphView.scaleY;
  } else {
    left = Math.min(...rangeNodes.map((node) => node.x - node.w / 2)) - 34 * scale;
    targetRight = Math.max(...rangeNodes.map((node) => node.x + node.w / 2)) + 34 * scale;
    top = Math.min(...rangeNodes.map((node) => node.y - node.h / 2)) - 46 * scale;
    bottom = Math.max(...rangeNodes.map((node) => node.y + node.h / 2)) + 46 * scale;
  }
  const edgeKey = `${state.layoutMode}:${range.turnId}`;
  if (!state.activeRangeEdge || state.activeRangeEdge.key !== edgeKey) {
    state.activeRangeEdge = { key: edgeKey, x: targetRight };
  } else {
    state.activeRangeEdge.x = REDUCED_MOTION ? targetRight : mix(state.activeRangeEdge.x, targetRight, .16);
  }
  const right = state.activeRangeEdge.x;
  if (right < laneGutter() - 80 || left > width + 80 || bottom < -80 || top > height + 80) return;
  const pulse = .5 + Math.sin(state.livePhase * .052) * .5;
  const gradient = ctx.createLinearGradient(left, 0, right, 0);
  gradient.addColorStop(0, 'rgba(255,209,102,.05)');
  gradient.addColorStop(.5, 'rgba(255,209,102,.012)');
  gradient.addColorStop(1, 'rgba(255,209,102,.05)');
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(left, top, Math.max(0, right - left), bottom - top);
  ctx.restore();
  drawPromptRangePointer(ctx, prompt, left, scale, pulse);
  drawGoldenBrace(ctx, left, top, bottom, -1, scale, pulse);
  drawGoldenBrace(ctx, right, top, bottom, 1, scale, pulse);
  ctx.save();
  ctx.globalAlpha = .58 + pulse * .28;
  ctx.fillStyle = '#ffd166';
  ctx.font = `700 ${clamp(7.5 * scale, 7.5, 10)}px ${GRAPH_FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('ACTIVE TURN  ✦', right - 15 * scale, Math.max(14, top - 7 * scale));
  ctx.restore();
}

function drawPromptRangePointer(ctx, prompt, braceX, scale, pulse) {
  const startX = prompt.x + prompt.w / 2;
  const endX = braceX;
  const y = prompt.y;
  if (Math.abs(endX - startX) < 2) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,209,102,${.58 + pulse * .3})`;
  ctx.lineWidth = (1.2 + pulse * .45) * graphStrokeScale(scale);
  ctx.shadowColor = '#ffd166';
  ctx.shadowBlur = 8 + pulse * 9;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(endX, y);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(startX, y, 2.1 * graphStrokeScale(scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(endX, y);
  ctx.rotate(Math.PI / 4);
  const marker = 3.1 * graphStrokeScale(scale);
  ctx.fillRect(-marker / 2, -marker / 2, marker, marker);
  ctx.restore();
}

function drawGoldenBrace(ctx, x, top, bottom, facing, scale, pulse) {
  const span = Math.max(80, bottom - top);
  const middle = top + span / 2;
  const quarter = span / 4;
  const depth = 18 * scale;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x + facing * depth, top);
    ctx.bezierCurveTo(x + facing * depth * .18, top, x, top + quarter * .28, x, top + quarter);
    ctx.bezierCurveTo(x, middle - quarter * .34, x + facing * depth * .2, middle - depth * .4, x + facing * depth, middle);
    ctx.bezierCurveTo(x + facing * depth * .2, middle + depth * .4, x, middle + quarter * .34, x, bottom - quarter);
    ctx.bezierCurveTo(x, bottom - quarter * .28, x + facing * depth * .18, bottom, x + facing * depth, bottom);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,209,102,.28)';
  ctx.lineWidth = (2.2 + pulse * 1.2) * graphStrokeScale(scale);
  ctx.shadowColor = '#ffd166';
  ctx.shadowBlur = 14 + pulse * 16;
  trace();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(255,225,145,${.72 + pulse * .25})`;
  ctx.lineWidth = 1.25 * graphStrokeScale(scale);
  trace();
  ctx.stroke();
  ctx.restore();
}

function animateCardEntrance(node, progress) {
  if (progress >= 1 || REDUCED_MOTION) return node;
  const eased = 1 - Math.pow(1 - progress, 3);
  const bloom = Math.sin(progress * Math.PI) * .045;
  const scale = .74 + eased * .26 + bloom;
  return {
    ...node,
    y: node.y + (1 - eased) * 18,
    w: node.w * scale,
    h: node.h * scale,
    visualScale: node.visualScale * scale,
  };
}

function drawMaterializationHalo(ctx, node, progress) {
  const energy = Math.sin(progress * Math.PI) * (1 - progress * .35);
  if (energy <= .01) return;
  const color = node.kind === 'files' ? '#79d9ff' : nodeColor(node.data);
  const expansion = 5 + (1 - progress) * 18;
  ctx.save();
  ctx.globalAlpha = energy * .42;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * graphStrokeScale(node.visualScale);
  ctx.shadowColor = color;
  ctx.shadowBlur = 18 * energy;
  roundedRect(ctx, node.x - node.w / 2 - expansion, node.y - node.h / 2 - expansion, node.w + expansion * 2, node.h + expansion * 2, 7);
  ctx.stroke();
  ctx.restore();
}

function drawExitingCards(ctx, now) {
  if (REDUCED_MOTION || !state.exitingNodes.length) return;
  state.exitingNodes = state.exitingNodes.filter((item) => now - item.removedAt < CARD_EXIT_MS);
  for (const item of state.exitingNodes) {
    const progress = clamp((now - item.removedAt) / CARD_EXIT_MS, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const projected = projectNode(item.node);
    const scale = 1 - eased * .34;
    const ghost = {
      ...projected,
      y: projected.y - eased * 16,
      w: projected.w * scale,
      h: projected.h * scale,
      visualScale: projected.visualScale * scale,
    };
    const rect = elements.canvas.getBoundingClientRect();
    if (!isScreenNodeVisible(ghost, rect.width, rect.height, 80)) continue;
    const opacity = Math.pow(1 - progress, 2);
    drawDissolveMotes(ctx, ghost, progress);
    if (ghost.kind === 'files') drawFileNode(ctx, ghost, opacity);
    else drawWorkNode(ctx, ghost, opacity);
  }
}

function drawDissolveMotes(ctx, node, progress) {
  const color = node.kind === 'files' ? '#79d9ff' : nodeColor(node.data);
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let index = 0; index < 9; index += 1) {
    const seed = constellationRandom(`${node.id}:${index}`, 83);
    const x = node.x - node.w / 2 + seed * node.w;
    const y = node.y + node.h / 2 - progress * (22 + seed * 34);
    ctx.globalAlpha = Math.sin(progress * Math.PI) * (.25 + seed * .55);
    ctx.beginPath();
    ctx.arc(x, y, 1 + seed * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function smoothstep(value) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function detectRasterMime(payload) {
  try {
    const bytes = Uint8Array.from(atob(payload.slice(0, 96)), (character) => character.charCodeAt(0));
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(0, 2) === 'BM') return 'image/bmp';
    if (ascii(4, 12) === 'ftypavif' || ascii(4, 12) === 'ftypavis') return 'image/avif';
  } catch {
    return null;
  }
  return null;
}

function appendEmbeddedFile(container, file) {
  const card = document.createElement(file.image ? 'figure' : 'div');
  card.className = `embedded-file${file.image ? ' image' : ''}`;
  if (file.image && file.dataUrl) {
    const preview = document.createElement('img');
    preview.src = file.dataUrl;
    preview.alt = `${file.name} preview`;
    preview.loading = 'lazy';
    preview.decoding = 'async';
    preview.addEventListener('error', () => { card.classList.add('preview-failed'); });
    card.append(preview);
  } else if (file.image) {
    card.classList.add('preview-failed');
  } else {
    const icon = document.createElement('span'); icon.className = 'embedded-file-icon'; icon.textContent = 'FILE'; card.append(icon);
  }
  const footer = document.createElement(file.image ? 'figcaption' : 'div'); footer.className = 'embedded-file-footer';
  const details = document.createElement('span');
  details.textContent = file.truncated ? `${file.mime} · CAPTURE TRUNCATED` : `${file.mime} · ${formatBytes(file.size)}`;
  footer.append(details);
  if (file.dataUrl) {
    const action = document.createElement('a');
    action.className = 'embedded-file-action'; action.href = file.dataUrl; action.download = file.name;
    action.textContent = file.image ? 'OPEN' : 'DOWNLOAD'; footer.append(action);
  }
  card.append(footer); container.append(card);
}

function embeddedFileName(label, mime) {
  const extension = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/avif': 'avif', 'image/bmp': 'bmp', 'application/pdf': 'pdf',
  }[mime] || 'bin';
  const stem = String(label || 'attachment').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'attachment';
  return `${stem}.${extension}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function humanizeKey(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').toUpperCase();
}

function permissionLabel(permission) {
  if (!permission) return state.session?.permissionMode || 'NOT REPORTED';
  if (permission.allowed === true) return `ALLOWED · ${permission.mode || permission.decision || 'REQUESTED'}`;
  if (permission.allowed === false) return `DENIED · ${permission.mode || permission.decision || 'REQUESTED'}`;
  return String(permission.mode || permission.decision || 'REQUESTED').toUpperCase();
}

function closeInspector() {
  const wasOpen = elements.inspector.classList.contains('open');
  state.selectedNodeId = null;
  elements.inspector.classList.remove('open'); elements.inspector.setAttribute('aria-hidden', 'true'); elements.scrim.hidden = true;
  drawGraph();
  if (wasOpen && state.inspectorReturnFocus instanceof HTMLElement) state.inspectorReturnFocus.focus();
  state.inspectorReturnFocus = null;
}

async function deleteCurrentSession() {
  if (!state.session || !confirm(`Delete saved session ${shortId(state.session.id)}? This cannot be undone.`)) return;
  await fetch(`/api/sessions/${encodeURIComponent(state.session.id)}`, { method: 'DELETE' });
  state.session = null; state.selectedId = null; closeInspector(); await loadSessions();
}

function exportCurrentSession() {
  if (!state.session) return;
  const link = document.createElement('a');
  link.href = `/api/sessions/${encodeURIComponent(state.session.id)}/export`;
  link.download = `activisual-${shortId(state.session.id).replace('…', '-')}.json`;
  document.body.append(link); link.click(); link.remove();
}

function connectStream() {
  const stream = new EventSource('/api/stream');
  let timer;
  stream.addEventListener('ready', () => setConnection(true));
  stream.addEventListener('events', () => { clearTimeout(timer); timer = setTimeout(() => loadSessions(state.selectedId), 90); });
  stream.addEventListener('session-deleted', () => loadSessions());
  stream.onerror = () => setConnection(false);
}

function setConnection(online) {
  elements.connectionDot.className = `connection-dot ${online ? 'online' : 'offline'}`;
  elements.connectionLabel.textContent = online ? 'LIVE LINK' : 'RECONNECTING';
}

function filesFor(chunks) {
  const map = new Map();
  for (const chunk of chunks) for (const file of chunk.files || []) {
    if (!isCredibleProjectPath(file.path)) continue;
    const item = map.get(file.path) || { path: file.path, reads: 0, writes: 0, chunkIds: [] };
    file.action === 'write' ? item.writes++ : item.reads++;
    item.chunkIds.push(chunk.id);
    map.set(file.path, item);
  }
  return [...map.values()].sort((a, b) => (b.writes + b.reads) - (a.writes + a.reads));
}

function dedupeGraphFiles(files) {
  const map = new Map();
  for (const file of files) {
    if (!file?.path) continue;
    const existing = map.get(file.path);
    map.set(file.path, existing?.action === 'write' ? existing : file);
  }
  return [...map.values()];
}

function isCredibleProjectPath(value) {
  const path = String(value || '').replaceAll('\\', '/');
  return path.includes('/') || path.startsWith('.') || /\.[a-z0-9]{1,10}$/i.test(path);
}

function laneGutter() { return state.layoutMode === 'orbit' ? 20 : elements.graphWrap.clientWidth < 600 ? 108 : 132; }
function roundedRect(ctx, x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function mix(from, to, amount) { return from + (to - from) * amount; }
function formatLaneDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
function itemDurationLabel(data) {
  if (!data || data.type === 'prompt' || data.type === 'session' || data.type === 'milestone') return '';
  const running = isInProgressNode(data);
  let duration = Number.isFinite(data.durationMs) ? Math.max(0, data.durationMs) : null;
  if (running && data.startedAt) duration = Math.max(0, Date.now() - Date.parse(data.startedAt));
  if (duration == null || duration <= 0) return '';
  const suffix = running ? '+' : '';
  if (duration < 1000) return `<1s${suffix}`;
  if (duration < 60_000) return `${Math.max(1, Math.floor(duration / 1000))}s${suffix}`;
  if (duration < 3_600_000) return `${Math.max(1, Math.floor(duration / 60_000))}m${suffix}`;
  return `${Math.max(1, Math.floor(duration / 3_600_000))}h${suffix}`;
}
function cardTimingText(data) {
  const duration = itemDurationLabel(data);
  return `${timeOnly(data.startedAt)}${duration ? ` · ${duration}` : ''}`;
}
function formatDuration(ms) { if (ms == null) return '—'; if (ms < 1000) return `${ms}ms`; if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`; return `${Math.floor(ms / 60_000)}m ${Math.floor(ms % 60_000 / 1000)}s`; }
function elapsed(start, end) { if (!start || !end) return '00:00'; const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function timeOnly(value) { return value ? new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function relativeTime(value) { const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000)); if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86_400)}d`; }
function shortId(value) { if (!value) return '—'; const text = String(value); return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text; }
function displayNodeTitle(node) { return node?.sourceCount > 1 ? `${node.title} × ${node.sourceCount}` : String(node?.title || ''); }
function fitNodeTitle(node, max) {
  if (!(node?.sourceCount > 1)) return ellipsize(node?.title, max);
  const suffix = ` × ${node.sourceCount}`;
  return `${ellipsize(node.title, Math.max(2, max - suffix.length))}${suffix}`;
}
function ellipsize(value, max) { const text = String(value || ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
