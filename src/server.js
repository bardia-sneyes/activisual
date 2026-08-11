import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactHookEvent } from './redact.js';
import { EventStore } from './store.js';
import { DEFAULT_HOST, DEFAULT_PORT } from './config.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export async function createActivisualServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port ?? DEFAULT_PORT);
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const store = options.store || await new EventStore(projectRoot, options).init();
  const clients = new Set();

  store.on('events', (events) => broadcast(clients, 'events', { events }));
  store.on('deleted', (id) => broadcast(clients, 'session-deleted', { id }));

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
      setSecurityHeaders(response);

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(response, 200, { ok: true, projectRoot, now: new Date().toISOString() });
      }
      if (request.method === 'GET' && url.pathname === '/api/sessions') {
        const sessions = store.getSessions().map(({ chunks, files, ...session }) => session);
        return json(response, 200, { sessions });
      }
      if (request.method === 'GET' && url.pathname === '/api/stream') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        response.write(`event: ready\ndata: ${JSON.stringify({ projectRoot })}\n\n`);
        clients.add(response);
        const keepAlive = setInterval(() => response.write(': pulse\n\n'), 15_000);
        request.on('close', () => {
          clearInterval(keepAlive);
          clients.delete(response);
        });
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === 'GET') {
        const session = store.getSession(decodeURIComponent(sessionMatch[1]));
        return session ? json(response, 200, { session }) : json(response, 404, { error: 'Session not found' });
      }
      if (sessionMatch && request.method === 'DELETE') {
        const deleted = await store.deleteSession(decodeURIComponent(sessionMatch[1]));
        return json(response, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Session not found' });
      }
      if (request.method === 'POST' && url.pathname === '/api/events') {
        const body = await readJson(request);
        const event = compactHookEvent(body);
        await store.append(event);
        return json(response, 202, { ok: true, id: event.id });
      }
      if (request.method === 'GET') return serveAsset(url.pathname, response);
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.statusCode || 500;
      return json(response, status, { error: status === 500 ? 'Internal server error' : error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    store,
    host,
    port: server.address().port,
    projectRoot,
    url: `http://${host}:${server.address().port}`,
    async close() {
      for (const client of clients) client.end();
      await store.close();
      server.closeIdleConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function serveAsset(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const assetPath = path.resolve(PUBLIC_DIR, relative);
  if (!assetPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && assetPath !== path.join(PUBLIC_DIR, 'index.html')) {
    return json(response, 403, { error: 'Forbidden' });
  }
  try {
    const body = await fs.readFile(assetPath);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(assetPath)] || 'application/octet-stream' });
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const index = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
      response.writeHead(200, { 'Content-Type': MIME['.html'] });
      response.end(index);
      return;
    }
    throw error;
  }
}

function setSecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function broadcast(clients, event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(message);
}
