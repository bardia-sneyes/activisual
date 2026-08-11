const $ = (selector) => document.querySelector(selector);
const elements = {
  sessionSelect: $('#session-select'),
  connectionDot: $('#connection-dot'), connectionLabel: $('#connection-label'), clock: $('#clock'),
  statusIcon: $('#status-icon'), statusLabel: $('#status-label'), missionTitle: $('#mission-title'), missionSummary: $('#mission-summary'),
  metricEvents: $('#metric-events'), metricFiles: $('#metric-files'), metricFailures: $('#metric-failures'), metricElapsed: $('#metric-elapsed'),
  replayToggle: $('#replay-toggle'), deleteSession: $('#delete-session'), replayControls: $('#replay-controls'), replayPlay: $('#replay-play'),
  replayRange: $('#replay-range'), replayPosition: $('#replay-position'), replaySpeed: $('#replay-speed'),
  timeline: $('#timeline'), timelineCount: $('#timeline-count'), canvas: $('#work-graph'), graphWrap: $('#graph-wrap'),
  graphEmpty: $('#graph-empty'), graphMeta: $('#graph-meta'), tooltip: $('#graph-tooltip'),
  inspector: $('#inspector'), inspectorTitle: $('#inspector-title'), inspectorBody: $('#inspector-body'), inspectorClose: $('#inspector-close'), scrim: $('#scrim'),
};

const state = {
  sessions: [], session: null, selectedId: null, graphHits: [], selectedNodeId: null,
  replay: { active: false, playing: false, position: 0, timer: null },
};

setInterval(() => { elements.clock.textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);
elements.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });

elements.sessionSelect.addEventListener('change', () => selectSession(elements.sessionSelect.value));
elements.replayToggle.addEventListener('click', toggleReplay);
elements.replayPlay.addEventListener('click', toggleReplayPlay);
elements.replayRange.addEventListener('input', () => {
  state.replay.position = Number(elements.replayRange.value);
  stopReplayTimer();
  render();
});
elements.deleteSession.addEventListener('click', deleteCurrentSession);
elements.inspectorClose.addEventListener('click', closeInspector);
elements.scrim.addEventListener('click', closeInspector);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeInspector(); });

const resizeObserver = new ResizeObserver(() => drawGraph(visibleChunks()));
resizeObserver.observe(elements.graphWrap);

elements.canvas.addEventListener('mousemove', (event) => {
  const hit = graphHitAt(event);
  elements.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
  if (!hit) {
    elements.tooltip.hidden = true;
    return;
  }
  elements.tooltip.hidden = false;
  elements.tooltip.textContent = `${hit.kind === 'file' ? 'FILE' : hit.node.type.toUpperCase()} // ${hit.node.title || hit.node.path}`;
  elements.tooltip.style.left = `${Math.min(event.offsetX + 12, elements.graphWrap.clientWidth - 230)}px`;
  elements.tooltip.style.top = `${Math.max(8, event.offsetY - 34)}px`;
});
elements.canvas.addEventListener('mouseleave', () => { elements.tooltip.hidden = true; });
elements.canvas.addEventListener('click', (event) => {
  const hit = graphHitAt(event);
  if (hit) openInspector(hit.node, hit.kind);
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

async function selectSession(id, resetReplay = true) {
  if (!id) return;
  const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!response.ok) return loadSessions();
  const data = await response.json();
  state.session = data.session;
  state.selectedId = id;
  elements.sessionSelect.value = id;
  if (resetReplay) endReplay();
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
  const chunks = visibleChunks();
  elements.replayToggle.disabled = !session?.chunks?.length;
  elements.deleteSession.disabled = !session;
  elements.timelineCount.textContent = `${chunks.length} CHUNK${chunks.length === 1 ? '' : 'S'}`;
  elements.replayControls.hidden = !state.replay.active;
  renderMission(session, chunks);
  renderTimeline(chunks);
  drawGraph(chunks);
  if (state.replay.active && session) {
    elements.replayRange.max = String(session.chunks.length);
    elements.replayRange.value = String(state.replay.position);
    elements.replayPosition.textContent = `${state.replay.position} / ${session.chunks.length}`;
  }
}

function renderMission(session, chunks) {
  if (!session) {
    elements.statusLabel.textContent = 'AWAITING SIGNAL';
    elements.missionTitle.textContent = 'No Codex session captured yet';
    elements.missionSummary.textContent = 'Start Codex in this project after installing the Activisual hooks.';
    elements.metricEvents.textContent = '000'; elements.metricFiles.textContent = '00'; elements.metricFailures.textContent = '00'; elements.metricElapsed.textContent = '00:00';
    return;
  }
  const running = chunks.findLast((chunk) => chunk.status === 'running' || chunk.status === 'waiting');
  const latest = running || chunks.at(-1);
  const status = state.replay.active ? 'REPLAYING LOCAL TRACE' : session.status === 'active' ? 'CODEX SESSION ACTIVE' : session.status === 'complete' ? 'SESSION COMPLETE' : 'CODEX STANDING BY';
  elements.statusLabel.textContent = status;
  elements.missionTitle.textContent = latest?.title || `${session.project} session`;
  elements.missionSummary.textContent = latest?.summary || `${shortId(session.id)} · ${session.model || 'Codex'}`;
  elements.metricEvents.textContent = String(chunks.length).padStart(3, '0');
  elements.metricFiles.textContent = String(filesFor(chunks).length).padStart(2, '0');
  elements.metricFailures.textContent = String(chunks.filter((chunk) => chunk.status === 'error').length).padStart(2, '0');
  elements.metricElapsed.textContent = elapsed(session.startedAt, chunks.at(-1)?.endedAt || chunks.at(-1)?.startedAt);
}

function renderTimeline(chunks) {
  elements.timeline.replaceChildren();
  if (!chunks.length) {
    elements.timeline.append($('#empty-template').content.cloneNode(true));
    return;
  }
  const fragment = document.createDocumentFragment();
  chunks.forEach((chunk, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `trace-item type-${chunk.type} status-${chunk.status}${state.selectedNodeId === chunk.id ? ' selected' : ''}`;
    button.style.animationDelay = `${Math.min(index * 18, 220)}ms`;
    button.addEventListener('click', () => openInspector(chunk, 'chunk'));

    const time = document.createElement('time');
    time.className = 'trace-time';
    time.textContent = timeOnly(chunk.startedAt);
    const copy = document.createElement('div'); copy.className = 'trace-copy';
    const title = document.createElement('strong'); title.textContent = chunk.title;
    const summary = document.createElement('p'); summary.textContent = chunk.summary || 'No additional summary';
    copy.append(title, summary);
    if (chunk.files?.length) {
      const files = document.createElement('div'); files.className = 'trace-files';
      for (const file of chunk.files.slice(0, 3)) {
        const chip = document.createElement('span'); chip.className = 'file-chip'; chip.textContent = file.path; files.append(chip);
      }
      if (chunk.files.length > 3) { const more = document.createElement('span'); more.className = 'file-chip'; more.textContent = `+${chunk.files.length - 3}`; files.append(more); }
      copy.append(files);
    }
    const meta = document.createElement('div'); meta.className = 'trace-meta';
    const outcome = document.createElement('span'); outcome.className = chunk.status === 'error' ? 'bad' : chunk.status === 'complete' ? 'ok' : '';
    outcome.textContent = statusGlyph(chunk.status);
    meta.append(outcome, document.createElement('br'), document.createTextNode(formatDuration(chunk.durationMs)));
    button.append(time, copy, meta);
    fragment.append(button);
  });
  elements.timeline.append(fragment);
  if (!state.replay.active) elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function drawGraph(chunks) {
  const canvas = elements.canvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, rect.width);
  const height = Math.max(430, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
  state.graphHits = [];
  const files = filesFor(chunks);
  elements.graphEmpty.hidden = chunks.length > 0;
  if (!chunks.length) { elements.graphMeta.textContent = '0 NODES · 0 LINKS'; return; }

  drawGrid(ctx, width, height);
  const workNodes = layoutWorkNodes(chunks, width, height);
  const fileNodes = layoutFileNodes(files, width, height);
  const workById = new Map(workNodes.map((node) => [node.data.id, node]));
  const fileByPath = new Map(fileNodes.map((node) => [node.data.path, node]));
  let links = 0;

  ctx.lineWidth = 1;
  for (let i = 1; i < workNodes.length; i++) {
    const from = workNodes[i - 1], to = workNodes[i];
    drawLink(ctx, from, to, 'rgba(113,247,168,.18)'); links++;
  }
  for (const chunk of chunks) {
    const from = workById.get(chunk.id);
    for (const file of chunk.files || []) {
      const to = fileByPath.get(file.path);
      if (from && to) { drawLink(ctx, from, to, 'rgba(121,217,255,.14)', true); links++; }
    }
  }
  for (const node of workNodes) drawWorkNode(ctx, node);
  for (const node of fileNodes) drawFileNode(ctx, node);
  state.graphHits = [
    ...workNodes.map((node) => ({ ...node, node: node.data, kind: 'chunk' })),
    ...fileNodes.map((node) => ({ ...node, node: node.data, kind: 'file' })),
  ];
  elements.graphMeta.textContent = `${workNodes.length + fileNodes.length} NODES · ${links} LINKS`;
}

function layoutWorkNodes(chunks, width, height) {
  const usableWidth = Math.max(180, width - 190);
  const usableHeight = height - 100;
  return chunks.slice(-36).map((chunk, index, visible) => {
    const progress = visible.length === 1 ? .5 : index / (visible.length - 1);
    const baseX = 55 + progress * usableWidth;
    const lane = laneFor(chunk, index);
    const y = 70 + lane * (usableHeight / 4) + Math.sin(index * 1.7) * 10;
    return { x: baseX, y, w: chunk.type === 'decision' ? 88 : 76, h: 34, data: chunk };
  });
}

function layoutFileNodes(files, width, height) {
  const x = width - 64;
  const spread = Math.min(height - 80, Math.max(100, files.length * 52));
  const start = (height - spread) / 2;
  return files.slice(0, 12).map((file, index, visible) => ({
    x: x + (index % 2 ? 13 : -4),
    y: visible.length === 1 ? height / 2 : start + index * (spread / Math.max(1, visible.length - 1)),
    w: 74, h: 26, data: { ...file, title: file.path },
  }));
}

function laneFor(chunk, index) {
  if (chunk.type === 'decision') return 0;
  if (chunk.type === 'agent') return 3;
  if (chunk.type === 'test' || chunk.type === 'build') return 2;
  return 1 + (index % 3 === 0 ? .28 : 0);
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = 'rgba(140,170,158,.045)'; ctx.lineWidth = 1;
  for (let x = 20; x < width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 20; y < height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
}

function drawLink(ctx, from, to, color, dashed = false) {
  ctx.save(); ctx.strokeStyle = color; if (dashed) ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.moveTo(from.x, from.y); const mid = (from.x + to.x) / 2; ctx.bezierCurveTo(mid, from.y, mid, to.y, to.x, to.y); ctx.stroke(); ctx.restore();
}

function drawWorkNode(ctx, node) {
  const { x, y, w, h, data } = node;
  const color = data.status === 'error' ? '#ff646d' : data.type === 'decision' ? '#ffd166' : data.status === 'running' || data.status === 'waiting' ? '#ffd166' : '#71f7a8';
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(8,17,14,.94)'; ctx.strokeStyle = color; ctx.lineWidth = state.selectedNodeId === data.id ? 1.8 : 1;
  roundedRect(ctx, -w / 2, -h / 2, w, h, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.fillRect(-w / 2, -h / 2, 3, h);
  ctx.font = '7px monospace'; ctx.fillText(data.type.toUpperCase().slice(0, 10), -w / 2 + 9, -3);
  ctx.fillStyle = '#a6b9b1'; ctx.font = '8px monospace'; ctx.fillText(ellipsize(data.title, 11), -w / 2 + 9, 9);
  ctx.restore();
}

function drawFileNode(ctx, node) {
  const { x, y, w, h, data } = node;
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = 'rgba(7,16,18,.94)'; ctx.strokeStyle = 'rgba(121,217,255,.58)';
  roundedRect(ctx, -w / 2, -h / 2, w, h, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#79d9ff'; ctx.beginPath(); ctx.arc(-w / 2 + 8, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9ab2ae'; ctx.font = '7px monospace'; ctx.fillText(ellipsize(data.path.split('/').at(-1), 11), -w / 2 + 15, 3); ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
}

function graphHitAt(event) {
  return [...state.graphHits].reverse().find((hit) => event.offsetX >= hit.x - hit.w / 2 && event.offsetX <= hit.x + hit.w / 2 && event.offsetY >= hit.y - hit.h / 2 && event.offsetY <= hit.y + hit.h / 2);
}

function openInspector(node, kind) {
  state.selectedNodeId = node.id || node.path;
  elements.inspectorTitle.textContent = kind === 'file' ? 'FILE NODE' : 'WORK NODE';
  elements.inspectorBody.replaceChildren();
  const status = document.createElement('span'); status.className = `inspect-status ${node.status || ''}`; status.textContent = (node.status || kind).toUpperCase();
  const title = document.createElement('h3'); title.className = 'inspect-title'; title.textContent = node.title || node.path;
  const summary = document.createElement('p'); summary.className = 'inspect-summary'; summary.textContent = kind === 'file' ? `${node.reads || 0} reads · ${node.writes || 0} writes · ${(node.chunkIds || []).length} linked chunks` : node.summary;
  elements.inspectorBody.append(status, title, summary);
  const metadata = kind === 'file' ? { PATH: node.path, READS: node.reads || 0, WRITES: node.writes || 0, LINKS: node.chunkIds?.length || 0 } : {
    TYPE: node.type, TOOL: node.toolName || '—', STARTED: timeOnly(node.startedAt), DURATION: formatDuration(node.durationMs), TURN: shortId(node.turnId || '—'), FILES: node.files?.length || 0,
  };
  const dl = document.createElement('dl'); dl.className = 'inspect-grid';
  for (const [key, value] of Object.entries(metadata)) { const wrap = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = key; const dd = document.createElement('dd'); dd.textContent = String(value); wrap.append(dt, dd); dl.append(wrap); }
  elements.inspectorBody.append(dl);
  if (kind !== 'file' && node.files?.length) addInspectSection('AFFECTED FILES', node.files.map((file) => `${file.action.toUpperCase().padEnd(5)} ${file.path}`).join('\n'));
  if (kind !== 'file' && node.details && Object.keys(node.details).length) addInspectSection('REDACTED EVENT DATA', JSON.stringify(node.details, null, 2));
  elements.inspector.classList.add('open'); elements.inspector.setAttribute('aria-hidden', 'false'); elements.scrim.hidden = false;
  render();
}

function addInspectSection(label, value) {
  const section = document.createElement('section'); section.className = 'inspect-section';
  const heading = document.createElement('h3'); heading.textContent = label;
  const pre = document.createElement('pre'); pre.className = 'inspect-code'; pre.textContent = value;
  section.append(heading, pre); elements.inspectorBody.append(section);
}

function closeInspector() {
  state.selectedNodeId = null; elements.inspector.classList.remove('open'); elements.inspector.setAttribute('aria-hidden', 'true'); elements.scrim.hidden = true; render();
}

function toggleReplay() {
  if (state.replay.active) endReplay();
  else { state.replay.active = true; state.replay.position = 1; state.replay.playing = false; }
  elements.replayToggle.innerHTML = state.replay.active ? '<span>■</span> LIVE' : '<span>▶</span> REPLAY';
  render();
}

function toggleReplayPlay() {
  if (!state.session) return;
  state.replay.playing = !state.replay.playing;
  elements.replayPlay.textContent = state.replay.playing ? 'Ⅱ' : '▶';
  if (state.replay.playing) {
    if (state.replay.position >= state.session.chunks.length) state.replay.position = 0;
    const tick = () => {
      state.replay.position++;
      if (state.replay.position >= state.session.chunks.length) { state.replay.position = state.session.chunks.length; state.replay.playing = false; elements.replayPlay.textContent = '▶'; stopReplayTimer(); }
      render();
    };
    state.replay.timer = setInterval(tick, Number(elements.replaySpeed.value)); tick();
  } else stopReplayTimer();
}

function stopReplayTimer() { clearInterval(state.replay.timer); state.replay.timer = null; state.replay.playing = false; elements.replayPlay.textContent = '▶'; }
function endReplay() { stopReplayTimer(); state.replay.active = false; state.replay.position = 0; elements.replayToggle.innerHTML = '<span>▶</span> REPLAY'; }
function visibleChunks() { const chunks = state.session?.chunks || []; return state.replay.active ? chunks.slice(0, state.replay.position) : chunks; }

async function deleteCurrentSession() {
  if (!state.session || !confirm(`Delete saved session ${shortId(state.session.id)}? This cannot be undone.`)) return;
  await fetch(`/api/sessions/${encodeURIComponent(state.session.id)}`, { method: 'DELETE' });
  state.session = null; state.selectedId = null; endReplay(); closeInspector(); await loadSessions();
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
    const item = map.get(file.path) || { path: file.path, reads: 0, writes: 0, chunkIds: [] };
    file.action === 'write' ? item.writes++ : item.reads++; item.chunkIds.push(chunk.id); map.set(file.path, item);
  }
  return [...map.values()].sort((a, b) => (b.writes + b.reads) - (a.writes + a.reads));
}

function statusGlyph(status) { return status === 'complete' ? '✓ DONE' : status === 'error' ? '× FAIL' : status === 'waiting' ? '? WAIT' : '● LIVE'; }
function formatDuration(ms) { if (ms == null) return '—'; if (ms < 1000) return `${ms}ms`; if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`; return `${Math.floor(ms / 60_000)}m ${Math.floor(ms % 60_000 / 1000)}s`; }
function elapsed(start, end) { if (!start || !end) return '00:00'; const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function timeOnly(value) { return value ? new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
function relativeTime(value) { const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000)); if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86_400)}d`; }
function shortId(value) { if (!value) return '—'; const text = String(value); return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text; }
function ellipsize(value, max) { const text = String(value || ''); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
