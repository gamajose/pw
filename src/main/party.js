// Modo grupo: grupos de personagens, Sync action, troca de personagem e organização das janelas.
import { EventEmitter } from 'node:events';
import { screen } from 'electron';
import { store } from './store.js';
import { native } from './native.js';
import { game } from './game.js';
import { vkFromAccelerator } from '../shared/keys.js';
import { createLogger } from './logger.js';

const log = createLogger('party');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Party extends EventEmitter {
  constructor() {
    super();
    this.activeGroupId = null;
    this.sync = { on: false, groupId: null, paused: false };
  }

  init() {
    game.on('changed', () => this.refreshSync().catch((e) => log.warn('refreshSync', e.message)));
    native.on('sync-paused', (d) => {
      this.sync.paused = !!d?.paused;
      this.emit('changed');
    });
    native.on('restarted', () => {
      // O módulo nativo reiniciou: o Sync action precisa ser religado.
      if (this.sync.on) this.startSync(this.sync.groupId).catch(() => this.stopSync());
    });
  }

  /** Membros do grupo na ordem definida (posição 1 = primeiro). */
  members(groupId) {
    const g = store.group(groupId);
    if (!g) return [];
    return g.memberIds.map((id) => store.account(id)).filter(Boolean);
  }

  memberHwnds(groupId) {
    return this.members(groupId)
      .map((a) => game.hwndOf(a.id))
      .filter(Boolean);
  }

  setActiveGroup(groupId) {
    if (groupId && !store.group(groupId)) return;
    this.activeGroupId = groupId;
    this.emit('active-group', groupId);
    this.emit('changed');
  }

  state() {
    return { activeGroupId: this.activeGroupId, sync: { ...this.sync }, syncRunning: this.sync.on };
  }

  // ---------------------------------------------------------------- Sync action

  syncConfig(groupId) {
    const s = store.settings;
    // Atalhos sem modificador (ex.: F12 sozinho) nunca devem ser espelhados.
    const accels = [...Object.values(s.hotkeys), ...store.db.presets.map((p) => p.hotkey)].filter(
      (a) => a && !/(ctrl|alt|shift|super|cmd|command|meta)\+/i.test(a),
    );
    return {
      members: this.memberHwnds(groupId),
      mode: s.sync.mode,
      chatPause: s.sync.chatPause,
      clickActivation: s.sync.clickActivation,
      excludeVks: accels.map(vkFromAccelerator).filter(Boolean),
    };
  }

  async startSync(groupId) {
    groupId ??= this.activeGroupId;
    if (!store.group(groupId)) throw new Error('Selecione um grupo para usar o Sync action.');
    const cfg = this.syncConfig(groupId);
    if (cfg.members.length < 2) throw new Error('O Sync action precisa de pelo menos 2 personagens do grupo jogando.');
    await native.call('sync-start', cfg);
    this.sync = { on: true, groupId, paused: false };
    this.setActiveGroup(groupId);
    log.info(`sync ligado (${cfg.members.length} janelas)`);
    this.emit('changed');
  }

  async stopSync() {
    if (native.available) await native.call('sync-stop').catch(() => {});
    this.sync = { on: false, groupId: null, paused: false };
    this.emit('changed');
  }

  async toggleSync(groupId) {
    if (this.sync.on && (!groupId || groupId === this.sync.groupId)) return this.stopSync();
    return this.startSync(groupId);
  }

  async setSyncPaused(paused) {
    if (!this.sync.on) return;
    await native.call('sync-pause', { paused });
  }

  /** Mantém a lista de janelas do Sync atualizada quando clientes abrem/fecham. */
  async refreshSync() {
    if (!this.sync.on) return;
    if (!store.group(this.sync.groupId)) return this.stopSync();
    await native.call('sync-update', this.syncConfig(this.sync.groupId));
  }

  // ---------------------------------------------------------------- troca de personagem

  async focusPosition(position, groupId = this.activeGroupId) {
    const member = this.members(groupId)[position - 1];
    if (!member) return;
    await game.focus(member.id);
  }

  async focusRelative(step) {
    const groupId = this.activeGroupId;
    const playing = this.members(groupId).filter((a) => game.hwndOf(a.id));
    if (playing.length === 0) return;
    let idx = playing.findIndex((a) => a.id === game.foregroundAccountId);
    idx = idx < 0 ? 0 : (idx + step + playing.length) % playing.length;
    await game.focus(playing[idx].id);
  }

  // ---------------------------------------------------------------- abrir / fechar grupo

  async launchGroup(groupId) {
    const members = this.members(groupId);
    if (members.length === 0) throw new Error('O grupo não tem personagens.');
    this.setActiveGroup(groupId);
    const errors = [];
    let first = true;
    for (const m of members) {
      if (game.running.has(m.id)) continue;
      if (!first) await sleep(store.settings.launch.delayBetweenMs);
      first = false;
      try {
        await game.launch(m.id);
      } catch (err) {
        errors.push(`${m.name}: ${err.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  }

  async stopGroup(groupId) {
    for (const m of this.members(groupId)) if (game.running.has(m.id)) await game.stop(m.id).catch(() => {});
  }

  // ---------------------------------------------------------------- organizar janelas

  /**
   * Organiza as janelas do grupo no monitor escolhido.
   * layout: "grid" (mosaico), "cascade" (cascata), "leader" (líder grande + demais em coluna).
   */
  async arrange(groupId, layout = 'grid', displayId = null) {
    const g = store.group(groupId);
    const accounts = this.members(groupId).filter((a) => game.hwndOf(a.id));
    if (accounts.length === 0) throw new Error('Nenhum personagem do grupo está jogando.');
    if (layout === 'leader' && g.leaderId) {
      accounts.sort((a, b) => (a.id === g.leaderId ? -1 : b.id === g.leaderId ? 1 : 0));
    }

    const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
    // workArea está em DIPs; o módulo nativo trabalha em pixels físicos.
    const area = screen.dipToScreenRect(null, display.workArea);
    const n = accounts.length;
    const rects = [];

    if (layout === 'cascade') {
      const w = Math.round(area.width * 0.7);
      const h = Math.round(area.height * 0.7);
      const step = Math.max(24, Math.min(40, Math.floor((area.height - h) / Math.max(1, n - 1))));
      for (let i = 0; i < n; i++) rects.push({ x: area.x + i * step, y: area.y + i * step, width: w, height: h });
    } else if (layout === 'leader' && n > 1) {
      const side = Math.round(area.width * 0.3);
      rects.push({ x: area.x, y: area.y, width: area.width - side, height: area.height });
      const h = Math.floor(area.height / (n - 1));
      for (let i = 1; i < n; i++) rects.push({ x: area.x + area.width - side, y: area.y + (i - 1) * h, width: side, height: h });
    } else {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const w = Math.floor(area.width / cols);
      const h = Math.floor(area.height / rows);
      for (let i = 0; i < n; i++) {
        rects.push({ x: area.x + (i % cols) * w, y: area.y + Math.floor(i / cols) * h, width: w, height: h });
      }
    }

    for (let i = 0; i < n; i++) {
      await native.call('move', { hwnd: game.hwndOf(accounts[i].id), ...rects[i] }).catch((e) => log.warn('move', e.message));
    }
  }

  async minimizeOthers(accountId) {
    for (const r of game.running.values()) {
      if (r.accountId !== accountId && r.hwnd) await native.call('minimize', { hwnd: r.hwnd }).catch(() => {});
    }
  }

  async alignCamera(groupId) {
    groupId ??= this.activeGroupId;
    const g = store.group(groupId);
    if (!g) throw new Error('Selecione um grupo para alinhar a câmera.');
    const leaderId = g.leaderId || g.memberIds[0];
    const leaderPid = game.running.get(leaderId)?.pid;
    if (!leaderPid) throw new Error('O líder do grupo não está com o jogo aberto.');

    const followerPids = g.memberIds
      .filter((id) => id !== leaderId)
      .map((id) => game.running.get(id)?.pid)
      .filter(Boolean);

    if (followerPids.length === 0) throw new Error('Nenhum seguidor do grupo está com o jogo aberto.');

    const res = await native.call('align-camera', { leaderPid, followerPids });
    log.info(`câmera alinhada: líder PID ${leaderPid}, seguidores ${followerPids.join(',')}`);
    return res;
  }
}

export const party = new Party();
