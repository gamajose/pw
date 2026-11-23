// Log simples em arquivo (userData/logs/main.log), com rotação ao passar de 2 MB.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

let file = null;

function target() {
  if (file) return file;
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'main.log');
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, path.join(dir, 'main.old.log'));
  } catch {
    /* arquivo ainda não existe */
  }
  return file;
}

function write(level, scope, msg, extra) {
  let line = `${new Date().toISOString()} [${level}] (${scope}) ${msg}`;
  if (extra !== undefined) {
    try {
      line += ' ' + (extra instanceof Error ? extra.stack || extra.message : JSON.stringify(extra));
    } catch {
      line += ' [extra não serializável]';
    }
  }
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  try {
    fs.appendFileSync(target(), line + '\n');
  } catch {
    /* sem log em disco não é fatal */
  }
}

export function createLogger(scope) {
  return {
    info: (m, e) => write('INFO', scope, m, e),
    warn: (m, e) => write('WARN', scope, m, e),
    error: (m, e) => write('ERROR', scope, m, e),
  };
}

export function logDir() {
  return path.dirname(target());
}
