// Lógica do Painel de Diagnóstico e Log do Sync
const pw = window.pw;
let state = null;
let metrics = [];
let memoryStats = {};
let eventCount = 0;

const elClientsList = document.getElementById('clients-list');
const elLogConsole = document.getElementById('log-console');
const elCpuTotalBadge = document.getElementById('cpu-total-badge');
const elEventCountBadge = document.getElementById('event-count-badge');
const elPerfSwitch = document.getElementById('perf-mode-switch');
const elBtnClear = document.getElementById('btn-clear-log');

function logLine(tag, msg, tagClass = 'sync') {
  eventCount++;
  elEventCountBadge.textContent = `${eventCount} eventos`;
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.innerHTML = `<span class="log-time">[${time}]</span><span class="log-tag ${tagClass}">[${tag}]</span> <span>${escapeHtml(msg)}</span>`;
  elLogConsole.appendChild(div);
  elLogConsole.scrollTop = elLogConsole.scrollHeight;

  // Manter no máximo 500 linhas
  while (elLogConsole.children.length > 500) {
    elLogConsole.removeChild(elLogConsole.firstChild);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function refreshClients() {
  if (!state) return;
  const running = state.running || [];
  if (running.length === 0) {
    elClientsList.innerHTML = '<div class="text-body-secondary small text-center py-4">Nenhum cliente em execução.</div>';
    elCpuTotalBadge.textContent = 'CPU Total: 0%';
    return;
  }

  // Buscar métricas atualizadas
  const pids = running.map((r) => r.pid).filter(Boolean);
  if (pids.length > 0) {
    try {
      metrics = await pw.call('system:process-metrics', pids);
    } catch {
      metrics = [];
    }
  }

  // Somar CPU total
  const totalCpu = metrics.reduce((acc, m) => acc + (m.cpuPercent || 0), 0);
  elCpuTotalBadge.textContent = `CPU Total: ${totalCpu.toFixed(1)}%`;

  elClientsList.innerHTML = '';
  running.forEach((cli) => {
    const acc = state.accounts?.find((a) => a.id === cli.accountId);
    const charName = acc?.character || acc?.name || `PID ${cli.pid}`;
    const met = metrics.find((m) => m.pid === cli.pid) || { cpuPercent: 0, memoryMb: 0 };
    const mem = memoryStats[cli.accountId]?.values || {};

    const isFg = state.foregroundAccountId === cli.accountId;
    const card = document.createElement('div');
    card.className = `client-card ${isFg ? 'focused' : ''}`;

    const hpPct = mem.max_hp ? Math.min(100, Math.round((mem.hp / mem.max_hp) * 100)) : 100;
    const mpPct = mem.max_mp ? Math.min(100, Math.round((mem.mp / mem.max_mp) * 100)) : 100;

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-1">
        <div>
          <span class="fw-bold">${escapeHtml(charName)}</span>
          ${isFg ? '<span class="badge bg-primary ms-1" style="font-size: 9px;">EM FOCO</span>' : ''}
        </div>
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary p-1" title="Focar janela" data-action="focus" data-acc="${cli.accountId}">
            <i class="bi bi-box-arrow-in-up-right"></i>
          </button>
          <button class="btn btn-outline-secondary p-1" title="Ocultar janela" data-action="hide" data-acc="${cli.accountId}">
            <i class="bi bi-eye-slash"></i>
          </button>
          <button class="btn btn-outline-secondary p-1" title="Mostrar janela" data-action="show" data-acc="${cli.accountId}">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-outline-secondary p-1 dropdown-toggle" data-bs-toggle="dropdown" title="Redimensionar">
            <i class="bi bi-aspect-ratio"></i>
          </button>
          <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end small">
            <li><a class="dropdown-item" href="#" data-resize="800x600" data-acc="${cli.accountId}">800 × 600</a></li>
            <li><a class="dropdown-item" href="#" data-resize="1024x768" data-acc="${cli.accountId}">1024 × 768</a></li>
            <li><a class="dropdown-item" href="#" data-resize="1280x720" data-acc="${cli.accountId}">1280 × 720 (HD)</a></li>
          </ul>
        </div>
      </div>
      <div class="client-meta d-flex gap-3">
        <span>PID: ${cli.pid}</span>
        <span>CPU: ${met.cpuPercent.toFixed(1)}%</span>
        <span>RAM: ${met.memoryMb} MB</span>
      </div>
      ${mem.hp ? `
        <div class="client-bars">
          <div class="d-flex justify-content-between" style="font-size: 10px; color: #f87171;">
            <span>HP: ${mem.hp} / ${mem.max_hp || mem.hp}</span>
            <span>${hpPct}%</span>
          </div>
          <div class="mini-bar"><div class="mini-bar-fill-hp" style="width: ${hpPct}%;"></div></div>
          <div class="d-flex justify-content-between" style="font-size: 10px; color: #60a5fa;">
            <span>MP: ${mem.mp} / ${mem.max_mp || mem.mp}</span>
            <span>${mpPct}%</span>
          </div>
          <div class="mini-bar"><div class="mini-bar-fill-mp" style="width: ${mpPct}%;"></div></div>
        </div>
      ` : ''}
    `;

    // Ações de botões
    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.onclick = async () => {
        const act = btn.getAttribute('data-action');
        const accId = btn.getAttribute('data-acc');
        if (act === 'focus') {
          await pw.call('game:focus', accId);
          logLine('WINDOW', `Foco solicitado para conta ${charName}`, 'win');
        } else if (act === 'hide') {
          await pw.call('game:set-visibility', accId, false);
          logLine('WINDOW', `Janela oculta: ${charName}`, 'win');
        } else if (act === 'show') {
          await pw.call('game:set-visibility', accId, true);
          logLine('WINDOW', `Janela exibida: ${charName}`, 'win');
        }
      };
    });

    card.querySelectorAll('[data-resize]').forEach((item) => {
      item.onclick = async (e) => {
        e.preventDefault();
        const [w, h] = item.getAttribute('data-resize').split('x').map(Number);
        const accId = item.getAttribute('data-acc');
        await pw.call('game:resize', accId, w, h);
        logLine('WINDOW', `Redimensionado para ${w}x${h}: ${charName}`, 'win');
      };
    });

    elClientsList.appendChild(card);
  });
}

// Switch do Modo Desempenho
elPerfSwitch.onchange = async () => {
  const on = elPerfSwitch.checked;
  await pw.call('system:set-performance-mode', on);
  logLine('PERF', `Modo Desempenho ${on ? 'LIGADO' : 'DESLIGADO'}`, 'perf');
};

elBtnClear.onclick = () => {
  elLogConsole.innerHTML = '';
  eventCount = 0;
  elEventCountBadge.textContent = '0 eventos';
};

pw.on('state', (s) => {
  state = s;
  if (state.settings?.performanceMode !== undefined) {
    elPerfSwitch.checked = !!state.settings.performanceMode;
  }
  refreshClients();
});

pw.on('sync:log', (entry) => {
  logLine(entry.tag || 'SYNC', entry.message, entry.kind || 'sync');
});

pw.on('memory:values', ({ accountId, values }) => {
  memoryStats[accountId] = { values, time: Date.now() };
  refreshClients();
});

pw.call('state:get').then((s) => {
  state = s;
  if (state.settings?.performanceMode !== undefined) {
    elPerfSwitch.checked = !!state.settings.performanceMode;
  }
  refreshClients();
  logLine('SYS', 'Painel de diagnóstico e monitoramento conectado.', 'win');
});

// Polling suave de métricas e status a cada 1.5s
setInterval(refreshClients, 1500);
