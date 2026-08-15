import path from 'node:path';

export const DEFAULT_PORT = 4319;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_RETENTION_DAYS = 30;
export const DEFAULT_SESSION_LIMIT = 50;

export function pathsFor(projectRoot) {
  const dataDir = path.join(projectRoot, '.activisual');
  return {
    dataDir,
    inboxPath: path.join(dataDir, 'events.jsonl'),
    historyPath: path.join(dataDir, 'events.history.jsonl'),
    settingsPath: path.join(dataDir, 'settings.json'),
  };
}
