// PW Manager — processo principal do Electron.
import { app, dialog } from 'electron';
import { store } from './store.js';
import { native } from './native.js';
import { game } from './game.js';
import { party } from './party.js';
import { presets } from './presets.js';
import { hotkeys } from './hotkeys.js';
import { backup } from './backup.js';
import { registerIpc, publicState } from './ipc.js';
import * as windows from './windows.js';
import { updater } from './updater.js';
import { createLogger } from './logger.js';

// Pasta de dados alternativa (testes/demonstração): PW_MANAGER_DATA=C:\caminho
if (process.env.PW_MANAGER_DATA) app.setPath('userData', process.env.PW_MANAGER_DATA);

const log = createLogger('main');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => windows.showMainWindow());
  app.setAppUserModelId('br.tcc.pwmanager');
  app.whenReady().then(start).catch((err) => {
    log.error('falha ao iniciar', err);
    dialog.showErrorBox('PW Manager', 'Falha ao iniciar: ' + err.message);
    app.exit(1);
  });
}

// Envia o estado completo para as janelas, agrupando alterações próximas (no máximo ~20x/s).
let stateTimer = null;
function pushState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    windows.broadcast('state', publicState());
  }, 50);
}

function notify(payload) {
  windows.broadcast('notify', payload);
}

async function quit() {
  windows.setQuitting(true);
  app.quit();
}

async function start() {
  log.info(`PW Manager ${app.getVersion()} iniciando`);
  store.load();
  registerIpc();

  native.on('status', (s) => {
    if (!s.available && s.reason === 'missing') notify({ type: 'error', message: 'Módulo nativo (PwNative.exe) não encontrado. Rode "npm run build:native".' });
    pushState();
  });
  native.on('foreground', () => pushState());
  native.start();

  game.init();
  party.init();
  presets.init();
  backup.init();
  updater.init();
  hotkeys.register();

  store.on('changed', pushState);
  for (const emitter of [game, party, presets, hotkeys]) {
    emitter.on('changed', pushState);
    emitter.on('notify', notify);
  }
  game.on('foreground', pushState);
  game.on('changed', () => {
    // Personagem fechou: se o Sync ficou com menos de 2 janelas, desliga.
    if (party.sync.on && party.memberHwnds(party.sync.groupId).length < 2) {
      party.stopSync().then(() => notify({ type: 'warning', message: 'Sync action desligado: menos de 2 personagens jogando.' }));
    }
  });

  windows.createMainWindow();
  windows.createTray({
    stopSync: () => party.stopSync(),
    stopPresets: () => presets.stopAll(),
    quit,
  });

  if (process.env.PW_SELFTEST) {
    const { runSelfTest } = await import('./selftest.js');
    runSelfTest().finally(() => quit());
  }
}

app.on('window-all-closed', () => {
  // Com bandeja ativa o app continua; sem bandeja, fecha.
  if (!store.settings.closeToTray) app.quit();
});

app.on('before-quit', () => {
  windows.setQuitting(true);
});

app.on('will-quit', () => {
  hotkeys.dispose();
  game.dispose();
  backup.dispose();
  native.stop();
  try {
    store.flush();
  } catch (err) {
    log.error('falha ao salvar ao sair', err);
  }
});
