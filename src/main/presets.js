// Presets (macros): sequências de teclas, cliques, esperas e trocas de foco executadas
// nas janelas do grupo. A execução em si acontece no módulo nativo (tempo preciso, em segundo plano).
import { EventEmitter } from 'node:events';
import { store } from './store.js';
import { native } from './native.js';
import { game } from './game.js';
import { party } from './party.js';
import { vkFromName } from '../shared/keys.js';
import { createLogger } from './logger.js';

const log = createLogger('presets');

class Presets extends EventEmitter {
  constructor() {
    super();
    this.running = new Set();
  }

  init() {
    native.on('preset-finished', (d) => {
      this.running.delete(d.runId);
      if (d.error) this.emit('notify', { type: 'error', message: `Preset falhou: ${d.error}` });
      this.emit('changed');
    });
    native.on('restarted', () => {
      this.running.clear();
      this.emit('changed');
    });
  }

  /** Resolve um alvo ("all", "leader", "members", "focused", "pos:N") para hwnds. */
  resolveTarget(target, groupId) {
    const group = store.group(groupId);
    const playing = group
      ? party.members(groupId).map((a) => ({ id: a.id, hwnd: game.hwndOf(a.id) }))
      : game.list().map((r) => ({ id: r.accountId, hwnd: r.hwnd }));

    const live = playing.filter((m) => m.hwnd);
    switch (true) {
      case target === 'all':
        return live.map((m) => m.hwnd);
      case target === 'leader':
        return live.filter((m) => m.id === group?.leaderId).map((m) => m.hwnd);
      case target === 'members':
        return live.filter((m) => m.id !== group?.leaderId).map((m) => m.hwnd);
      case target === 'focused':
        return live.filter((m) => m.id === game.foregroundAccountId).map((m) => m.hwnd);
      case /^pos:\d+$/.test(target): {
        const m = playing[Number(target.slice(4)) - 1];
        return m?.hwnd ? [m.hwnd] : [];
      }
      default:
        return [];
    }
  }

  compile(preset, groupId) {
    return preset.steps.map((s) => {
      switch (s.type) {
        case 'key':
          return { type: 'key', vk: vkFromName(s.key), holdMs: s.holdMs ?? 30, hwnds: this.resolveTarget(s.target, groupId) };
        case 'click':
          return {
            type: 'click',
            button: s.button ?? 'left',
            rx: s.rx ?? 0.5,
            ry: s.ry ?? 0.5,
            activate: !!s.activate || store.settings.sync.clickActivation,
            double: !!s.double,
            hwnds: this.resolveTarget(s.target, groupId),
          };
        case 'focus':
          return { type: 'focus', hwnds: this.resolveTarget(s.target, groupId) };
        case 'delay':
          return { type: 'delay', ms: Math.max(0, Number(s.ms) || 0) };
        default:
          throw new Error(`Comando inválido no preset: ${s.type}`);
      }
    });
  }

  validate(preset) {
    if (!preset.steps?.length) throw new Error('Adicione pelo menos um comando ao preset.');
    for (const s of preset.steps) {
      if (s.type === 'key' && !vkFromName(s.key)) throw new Error('Há um comando de tecla sem tecla escolhida.');
      if (s.type === 'click' && (s.rx == null || s.ry == null)) throw new Error('Há um clique sem posição capturada.');
    }
  }

  /**
   * Executa (ou para, se já estiver rodando) um preset.
   * @param {string} presetId
   * @param {{groupId?: string, fromHotkey?: boolean}} [opts]
   */
  async run(presetId, opts = {}) {
    const preset = store.preset(presetId);
    if (!preset) throw new Error('Preset não encontrado.');
    if (this.running.has(presetId)) return this.stop(presetId);

    if (opts.fromHotkey && store.settings.presets.requireFocus && !game.foregroundAccountId && !opts.appFocused) {
      return { skipped: true }; // atalho apertado fora do jogo
    }

    this.validate(preset);
    const groupId = opts.groupId ?? preset.groupId ?? party.activeGroupId;
    const steps = this.compile(preset, groupId);
    if (!steps.some((s) => s.hwnds?.length)) throw new Error('Nenhum personagem alvo deste preset está jogando.');

    await native.call('preset-run', {
      runId: presetId,
      steps,
      perTargetDelayMs: preset.perTargetDelayMs ?? 0,
      repeat: preset.repeat ?? 1,
      repeatDelayMs: preset.repeatDelayMs ?? 0,
    });
    this.running.add(presetId);
    log.info(`preset "${preset.name}" iniciado`);
    this.emit('changed');
    return { started: true };
  }

  /**
   * Executa uma lista de passos temporária diretamente (botão 'Testar Função').
   */
  async test(presetData, groupId) {
    this.validate(presetData);
    groupId = groupId ?? presetData.groupId ?? party.activeGroupId;
    const steps = this.compile(presetData, groupId);
    if (!steps.some((s) => s.hwnds?.length)) throw new Error('Nenhum personagem alvo deste preset está jogando.');

    const tempRunId = 'test-' + Date.now();
    await native.call('preset-run', {
      runId: tempRunId,
      steps,
      perTargetDelayMs: presetData.perTargetDelayMs ?? 0,
      repeat: 1,
      repeatDelayMs: 0,
    });
    this.running.add(tempRunId);
    log.info(`teste de preset temporário iniciado (${tempRunId})`);
    this.emit('changed');
    return { started: true };
  }

  async stop(presetId) {
    await native.call('preset-stop', presetId ? { runId: presetId } : {}).catch(() => {});
    return { stopped: true };
  }

  async stopAll() {
    return this.stop(null);
  }
}

export const presets = new Presets();
