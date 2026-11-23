// Tela de contas: lista, filtros, ordenação, seleção em massa e ações por conta.
import { call, getState } from '../api.js';
import { esc, run, toast, modal, confirmDialog, classBadge, CLASS_INFO, duration, relative, maskText } from '../ui.js';
import { accountForm, accountInfo, serverForm } from '../forms.js';

const ui = {
  search: '',
  tab: 'all',
  filters: { tag: '', cls: '', favorites: false, playing: false, store: false },
  selected: new Set(),
  root: null,
  timer: null,
  dragId: null,
  pending: false,
};

const SORTS = {
  manual: 'Manual',
  asc: 'Nome da conta (A-Z)',
  desc: 'Nome da conta (Z-A)',
  last: 'Últimos jogados',
  fav: 'Favoritos',
  most: 'Mais tempo de jogo',
};

export function mount(root, st) {
  ui.root = root;
  root.innerHTML = `
    <div class="view-header">
      <h1>Contas</h1>
      <span class="badge text-bg-secondary" id="acc-total"></span>
      <div class="ms-auto d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm" data-act="import"><i class="bi bi-box-arrow-in-down"></i> Importar</button>
        <button class="btn btn-outline-secondary btn-sm" data-act="export"><i class="bi bi-box-arrow-up"></i> Exportar</button>
        <button class="btn btn-primary btn-sm" data-act="add"><i class="bi bi-plus-lg"></i> Adicionar conta</button>
      </div>
    </div>

    <div class="panel mb-3">
      <div class="panel-body d-flex flex-wrap gap-2 align-items-center">
        <ul class="nav nav-pills nav-sm me-2" id="acc-tabs">
          <li class="nav-item"><a class="nav-link py-1 px-3" href="#" data-tab="all">Todas</a></li>
          <li class="nav-item"><a class="nav-link py-1 px-3" href="#" data-tab="archived">Arquivadas</a></li>
        </ul>
        <div class="input-group input-group-sm" style="max-width:260px">
          <span class="input-group-text"><i class="bi bi-search"></i></span>
          <input class="form-control" id="acc-search" placeholder="Buscar personagem" value="${esc(ui.search)}">
        </div>
        <select class="form-select form-select-sm" id="acc-tag" style="max-width:160px"></select>
        <select class="form-select form-select-sm" id="acc-cls" style="max-width:170px"></select>
        <div class="btn-group btn-group-sm" role="group">
          <input type="checkbox" class="btn-check" id="f-fav" ${ui.filters.favorites ? 'checked' : ''}>
          <label class="btn btn-outline-secondary" for="f-fav" title="Somente favoritos"><i class="bi bi-star"></i></label>
          <input type="checkbox" class="btn-check" id="f-play" ${ui.filters.playing ? 'checked' : ''}>
          <label class="btn btn-outline-secondary" for="f-play" title="Jogando"><i class="bi bi-play-circle"></i></label>
          <input type="checkbox" class="btn-check" id="f-store" ${ui.filters.store ? 'checked' : ''}>
          <label class="btn btn-outline-secondary" for="f-store" title="Somente lojas"><i class="bi bi-shop"></i></label>
        </div>
        <select class="form-select form-select-sm ms-auto" id="acc-sort" style="max-width:200px" title="Ordenação">
          ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="acc-bulk" class="alert alert-primary d-none py-2 d-flex align-items-center gap-2 flex-wrap"></div>
    <div class="panel"><div id="acc-list"></div></div>`;

  root.querySelector('[data-act=add]').addEventListener('click', () => accountForm());
  root.querySelector('[data-act=import]').addEventListener('click', () =>
    run(async () => {
      const r = await call('accounts:import');
      if (r.imported) toast(`${r.imported} conta(s) importada(s).`, 'success');
    }),
  );
  root.querySelector('[data-act=export]').addEventListener('click', exportDialog);

  root.querySelector('#acc-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    e.preventDefault();
    ui.tab = a.dataset.tab;
    ui.selected.clear();
    update(getState());
  });
  root.querySelector('#acc-search').addEventListener('input', (e) => {
    ui.search = e.target.value;
    renderList(getState());
  });
  root.querySelector('#acc-tag').addEventListener('change', (e) => {
    ui.filters.tag = e.target.value;
    renderList(getState());
  });
  root.querySelector('#acc-cls').addEventListener('change', (e) => {
    ui.filters.cls = e.target.value;
    renderList(getState());
  });
  for (const [id, key] of [['f-fav', 'favorites'], ['f-play', 'playing'], ['f-store', 'store']]) {
    root.querySelector('#' + id).addEventListener('change', (e) => {
      ui.filters[key] = e.target.checked;
      renderList(getState());
    });
  }
  root.querySelector('#acc-sort').addEventListener('change', (e) => run(() => call('settings:save', { accountSort: e.target.value })));

  const list = root.querySelector('#acc-list');
  list.addEventListener('click', onListClick);
  list.addEventListener('change', onListChange);
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('dragleave', (e) => e.target.closest('tr')?.classList.remove('drop-before'));
  list.addEventListener('drop', onDrop);
  list.addEventListener('hidden.bs.dropdown', () => {
    if (ui.pending) setTimeout(() => renderList(getState()), 0);
  });
  list.addEventListener('dragend', () => list.querySelectorAll('.dragging,.drop-before').forEach((n) => n.classList.remove('dragging', 'drop-before')));
  root.querySelector('#acc-bulk').addEventListener('click', onBulkClick);

  ui.timer = setInterval(() => renderList(getState()), 30000);
  update(st);
}

export function unmount() {
  clearInterval(ui.timer);
  ui.root = null;
}

export function update(st) {
  if (!ui.root) return;
  const r = ui.root;
  r.querySelectorAll('#acc-tabs .nav-link').forEach((a) => a.classList.toggle('active', a.dataset.tab === ui.tab));
  r.querySelector('#acc-sort').value = st.settings.accountSort;

  const tags = [...new Set(serverAccounts(st).map((a) => a.tag).filter(Boolean))].sort();
  if (ui.filters.tag && !tags.includes(ui.filters.tag)) ui.filters.tag = '';
  r.querySelector('#acc-tag').innerHTML =
    `<option value="">Todas as tags</option>` + tags.map((t) => `<option ${t === ui.filters.tag ? 'selected' : ''}>${esc(t)}</option>`).join('');
  r.querySelector('#acc-cls').innerHTML =
    `<option value="">Todas as classes</option>` +
    Object.entries(CLASS_INFO)
      .map(([k, v]) => `<option value="${k}" ${k === ui.filters.cls ? 'selected' : ''}>${esc(v.name)}</option>`)
      .join('');
  renderList(st);
}

// ------------------------------------------------------------------ dados

function serverAccounts(st) {
  return st.accounts.filter((a) => a.serverId === st.settings.selectedServerId);
}

function visibleAccounts(st) {
  const running = new Map(st.running.map((r) => [r.accountId, r]));
  const q = ui.search.trim().toLowerCase();
  let list = serverAccounts(st).filter((a) => (ui.tab === 'archived' ? a.archived : !a.archived));
  if (q) list = list.filter((a) => [a.name, a.character, a.login, a.tag].some((v) => v && v.toLowerCase().includes(q)));
  if (ui.filters.tag) list = list.filter((a) => a.tag === ui.filters.tag);
  if (ui.filters.cls) list = list.filter((a) => a.characterClass === ui.filters.cls);
  if (ui.filters.favorites) list = list.filter((a) => a.favorite);
  if (ui.filters.playing) list = list.filter((a) => running.has(a.id));
  if (ui.filters.store) list = list.filter((a) => a.characterClass === 'STORE');

  const byName = (x, y) => x.name.localeCompare(y.name, 'pt-BR', { sensitivity: 'base' });
  switch (st.settings.accountSort) {
    case 'asc':
      list.sort(byName);
      break;
    case 'desc':
      list.sort((x, y) => byName(y, x));
      break;
    case 'last':
      list.sort((x, y) => (y.lastPlayedAt ?? 0) - (x.lastPlayedAt ?? 0));
      break;
    case 'fav':
      list.sort((x, y) => Number(y.favorite) - Number(x.favorite) || (x.order ?? 0) - (y.order ?? 0));
      break;
    case 'most':
      list.sort((x, y) => (y.totalSeconds ?? 0) - (x.totalSeconds ?? 0));
      break;
    default:
      list.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  }
  return { list, running };
}

// ------------------------------------------------------------------ renderização

function renderList(st) {
  if (!ui.root) return;
  const container = ui.root.querySelector('#acc-list');
  // Não redesenha com um menu aberto (fecharia o menu); redesenha quando ele fechar.
  if (container.querySelector('.dropdown-menu.show')) {
    ui.pending = true;
    return;
  }
  ui.pending = false;
  const total = serverAccounts(st).filter((a) => !a.archived).length;
  ui.root.querySelector('#acc-total').textContent = `${total} ${total === 1 ? 'conta' : 'contas'}`;

  if (!st.settings.selectedServerId) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-hdd-network big"></i>
        <h5>Selecione um servidor</h5>
        <p>Cadastre ou selecione um servidor para ver as contas dele.</p>
        <button class="btn btn-primary" data-act="new-server"><i class="bi bi-plus-lg"></i> Adicionar servidor</button>
      </div>`;
    return;
  }

  const { list, running } = visibleAccounts(st);
  // Remove da seleção contas que não estão mais visíveis.
  const visibleIds = new Set(list.map((a) => a.id));
  for (const id of [...ui.selected]) if (!visibleIds.has(id)) ui.selected.delete(id);

  if (list.length === 0) {
    const noAccounts = serverAccounts(st).length === 0;
    container.innerHTML = noAccounts
      ? `<div class="empty-state">
          <i class="bi bi-person-plus big"></i>
          <h5>Ainda não há nenhuma conta!</h5>
          <p>Para começar, adicione uma conta com seus dados:</p>
          <button class="btn btn-primary" data-act="new-account"><i class="bi bi-plus-lg"></i> Adicionar conta</button>
          <span class="mx-2">ou</span>
          <button class="btn btn-outline-secondary" data-act="import-empty"><i class="bi bi-box-arrow-in-down"></i> Importar contas</button>
        </div>`
      : `<div class="empty-state"><i class="bi bi-funnel big"></i>${ui.tab === 'archived' ? 'Nenhuma conta arquivada' : 'Nenhuma conta encontrada com esses filtros.'}</div>`;
    renderBulk(st);
    return;
  }

  const draggable = st.settings.accountSort === 'manual' && !ui.search && !Object.values(ui.filters).some(Boolean);
  const streamer = st.settings.streamerMode;
  const allChecked = list.every((a) => ui.selected.has(a.id));

  container.innerHTML = `
    <table class="table table-hover account-table">
      <thead>
        <tr>
          <th style="width:36px"><input class="form-check-input" type="checkbox" data-act="select-all" ${allChecked ? 'checked' : ''} title="Selecionar todos"></th>
          <th style="width:28px"></th>
          <th>Conta</th>
          <th>Login</th>
          <th>Tag</th>
          <th>Status</th>
          <th class="text-end">Horas jogadas</th>
          <th class="text-end" style="width:190px">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((a) => row(a, running.get(a.id), st, { draggable, streamer })).join('')}
      </tbody>
    </table>`;
  renderBulk(st);
}

function row(a, r, st, { draggable, streamer }) {
  const playing = !!r;
  const fg = st.foregroundAccountId === a.id;
  const liveSeconds = (a.totalSeconds ?? 0) + (playing ? (Date.now() - r.startedAt) / 1000 : 0);
  const status = playing
    ? r.launching
      ? '<span class="text-warning"><span class="spinner-border spinner-border-sm me-1"></span>Abrindo…</span>'
      : `<span class="text-success"><span class="dot on me-1"></span>Jogando ${duration((Date.now() - r.startedAt) / 1000)}</span>`
    : `<span class="text-body-secondary small">Último: ${relative(a.lastPlayedAt)}</span>`;

  return `
    <tr data-id="${a.id}" class="${playing ? 'playing' : ''} ${fg ? 'foreground' : ''}" ${draggable ? 'draggable="true"' : ''}>
      <td><input class="form-check-input" type="checkbox" data-act="select" ${ui.selected.has(a.id) ? 'checked' : ''}></td>
      <td>${draggable ? '<i class="bi bi-grip-vertical drag-handle" title="Arraste para reordenar"></i>' : ''}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          ${classBadge(a.characterClass)}
          <div>
            <div class="acc-name"><i class="bi ${a.favorite ? 'bi-star-fill' : 'bi-star'} fav ${a.favorite ? 'on' : ''}" data-act="fav"></i> ${esc(a.name)}</div>
            <div class="acc-sub">${streamer ? maskText(a.character) : esc(a.character || '—')}</div>
          </div>
        </div>
      </td>
      <td class="font-monospace small">${streamer ? `<span class="masked">${maskText(a.login)}</span>` : esc(a.login || '—')}${a.hasPassword ? '' : ' <i class="bi bi-exclamation-triangle text-warning" title="Sem senha salva"></i>'}</td>
      <td>${a.tag ? `<span class="badge tag-badge">${esc(a.tag)}</span>` : ''}</td>
      <td>${status}</td>
      <td class="text-end">${duration(liveSeconds)}</td>
      <td class="text-end text-nowrap">
        ${
          playing
            ? `<button class="btn btn-sm btn-outline-primary btn-icon" data-act="focus" title="Ir para a janela"><i class="bi bi-window"></i></button>
               <button class="btn btn-sm btn-outline-secondary btn-icon" data-act="type" title="Digitar login no jogo"><i class="bi bi-keyboard"></i></button>
               <button class="btn btn-sm btn-danger btn-icon" data-act="stop" title="Parar"><i class="bi bi-stop-fill"></i></button>`
            : `<button class="btn btn-sm btn-success px-3" data-act="play"><i class="bi bi-play-fill"></i> Jogar</button>`
        }
        <div class="btn-group">
          <button class="btn btn-sm btn-outline-secondary btn-icon" data-bs-toggle="dropdown" title="Mais"><i class="bi bi-three-dots-vertical"></i></button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="#" data-act="info"><i class="bi bi-info-circle me-2"></i>Informações</a></li>
            <li><a class="dropdown-item" href="#" data-act="edit"><i class="bi bi-pencil me-2"></i>Editar</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="#" data-act="copy-login"><i class="bi bi-clipboard me-2"></i>Copiar login</a></li>
            <li><a class="dropdown-item" href="#" data-act="copy-password"><i class="bi bi-key me-2"></i>Copiar senha</a></li>
            <li><a class="dropdown-item ${streamer ? 'disabled' : ''}" href="#" data-act="reveal"><i class="bi bi-eye me-2"></i>Mostrar senha</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item" href="#" data-act="tag"><i class="bi bi-tag me-2"></i>Alterar tag</a></li>
            <li><a class="dropdown-item" href="#" data-act="move-start"><i class="bi bi-arrow-bar-up me-2"></i>Mover para o início</a></li>
            <li><a class="dropdown-item" href="#" data-act="move-end"><i class="bi bi-arrow-bar-down me-2"></i>Mover para o fim</a></li>
            <li><a class="dropdown-item" href="#" data-act="archive"><i class="bi bi-archive me-2"></i>${a.archived ? 'Desarquivar' : 'Arquivar'}</a></li>
            <li><a class="dropdown-item text-danger" href="#" data-act="delete"><i class="bi bi-trash me-2"></i>Excluir</a></li>
          </ul>
        </div>
      </td>
    </tr>`;
}

function renderBulk(st) {
  const bar = ui.root.querySelector('#acc-bulk');
  const n = ui.selected.size;
  bar.classList.toggle('d-none', n === 0);
  if (!n) return;
  bar.innerHTML = `
    <strong>${n} selecionada(s)</strong>
    <button class="btn btn-sm btn-success" data-bulk="play"><i class="bi bi-play-fill"></i> Jogar</button>
    <button class="btn btn-sm btn-outline-danger" data-bulk="stop"><i class="bi bi-stop-fill"></i> Parar</button>
    <button class="btn btn-sm btn-outline-secondary" data-bulk="group"><i class="bi bi-diagram-3"></i> Criar grupo</button>
    <button class="btn btn-sm btn-outline-secondary" data-bulk="tag"><i class="bi bi-tag"></i> Alterar tag</button>
    <button class="btn btn-sm btn-outline-secondary" data-bulk="archive"><i class="bi bi-archive"></i> ${ui.tab === 'archived' ? 'Desarquivar' : 'Arquivar'}</button>
    <button class="btn btn-sm btn-outline-danger" data-bulk="delete"><i class="bi bi-trash"></i> Excluir</button>
    <button class="btn btn-sm btn-link ms-auto" data-bulk="clear">Limpar seleção</button>`;
  void st;
}

// ------------------------------------------------------------------ ações

function accountById(id) {
  return getState().accounts.find((a) => a.id === id);
}

function onListChange(e) {
  const act = e.target.dataset.act;
  if (act === 'select') {
    const id = e.target.closest('tr').dataset.id;
    if (e.target.checked) ui.selected.add(id);
    else ui.selected.delete(id);
    renderBulk(getState());
  } else if (act === 'select-all') {
    const { list } = visibleAccounts(getState());
    if (e.target.checked) list.forEach((a) => ui.selected.add(a.id));
    else ui.selected.clear();
    renderList(getState());
  }
}

async function onListClick(e) {
  const target = e.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  if (act === 'select' || act === 'select-all') return;
  if (target.tagName === 'A') e.preventDefault();
  if (target.classList.contains('disabled')) return;

  if (act === 'new-server') return serverForm();
  if (act === 'new-account') return accountForm();
  if (act === 'import-empty') return ui.root.querySelector('[data-act=import]').click();

  const id = target.closest('tr')?.dataset.id;
  const a = accountById(id);
  if (!a) return;

  switch (act) {
    case 'play':
      target.disabled = true;
      return run(() => call('game:launch', [id]));
    case 'stop':
      return run(() => call('game:stop', [id]));
    case 'focus':
      return run(() => call('game:focus', id));
    case 'type':
      return run(() => call('game:type-login', id));
    case 'fav':
      return run(() => call('accounts:favorite', id, !a.favorite));
    case 'info':
      return accountInfo(a);
    case 'edit':
      return accountForm(a);
    case 'copy-login':
      return run(() => call('accounts:copy', id, 'login'), 'Login copiado.');
    case 'copy-password':
      return run(() => call('accounts:copy', id, 'password'), 'Senha copiada.');
    case 'reveal':
      return run(async () => {
        const pass = await call('accounts:reveal-password', id);
        modal({
          title: `Senha de ${a.name}`,
          cancelLabel: 'Fechar',
          body: `<div class="input-group"><input class="form-control font-monospace selectable" readonly value="${esc(pass || '')}" placeholder="(sem senha salva)"></div>`,
        });
      });
    case 'tag':
      return tagDialog([id]);
    case 'move-start':
    case 'move-end':
      return run(() => call('accounts:move', id, act === 'move-start' ? 'start' : 'end'));
    case 'archive':
      return run(() => call('accounts:archive', [id], !a.archived));
    case 'delete':
      if (await confirmDialog('Excluir conta', `Excluir a conta "${a.name}"? Essa ação não pode ser desfeita.`, { confirmLabel: 'Excluir' })) {
        return run(() => call('accounts:delete', [id]), 'Conta excluída.');
      }
      return undefined;
    default:
      return undefined;
  }
}

async function onBulkClick(e) {
  const b = e.target.closest('[data-bulk]');
  if (!b) return;
  const ids = [...ui.selected];
  switch (b.dataset.bulk) {
    case 'play':
      return run(() => call('game:launch', ids));
    case 'stop':
      return run(() => call('game:stop', ids));
    case 'tag':
      return tagDialog(ids);
    case 'group':
      return quickGroup(ids);
    case 'archive':
      await run(() => call('accounts:archive', ids, ui.tab !== 'archived'));
      ui.selected.clear();
      return renderList(getState());
    case 'delete':
      if (await confirmDialog('Excluir contas', `Excluir ${ids.length} conta(s)? Essa ação não pode ser desfeita.`, { confirmLabel: 'Excluir' })) {
        await run(() => call('accounts:delete', ids), 'Contas excluídas.');
        ui.selected.clear();
      }
      return undefined;
    case 'clear':
      ui.selected.clear();
      return renderList(getState());
    default:
      return undefined;
  }
}

function tagDialog(ids) {
  const st = getState();
  const tags = [...new Set(st.accounts.map((x) => x.tag).filter(Boolean))].sort();
  modal({
    title: 'Alterar tag',
    body: `
      <label class="form-label">Tag (vazio remove)</label>
      <input class="form-control" name="tag" list="tag-list-2" maxlength="40" autofocus>
      <datalist id="tag-list-2">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`,
    onSubmit: (form) => call('accounts:set-tag', ids, form.tag.value),
  });
}

function quickGroup(ids) {
  const st = getState();
  if (ids.length > 10) return toast('Um grupo pode ter no máximo 10 personagens.', 'warning');
  modal({
    title: 'Criar grupo com as contas selecionadas',
    body: `<label class="form-label">Nome do grupo</label><input class="form-control" name="name" maxlength="60" autofocus>`,
    submitLabel: 'Criar',
    onSubmit: async (form) => {
      const ordered = visibleAccounts(st).list.map((a) => a.id).filter((id) => ids.includes(id));
      await call('groups:save', { name: form.name.value, serverId: st.settings.selectedServerId, memberIds: ordered, leaderId: ordered[0] });
      toast('Grupo criado. Veja em "Modo grupo".', 'success');
    },
  });
  return undefined;
}

function exportDialog() {
  const ids = [...ui.selected];
  modal({
    title: 'Exportar contas',
    submitLabel: 'Exportar',
    body: `
      <p>${ids.length ? `Exportar as ${ids.length} conta(s) selecionada(s).` : 'Exportar todas as contas (de todos os servidores).'}</p>
      <div class="form-check">
        <input class="form-check-input" type="checkbox" name="includePasswords" id="inc-pass">
        <label class="form-check-label" for="inc-pass">Incluir senhas (texto puro — guarde o arquivo com cuidado)</label>
      </div>`,
    onSubmit: async (form) => {
      const r = await call('accounts:export', { ids, includePasswords: form.includePasswords.checked });
      if (r.exported) toast(`${r.exported} conta(s) exportada(s).`, 'success');
    },
  });
}

// ------------------------------------------------------------------ arrastar e soltar (ordem manual)

function onDragStart(e) {
  const tr = e.target.closest('tr[draggable]');
  if (!tr) return;
  ui.dragId = tr.dataset.id;
  tr.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ui.dragId);
}

function onDragOver(e) {
  const tr = e.target.closest('tr[draggable]');
  if (!tr || !ui.dragId) return;
  e.preventDefault();
  ui.root.querySelectorAll('.drop-before').forEach((n) => n !== tr && n.classList.remove('drop-before'));
  tr.classList.add('drop-before');
}

function onDrop(e) {
  const tr = e.target.closest('tr[draggable]');
  if (!tr || !ui.dragId) return;
  e.preventDefault();
  const targetId = tr.dataset.id;
  const dragId = ui.dragId;
  ui.dragId = null;
  if (targetId === dragId) return;
  const ordered = [...getState().accounts].sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((a) => a.id);
  ordered.splice(ordered.indexOf(dragId), 1);
  ordered.splice(ordered.indexOf(targetId), 0, dragId);
  run(() => call('accounts:reorder', ordered));
}

