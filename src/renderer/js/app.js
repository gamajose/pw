// Interface principal: navegação, seletor de servidor e barra de status.
import { initState, subscribe, call, getState, onEvent } from './api.js';
import { esc, toast, run } from './ui.js';
import { serverForm } from './forms.js';
import * as accounts from './views/accounts.js';
import * as groups from './views/groups.js';
import * as presets from './views/presets.js';
import * as forja from './views/forja.js';
import * as map from './views/map.js';
import * as equipment from './views/equipment.js';
import * as calculators from './views/calculators.js';
import * as servers from './views/servers.js';
import * as settings from './views/settings.js';
import * as about from './views/about.js';

const VIEWS = { accounts, groups, presets, forja, map, equipment, calculators, servers, settings, about };
const viewEl = document.getElementById('view');
let current = null;
let currentName = null;

function show(name) {
  if (!VIEWS[name]) name = 'accounts';
  current?.unmount?.();
  currentName = name;
  current = VIEWS[name];
  try {
    localStorage.setItem('pw.view', name);
  } catch {
    /* sem armazenamento local */
  }
  document.querySelectorAll('#nav .nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  viewEl.innerHTML = '';
  viewEl.scrollTop = 0;
  current.mount(viewEl, getState(), { show });
}

function renderSidebar(st) {
  document.getElementById('app-version').textContent = 'v' + st.app.version;

  const sel = document.getElementById('server-select');
  const opts = st.servers.length
    ? st.servers.map((s) => `<option value="${s.id}" ${s.id === st.settings.selectedServerId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">Nenhum servidor</option>';
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  sel.disabled = !st.servers.length;

  const nativeEl = document.getElementById('status-native');
  nativeEl.innerHTML = st.native.available
    ? '<span class="dot on"></span> Módulo nativo ativo'
    : '<span class="dot off"></span> Módulo nativo indisponível';

  const playing = st.running.length;
  document.getElementById('status-playing').innerHTML = `<span class="dot ${playing ? 'on' : ''}"></span> ${playing} ${playing === 1 ? 'cliente aberto' : 'clientes abertos'}`;

  const sync = st.party.sync;
  const g = st.groups.find((x) => x.id === sync.groupId);
  document.getElementById('status-sync').innerHTML = sync.on
    ? `<span class="dot warn"></span> Sync: ${esc(g?.name ?? '')}${sync.paused ? ' (pausado)' : ''}`
    : '<span class="dot"></span> Sync desligado';
}

async function main() {
  const st = await initState();

  document.getElementById('nav').addEventListener('click', (e) => {
    const a = e.target.closest('.nav-link');
    if (!a) return;
    e.preventDefault();
    show(a.dataset.view);
  });

  document.getElementById('server-select').addEventListener('change', (e) => run(() => call('servers:select', e.target.value)));
  document.getElementById('server-add').addEventListener('click', () => serverForm());
  document.getElementById('stop-all').addEventListener('click', () =>
    run(async () => {
      await call('presets:stop-all');
      if (getState().party.sync.on) await call('sync:toggle', null);
    }, 'Presets e Sync action parados.'),
  );

  subscribe((s) => {
    renderSidebar(s);
    current?.update?.(s);
  });
  onEvent('notify', (n) => toast(n.message, n.type ?? 'info'));
  onEvent('navigate', (view) => show(view));

  renderSidebar(st);
  let start = 'accounts';
  try {
    start = localStorage.getItem('pw.view') || 'accounts';
  } catch {
    /* sem armazenamento local */
  }
  if (!st.servers.length) start = 'servers';
  show(start);
  void currentName;
}

main().catch((err) => {
  viewEl.innerHTML = `<div class="alert alert-danger m-4">Falha ao carregar a interface: ${esc(err.message)}</div>`;
});
