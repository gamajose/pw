// Tela de servidores: cadastro do element client, argumentos e estatísticas.
import { call, getState } from '../api.js';
import { esc, run, confirmDialog, CLASS_INFO, classBadge, duration } from '../ui.js';
import { serverForm } from '../forms.js';

const ui = { root: null };

export function mount(root, st) {
  ui.root = root;
  root.innerHTML = `
    <div class="view-header">
      <h1>Lista de servidores</h1>
      <div class="ms-auto"><button class="btn btn-primary btn-sm" data-act="add"><i class="bi bi-plus-lg"></i> Adicionar servidor</button></div>
    </div>
    <div id="srv-list"></div>`;
  root.querySelector('[data-act=add]').addEventListener('click', () => serverForm());
  root.querySelector('#srv-list').addEventListener('click', onClick);
  update(st);
}

export function unmount() {
  ui.root = null;
}

export function update(st) {
  if (!ui.root) return;
  const box = ui.root.querySelector('#srv-list');
  if (!st.servers.length) {
    box.innerHTML = `
      <div class="panel"><div class="empty-state">
        <i class="bi bi-hdd-network big"></i>
        <h5>Ainda não há nenhum servidor</h5>
        <p>Cadastre seu servidor informando o caminho do <span class="kbd">elementclient.exe</span>.</p>
        <button class="btn btn-primary" data-act="add-empty"><i class="bi bi-plus-lg"></i> Adicionar servidor</button>
      </div></div>`;
    return;
  }
  const running = new Set(st.running.map((r) => r.accountId));
  box.innerHTML = st.servers
    .map((s) => {
      const accounts = st.accounts.filter((a) => a.serverId === s.id);
      const active = accounts.filter((a) => !a.archived);
      const playing = accounts.filter((a) => running.has(a.id)).length;
      const hours = accounts.reduce((sum, a) => sum + (a.totalSeconds ?? 0), 0);
      const byClass = Object.keys(CLASS_INFO)
        .map((k) => [k, active.filter((a) => a.characterClass === k).length])
        .filter(([, n]) => n > 0);
      const selected = s.id === st.settings.selectedServerId;
      return `
      <div class="panel mb-3 ${selected ? 'border-primary' : ''}" data-id="${s.id}">
        <div class="panel-header">
          <i class="bi bi-hdd-network"></i>
          <h5 class="m-0">${esc(s.name)}</h5>
          ${selected ? '<span class="badge text-bg-primary">Selecionado</span>' : `<button class="btn btn-sm btn-link" data-act="select">Selecionar</button>`}
          <div class="ms-auto d-flex gap-1">
            <button class="btn btn-sm btn-outline-info" data-act="check-version" title="Verificar versão local do cliente"><i class="bi bi-patch-check"></i> Versão</button>
            <button class="btn btn-sm btn-outline-primary" data-act="open-launcher" title="Abrir launcher/patcher do servidor"><i class="bi bi-box-arrow-up-right"></i> Launcher</button>
            <button class="btn btn-sm btn-outline-secondary" data-act="edit"><i class="bi bi-pencil"></i> Editar</button>
            <button class="btn btn-sm btn-outline-danger btn-icon" data-act="delete" title="Excluir"><i class="bi bi-trash"></i></button>
          </div>
        </div>
        <div class="panel-body">
          <div class="row g-3">
            <div class="col-lg-7">
              <h6 class="text-body-secondary small text-uppercase">Informações gerais</h6>
              <dl class="row small mb-0">
                <dt class="col-sm-3">Element client</dt><dd class="col-sm-9 font-monospace text-break selectable">${esc(s.clientPath)}</dd>
                <dt class="col-sm-3">Argumentos</dt><dd class="col-sm-9 font-monospace text-break selectable">${esc(s.args)}</dd>
                ${s.forceServerName ? `<dt class="col-sm-3">Forçar servidor</dt><dd class="col-sm-9">${esc(s.forceServerName)}</dd>` : ''}
                ${s.description ? `<dt class="col-sm-3">Descrição</dt><dd class="col-sm-9">${esc(s.description)}</dd>` : ''}
              </dl>
            </div>
            <div class="col-lg-5">
              <h6 class="text-body-secondary small text-uppercase">Estatísticas do servidor</h6>
              <div class="d-flex gap-3 mb-2">
                <div><div class="fs-4 fw-bold">${accounts.length}</div><div class="small text-body-secondary">Total de contas</div></div>
                <div><div class="fs-4 fw-bold">${active.length}</div><div class="small text-body-secondary">Contas ativas</div></div>
                <div><div class="fs-4 fw-bold text-success">${playing}</div><div class="small text-body-secondary">Jogando</div></div>
                <div><div class="fs-4 fw-bold">${duration(hours)}</div><div class="small text-body-secondary">Tempo de jogo</div></div>
              </div>
              <div class="d-flex flex-wrap gap-2">
                ${byClass.map(([k, n]) => `<span class="d-inline-flex align-items-center gap-1 small">${classBadge(k)} ${n}</span>`).join('') || '<span class="small text-body-secondary">Sem classes definidas.</span>'}
              </div>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

async function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'add-empty') return serverForm();
  const id = t.closest('[data-id]')?.dataset.id;
  const s = getState().servers.find((x) => x.id === id);
  if (!s) return;
  switch (t.dataset.act) {
    case 'select':
      return run(() => call('servers:select', id));
    case 'check-version':
      return run(async () => {
        const info = await call('element:check-version', id);
        if (!info || !info.exists) toast('Executável do cliente não encontrado no caminho cadastrado.', 'warning');
        else toast(`Versão detectada do cliente: ${info.version ? 'v' + info.version : 'desconhecida'}${info.hasLauncher ? ' (Launcher encontrado)' : ''}`, 'info', 6000);
      });
    case 'open-launcher':
      return run(async () => {
        await call('element:open-launcher', id);
      }, 'Launcher iniciado com sucesso.');
    case 'edit':
      return serverForm(s);
    case 'delete':
      if (await confirmDialog('Excluir servidor', `Excluir o servidor "${s.name}"?`, { confirmLabel: 'Excluir' })) {
        return run(() => call('servers:delete', id), 'Servidor excluído.');
      }
      return undefined;
    default:
      return undefined;
  }
}
