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
    this.events = [];
    this.offset = 0;
    this.remainder = '';
    this.watcher = null;
    this.poller = null;
    this.readPromise = null;
  }

  async init() {
    await fsp.mkdir(this.paths.dataDir, { recursive: true, mode: 0o700 });
    const handle = await fsp.open(this.paths.inboxPath, 'a', 0o600);
    await handle.close();
    await this.readNew();
    await this.prune();
    this.watch();
    return this;
  }

  watch() {
    this.watcher = fs.watch(this.paths.dataDir, (_event, filename) => {
      if (filename === 'events.jsonl') void this.readNew();
    });
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
    if (this.readPromise) await this.readPromise;
  }

  async readNew() {
    if (this.readPromise) return this.readPromise;
    this.readPromise = (async () => {
      const stat = await fsp.stat(this.paths.inboxPath);
      if (stat.size < this.offset) {
        this.offset = 0;
        this.remainder = '';
        this.events = [];
      }
      if (stat.size === this.offset) return;
      const handle = await fsp.open(this.paths.inboxPath, 'r');
      const size = stat.size - this.offset;
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, this.offset);
      await handle.close();
      this.offset = stat.size;
      const lines = `${this.remainder}${buffer.toString('utf8')}`.split('\n');
      this.remainder = lines.pop() || '';
      const added = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event?.sessionId && event?.receivedAt) {
            this.events.push(event);
            added.push(event);
          }
        } catch {
          // A partial/corrupt line is ignored; subsequent valid events remain usable.
        }
      }
      if (added.length) this.emit('events', added);
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
    const before = this.events.length;
    this.events = this.events.filter((event) => event.sessionId !== id);
    if (before === this.events.length) return false;
    await this.rewrite();
    this.emit('deleted', id);
    return true;
  }

  async prune(now = Date.now()) {
    const cutoff = now - this.retentionDays * 86_400_000;
    const allowedSessions = new Set(this.getSessions().slice(0, this.sessionLimit).map((session) => session.id));
    const retained = this.events.filter((event) => Date.parse(event.receivedAt) >= cutoff && allowedSessions.has(event.sessionId));
    if (retained.length !== this.events.length) {
      this.events = retained;
      await this.rewrite();
    }
  }

  async rewrite() {
    const tempPath = `${this.paths.inboxPath}.tmp`;
    const body = this.events.map((event) => JSON.stringify(event)).join('\n');
    await fsp.writeFile(tempPath, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tempPath, this.paths.inboxPath);
    this.offset = Buffer.byteLength(body ? `${body}\n` : '');
    this.remainder = '';
  }
}
