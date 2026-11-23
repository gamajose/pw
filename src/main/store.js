// Persistência em JSON (userData/data/db.json) com gravação atômica e senhas criptografadas
// pelo Windows (DPAPI, via safeStorage do Electron).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { app, safeStorage } from 'electron';
import { createLogger } from './logger.js';

const log = createLogger('store');
const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 5000;

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  streamerMode: false,
  closeToTray: true,
  renameWindows: true,
  windowTitleFormat: '{character} [{account}]',
  accountSort: 'manual',
  selectedServerId: null,
  windowBounds: null,
  performanceMode: false,
  presetEngine: 'v2',
  calculator: {},
  typing: { method: 'unicode', charDelayMs: 15, pressEnter: true },
  launch: { delayBetweenMs: 1500, autoTypeLogin: false, autoTypeDelayMs: 8000 },
  backup: { enabled: true, intervalHours: 24, path: '', keep: 20, lastAt: null },
  party: { numpadSwitch: false, changeWith: 'single', showClass: true, showPosition: true, miniAlwaysOnTop: true },
  sync: { mode: 'keys', chatPause: true, clickActivation: false },
  presets: { requireFocus: true },
  hotkeys: {
    typeLogin: 'Ctrl+Shift+L',
    toggleSync: 'Ctrl+Shift+S',
    focusNext: 'Ctrl+Shift+Right',
    focusPrev: 'Ctrl+Shift+Left',
    stopPresets: 'Ctrl+Shift+X',
    openSearch: 'Ctrl+Space',
    toggleToolbar: 'Ctrl+Shift+T',
  },
  updater: {
    autoCheck: true,
    feedUrl: '',
  },
};

function emptyDb() {
  return {
    version: SCHEMA_VERSION,
    servers: [],
    accounts: [],
    groups: [],
    presets: [],
    sessions: [],
    runtime: [],
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

// Mescla recursivamente as configurações salvas sobre os padrões (novas chaves ganham valor padrão).
function mergeDefaults(defaults, saved) {
  if (saved == null || typeof saved !== 'object' || Array.isArray(saved)) return structuredClone(defaults);
  const out = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergeDefaults(v, saved[k]);
    else out[k] = k in saved ? saved[k] : v;
  }
  return out;
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.db = emptyDb();
    this.file = null;
    this.timer = null;
  }

  get dataDir() {
    return path.join(app.getPath('userData'), 'data');
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.file = path.join(this.dataDir, 'db.json');
    if (fs.existsSync(this.file)) {
      try {
        this.db = this.normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch (err) {
        const broken = this.file + '.corrompido-' + Date.now();
        fs.copyFileSync(this.file, broken);
        log.error('db.json inválido; cópia salva em ' + broken, err);
        this.db = emptyDb();
      }
    }
    log.info(`dados carregados: ${this.db.accounts.length} contas, ${this.db.servers.length} servidores`);
  }

  normalize(raw) {
    const db = emptyDb();
    for (const key of ['servers', 'accounts', 'groups', 'presets', 'sessions', 'runtime']) {
      if (Array.isArray(raw?.[key])) db[key] = raw[key];
    }
    db.settings = mergeDefaults(DEFAULT_SETTINGS, raw?.settings);
    db.accounts.forEach((a, i) => {
      a.order ??= i;
      a.totalSeconds ??= 0;
      a.archived ??= false;
      a.favorite ??= false;
    });
    return db;
  }

  /** Marca alteração: salva em disco (com atraso curto) e avisa a interface. */
  commit() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
    this.emit('changed');
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    if (this.db.sessions.length > MAX_SESSIONS) this.db.sessions = this.db.sessions.slice(-MAX_SESSIONS);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Substitui todo o banco (restauração de backup). */
  replace(raw) {
    this.db = this.normalize(raw);
    this.flush();
    this.emit('changed');
  }

  id() {
    return crypto.randomUUID();
  }

  // ---------------- Senhas ----------------

  encrypt(plain) {
    if (!plain) return '';
    if (safeStorage.isEncryptionAvailable()) return 'dpapi:' + safeStorage.encryptString(plain).toString('base64');
    log.warn('criptografia do sistema indisponível; senha salva apenas codificada');
    return 'plain:' + Buffer.from(plain, 'utf8').toString('base64');
  }

  decrypt(enc) {
    if (!enc) return '';
    try {
      if (enc.startsWith('dpapi:')) return safeStorage.decryptString(Buffer.from(enc.slice(6), 'base64'));
      if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf8');
    } catch (err) {
      log.warn('não foi possível descriptografar uma senha (backup de outro PC/usuário?)', err.message);
    }
    return '';
  }

  // ---------------- Consultas ----------------

  server(id) {
    return this.db.servers.find((s) => s.id === id) ?? null;
  }

  account(id) {
    return this.db.accounts.find((a) => a.id === id) ?? null;
  }

  group(id) {
    return this.db.groups.find((g) => g.id === id) ?? null;
  }

  preset(id) {
    return this.db.presets.find((p) => p.id === id) ?? null;
  }

  get settings() {
    return this.db.settings;
  }
}

export const store = new Store();
