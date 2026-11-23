// Abertura dos clientes do jogo (elementclient.exe), acompanhamento dos processos/janelas
// e registro de sessões (tempo de jogo).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { store } from './store.js';
import { native } from './native.js';
import { createLogger } from './logger.js';

const log = createLogger('game');

export const DEFAULT_ARGS = 'startbypatcher user:{login} pwd:{password} role:{character}';
const POLL_MS = 1500;

/** Divide a linha de argumentos respeitando aspas duplas. */
export function tokenize(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (const ch of String(line ?? '')) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/**
 * Monta os argumentos do cliente a partir do modelo do servidor.
 * Variáveis: {login} {password} {character} {server} {account}.
 * Um argumento cuja variável está vazia é omitido (ex.: role: sem personagem).
 */
export function buildArgs(template, ctx) {
  const out = [];
  for (const token of tokenize(template?.trim() ? template : DEFAULT_ARGS)) {
    let missing = false;
    const value = token.replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx[key] ?? '';
      if (v === '') missing = true;
      return v;
    });
    if (!missing) out.push(value);
  }
  return out;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // existe, mas pertence a outro nível de privilégio
  }
}

export function formatTitle(format, account, server) {
  return String(format || '{character}')
    .replaceAll('{character}', account.character || account.name || '')
    .replaceAll('{account}', account.name || account.login || '')
    .replaceAll('{server}', server?.name || '')
    .trim();
}

class Game extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, {accountId:string,pid:number,hwnd:number|null,startedAt:number,launching:boolean}>} */
    this.running = new Map();
    this.foregroundAccountId = null;
    this.foregroundHwnd = 0;
    this.timer = null;
    this.polling = false;
  }

  init() {
    // Reanexa clientes abertos antes de o PW Manager ser reiniciado.
    for (const r of store.db.runtime) {
      if (store.account(r.accountId) && isAlive(r.pid)) {
        this.running.set(r.accountId, { accountId: r.accountId, pid: r.pid, hwnd: null, startedAt: r.startedAt, launching: false, verify: true });
      }
    }
    this.persistRuntime();
    native.on('foreground', (d) => this.onForeground(d));
    native.on('restarted', () => this.emit('changed'));
    this.timer = setInterval(() => this.poll().catch((e) => log.warn('poll', e.message)), POLL_MS);
  }

  dispose() {
    clearInterval(this.timer);
  }

  list() {
    return [...this.running.values()].map((r) => ({
      accountId: r.accountId,
      pid: r.pid,
      hwnd: r.hwnd,
      startedAt: r.startedAt,
      launching: r.launching,
    }));
  }

  hwndOf(accountId) {
    return this.running.get(accountId)?.hwnd ?? null;
  }

  accountByHwnd(hwnd) {
    for (const r of this.running.values()) if (r.hwnd === hwnd) return r.accountId;
    return null;
  }

  persistRuntime() {
    store.db.runtime = [...this.running.values()].map((r) => ({ accountId: r.accountId, pid: r.pid, startedAt: r.startedAt }));
    store.commit();
  }

  // ---------------------------------------------------------------- abrir/fechar

  async launch(accountId) {
    const account = store.account(accountId);
    if (!account) throw new Error('Conta não encontrada.');
    const server = store.server(account.serverId);
    if (!server) throw new Error(`A conta "${account.name}" não tem servidor configurado.`);
    if (!server.clientPath || !fs.existsSync(server.clientPath)) {
      throw new Error(`Caminho do element client inválido no servidor "${server.name}".`);
    }

    const existing = this.running.get(accountId);
    if (existing) {
      if (existing.hwnd) await native.call('focus', { hwnd: existing.hwnd }).catch(() => {});
      return { alreadyRunning: true };
    }

    const password = store.decrypt(account.passwordEnc);
    const args = buildArgs(server.args, {
      login: account.login ?? '',
      password,
      character: account.character ?? '',
      server: server.forceServerName ?? '',
      account: account.name ?? '',
    });

    const exe = server.clientPath;
    log.info(`abrindo ${account.name} (${path.basename(exe)})`);
    const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (err) =>
        reject(new Error(['EACCES', 'EPERM', 'UNKNOWN'].includes(err.code)
          ? 'O Windows negou a abertura do jogo (o cliente pode exigir administrador). Abra o PW Manager como administrador.'
          : `Não foi possível abrir o jogo: ${err.message}`)),
      );
    });
    child.unref();

    const entry = { accountId, pid: child.pid, hwnd: null, startedAt: Date.now(), launching: true };
    this.running.set(accountId, entry);
    account.lastPlayedAt = entry.startedAt;
    this.persistRuntime();
    this.emit('changed');

    this.attachWindow(entry, 60000).then(async () => {
      const s = store.settings.launch;
      if (s.autoTypeLogin && entry.hwnd) {
        await new Promise((r) => setTimeout(r, s.autoTypeDelayMs));
        if (this.running.get(accountId) === entry) await this.typeLogin(accountId).catch((e) => this.emit('notify', { type: 'error', message: e.message }));
      }
    });
    return { pid: child.pid };
  }

  async attachWindow(entry, timeoutMs) {
    try {
      const w = await native.call('window-for-pid', { pid: entry.pid, timeoutMs }, timeoutMs + 5000);
      if (this.running.get(entry.accountId) !== entry) return;
      entry.launching = false;
      if (w) {
        entry.hwnd = w.hwnd;
        await this.applyTitle(entry);
      }
      this.emit('changed');
    } catch (err) {
      entry.launching = false;
      log.warn('não achou a janela do cliente', err.message);
      this.emit('changed');
    }
  }

  async applyTitle(entry) {
    if (!store.settings.renameWindows || !entry.hwnd) return;
    const account = store.account(entry.accountId);
    if (!account) return;
    const title = formatTitle(store.settings.windowTitleFormat, account, store.server(account.serverId));
    if (!title) return;
    const info = await native.call('window-info', { hwnd: entry.hwnd }).catch(() => null);
    if (info && info.title !== title) await native.call('set-title', { hwnd: entry.hwnd, title }).catch(() => {});
  }

  async stop(accountId) {
    const entry = this.running.get(accountId);
    if (!entry) return;
    try {
      process.kill(entry.pid);
    } catch (err) {
      if (err.code === 'EPERM' && entry.hwnd) await native.call('close', { hwnd: entry.hwnd }).catch(() => {});
      else if (err.code !== 'ESRCH') throw new Error('Não foi possível fechar o jogo: ' + err.message);
    }
    setTimeout(() => this.poll().catch(() => {}), 500);
  }

  async focus(accountId) {
    const hwnd = this.hwndOf(accountId);
    if (!hwnd) throw new Error('Este personagem não está jogando.');
    return native.call('focus', { hwnd });
  }

  async typeLogin(accountId) {
    const account = store.account(accountId);
    if (!account) throw new Error('Conta não encontrada.');
    const hwnd = this.hwndOf(accountId);
    if (!hwnd) throw new Error('A janela do jogo não foi encontrada.');
    if (!account.login) throw new Error(`A conta ${account.name} não tem login salvo.`);
    const password = store.decrypt(account.passwordEnc);
    if (!password) throw new Error(`A conta ${account.name} não tem senha salva.`);
    const t = store.settings.typing;
    await native.call('type-login', {
      hwnd,
      login: account.login,
      password,
      method: t.method,
      charDelayMs: t.charDelayMs,
      enter: t.pressEnter,
    }, 40000);
  }

  /** Digita o login no cliente que está em foco (atalho global). */
  async typeLoginForeground() {
    const fg = await native.call('foreground');
    const accountId = this.accountByHwnd(fg.hwnd) ?? [...this.running.values()].find((r) => r.pid === fg.pid)?.accountId;
    if (!accountId) throw new Error('Este cliente não foi aberto pelo PW Manager, então não dá para saber qual é a conta.');
    await this.typeLogin(accountId);
  }

  // ---------------------------------------------------------------- monitoramento

  onForeground({ hwnd, pid }) {
    this.foregroundHwnd = hwnd;
    let id = this.accountByHwnd(hwnd);
    if (!id) for (const r of this.running.values()) if (r.pid === pid) id = r.accountId;
    if (id !== this.foregroundAccountId) {
      this.foregroundAccountId = id;
      this.emit('foreground', id);
    }
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      let changed = false;
      for (const entry of [...this.running.values()]) {
        if (!isAlive(entry.pid)) {
          this.endSession(entry);
          changed = true;
          continue;
        }
        if (!native.available || entry.launching) continue;

        if (entry.hwnd) {
          const alive = await native.call('alive', { hwnds: [entry.hwnd] }).catch(() => null);
          if (alive && alive.length === 0) {
            entry.hwnd = null;
            changed = true;
          }
        }
        if (!entry.hwnd) {
          const w = await native.call('window-for-pid', { pid: entry.pid, timeoutMs: 0 }).catch(() => null);
          if (entry.verify) {
            // Processo reanexado após reinício: confirma que é mesmo o cliente do jogo.
            const server = store.server(store.account(entry.accountId)?.serverId);
            const expected = server?.clientPath ? path.basename(server.clientPath).toLowerCase() : null;
            if (!w || (expected && w.processName.toLowerCase() !== expected)) {
              this.running.delete(entry.accountId);
              changed = true;
              continue;
            }
            entry.verify = false;
          }
          if (w) {
            entry.hwnd = w.hwnd;
            changed = true;
          }
        }
        await this.applyTitle(entry);
      }
      if (changed) {
        this.persistRuntime();
        this.emit('changed');
      }
    } finally {
      this.polling = false;
    }
  }

  endSession(entry) {
    this.running.delete(entry.accountId);
    const end = Date.now();
    const seconds = Math.max(0, Math.round((end - entry.startedAt) / 1000));
    const account = store.account(entry.accountId);
    if (account) {
      account.totalSeconds = (account.totalSeconds ?? 0) + seconds;
      account.lastPlayedAt = end;
    }
    store.db.sessions.push({ accountId: entry.accountId, start: entry.startedAt, end, seconds });
    if (this.foregroundAccountId === entry.accountId) this.foregroundAccountId = null;
    log.info(`sessão encerrada: ${account?.name ?? entry.accountId} (${seconds}s)`);
  }
}

export const game = new Game();
