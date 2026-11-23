// Ponte com o módulo nativo PwNative.exe (C#), via JSON por linha em stdin/stdout.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { createLogger } from './logger.js';

const log = createLogger('native');

// Mensagens amigáveis para os códigos de erro do módulo nativo.
const MESSAGES = {
  NOT_FOUND: 'A janela do jogo não foi encontrada.',
  NOT_FOREGROUND: 'A janela do jogo não estava em primeiro plano. Clique nela e tente de novo.',
  MODIFIERS_HELD: 'Solte Ctrl, Shift, Alt e Win logo depois de apertar o atalho.',
  FOCUS_LOST: 'A janela do jogo perdeu o foco no meio da digitação.',
  WINDOW_CLOSED: 'A janela do jogo fechou no meio da digitação.',
  INPUT_BLOCKED: 'O Windows bloqueou a digitação. O jogo pode estar aberto como administrador — abra o PW Manager como administrador também.',
  POST_FAILED: 'O jogo não aceitou as teclas enviadas.',
  INVALID_INPUT: 'O login ou a senha têm um caractere que não dá para digitar.',
  TIMEOUT: 'A operação demorou demais e foi cancelada.',
  CANCELLED: 'Operação cancelada.',
  BUSY: 'Já existe uma operação dessas em andamento.',
  HOOK_FAILED: 'Não foi possível monitorar teclado/mouse.',
  UNAVAILABLE: 'O módulo nativo (PwNative.exe) não está disponível. Reinstale o PW Manager.',
};

export class NativeError extends Error {
  constructor(code, message) {
    super(MESSAGES[code] && code !== 'FAILED' ? MESSAGES[code] : message || MESSAGES[code] || 'Falha no módulo nativo.');
    this.code = code;
  }
}

function resolveExe() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'bin', 'PwNative.exe')]
    : [
        path.join(app.getAppPath(), 'bin', 'PwNative.exe'),
        path.join(app.getAppPath(), 'native', 'PwNative', 'bin', 'Release', 'net9.0-windows', 'win-x64', 'PwNative.exe'),
      ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

class Native extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.ready = false;
    this.restarts = [];
    this.stopping = false;
    this.exe = null;
  }

  get available() {
    return this.ready;
  }

  start() {
    this.exe = resolveExe();
    if (!this.exe) {
      log.error('PwNative.exe não encontrado. Rode "npm run build:native".');
      this.emit('status', { available: false, reason: 'missing' });
      return;
    }
    this.spawn();
  }

  spawn() {
    log.info('iniciando ' + this.exe);
    const proc = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => log.warn('stderr: ' + d.trim()));
    proc.on('error', (err) => log.error('falha ao iniciar o módulo nativo', err));
    proc.on('exit', (code) => this.onExit(proc, code));
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log.warn('linha inválida do módulo nativo: ' + line.slice(0, 200));
        continue;
      }
      if (msg.event) {
        if (msg.event === 'ready') {
          this.ready = true;
          log.info('módulo nativo pronto', msg.data);
          this.emit('status', { available: true });
        }
        this.emit(msg.event, msg.data);
      } else if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new NativeError(msg.code || 'FAILED', msg.error));
      }
    }
  }

  onExit(proc, code) {
    if (proc !== this.proc) return;
    this.ready = false;
    this.proc = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new NativeError('UNAVAILABLE'));
    }
    this.pending.clear();
    if (this.stopping) return;

    log.error(`módulo nativo terminou (código ${code})`);
    this.emit('status', { available: false, reason: 'crashed' });
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60000);
    if (this.restarts.length >= 5) {
      log.error('módulo nativo caiu 5 vezes em 1 minuto; desistindo de reiniciar');
      return;
    }
    this.restarts.push(now);
    setTimeout(() => {
      this.spawn();
      this.once('ready', () => this.emit('restarted'));
    }, 1000);
  }

  /**
   * Envia um comando. Rejeita com NativeError (com .code) em caso de falha.
   * @param {string} cmd
   * @param {object} [args]
   * @param {number} [timeoutMs]
   */
  call(cmd, args = {}, timeoutMs = 15000) {
    if (!this.proc || !this.ready) return Promise.reject(new NativeError('UNAVAILABLE'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NativeError('TIMEOUT'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    this.stopping = true;
    if (this.proc) {
      try {
        this.proc.stdin.end();
      } catch {
        /* já fechado */
      }
      const p = this.proc;
      setTimeout(() => {
        try {
          p.kill();
        } catch {
          /* já saiu */
        }
      }, 1500);
    }
  }
}

export const native = new Native();
