// Janela flutuante do grupo: troca rápida de personagem, Sync action e presets durante o jogo.
import { initState, subscribe, call, onEvent } from './api.js';
import { esc, run, toast, classBadge } from './ui.js';

const groupId = new URLSearchParams(location.search).get('group');
const body = document.getElementById('body');
let clickTimer = null;

function render(st) {
  const g = st.groups.find((x) => x.id === groupId);
  if (!g) {
    body.innerHTML = '<div class="text-center text-body-secondary small p-3">Este grupo foi excluído.</div>';
    return;
  }
  document.getElementById('title').textContent = g.name;
  document.title = `Grupo — ${g.name}`;

  const running = new Map(st.running.map((r) => [r.accountId, r]));
  const sync = st.party.sync;
  const syncOn = sync.on && sync.groupId === g.id;
  const p = st.settings.party;
  const presets = st.presets.filter((x) => x.groupId === g.id || !x.groupId);
  const playingCount = g.memberIds.filter((id) => running.get(id)?.hwnd).length;

  body.innerHTML = `
    <div class="sync-box ${syncOn ? 'on' : ''}">
      <div>
        <div class="fw-semibold small"><i class="bi bi-arrow-repeat"></i> Sync action</div>
        <div class="small text-body-secondary">${syncOn ? (sync.paused ? 'Pausado (chat) — Enter/Esc retoma' : 'Ligado') : 'Desligado'}</div>
      </div>
      <div class="d-flex gap-1">
        ${syncOn ? `<button class="btn btn-sm btn-outline-secondary" data-act="pause" title="${sync.paused ? 'Retomar' : 'Pausar'}"><i class="bi ${sync.paused ? 'bi-play-fill' : 'bi-pause-fill'}"></i></button>` : ''}
        <div class="form-check form-switch m-0">
          <input class="form-check-input" type="checkbox" role="switch" data-act="sync" ${syncOn ? 'checked' : ''} ${playingCount < 2 && !syncOn ? 'disabled' : ''}>
        </div>
      </div>
    </div>

    <div class="mini-section d-flex align-items-center">
      Personagens <span class="ms-1">(${playingCount}/${g.memberIds.length})</span>
      <button class="btn btn-sm btn-link p-0 ms-auto" data-act="launch-all" title="Abrir todos"><i class="bi bi-play-fill"></i></button>
      <button class="btn btn-sm btn-link p-0 ms-1" data-act="arrange" title="Organizar janelas (mosaico)"><i class="bi bi-grid"></i></button>
    </div>
    ${g.memberIds
      .map((id, i) => {
        const a = st.accounts.find((x) => x.id === id);
        if (!a) return '';
        const r = running.get(id);
        const fg = st.foregroundAccountId === id;
        const leader = g.leaderId === id;
        return `
        <div class="mini-member ${fg ? 'fg' : ''} ${r ? '' : 'offline'}" data-member="${id}" title="${r ? (p.changeWith === 'double' ? 'Clique duplo' : 'Clique') + ' para focar' : 'Parado'}">
          ${p.showPosition ? `<span class="member-pos">${i + 1}</span>` : ''}
          ${p.showClass ? classBadge(a.characterClass) : ''}
          <span class="flex-grow-1 text-truncate">${esc(a.character || a.name)}${leader ? ' <i class="bi bi-star-fill leader-crown small"></i>' : ''}</span>
          ${
            r
              ? r.launching
                ? '<span class="spinner-border spinner-border-sm text-warning"></span>'
                : '<span class="dot on"></span>'
              : `<button class="btn btn-sm btn-link p-0 text-success" data-act="play" title="Jogar"><i class="bi bi-play-circle"></i></button>`
          }
        </div>`;
      })
      .join('')}

    <div class="mini-section">Presets</div>
    <div class="d-flex flex-wrap gap-1">
      ${
        presets.length
          ? presets
              .map((x) => {
                const on = st.presetsRunning.includes(x.id);
                return `<button class="btn btn-sm preset-btn ${on ? 'btn-danger' : 'btn-outline-primary'}" data-act="preset" data-id="${x.id}" title="${x.hotkey ? esc(x.hotkey) : ''}">
                  <i class="bi ${on ? 'bi-stop-fill' : 'bi-lightning-charge'}"></i> ${esc(x.name)}</button>`;
              })
              .join('')
          : '<span class="small text-body-secondary">Nenhum preset.</span>'
      }
    </div>`;
}

body.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  const member = e.target.closest('[data-member]')?.dataset.member;
  if (act) {
    switch (act.dataset.act) {
      case 'play':
        e.stopPropagation();
        return run(() => call('game:launch', [member]));
      case 'pause': {
        const paused = act.querySelector('.bi-play-fill') != null;
        return run(() => call('sync:pause', !paused));
      }
      case 'launch-all':
        return run(() => call('groups:launch', groupId));
      case 'arrange':
        return run(() => call('groups:arrange', groupId, 'grid', null));
      case 'preset':
        return run(() => call('presets:run', act.dataset.id, groupId));
      default:
        return undefined;
    }
  }
  if (member) {
    const st = window.__state;
    if (st?.settings.party.changeWith === 'double') return undefined;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => run(() => call('game:focus', member)), 0);
  }
  return undefined;
});

body.addEventListener('dblclick', (e) => {
  const member = e.target.closest('[data-member]')?.dataset.member;
  if (!member || e.target.closest('[data-act]')) return;
  if (window.__state?.settings.party.changeWith === 'double') run(() => call('game:focus', member));
});

body.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'sync') run(() => call('sync:toggle', groupId));
});

document.getElementById('btn-close').addEventListener('click', () => call('window:close'));
document.getElementById('btn-min').addEventListener('click', () => call('window:minimize'));
document.getElementById('btn-main').addEventListener('click', () => call('app:show-main'));
document.getElementById('btn-pin').addEventListener('click', async () => {
  const on = await call('window:toggle-on-top');
  document.querySelector('#btn-pin i').className = on ? 'bi bi-pin-angle-fill' : 'bi bi-pin-angle';
});

async function main() {
  const st = await initState();
  window.__state = st;
  document.querySelector('#btn-pin i').className = st.settings.party.miniAlwaysOnTop ? 'bi bi-pin-angle-fill' : 'bi bi-pin-angle';
  subscribe((s) => {
    window.__state = s;
    render(s);
  });
  onEvent('notify', (n) => toast(n.message, n.type ?? 'info'));
  render(st);
}

main().catch((err) => {
  body.innerHTML = `<div class="alert alert-danger m-2 small">${esc(err.message)}</div>`;
});
