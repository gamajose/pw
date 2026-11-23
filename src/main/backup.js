// Backup automático e manual do banco de dados.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { store } from './store.js';
import { createLogger } from './logger.js';

const log = createLogger('backup');
const CHECK_MS = 5 * 60 * 1000;
const MIN_MANUAL_INTERVAL_MS = 10 * 1000;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

class Backup {
  constructor() {
    this.timer = null;
    this.lastManual = 0;
  }

  get folder() {
    return store.settings.backup.path || path.join(app.getPath('documents'), 'PW Manager', 'Backups');
  }

  init() {
    this.timer = setInterval(() => this.tick(), CHECK_MS);
    setTimeout(() => this.tick(), 30 * 1000);
  }

  dispose() {
    clearInterval(this.timer);
  }

  tick() {
    const b = store.settings.backup;
    if (!b.enabled) return;
    const due = !b.lastAt || Date.now() - b.lastAt >= b.intervalHours * 3600 * 1000;
    if (due) {
      try {
        this.run('auto');
      } catch (err) {
        log.error('backup automático falhou', err);
      }
    }
  }

  /** Grava uma cópia do banco. Retorna o caminho do arquivo criado. */
  run(kind = 'manual') {
    if (kind === 'manual') {
      const wait = MIN_MANUAL_INTERVAL_MS - (Date.now() - this.lastManual);
      if (wait > 0) throw new Error(`Aguarde ${Math.ceil(wait / 1000)}s para fazer outro backup.`);
      this.lastManual = Date.now();
    }
    store.settings.backup.lastAt = Date.now();
    store.flush();
    fs.mkdirSync(this.folder, { recursive: true });
    const file = path.join(this.folder, `pw-manager-${kind}-${stamp()}.json`);
    fs.copyFileSync(store.file, file);
    this.prune();
    store.commit();
    log.info('backup criado: ' + file);
    return file;
  }

  prune() {
    const keep = Math.max(1, store.settings.backup.keep || 20);
    const files = this.list();
    for (const f of files.slice(keep)) {
      try {
        fs.unlinkSync(f.file);
      } catch {
        /* ignorado */
      }
    }
  }

  list() {
    if (!fs.existsSync(this.folder)) return [];
    return fs
      .readdirSync(this.folder)
      .filter((n) => /^pw-manager-.*\.json$/.test(n))
      .map((n) => {
        const file = path.join(this.folder, n);
        return { file, name: n, mtime: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  restore(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(raw.accounts) || !Array.isArray(raw.servers)) throw new Error('Este arquivo não é um backup do PW Manager.');
    this.run('antes-de-restaurar');
    raw.runtime = store.db.runtime; // não perder os clientes abertos agora
    store.replace(raw);
    log.info('backup restaurado: ' + file);
  }
}

export const backup = new Backup();
