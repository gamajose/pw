// Lógica da Busca Rápida (Spotlight / Paleta de Comandos)
const pw = window.pw;
let state = null;
let selectedIndex = 0;
let currentItems = [];

const elInput = document.getElementById('search-input');
const elResults = document.getElementById('results-list');
const elBtnClose = document.getElementById('btn-close');

function getActions() {
  const syncRunning = !!state?.party?.syncRunning;
  return [
    {
      id: 'act:sync',
      category: 'Ações Rápidas',
      title: syncRunning ? 'Desligar Sync Action' : 'Ligar Sync Action',
      desc: 'Espelhamento de teclado e cliques nos membros',
      icon: 'bi-broadcast',
      run: () => pw.call(syncRunning ? 'party:sync-stop' : 'party:sync-start'),
    },
    {
      id: 'act:align-cam',
      category: 'Ações Rápidas',
      title: 'Alinhar Câmera com Líder',
      desc: 'Sincroniza yaw, pitch e zoom de todos com o líder',
      icon: 'bi-camera-video',
      run: () => pw.call('party:align-camera'),
    },
    {
      id: 'act:grid',
      category: 'Ações Rápidas',
      title: 'Alternar Grid de Alinhamento de HUD',
      desc: 'Mostra ou esconde linhas guias para alinhar a interface do jogo',
      icon: 'bi-grid-3x3',
      run: () => pw.call('windows:toggle-hud-grid'),
    },
    {
      id: 'act:stop-all',
      category: 'Ações Rápidas',
      title: 'Parar Todos os Presets e Sync',
      desc: 'Cancela execuções ativas e desliga o sync',
      icon: 'bi-stop-circle',
      run: () => pw.call('party:stop-all'),
    },
    {
      id: 'act:hide-clients',
      category: 'Ações Rápidas',
      title: 'Ocultar Todas as Janelas do Jogo',
      desc: 'Minimiza/oculta os clientes de elementclient',
      icon: 'bi-eye-slash',
      run: () => pw.call('game:set-all-visibility', false),
    },
    {
      id: 'act:show-clients',
      category: 'Ações Rápidas',
      title: 'Exibir Todas as Janelas do Jogo',
      desc: 'Restaura a exibição de todos os clientes',
      icon: 'bi-eye',
      run: () => pw.call('game:set-all-visibility', true),
    },
    {
      id: 'act:calc',
      category: 'Ferramentas',
      title: 'Calculadora de Livros Divinos',
      desc: 'Árvore de materiais e custos de tomos do Nível 1 ao 9',
      icon: 'bi-calculator',
      run: () => pw.call('windows:open-calc'),
    },
    {
      id: 'act:synclog',
      category: 'Ferramentas',
      title: 'Diagnóstico & Log do Sync',
      desc: 'Monitor de CPU, janelas, memória e cliques em tempo real',
      icon: 'bi-speedometer2',
      run: () => pw.call('windows:open-synclog'),
    },
    {
      id: 'act:toolbar',
      category: 'Ferramentas',
      title: 'Abrir Barra de Ferramentas Flutuante',
      desc: 'Exibe a barra rápida de controle no topo',
      icon: 'bi-layout-sidebar',
      run: () => pw.call('windows:open-toolbar'),
    },
  ];
}

function renderResults() {
  const query = elInput.value.trim().toLowerCase();
  const items = [];

  // Ações
  for (const act of getActions()) {
    if (!query || act.title.toLowerCase().includes(query) || act.desc.toLowerCase().includes(query)) {
      items.push(act);
    }
  }

  // Contas
  const accounts = state?.accounts || [];
  for (const a of accounts) {
    const text = `${a.name} ${a.character || ''} ${a.login || ''} ${a.tag || ''}`.toLowerCase();
    if (!query || text.includes(query)) {
      const isRunning = (state?.running || []).some((r) => r.accountId === a.id);
      items.push({
        id: `acc:${a.id}`,
        category: 'Contas',
        title: a.character ? `${a.character} (${a.name})` : a.name,
        desc: isRunning ? 'Em execução · Clique para focar' : 'Clique para abrir o cliente',
        icon: isRunning ? 'bi-play-circle-fill text-success' : 'bi-person',
        hint: isRunning ? 'Focar' : 'Abrir',
        run: () => (isRunning ? pw.call('game:focus', a.id) : pw.call('game:launch', [a.id])),
      });
    }
  }

  // Grupos
  const groups = state?.groups || [];
  for (const g of groups) {
    if (!query || g.name.toLowerCase().includes(query)) {
      items.push({
        id: `grp:${g.id}`,
        category: 'Grupos',
        title: `Grupo: ${g.name}`,
        desc: `${(g.memberIds || []).length} membros cadastrados`,
        icon: 'bi-diagram-3',
        hint: 'Abrir todos',
        run: () => pw.call('party:launch-group', g.id),
      });
    }
  }

  // Presets
  const presets = state?.presets || [];
  for (const p of presets) {
    if (!query || p.name.toLowerCase().includes(query)) {
      items.push({
        id: `pst:${p.id}`,
        category: 'Presets',
        title: `Preset: ${p.name}`,
        desc: `${(p.steps || []).length} passos · Atalho: ${p.hotkey || 'Nenhum'}`,
        icon: 'bi-lightning-charge',
        hint: 'Executar',
        run: () => pw.call('presets:run', p.id),
      });
    }
  }

  currentItems = items;
  if (selectedIndex >= currentItems.length) selectedIndex = Math.max(0, currentItems.length - 1);

  if (currentItems.length === 0) {
    elResults.innerHTML = '<div class="text-center text-body-secondary py-4 small">Nenhum resultado encontrado.</div>';
    return;
  }

  // Render grouped by category
  elResults.innerHTML = '';
  let lastCat = null;
  currentItems.forEach((item, idx) => {
    if (item.category !== lastCat) {
      lastCat = item.category;
      const catDiv = document.createElement('div');
      catDiv.className = 'result-category';
      catDiv.textContent = item.category;
      elResults.appendChild(catDiv);
    }

    const itemDiv = document.createElement('div');
    itemDiv.className = `result-item ${idx === selectedIndex ? 'selected' : ''}`;
    itemDiv.innerHTML = `
      <div class="result-left">
        <span class="result-icon"><i class="bi ${item.icon}"></i></span>
        <div>
          <span class="result-title">${escapeHtml(item.title)}</span>
          <span class="result-desc">${escapeHtml(item.desc || '')}</span>
        </div>
      </div>
      ${item.hint ? `<span class="result-hint">${escapeHtml(item.hint)}</span>` : ''}
    `;

    itemDiv.onclick = () => executeItem(idx);
    elResults.appendChild(itemDiv);
  });

  const selEl = elResults.querySelector('.result-item.selected');
  if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function executeItem(idx) {
  const item = currentItems[idx];
  if (!item) return;
  try {
    await item.run();
  } catch (err) {
    console.error('Erro na ação:', err);
  } finally {
    pw.call('windows:close-search');
  }
}

elInput.oninput = () => {
  selectedIndex = 0;
  renderResults();
};

window.onkeydown = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    pw.call('windows:close-search');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentItems.length > 0) {
      selectedIndex = (selectedIndex + 1) % currentItems.length;
      renderResults();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentItems.length > 0) {
      selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
      renderResults();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    executeItem(selectedIndex);
  }
};

elBtnClose.onclick = () => pw.call('windows:close-search');

pw.on('state', (s) => {
  state = s;
  renderResults();
});

pw.call('state:get').then((s) => {
  state = s;
  renderResults();
});
