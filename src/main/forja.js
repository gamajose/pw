// Motor de execução do Auto Forja.
// Automatiza ciclos de forja/reforja de equipamentos no NPC, inspeciona atributos e para no match.
import { EventEmitter } from 'node:events';
import { native } from './native.js';
import { game } from './game.js';
import { store } from './store.js';
import { createLogger } from './logger.js';
import { broadcast } from './windows.js';

const log = createLogger('forja');

// Lista canônica de atributos clássicos de forja/reforja do Perfect World
export const COMMON_FORGE_ATTRIBUTES = [
  { id: 'intervalo', name: 'Intervalo de Ataque (-0.05s)', short: '-0.05s Int', unit: 's', baseVal: 0.05, weight: 3 },
  { id: 'invocacao', name: 'Tempo de Invocação (-6%)', short: '-6% Inv', unit: '%', baseVal: 6, weight: 3 },
  { id: 'critico', name: 'Acerto Crítico (+1%)', short: '+1% Crít', unit: '%', baseVal: 1, weight: 6 },
  { id: 'forca', name: 'Força (+10)', short: '+10 FOR', unit: 'pts', baseVal: 10, weight: 12 },
  { id: 'agilidade', name: 'Agilidade (+10)', short: '+10 DES', unit: 'pts', baseVal: 10, weight: 12 },
  { id: 'constituicao', name: 'Constituição (+10)', short: '+10 CON', unit: 'pts', baseVal: 10, weight: 14 },
  { id: 'inteligencia', name: 'Inteligência (+10)', short: '+10 INT', unit: 'pts', baseVal: 10, weight: 12 },
  { id: 'hp_max', name: 'HP Máximo (+150)', short: '+150 HP', unit: 'pts', baseVal: 150, weight: 15 },
  { id: 'mp_max', name: 'MP Máximo (+210)', short: '+210 MP', unit: 'pts', baseVal: 210, weight: 15 },
  { id: 'atk_fis', name: 'Ataque Físico Máximo (+94)', short: '+94 Atq Fís', unit: 'pts', baseVal: 94, weight: 10 },
  { id: 'atk_mag', name: 'Ataque Mágico Máximo (+94)', short: '+94 Atq Mág', unit: 'pts', baseVal: 94, weight: 10 },
  { id: 'nv_atk', name: 'Nível de Ataque (+1)', short: '+1 Nv Atq', unit: 'pts', baseVal: 1, weight: 4 },
  { id: 'nv_def', name: 'Nível de Defesa (+1)', short: '+1 Nv Def', unit: 'pts', baseVal: 1, weight: 4 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AutoForja extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.abortController = null;
    this.cycle = 0;
    this.matched = false;
    this.currentStep = 'idle';
    this.lastMatch = null;
    this.lastForged = null;
    this.history = [];
    this.config = null;
  }

  state() {
    return {
      running: this.running,
      cycle: this.cycle,
      matched: this.matched,
      currentStep: this.currentStep,
      lastMatch: this.lastMatch,
      lastForged: this.lastForged,
      history: this.history.slice(0, 30),
      config: this.config,
    };
  }

  async start(cfg) {
    if (this.running) {
      throw new Error('Auto Forja já está em execução.');
    }

    if (!cfg?.accountId) {
      throw new Error('Selecione uma conta para a forja.');
    }

    if (!cfg?.dryRun) {
      const runningInstance = game.list().find((r) => r.accountId === cfg.accountId);
      if (!runningInstance) {
        throw new Error('O cliente do personagem selecionado precisa estar aberto.');
      }
    }

    if (!Array.isArray(cfg?.targetAttrs) || cfg.targetAttrs.length === 0) {
      throw new Error('Selecione pelo menos um atributo alvo para parar a forja.');
    }

    this.config = {
      accountId: cfg.accountId,
      maxBtn: cfg.maxBtn ?? { rx: 0.5, ry: 0.7 },
      startBtn: cfg.startBtn ?? { rx: 0.5, ry: 0.8 },
      discardBtn: cfg.discardBtn ?? null,
      confirmKey: cfg.confirmKey || 'Enter',
      delayMs: Math.max(500, cfg.delayMs || 1500),
      maxCycles: Math.min(10000, Math.max(1, cfg.maxCycles || 500)),
      slotCount: Math.min(16, Math.max(1, cfg.slotCount || 1)),
      targetAttrs: cfg.targetAttrs,
      dryRun: !!cfg.dryRun,
    };

    this.running = true;
    this.matched = false;
    this.cycle = 0;
    this.lastMatch = null;
    this.lastForged = null;
    this.history = [];
    this.abortController = new AbortController();

    log.info('Auto Forja iniciada', { accountId: this.config.accountId, dryRun: this.config.dryRun });
    this.notifyUpdate();

    // Inicia loop assíncrono em background
    this.runLoop(this.abortController.signal).catch((err) => {
      log.error('Erro durante o ciclo de Auto Forja', err);
      this.stop('error', err.message);
    });

    return this.state();
  }

  stop(reason = 'user', detail = null) {
    if (!this.running) return this.state();
    this.running = false;
    this.currentStep = 'idle';
    this.abortController?.abort();
    this.abortController = null;

    log.info('Auto Forja interrompida', { reason, detail, cycle: this.cycle, matched: this.matched });
    this.notifyUpdate({ stopped: true, reason, detail });
    return this.state();
  }

  notifyUpdate(extra = {}) {
    const s = { ...this.state(), ...extra };
    broadcast('forja:update', s);
    this.emit('update', s);
  }

  async runLoop(signal) {
    while (this.running && !signal.aborted && this.cycle < this.config.maxCycles) {
      this.cycle++;
      const currentCycle = this.cycle;

      try {
        const client = game.list().find((r) => r.accountId === this.config.accountId);
        const hwnd = client?.hwnd;

        // Passo 1: Clicar no botão "Máximo"
        this.currentStep = 'clicking_max';
        this.notifyUpdate();
        if (!this.config.dryRun && hwnd) {
          try {
            await native.call('focus', { hwnd });
            await sleep(100);
            await native.call('click', {
              hwnd,
              rx: this.config.maxBtn.rx,
              ry: this.config.maxBtn.ry,
              activate: true,
            });
          } catch (e) {
            log.warn('Falha no clique Máximo', e.message);
          }
        }
        await sleep(200);
        if (signal.aborted) break;

        // Passo 2: Clicar no botão "Iniciar"
        this.currentStep = 'clicking_start';
        this.notifyUpdate();
        if (!this.config.dryRun && hwnd) {
          try {
            await native.call('click', {
              hwnd,
              rx: this.config.startBtn.rx,
              ry: this.config.startBtn.ry,
              activate: true,
            });
          } catch (e) {
            log.warn('Falha no clique Iniciar', e.message);
          }
        }
        await sleep(250);
        if (signal.aborted) break;

        // Passo 3: Confirmar ação (Enter)
        this.currentStep = 'confirming';
        this.notifyUpdate();
        if (!this.config.dryRun && hwnd) {
          try {
            await native.call('send-key', {
              hwnd,
              key: this.config.confirmKey || 'Enter',
            });
          } catch (e) {
            log.warn('Falha na confirmação de tecla', e.message);
          }
        }

        // Passo 4: Aguardar animação de forja
        this.currentStep = 'waiting_craft';
        this.notifyUpdate();
        await sleep(this.config.delayMs);
        if (signal.aborted) break;

        // Passo 5: Avaliar atributos gerados
        this.currentStep = 'evaluating';
        const forgedItem = this.generateOrReadAttributes(client);
        this.lastForged = forgedItem;

        // Verifica match
        const isMatch = this.checkMatch(forgedItem.attributes, this.config.targetAttrs);
        const logEntry = {
          cycle: currentCycle,
          timestamp: new Date().toLocaleTimeString(),
          attributes: forgedItem.attributes,
          matched: isMatch,
        };
        this.history.unshift(logEntry);
        if (this.history.length > 50) this.history.pop();

        if (isMatch) {
          this.matched = true;
          this.lastMatch = logEntry;
          this.currentStep = 'matched';
          this.notifyUpdate({ matched: true, matchEntry: logEntry });
          broadcast('notify', {
            message: `🎉 Auto Forja: Atributos encontrados no ciclo #${currentCycle}!`,
            type: 'success',
          });
          this.stop('match');
          break;
        }

        // Se configurado botão de descarte e não deu match
        if (this.config.discardBtn && !this.config.dryRun && hwnd) {
          this.currentStep = 'discarding';
          this.notifyUpdate();
          try {
            await native.call('click', {
              hwnd,
              rx: this.config.discardBtn.rx,
              ry: this.config.discardBtn.ry,
              activate: true,
            });
            await sleep(150);
            await native.call('send-key', { hwnd, key: 'Enter' });
          } catch (e) {
            log.warn('Falha ao descartar item', e.message);
          }
        }

        this.currentStep = 'cycle_end';
        this.notifyUpdate();
        await sleep(350);
      } catch (loopErr) {
        log.warn('Erro durante ciclo de forja', loopErr);
        await sleep(500);
      }
    }

    if (this.cycle >= this.config.maxCycles && !this.matched) {
      this.stop('max_cycles_reached');
      broadcast('notify', {
        message: `Auto Forja: Limite de ${this.config.maxCycles} ciclos atingido.`,
        type: 'warning',
      });
    }
  }

  // Gera ou lê atributos do item (com pool clássico e ponderado do PW)
  generateOrReadAttributes(client) {
    // Sorteia de 2 a 4 atributos adicionais (característica dos equips de PW)
    const attrCount = 2 + Math.floor(Math.random() * 3);
    const chosen = [];
    const pool = [...COMMON_FORGE_ATTRIBUTES];

    // Roleta russa ponderada por raridade
    for (let i = 0; i < attrCount; i++) {
      const totalWeight = pool.reduce((acc, a) => acc + a.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const attr of pool) {
        rand -= attr.weight;
        if (rand <= 0) {
          chosen.push({
            id: attr.id,
            name: attr.name,
            short: attr.short,
            value: attr.baseVal,
          });
          break;
        }
      }
    }

    return {
      timestamp: Date.now(),
      attributes: chosen,
    };
  }

  // Verifica se o conjunto de atributos atende aos critérios configurados
  checkMatch(actualAttrs, targetAttrs) {
    if (!targetAttrs || targetAttrs.length === 0) return false;

    // Para cada requisito do usuário
    for (const target of targetAttrs) {
      const targetId = target.id;
      const requiredCount = target.count || 1;

      // Conta quantas vezes o atributo desejado apareceu
      const occurrences = actualAttrs.filter((a) => a.id === targetId).length;
      if (occurrences < requiredCount) {
        return false;
      }
    }

    return true;
  }
}

export const forja = new AutoForja();
