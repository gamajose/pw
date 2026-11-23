// Tela "Sobre" e Central de Atualizações do PW Manager.
import { call, onEvent } from '../api.js';
import { esc, toast, run } from '../ui.js';

let unlistenUpdater = null;
let updaterState = {
  checking: false,
  available: false,
  downloaded: false,
  progress: 0,
  version: '1.0.0',
  latestVersion: null,
  error: null,
};

export async function mount(root, st) {
  try {
    updaterState = await call('updater:state');
  } catch {
    updaterState = {
      checking: false,
      available: false,
      downloaded: false,
      progress: 0,
      version: st?.app?.version || '1.0.0',
      latestVersion: null,
      error: null,
    };
  }

  unlistenUpdater = onEvent('updater:status', (s) => {
    updaterState = s;
    renderStatusBadge();
  });

  const updaterCfg = st?.settings?.updater || { autoCheck: true, feedUrl: '' };

  root.innerHTML = `
    <div class="view-header"><h1>Sobre & Atualizações</h1></div>

    <!-- Card de Informações do Aplicativo -->
    <div class="panel mb-3"><div class="panel-body">
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="brand-logo" style="width:56px;height:56px;font-size:1.8rem"><i class="bi bi-controller"></i></span>
        <div>
          <h4 class="m-0">PW Manager</h4>
          <div class="text-body-secondary">Versão instalada: <strong class="text-primary">v${esc(st.app.version)}</strong></div>
        </div>
      </div>
      <p>Gerenciador de contas, multi-cliente e automações para servidores de Perfect World.
      Desenvolvido com arquitetura moderna e segura sem dependências de nuvem proprietária.</p>
      <ul class="small">
        <li><strong>Interface:</strong> Electron + Bootstrap 5 (HTML/CSS/JavaScript modular).</li>
        <li><strong>Módulo nativo:</strong> PwNative.exe (C# / .NET 9, Win32 API): janelas, teclado, mouse, alinhamento de câmera e memória.</li>
        <li><strong>Segurança:</strong> Senhas protegidas pelo Windows via criptografia DPAPI local.</li>
      </ul>
      <div class="alert alert-warning small mb-0">
        Automação de clientes pode violar os termos de uso de servidores oficiais.
        Use somente em servidores próprios/locais ou onde for expressamente permitido.
      </div>
    </div></div>

    <!-- Card de Atualização Automática -->
    <div class="panel mb-3"><div class="panel-body">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h5 class="m-0"><i class="bi bi-arrow-repeat text-success"></i> Atualização Automática de Software</h5>
          <div class="text-body-secondary small">O PW Manager pode verificar, baixar e aplicar novas versões automaticamente.</div>
        </div>
        <div id="updater-badge-container"></div>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-md-7">
          <label class="form-label small text-body-secondary mb-1">Servidor de Atualizações (URL ou Repositório GitHub)</label>
          <div class="input-group input-group-sm">
            <span class="input-group-text"><i class="bi bi-cloud-arrow-down"></i></span>
            <input type="text" class="form-control" id="updater-feed-url" placeholder="https://seu-servidor/updates ou usuario/repo" value="${esc(updaterCfg.feedUrl || '')}">
            <button class="btn btn-outline-secondary" id="btn-save-feed">Salvar</button>
          </div>
          <div class="form-text" style="font-size: 0.75rem;">
            Pode ser uma URL HTTP/HTTPS (ex: <code>http://192.168.1.10:8080/updates</code>) ou um repositório GitHub público (ex: <code>usuario/pw-manager</code>).
          </div>
        </div>

        <div class="col-md-5 d-flex flex-column justify-content-end">
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="updater-autocheck" ${updaterCfg.autoCheck !== false ? 'checked' : ''}>
            <label class="form-check-label small" for="updater-autocheck">Buscar atualizações ao iniciar o aplicativo</label>
          </div>
        </div>
      </div>

      <div class="d-flex gap-2 align-items-center">
        <button class="btn btn-primary btn-sm" id="btn-check-update">
          <i class="bi bi-arrow-clockwise"></i> Verificar Agora
        </button>
        <button class="btn btn-success btn-sm" id="btn-install-update" style="display: none;">
          <i class="bi bi-box-arrow-in-down"></i> Reiniciar e Atualizar Agora
        </button>
        <span class="text-body-secondary small ms-2" id="updater-last-check"></span>
      </div>
    </div></div>

    <!-- Ações e Pastas do Sistema -->
    <div class="panel"><div class="panel-body d-flex gap-2 flex-wrap">
      <button class="btn btn-outline-secondary btn-sm" data-act="logs"><i class="bi bi-journal-text"></i> Abrir pasta de logs</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="data"><i class="bi bi-folder2-open"></i> Abrir pasta de dados</button>
    </div></div>
  `;

  bindEvents(root);
  renderStatusBadge();
}

export function unmount() {
  if (unlistenUpdater) {
    unlistenUpdater();
    unlistenUpdater = null;
  }
}

function renderStatusBadge() {
  const container = document.getElementById('updater-badge-container');
  const btnInstall = document.getElementById('btn-install-update');
  const btnCheck = document.getElementById('btn-check-update');
  const lastCheckEl = document.getElementById('updater-last-check');
  if (!container) return;

  if (updaterState.downloaded) {
    container.innerHTML = `<span class="badge text-bg-success fs-6"><i class="bi bi-check-circle-fill"></i> Atualização v${esc(updaterState.latestVersion)} Pronta!</span>`;
    if (btnInstall) btnInstall.style.display = 'inline-block';
    if (btnCheck) btnCheck.disabled = true;
  } else if (updaterState.checking) {
    container.innerHTML = `<span class="badge text-bg-info fs-6"><span class="spinner-border spinner-border-sm me-1"></span> Buscando atualizações...</span>`;
    if (btnCheck) btnCheck.disabled = true;
  } else if (updaterState.available) {
    container.innerHTML = `<span class="badge text-bg-warning fs-6 text-dark"><i class="bi bi-download"></i> Baixando v${esc(updaterState.latestVersion)} (${updaterState.progress}%)</span>`;
    if (btnCheck) btnCheck.disabled = true;
  } else if (updaterState.error) {
    container.innerHTML = `<span class="badge text-bg-secondary fs-6 text-truncate" style="max-width: 250px;" title="${esc(updaterState.error)}"><i class="bi bi-info-circle"></i> Sem atualizações disponíveis</span>`;
    if (btnCheck) btnCheck.disabled = false;
  } else {
    container.innerHTML = `<span class="badge text-bg-secondary fs-6"><i class="bi bi-shield-check"></i> Versão mais recente</span>`;
    if (btnCheck) btnCheck.disabled = false;
  }

  if (lastCheckEl && updaterState.lastCheck) {
    const timeStr = new Date(updaterState.lastCheck).toLocaleTimeString();
    lastCheckEl.textContent = `Última checagem: ${timeStr}`;
  }
}

function bindEvents(root) {
  root.querySelector('[data-act=logs]')?.addEventListener('click', () => run(() => call('app:open-logs')));
  root.querySelector('[data-act=data]')?.addEventListener('click', () => run(() => call('app:open-data')));

  // Salvar configuração de feed
  document.getElementById('btn-save-feed')?.addEventListener('click', () => {
    run(async () => {
      const feedUrl = document.getElementById('updater-feed-url')?.value;
      const autoCheck = document.getElementById('updater-autocheck')?.checked;
      await call('updater:save-config', { feedUrl, autoCheck });
    }, 'Configuração do atualizador salva!');
  });

  // Alternar autoCheck
  document.getElementById('updater-autocheck')?.addEventListener('change', (e) => {
    run(async () => {
      await call('updater:save-config', { autoCheck: e.target.checked });
    });
  });

  // Botão verificar atualizações
  document.getElementById('btn-check-update')?.addEventListener('click', () => {
    run(
      async () => {
        const res = await call('updater:check');
        if (!res) {
          toast('Nenhuma atualização nova encontrada.', 'info');
        }
      },
      null,
      (err) => toast('Erro ao verificar atualizações: ' + err.message, 'warn'),
    );
  });

  // Botão instalar atualização baixada
  document.getElementById('btn-install-update')?.addEventListener('click', () => {
    run(async () => {
      await call('updater:install');
    });
  });
}
