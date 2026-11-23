// Tela de configurações. Cada campo é salvo assim que muda (data-path = caminho na configuração).
import { call, getState } from '../api.js';
import { esc, run, toast, hotkeyInput, dateTime, confirmDialog } from '../ui.js';

const ui = { root: null, tab: 'general' };

const TABS = {
  general: 'Geral',
  login: 'Login e abertura',
  party: 'Modo grupo',
  sync: 'Sync action',
  performance: 'Desempenho & Ferramentas',
  hotkeys: 'Atalhos',
  backup: 'Backup',
};

function get(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function patchFor(path, value) {
  const keys = path.split('.');
  const out = {};
  let cur = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = cur[k] = {};
  });
  return out;
}

const sw = (path, label, desc = '') => `
  <div class="form-check form-switch mb-3">
    <input class="form-check-input" type="checkbox" role="switch" id="s-${path}" data-path="${path}">
    <label class="form-check-label" for="s-${path}">${label}</label>
    ${desc ? `<div class="form-text mt-0">${desc}</div>` : ''}
  </div>`;

const select = (path, label, options, desc = '') => `
  <div class="mb-3">
    <label class="form-label" for="s-${path}">${label}</label>
    <select class="form-select" id="s-${path}" data-path="${path}" style="max-width:340px">
      ${options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
    </select>
    ${desc ? `<div class="form-text">${desc}</div>` : ''}
  </div>`;

const number = (path, label, { min = 0, max = 100000, step = 1, suffix = '' } = {}, desc = '') => `
  <div class="mb-3">
    <label class="form-label" for="s-${path}">${label}</label>
    <div class="input-group" style="max-width:220px">
      <input class="form-control" type="number" id="s-${path}" data-path="${path}" min="${min}" max="${max}" step="${step}">
      ${suffix ? `<span class="input-group-text">${suffix}</span>` : ''}
    </div>
    ${desc ? `<div class="form-text">${desc}</div>` : ''}
  </div>`;

const text = (path, label, desc = '') => `
  <div class="mb-3">
    <label class="form-label" for="s-${path}">${label}</label>
    <input class="form-control" id="s-${path}" data-path="${path}" style="max-width:420px">
    ${desc ? `<div class="form-text">${desc}</div>` : ''}
  </div>`;

function tabHtml(tab, st) {
  switch (tab) {
    case 'general':
      return `
        ${select('theme', 'Tema', [['dark', 'Escuro'], ['light', 'Claro']])}
        ${sw('streamerMode', 'Modo Streamer', 'Esconde login e personagem das contas e bloqueia mostrar senhas. Copiar continua liberado.')}
        ${sw('closeToTray', 'Fechar para a bandeja', 'Ao fechar a janela, o PW Manager continua rodando ao lado do relógio (atalhos e Sync continuam ativos).')}
        ${sw('renameWindows', 'Renomear janelas do jogo', 'Coloca o nome do personagem no título de cada cliente, para achar fácil na barra de tarefas.')}
        ${text('windowTitleFormat', 'Formato do título', 'Variáveis: {character} {account} {server}')}`;
    case 'login':
      return `
        <h6>Digitar login no jogo</h6>
        ${select('typing.method', 'Método de digitação', [
          ['unicode', 'Unicode (recomendado)'],
          ['vk', 'Teclas virtuais (para servidores que ignoram Unicode)'],
          ['post', 'Mensagens em segundo plano (não precisa de foco)'],
        ])}
        ${number('typing.charDelayMs', 'Atraso entre caracteres', { min: 0, max: 500, suffix: 'ms' })}
        ${sw('typing.pressEnter', 'Pressionar Enter depois da senha')}
        <hr>
        <h6>Abertura dos clientes</h6>
        ${number('launch.delayBetweenMs', 'Intervalo ao abrir vários clientes', { min: 0, max: 60000, step: 100, suffix: 'ms' })}
        ${sw('launch.autoTypeLogin', 'Digitar login automaticamente após abrir', 'Útil quando o servidor não aceita login pelos argumentos (startbypatcher).')}
        ${number('launch.autoTypeDelayMs', 'Esperar antes de digitar', { min: 1000, max: 120000, step: 500, suffix: 'ms' }, 'Tempo para a tela de login carregar.')}`;
    case 'party':
      return `
        ${sw('party.numpadSwitch', 'Escolher personagem pelo teclado numérico', 'Num 1–9 e Num 0 (10º) focam o personagem daquela posição do grupo ativo. As teclas numéricas sozinhas ficam reservadas enquanto ligado.')}
        ${select('party.changeWith', 'Troca de personagem (janela do grupo) com', [['single', 'Clique simples'], ['double', 'Clique duplo']])}
        ${sw('party.showClass', 'Mostrar classe do personagem')}
        ${sw('party.showPosition', 'Mostrar número das posições')}
        ${sw('party.miniAlwaysOnTop', 'Janela do grupo sempre no topo')}
        ${sw('presets.requireFocus', 'Presets por atalho só com o jogo ou o PW Manager em foco')}
        <div class="mb-3">
          <div class="form-label">Janela do grupo fora da tela?</div>
          <button class="btn btn-outline-secondary btn-sm" data-act="reset-mini"><i class="bi bi-arrow-counterclockwise"></i> Resetar posição</button>
        </div>`;
    case 'sync':
      return `
        <p class="text-body-secondary">Repete no grupo o que você faz no personagem em foco. Liga e desliga na tela do grupo, na janela do grupo ou pelo atalho.</p>
        ${select('sync.mode', 'O que espelhar', [['keys', 'Cliques e teclas'], ['clicks', 'Só cliques']],
          'Teclas espelhadas: F1–F12, 0–9, A–Z, Tab e Espaço, sem Shift, Ctrl ou Alt. Atalhos do PW Manager nunca são espelhados. Tab e Espaço só vão para janelas que não estão minimizadas.')}
        ${sw('sync.chatPause', 'Pausar teclas com Enter (chat)', 'Outro Enter ou Esc retoma.')}
        ${sw('sync.clickActivation', 'Ativar a janela para o clique', 'Para servidores que ignoram clique em janela inativa.')}`;
    case 'performance':
      return `
        <h6>Otimização de Recursos</h6>
        ${sw('performanceMode', 'Modo Desempenho (CPU Throttling)', 'Limita o processamento dos clientes em segundo plano via pausas programadas.')}
        ${select('presetEngine', 'Motor de Presets', [['v2', 'Motor V2 (Novo, com cancelamento atômico e heartbeat)'], ['classic', 'Motor Clássico']])}
        <hr>
        <h6>Ferramentas de Alinhamento e Diagnóstico</h6>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button class="btn btn-outline-info btn-sm" data-act="open-grid"><i class="bi bi-grid-3x3 me-1"></i> Grid de Alinhamento HUD</button>
          <button class="btn btn-outline-primary btn-sm" data-act="open-synclog"><i class="bi bi-speedometer2 me-1"></i> Diagnóstico & Log</button>
          <button class="btn btn-outline-secondary btn-sm" data-act="open-toolbar"><i class="bi bi-layout-sidebar me-1"></i> Barra Flutuante</button>
          <button class="btn btn-outline-secondary btn-sm" data-act="open-search"><i class="bi bi-search me-1"></i> Busca Rápida (Ctrl+Space)</button>
        </div>`;
    case 'hotkeys':
      return `
        <p class="text-body-secondary">Atalhos globais funcionam mesmo com o jogo em foco. Clique no campo e pressione a combinação (Backspace limpa).</p>
        <div class="row g-3" style="max-width:720px">
          ${Object.entries(st.app.hotkeyLabels)
            .map(
              ([k, label]) => `
            <div class="col-md-7 d-flex align-items-center">${esc(label)}</div>
            <div class="col-md-5"><input class="form-control form-control-sm" data-hotkey="${k}"></div>`,
            )
            .join('')}
        </div>
        <div id="hk-failures" class="mt-3"></div>
        <p class="small text-body-secondary mt-3">Os atalhos de cada preset são configurados no próprio preset.</p>`;
    case 'backup':
      return `
        ${sw('backup.enabled', 'Backup automático')}
        ${select('backup.intervalHours', 'Intervalo de backup', [['1', 'A cada 1 hora'], ['4', 'A cada 4 horas'], ['8', 'A cada 8 horas'], ['12', 'A cada 12 horas'], ['24', 'A cada 1 dia']])}
        ${number('backup.keep', 'Quantidade de backups guardados', { min: 1, max: 500 })}
        <div class="mb-3">
          <label class="form-label">Caminho do backup</label>
          <div class="input-group" style="max-width:560px">
            <input class="form-control" id="bk-path" readonly>
            <button class="btn btn-outline-secondary" data-act="bk-choose"><i class="bi bi-folder2"></i> Alterar</button>
            <button class="btn btn-outline-secondary" data-act="bk-open"><i class="bi bi-box-arrow-up-right"></i> Abrir</button>
          </div>
          <div class="form-text" id="bk-last"></div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-primary btn-sm" data-act="bk-now"><i class="bi bi-cloud-arrow-up"></i> Fazer backup agora</button>
          <button class="btn btn-outline-warning btn-sm" data-act="bk-restore"><i class="bi bi-cloud-arrow-down"></i> Restaurar backup…</button>
        </div>
        <div class="alert alert-secondary small mt-3 mb-0">As senhas no backup ficam criptografadas com o seu usuário do Windows.
        Para levar contas para outro PC, use <strong>Contas → Exportar</strong> com senhas.</div>`;
    default:
      return '';
  }
}

export function mount(root, st) {
  ui.root = root;
  root.innerHTML = `
    <div class="view-header"><h1>Configurações</h1></div>
    <ul class="nav nav-tabs mb-3" id="set-tabs">
      ${Object.entries(TABS).map(([k, v]) => `<li class="nav-item"><a class="nav-link" href="#" data-tab="${k}">${v}</a></li>`).join('')}
    </ul>
    <div class="panel"><div class="panel-body" id="set-body"></div></div>`;

  root.querySelector('#set-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    e.preventDefault();
    ui.tab = a.dataset.tab;
    renderTab(getState());
  });

  const body = root.querySelector('#set-body');
  body.addEventListener('change', (e) => {
    const path = e.target.dataset.path;
    if (!path) return;
    let value;
    if (e.target.type === 'checkbox') value = e.target.checked;
    else if (e.target.type === 'number' || path === 'backup.intervalHours') value = Number(e.target.value);
    else value = e.target.value;
    run(() => call('settings:save', patchFor(path, value)));
  });
  body.addEventListener('click', onAction);
  renderTab(st);
}

export function unmount() {
  ui.root = null;
}

export function update(st) {
  if (!ui.root) return;
  renderDynamic(st);
}

function renderTab(st) {
  ui.root.querySelectorAll('#set-tabs .nav-link').forEach((a) => a.classList.toggle('active', a.dataset.tab === ui.tab));
  const body = ui.root.querySelector('#set-body');
  body.innerHTML = tabHtml(ui.tab, st);
  body.querySelectorAll('[data-path]').forEach((input) => {
    const v = get(st.settings, input.dataset.path);
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v ?? '';
  });
  body.querySelectorAll('[data-hotkey]').forEach((input) => {
    input.value = st.settings.hotkeys[input.dataset.hotkey] ?? '';
    hotkeyInput(input, (accel) => run(() => call('settings:save', { hotkeys: { [input.dataset.hotkey]: accel } })));
  });
  renderDynamic(st);
}

function renderDynamic(st) {
  const body = ui.root.querySelector('#set-body');
  const fails = body.querySelector('#hk-failures');
  if (fails) {
    fails.innerHTML = st.hotkeyFailures.length
      ? `<div class="alert alert-warning small mb-0"><strong>Atalhos não registrados:</strong><ul class="mb-0">${st.hotkeyFailures
          .map((f) => `<li><span class="kbd">${esc(f.accel)}</span> — ${esc(f.label)}: ${esc(f.reason)}</li>`)
          .join('')}</ul></div>`
      : '';
  }
  const path = body.querySelector('#bk-path');
  if (path) path.value = st.backupFolder;
  const last = body.querySelector('#bk-last');
  if (last) last.textContent = `Último backup: ${dateTime(st.settings.backup.lastAt)}`;
}

async function onAction(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  switch (t.dataset.act) {
    case 'reset-mini':
      return run(() => call('settings:reset-mini-position'), 'Posição da janela do grupo resetada!');
    case 'open-grid':
      return run(() => call('windows:toggle-hud-grid'));
    case 'open-synclog':
      return run(() => call('windows:open-synclog'));
    case 'open-toolbar':
      return run(() => call('windows:open-toolbar'));
    case 'open-search':
      return run(() => call('windows:open-search'));
    case 'bk-choose':
      return run(() => call('backup:choose-folder'));
    case 'bk-open':
      return run(() => call('backup:open-folder'));
    case 'bk-now': {
      const file = await run(() => call('backup:now'));
      if (file) toast('Backup criado:\n' + file, 'success');
      return undefined;
    }
    case 'bk-restore':
      if (await confirmDialog('Restaurar backup', 'Os dados atuais serão substituídos pelo backup escolhido. Um backup do estado atual é feito antes. Continuar?', { confirmLabel: 'Escolher arquivo', danger: false })) {
        const ok = await run(() => call('backup:restore'));
        if (ok) toast('Backup restaurado.', 'success');
      }
      return undefined;
    default:
      return undefined;
  }
}
