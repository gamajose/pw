// Tela "Modo grupo": grupos de personagens, membros/líder, Sync action, janela flutuante e organização.
import { call, getState } from '../api.js';
import { esc, run, toast, modal, confirmDialog, classBadge } from '../ui.js';
import { openPartyWizard } from '../party-wizard.js';

const ui = {
  root: null,
  tab: 'all',
  selectedId: null,
  search: '',
  drag: null, // { id, from: 'members' | 'available' }
  displays: [],
};

export function mount(root, st, nav) {
  ui.root = root;
  ui.nav = nav;
  root.innerHTML = `
    <div class="view-header">
      <h1>Modo grupo</h1>
      <div class="ms-auto d-flex gap-2">
        <button class="btn btn-outline-info btn-sm" data-act="assistant"><i class="bi bi-magic me-1"></i> PW Assistente</button>
        <button class="btn btn-primary btn-sm" data-act="new"><i class="bi bi-plus-lg"></i> Novo grupo</button>
      </div>
    </div>
    <div class="row g-3">
      <div class="col-lg-3">
        <ul class="nav nav-pills mb-2" id="grp-tabs">
          <li class="nav-item"><a class="nav-link py-1 px-3" href="#" data-tab="all">Todos</a></li>
          <li class="nav-item"><a class="nav-link py-1 px-3" href="#" data-tab="archived">Arquivados</a></li>
        </ul>
        <div id="grp-list"></div>
      </div>
      <div class="col-lg-9" id="grp-detail"></div>
    </div>`;

  root.querySelector('[data-act=assistant]').addEventListener('click', () => {
    const g = current(getState());
    if (!g) return toast('Selecione um grupo primeiro.', 'warning');
    openPartyWizard(g);
  });
  root.querySelector('[data-act=new]').addEventListener('click', () => groupNameDialog());
  root.querySelector('#grp-tabs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    e.preventDefault();
    ui.tab = a.dataset.tab;
    update(getState());
  });
  root.querySelector('#grp-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-group]');
    if (!card) return;
    ui.selectedId = card.dataset.group;
    update(getState());
  });

  const detail = root.querySelector('#grp-detail');
  detail.addEventListener('click', onDetailClick);
  detail.addEventListener('input', (e) => {
    if (e.target.id === 'avail-search') {
      ui.search = e.target.value;
      renderAvailable(getState());
    }
  });
  detail.addEventListener('dragstart', onDragStart);
  detail.addEventListener('dragover', onDragOver);
  detail.addEventListener('drop', onDrop);
  detail.addEventListener('dragend', clearDragMarks);

  call('app:displays').then((d) => {
    ui.displays = d;
  });
  update(st);
}

export function unmount() {
  ui.root = null;
}

function serverGroups(st) {
  return st.groups.filter((g) => g.serverId === st.settings.selectedServerId);
}

function current(st) {
  return st.groups.find((g) => g.id === ui.selectedId) ?? null;
}

export function update(st) {
  if (!ui.root) return;
  if (ui.root.querySelector('#grp-detail .dropdown-menu.show')) return; // não fecha menus abertos
  ui.root.querySelectorAll('#grp-tabs .nav-link').forEach((a) => a.classList.toggle('active', a.dataset.tab === ui.tab));

  const groups = serverGroups(st).filter((g) => (ui.tab === 'archived' ? g.archived : !g.archived));
  if (!groups.some((g) => g.id === ui.selectedId)) ui.selectedId = groups.find((g) => g.id === st.party.activeGroupId)?.id ?? groups[0]?.id ?? null;

  const running = new Set(st.running.map((r) => r.accountId));
  const listEl = ui.root.querySelector('#grp-list');
  if (!st.settings.selectedServerId) {
    listEl.innerHTML = '<div class="text-body-secondary small p-2">Selecione um servidor.</div>';
  } else if (groups.length === 0) {
    listEl.innerHTML = `<div class="text-body-secondary small p-2">${ui.tab === 'archived' ? 'Nenhum grupo arquivado.' : 'Nenhum grupo ainda. Crie um em "Novo grupo".'}</div>`;
  } else {
    listEl.innerHTML = groups
      .map((g) => {
        const playing = g.memberIds.filter((id) => running.has(id)).length;
        const syncOn = st.party.sync.on && st.party.sync.groupId === g.id;
        return `
        <div class="group-card ${g.id === ui.selectedId ? 'active' : ''}" data-group="${g.id}">
          <div class="d-flex align-items-center">
            <strong class="text-truncate">${esc(g.name)}</strong>
            ${st.party.activeGroupId === g.id ? '<span class="badge text-bg-primary ms-2">Ativo</span>' : ''}
            ${syncOn ? '<span class="badge text-bg-warning ms-1">Sync</span>' : ''}
          </div>
          <div class="small text-body-secondary">${g.memberIds.length} personagem(ns) · ${playing} jogando</div>
        </div>`;
      })
      .join('');
  }
  renderDetail(st);
}

// ------------------------------------------------------------------ detalhe do grupo

function renderDetail(st) {
  const detail = ui.root.querySelector('#grp-detail');
  const searchFocused = document.activeElement?.id === 'avail-search';
  const g = current(st);
  if (!g) {
    detail.innerHTML = `
      <div class="panel"><div class="empty-state">
        <i class="bi bi-diagram-3 big"></i>
        <h5>Nenhum grupo selecionado</h5>
        <p>Grupos juntam personagens para abrir, controlar e sincronizar todos de uma vez.</p>
      </div></div>`;
    return;
  }
  const syncOn = st.party.sync.on && st.party.sync.groupId === g.id;
  const groupPresets = st.presets.filter((p) => p.groupId === g.id || !p.groupId);

  detail.innerHTML = `
    <div class="panel mb-3">
      <div class="panel-header flex-wrap">
        <h5 class="m-0 me-2">${esc(g.name)}</h5>
        ${st.party.activeGroupId === g.id ? '<span class="badge text-bg-primary">Grupo ativo</span>' : `<button class="btn btn-sm btn-link p-0" data-act="activate">Tornar ativo</button>`}
        <div class="ms-auto d-flex gap-1 flex-wrap">
          <button class="btn btn-sm btn-success" data-act="launch"><i class="bi bi-play-fill"></i> Abrir todos</button>
          <button class="btn btn-sm btn-outline-danger" data-act="stop"><i class="bi bi-stop-fill"></i> Fechar todos</button>
          <button class="btn btn-sm btn-outline-primary" data-act="mini"><i class="bi bi-window-stack"></i> Janela do grupo</button>
          <button class="btn btn-sm ${syncOn ? 'btn-warning' : 'btn-outline-warning'}" data-act="sync" title="Repete no grupo o que você faz no personagem em foco">
            <i class="bi bi-arrow-repeat"></i> Sync ${syncOn ? (st.party.sync.paused ? '(pausado)' : 'ligado') : 'desligado'}
          </button>
          <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-grid-1x2"></i> Organizar</button>
            <ul class="dropdown-menu dropdown-menu-end">
              ${(ui.displays.length ? ui.displays : [{ id: null, label: 'Monitor principal' }])
                .map(
                  (d) => `
                <li><h6 class="dropdown-header">${esc(d.label)}</h6></li>
                <li><a class="dropdown-item" href="#" data-act="arrange" data-layout="grid" data-display="${d.id ?? ''}"><i class="bi bi-grid me-2"></i>Mosaico</a></li>
                <li><a class="dropdown-item" href="#" data-act="arrange" data-layout="leader" data-display="${d.id ?? ''}"><i class="bi bi-layout-sidebar-reverse me-2"></i>Líder em destaque</a></li>
                <li><a class="dropdown-item" href="#" data-act="arrange" data-layout="cascade" data-display="${d.id ?? ''}"><i class="bi bi-layers me-2"></i>Cascata</a></li>`,
                )
                .join('<li><hr class="dropdown-divider"></li>')}
            </ul>
          </div>
          <div class="btn-group">
            <button class="btn btn-sm btn-outline-secondary btn-icon" data-bs-toggle="dropdown"><i class="bi bi-three-dots-vertical"></i></button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" data-act="rename"><i class="bi bi-pencil me-2"></i>Renomear</a></li>
              <li><a class="dropdown-item" href="#" data-act="archive"><i class="bi bi-archive me-2"></i>${g.archived ? 'Desarquivar' : 'Arquivar'}</a></li>
              <li><a class="dropdown-item text-danger" href="#" data-act="delete"><i class="bi bi-trash me-2"></i>Excluir</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="panel-body">
        <div class="row g-3">
          <div class="col-xl-7">
            <div class="d-flex align-items-center mb-2">
              <h6 class="m-0">Grupo <span class="text-body-secondary small">(${g.memberIds.length}/10)</span></h6>
              <span class="small text-body-secondary ms-auto">Arraste para reordenar · <i class="bi bi-star-fill leader-crown"></i> = líder</span>
            </div>
            <div class="drop-zone" data-zone="members" id="members-zone">${membersHtml(st, g)}</div>
          </div>
          <div class="col-xl-5">
            <h6 class="mb-2">Disponíveis</h6>
            <input class="form-control form-control-sm mb-2" id="avail-search" placeholder="Buscar personagem" value="${esc(ui.search)}">
            <div class="drop-zone" data-zone="available" id="avail-zone" style="max-height:360px;overflow:auto"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h6 class="m-0">Presets</h6>
        <span class="small text-body-secondary">Do grupo e globais</span>
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-sm btn-outline-info" data-act="assistant"><i class="bi bi-magic me-1"></i> PW Assistente</button>
          <button class="btn btn-sm btn-link" data-act="go-presets">Gerenciar presets</button>
        </div>
      </div>
      <div class="panel-body d-flex flex-wrap gap-2">
        ${
          groupPresets.length
            ? groupPresets
                .map((p) => {
                  const on = st.presetsRunning.includes(p.id);
                  return `<button class="btn btn-sm ${on ? 'btn-danger' : 'btn-outline-primary'}" data-act="preset" data-id="${p.id}">
                    <i class="bi ${on ? 'bi-stop-fill' : 'bi-lightning-charge'}"></i> ${esc(p.name)}
                    ${p.hotkey ? `<span class="kbd ms-1">${esc(p.hotkey)}</span>` : ''}</button>`;
                })
                .join('')
            : '<span class="text-body-secondary small">Nenhum preset. Crie em "Presets".</span>'
        }
      </div>
    </div>`;
  renderAvailable(st);
  if (searchFocused) {
    const input = detail.querySelector('#avail-search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

function membersHtml(st, g) {
  if (!g.memberIds.length) return '<div class="text-center text-body-secondary small py-4">Arraste personagens aqui</div>';
  const running = new Map(st.running.map((r) => [r.accountId, r]));
  return g.memberIds
    .map((id, i) => {
      const a = st.accounts.find((x) => x.id === id);
      if (!a) return '';
      const r = running.get(id);
      const leader = g.leaderId === id;
      const fg = st.foregroundAccountId === id;
      return `
        <div class="member-row ${fg ? 'border-primary' : ''}" draggable="true" data-member="${id}">
          <span class="member-pos">${i + 1}</span>
          ${classBadge(a.characterClass)}
          <div class="flex-grow-1 text-truncate">
            <div class="acc-name text-truncate">${esc(a.character || a.name)}</div>
            <div class="acc-sub text-truncate">${esc(a.name)}</div>
          </div>
          <span class="dot ${r ? 'on' : ''}" title="${r ? 'Jogando' : 'Parado'}"></span>
          <button class="btn btn-sm btn-link p-0 ${leader ? 'leader-crown' : 'text-body-secondary'}" data-act="leader" title="${leader ? 'Líder' : 'Definir como líder'}">
            <i class="bi ${leader ? 'bi-star-fill' : 'bi-star'}"></i></button>
          ${
            r
              ? `<button class="btn btn-sm btn-outline-primary btn-icon" data-act="focus" title="Ir para a janela"><i class="bi bi-window"></i></button>
                 <button class="btn btn-sm btn-outline-danger btn-icon" data-act="stop-one" title="Parar"><i class="bi bi-stop-fill"></i></button>`
              : `<button class="btn btn-sm btn-outline-success btn-icon" data-act="play-one" title="Jogar"><i class="bi bi-play-fill"></i></button>`
          }
          <button class="btn btn-sm btn-outline-secondary btn-icon" data-act="remove" title="Remover do grupo"><i class="bi bi-x-lg"></i></button>
        </div>`;
    })
    .join('');
}

function renderAvailable(st) {
  const g = current(st);
  const zone = ui.root?.querySelector('#avail-zone');
  if (!g || !zone) return;
  const q = ui.search.trim().toLowerCase();
  const list = st.accounts
    .filter((a) => a.serverId === g.serverId && !a.archived && !g.memberIds.includes(a.id))
    .filter((a) => !q || [a.name, a.character, a.tag].some((v) => v && v.toLowerCase().includes(q)))
    .sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  zone.innerHTML = list.length
    ? list
        .map(
          (a) => `
        <div class="member-row available-item" draggable="true" data-available="${a.id}">
          ${classBadge(a.characterClass)}
          <div class="flex-grow-1 text-truncate">
            <div class="acc-name text-truncate">${esc(a.character || a.name)}</div>
            <div class="acc-sub text-truncate">${esc(a.name)}${a.tag ? ' · ' + esc(a.tag) : ''}</div>
          </div>
          <button class="btn btn-sm btn-outline-primary btn-icon" data-act="add" title="Adicionar ao grupo"><i class="bi bi-plus-lg"></i></button>
        </div>`,
        )
        .join('')
    : '<div class="text-center text-body-secondary small py-4">Nenhum personagem disponível.</div>';
}

// ------------------------------------------------------------------ ações

function saveGroup(g, patch) {
  return run(() => call('groups:save', { ...g, ...patch }));
}

async function onDetailClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  const st = getState();
  const g = current(st);
  if (!g) return;
  const memberId = t.closest('[data-member]')?.dataset.member;
  const availId = t.closest('[data-available]')?.dataset.available;

  switch (t.dataset.act) {
    case 'activate':
      return run(() => call('groups:set-active', g.id));
    case 'launch':
      return run(() => call('groups:launch', g.id));
    case 'stop':
      if (await confirmDialog('Fechar grupo', `Fechar todos os clientes do grupo "${g.name}"?`, { confirmLabel: 'Fechar todos' })) {
        return run(() => call('groups:stop', g.id));
      }
      return undefined;
    case 'mini':
      return run(() => call('groups:open-mini', g.id));
    case 'assistant':
      return openPartyWizard(g);
    case 'sync':
      return run(() => call('sync:toggle', g.id));
    case 'arrange':
      return run(() => call('groups:arrange', g.id, t.dataset.layout, t.dataset.display ? Number(t.dataset.display) : null));
    case 'rename':
      return groupNameDialog(g);
    case 'archive':
      return run(() => call('groups:archive', g.id, !g.archived));
    case 'delete':
      if (await confirmDialog('Excluir grupo', `Excluir o grupo "${g.name}"? As contas não são apagadas.`, { confirmLabel: 'Excluir' })) {
        return run(() => call('groups:delete', g.id), 'Grupo excluído.');
      }
      return undefined;
    case 'go-presets':
      return ui.nav.show('presets');
    case 'preset':
      return run(() => call('presets:run', t.dataset.id, g.id));
    case 'leader':
      return saveGroup(g, { leaderId: memberId });
    case 'focus':
      return run(() => call('game:focus', memberId));
    case 'play-one':
      return run(() => call('game:launch', [memberId]));
    case 'stop-one':
      return run(() => call('game:stop', [memberId]));
    case 'remove':
      return saveGroup(g, { memberIds: g.memberIds.filter((id) => id !== memberId) });
    case 'add':
      if (g.memberIds.length >= 10) return toast('Um grupo pode ter no máximo 10 personagens.', 'warning');
      return saveGroup(g, { memberIds: [...g.memberIds, availId] });
    default:
      return undefined;
  }
}

function groupNameDialog(group = null) {
  const st = getState();
  if (!group && !st.settings.selectedServerId) return toast('Selecione um servidor primeiro.', 'warning');
  modal({
    title: group ? 'Renomear grupo' : 'Novo grupo',
    submitLabel: group ? 'Salvar' : 'Criar',
    body: `<label class="form-label">Nome do grupo</label><input class="form-control" name="name" maxlength="60" value="${esc(group?.name ?? '')}" autofocus>`,
    onSubmit: async (form) => {
      const r = await call('groups:save', group ? { ...group, name: form.name.value } : { name: form.name.value, serverId: st.settings.selectedServerId, memberIds: [] });
      ui.selectedId = r.id;
      ui.tab = 'all';
    },
  });
  return undefined;
}

// ------------------------------------------------------------------ arrastar e soltar

function onDragStart(e) {
  const m = e.target.closest('[data-member]');
  const a = e.target.closest('[data-available]');
  if (!m && !a) return;
  ui.drag = m ? { id: m.dataset.member, from: 'members' } : { id: a.dataset.available, from: 'available' };
  (m ?? a).classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ui.drag.id);
}

function onDragOver(e) {
  if (!ui.drag) return;
  const zone = e.target.closest('[data-zone]');
  if (!zone) return;
  e.preventDefault();
  ui.root.querySelectorAll('.drop-zone.over').forEach((z) => z !== zone && z.classList.remove('over'));
  zone.classList.add('over');
  ui.root.querySelectorAll('.drop-before').forEach((n) => n.classList.remove('drop-before'));
  const row = e.target.closest('[data-member]');
  if (row && zone.dataset.zone === 'members') row.classList.add('drop-before');
}

function onDrop(e) {
  if (!ui.drag) return;
  const zone = e.target.closest('[data-zone]');
  if (!zone) return;
  e.preventDefault();
  const st = getState();
  const g = current(st);
  const { id, from } = ui.drag;
  ui.drag = null;
  clearDragMarks();
  if (!g) return;

  if (zone.dataset.zone === 'available') {
    if (from === 'members') saveGroup(g, { memberIds: g.memberIds.filter((x) => x !== id) });
    return;
  }
  const beforeId = e.target.closest('[data-member]')?.dataset.member ?? null;
  const ids = g.memberIds.filter((x) => x !== id);
  if (from === 'available' && ids.length >= 10) {
    toast('Um grupo pode ter no máximo 10 personagens.', 'warning');
    return;
  }
  const at = beforeId && beforeId !== id ? ids.indexOf(beforeId) : ids.length;
  ids.splice(at < 0 ? ids.length : at, 0, id);
  saveGroup(g, { memberIds: ids });
}

function clearDragMarks() {
  ui.root?.querySelectorAll('.dragging,.drop-before,.over').forEach((n) => n.classList.remove('dragging', 'drop-before', 'over'));
}
