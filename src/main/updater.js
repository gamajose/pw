// Módulo de Atualização Automática (Auto-Update).
// Gerencia a verificação, download em segundo plano e instalação automática de novas versões.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;
import { store } from './store.js';
import { createLogger } from './logger.js';
import { broadcast } from './windows.js';

const log = createLogger('updater');

class AppUpdaterService extends EventEmitter {
  constructor() {
    super();
    this.status = {
      checking: false,
      available: false,
      downloaded: false,
      progress: 0,
      version: app.getVersion(),
      latestVersion: null,
      error: null,
      lastCheck: null,
    };
    this.configured = false;
  }

  init() {
    // Configura o comportamento do autoUpdater: download e instalação 100% silenciosos e automáticos
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    this.setupListeners();
    this.applyFeedConfig();

    // Verificação automática ao iniciar o app instalado e a cada 30 minutos
    if (app.isPackaged) {
      setTimeout(() => {
        this.checkForUpdates(true).catch((err) => {
          log.debug('Verificação automática inicial:', err.message);
        });
      }, 5000);

      // Checagem em background a cada 30 minutos
      setInterval(() => {
        this.checkForUpdates(true).catch((err) => {
          log.debug('Verificação automática periódica:', err.message);
        });
      }, 30 * 60 * 1000);
    }
  }

  setupListeners() {
    autoUpdater.on('checking-for-update', () => {
      this.status.checking = true;
      this.status.error = null;
      this.notify();
      log.info('Verificando se há atualizações...');
    });

    autoUpdater.on('update-available', (info) => {
      this.status.checking = false;
      this.status.available = true;
      this.status.latestVersion = info.version;
      this.notify();
      log.info(`Nova versão disponível: v${info.version}`);
      broadcast('notify', {
        message: `Uma nova versão (v${info.version}) foi encontrada e está sendo baixada em segundo plano.`,
        type: 'info',
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.status.checking = false;
      this.status.available = false;
      this.status.latestVersion = info?.version || this.status.version;
      this.status.lastCheck = Date.now();
      this.notify();
      log.info('O aplicativo já está na versão mais recente.');
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.status.progress = Math.round(progressObj.percent || 0);
      this.notify();
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.status.downloaded = true;
      this.status.progress = 100;
      this.status.latestVersion = info.version;
      this.notify();
      log.info(`Atualização v${info.version} baixada com sucesso.`);
      broadcast('notify', {
        message: `🎉 Versão v${info.version} pronta! Ela será instalada automaticamente ao reiniciar o PW Manager.`,
        type: 'success',
      });
    });

    autoUpdater.on('error', (err) => {
      this.status.checking = false;
      this.status.error = err.message || 'Falha ao buscar atualizações.';
      this.notify();
      log.warn('Erro no atualizador automático:', err.message);
    });
  }

  applyFeedConfig() {
    try {
      const feedUrl = store.db.settings?.updater?.feedUrl?.trim();
      if (feedUrl && (feedUrl.startsWith('http://') || feedUrl.startsWith('https://'))) {
        autoUpdater.setFeedURL({
          provider: 'generic',
          url: feedUrl,
        });
        log.info(`Servidor customizado configurado: ${feedUrl}`);
      } else if (feedUrl && feedUrl.includes('/')) {
        const [owner, repo] = feedUrl.split('/');
        autoUpdater.setFeedURL({
          provider: 'github',
          owner,
          repo,
        });
        log.info(`GitHub customizado configurado: ${owner}/${repo}`);
      } else {
        // Padrão oficial: repositório github.com/gamajose/pw
        autoUpdater.setFeedURL({
          provider: 'github',
          owner: 'gamajose',
          repo: 'pw',
        });
        log.info('Repositório oficial configurado: gamajose/pw');
      }
      this.configured = true;
    } catch (e) {
      log.warn('Falha ao aplicar configuração do feed de atualização:', e.message);
    }
  }

  notify() {
    broadcast('updater:status', this.getState());
    this.emit('status', this.getState());
  }

  getState() {
    return { ...this.status, isPackaged: app.isPackaged };
  }

  async checkForUpdates(silent = false) {
    this.status.lastCheck = Date.now();
    this.applyFeedConfig();

    if (!app.isPackaged) {
      log.info('Ambiente de desenvolvimento. Verificação de atualização simulada.');
      this.status.checking = false;
      this.status.available = false;
      this.notify();
      return { isDev: true };
    }

    try {
      return await autoUpdater.checkForUpdates();
    } catch (err) {
      this.status.checking = false;
      this.status.error = err.message;
      this.notify();
      if (!silent) throw err;
      return null;
    }
  }

  // Reinicia o aplicativo e aplica a nova versão imediatamente
  quitAndInstall() {
    if (this.status.downloaded) {
      log.info('Reiniciando aplicativo para aplicar a atualização...');
      autoUpdater.quitAndInstall(false, true);
      return true;
    }
    throw new Error('Nenhuma atualização baixada no momento.');
  }
}

export const updater = new AppUpdaterService();
