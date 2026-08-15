import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { buildSession } from './model.js';
import { pathsFor, DEFAULT_RETENTION_DAYS, DEFAULT_SESSION_LIMIT } from './config.js';

export class EventStore extends EventEmitter {
  constructor(projectRoot, options = {}) {
    super();
    this.projectRoot = projectRoot;
    this.paths = pathsFor(projectRoot);
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.sessionLimit = options.sessionLimit ?? DEFAULT_SESSION_LIMIT;
    this.historyEvents = [];
    this.liveEvents = [];
    this.events = [];
    this.offset = 0;
    this.remainder = '';
    this.watcher = null;
    this.poller = null;
    this.readPromise = null;
    this.mutationPromise = Promise.resolve();
    this.rotating = false;
  }

  async init() {
    await fsp.mkdir(this.paths.dataDir, { recursive: true, mode: 0o700 });
    const history = await fsp.open(this.paths.historyPath, 'a', 0o600);
    await history.close();
    const handle = await fsp.open(this.paths.inboxPath, 'a', 0o600);
    await handle.close();
    this.historyEvents = await readEventFile(this.paths.historyPath);
    this.refreshEvents();
    await this.readNew();
    await this.prune();
    this.watch();
    return this;
  }

  watch() {
    // Node 24's Windows fs-event backend can abort the process when a watched
    // temporary directory changes. Polling remains reliable on Windows.
    if (process.platform !== 'win32') {
      this.watcher = fs.watch(this.paths.dataDir, (_event, filename) => {
        if (filename === 'events.jsonl') void this.readNew();
      });
    }
    this.poller = setInterval(() => void this.readNew(), 750);
    this.poller.unref();
  }

  async close() {
    clearInterval(this.poller);
    this.poller = null;
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      await new Promise((resolve) => {
        watcher.once('close', resolve);
        watcher.close();
      });
    }
    await this.mutationPromise;
    if (this.readPromise) await this.readPromise;
  }

  async readNew() {
    if (this.rotating) return;
    if (this.readPromise) return this.readPromise;
    this.readPromise = (async () => {
      const handle = await fsp.open(this.paths.inboxPath, 'r');
      try {
        const stat = await handle.stat();
        if (stat.size < this.offset) {
          this.offset = 0;
          this.remainder = '';
          this.liveEvents = [];
          this.refreshEvents();
        }
        if (stat.size === this.offset) return;

        const startOffset = this.offset;
        const size = stat.size - startOffset;
        const buffer = Buffer.alloc(size);
        let bytesRead = 0;
        while (bytesRead < size) {
          const result = await handle.read(buffer, bytesRead, size - bytesRead, startOffset + bytesRead);
          if (result.bytesRead === 0) break;
          bytesRead += result.bytesRead;
        }
        if (bytesRead === 0) return;

        this.offset = startOffset + bytesRead;
        const lines = `${this.remainder}${buffer.subarray(0, bytesRead).toString('utf8')}`.split('\n');
        this.remainder = lines.pop() || '';
        const added = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event?.sessionId && event?.receivedAt) {
              this.liveEvents.push(event);
              added.push(event);
            }
          } catch {
            // A partial/corrupt line is ignored; subsequent valid events remain usable.
          }
        }
        if (added.length) this.refreshEvents();
        if (added.length) this.emit('events', added);
      } finally {
        await handle.close();
      }
    })();
    try {
      return await this.readPromise;
    } finally {
      this.readPromise = null;
    }
  }

  getSessions() {
    const groups = new Map();
    for (const event of this.events) {
      const events = groups.get(event.sessionId) || [];
      events.push(event);
      groups.set(event.sessionId, events);
    }
    return [...groups.values()]
      .map((events) => buildSession(events, this.projectRoot))
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  }

  getSession(id) {
    const events = this.events.filter((event) => event.sessionId === id);
    return events.length ? buildSession(events, this.projectRoot) : null;
  }

  async append(event) {
    await fsp.appendFile(this.paths.inboxPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    await this.readNew();
    await this.readNew();
  }

  async deleteSession(id) {
    await this.readNew();
    if (!this.events.some((event) => event.sessionId === id)) return false;
    await this.compact((event) => event.sessionId !== id);
    this.emit('deleted', id);
    return true;
  }

  async prune(now = Date.now()) {
    const cutoff = now - this.retentionDays * 86_400_000;
    const allowedSessions = new Set(this.getSessions().slice(0, this.sessionLimit).map((session) => session.id));
    const retained = this.events.filter((event) => Date.parse(event.receivedAt) >= cutoff && allowedSessions.has(event.sessionId));
    if (retained.length !== this.events.length) {
      await this.compact((event) => Date.parse(event.receivedAt) >= cutoff && allowedSessions.has(event.sessionId));
    }
  }

  async compact(keep) {
    const operation = this.mutationPromise.then(async () => {
      await this.readNew();
      this.rotating = true;
      const rotatedPath = `${this.paths.inboxPath}.rotate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const tempHistoryPath = `${this.paths.historyPath}.tmp`;
      try {
        await renameWithRetry(this.paths.inboxPath, rotatedPath);
        const liveHandle = await fsp.open(this.paths.inboxPath, 'a', 0o600);
        await liveHandle.close();

        // Re-read the rotated segment after the rename so events appended between
        // the last poll and rotation are included in the compaction.
        const rotatedEvents = await readEventFile(rotatedPath);
        const retained = [...this.historyEvents, ...rotatedEvents].filter(keep);
        await writeEventFile(tempHistoryPath, retained);
        await fsp.rename(tempHistoryPath, this.paths.historyPath);

        this.historyEvents = retained;
        this.liveEvents = [];
        this.offset = 0;
        this.remainder = '';
        this.refreshEvents();
        await fsp.rm(rotatedPath, { force: true });
      } finally {
        this.rotating = false;
        await fsp.rm(tempHistoryPath, { force: true }).catch(() => {});
      }
      await this.readNew();
    });
    this.mutationPromise = operation.catch(() => {});
    return operation;
  }

  refreshEvents() {
    this.events = [...this.historyEvents, ...this.liveEvents];
  }
}

async function readEventFile(filePath) {
  let body = '';
  try {
    body = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const events = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.sessionId && event?.receivedAt) events.push(event);
    } catch {
      // Preserve subsequent valid events when one line is corrupt.
    }
  }
  return events;
}

async function writeEventFile(filePath, events) {
  const body = events.map((event) => JSON.stringify(event)).join('\n');
  await fsp.writeFile(filePath, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 });
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 12 * (attempt + 1)));
    }
  }
  throw lastError;
}
