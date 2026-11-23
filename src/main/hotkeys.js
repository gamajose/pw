// Atalhos globais (funcionam com o jogo em foco).
import { EventEmitter } from 'node:events';
import { globalShortcut, BrowserWindow } from 'electron';
import { store } from './store.js';
import { game } from './game.js';
import { party } from './party.js';
import { presets } from './presets.js';
import * as windows from './windows.js';
import { createLogger } from './logger.js';

const log = createLogger('hotkeys');

export const HOTKEY_LABELS = {
  typeLogin: 'Digitar login no jogo em foco',
  toggleSync: 'Ligar/desligar Sync action',
  focusNext: 'Próximo personagem do grupo',
  focusPrev: 'Personagem anterior do grupo',
  stopPresets: 'Parar todos os presets',
  openSearch: 'Busca rápida (paleta de comandos)',
  toggleToolbar: 'Abrir barra de ferramentas',
};

class Hotkeys extends EventEmitter {
  constructor() {
    super();
    this.failures = [];
  }

  wrap(fn) {
    return () => {
      Promise.resolve()
        .then(fn)
        .catch((err) => this.emit('notify', { type: 'error', message: err.message }));
    };
  }

  add(accel, label, fn) {
    if (!accel) return;
    try {
      if (globalShortcut.isRegistered(accel) || !globalShortcut.register(accel, this.wrap(fn))) {
        this.failures.push({ accel, label, reason: 'em uso por outro programa ou repetido' });
      }
    } catch {
      this.failures.push({ accel, label, reason: 'atalho inválido' });
    }
  }

  register() {
    globalShortcut.unregisterAll();
    this.failures = [];
    const hk = store.settings.hotkeys;

    this.add(hk.typeLogin, HOTKEY_LABELS.typeLogin, () => game.typeLoginForeground());
    this.add(hk.toggleSync, HOTKEY_LABELS.toggleSync, () => party.toggleSync());
    this.add(hk.focusNext, HOTKEY_LABELS.focusNext, () => party.focusRelative(1));
    this.add(hk.focusPrev, HOTKEY_LABELS.focusPrev, () => party.focusRelative(-1));
    this.add(hk.stopPresets, HOTKEY_LABELS.stopPresets, () => presets.stopAll());
    this.add(hk.openSearch, HOTKEY_LABELS.openSearch, () => windows.openSearch());
    this.add(hk.toggleToolbar, HOTKEY_LABELS.toggleToolbar, () => windows.openToolbar());

    for (const p of store.db.presets) {
      this.add(p.hotkey, `Preset: ${p.name}`, () =>
        presets.run(p.id, { fromHotkey: true, appFocused: BrowserWindow.getFocusedWindow() != null }),
      );
    }

    if (store.settings.party.numpadSwitch) {
      for (let n = 1; n <= 10; n++) {
        const key = `num${n % 10}`;
        this.add(key, `Personagem ${n} (teclado numérico)`, () => party.focusPosition(n));
      }
    }

    if (this.failures.length) log.warn('atalhos não registrados', this.failures);
    this.emit('changed');
  }

  dispose() {
    globalShortcut.unregisterAll();
  }
}

export const hotkeys = new Hotkeys();
