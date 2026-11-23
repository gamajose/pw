// Interface de visualização e controle do Auto Forja.
import { call, onEvent } from '../api.js';
import { esc, toast, run } from '../ui.js';

let container = null;
let stateRef = null;
let forjaState = null;
let availableAttrs = [];
let targetRules = [
  { id: 'intervalo', count: 2 }, // Padrão clássico: 2x Intervalo de Ataque (-0.10s)
];
let unlistenUpdate = null;

export async function mount(el, state) {
  container = el;
  stateRef = state;

  try {
    availableAttrs = await call('forja:get-attributes');
    forjaState = await call('forja:state');
  } catch {
    availableAttrs = [];
    forjaState = { running: false, cycle: 0, matched: false, history: [] };
  }

  // Se já havia configuração salva
  if (forjaState?.config?.targetAttrs?.length) {
    targetRules = forjaState.config.targetAttrs;
  }

  unlistenUpdate = onEvent('forja:update', (updated) => {
    forjaState = updated;
    renderStatusBadge();
    renderHistory();
  });

  render();
}

export function unmount() {
  if (unlistenUpdate) {
    unlistenUpdate();
    unlistenUpdate = null;
  }
  container = null;
}

export function update(state) {
  stateRef = state;
  updateAccountSelect();
}

function render() {
  if (!container) return;

  const runningAccs = stateRef?.running || [];
  const selectedAccId = forjaState?.config?.accountId || runningAccs[0]?.accountId || '';

  container.innerHTML = `
    <div class="view-header d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="h4 mb-1"><i class="bi bi-fire text-warning"></i> Auto Forja</h2>
        <div class="text-body-secondary small">Automação inteligente de forja e reforja de equipamentos com verificação de atributos em tempo real.</div>
      </div>
      <div id="forja-status-badge"></div>
    </div>

    <div class="row g-3">
      <!-- Painel Esquerdo: Configuração dos Botões e Parâmetros -->
      <div class="col-lg-5">
        <div class="card h-100 shadow-sm border-secondary-subtle">
          <div class="card-header bg-body-tertiary d-flex justify-content-between align-items-center py-2">
            <span class="fw-semibold small"><i class="bi bi-sliders"></i> Parâmetros do NPC</span>
            <button class="btn btn-xs btn-outline-secondary" id="forja-save-cfg"><i class="bi bi-save"></i> Salvar</button>
          </div>
          <div class="card-body small">
            <div class="mb-3">
              <label class="form-label text-body-secondary mb-1">Personagem Executor</label>
              <select class="form-select form-select-sm" id="forja-account">
                ${renderAccountOptions(selectedAccId)}
              </select>
              <div class="form-text">A janela deste personagem será focada e receberá os cliques.</div>
            </div>

            <!-- Botão Máximo -->
            <div class="mb-3">
              <label class="form-label text-body-secondary mb-1">Botão "Máximo" (NPC)</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text">X</span>
                <input type="number" step="0.001" min="0" max="1" class="form-control" id="forja-max-rx" value="${forjaState?.config?.maxBtn?.rx ?? 0.485}">
                <span class="input-group-text">Y</span>
                <input type="number" step="0.001" min="0" max="1" class="form-control" id="forja-max-ry" value="${forjaState?.config?.maxBtn?.ry ?? 0.720}">
                <button class="btn btn-outline-primary" id="btn-cap-max" title="Capturar clique na tela"><i class="bi bi-crosshair"></i> Capturar</button>
              </div>
            </div>

            <!-- Botão Iniciar -->
            <div class="mb-3">
              <label class="form-label text-body-secondary mb-1">Botão "Iniciar" / Forjar (NPC)</label>
              <div class="input-group input-group-sm">
                <span class="input-group-text">X</span>
                <input type="number" step="0.001" min="0" max="1" class="form-control" id="forja-start-rx" value="${forjaState?.config?.startBtn?.rx ?? 0.515}">
                <span class="input-group-text">Y</span>
                <input type="number" step="0.001" min="0" max="1" class="form-control" id="forja-start-ry" value="${forjaState?.config?.startBtn?.ry ?? 0.810}">
                <button class="btn btn-outline-primary" id="btn-cap-start" title="Capturar clique na tela"><i class="bi bi-crosshair"></i> Capturar</button>
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label text-body-secondary mb-1">Tecla Confirmação</label>
                <select class="form-select form-select-sm" id="forja-key">
                  <option value="Enter" ${forjaState?.config?.confirmKey === 'Enter' ? 'selected' : ''}>Enter (Padrão)</option>
                  <option value="Space" ${forjaState?.config?.confirmKey === 'Space' ? 'selected' : ''}>Espaço</option>
                  <option value="1" ${forjaState?.config?.confirmKey === '1' ? 'selected' : ''}>Tecla 1</option>
                  <option value="2" ${forjaState?.config?.confirmKey === '2' ? 'selected' : ''}>Tecla 2</option>
                </select>
              </div>
              <div class="col-6">
                <label class="form-label text-body-secondary mb-1">Delay Forja (ms)</label>
                <input type="number" class="form-control form-control-sm" id="forja-delay" value="${forjaState?.config?.delayMs ?? 1500}" min="300" max="10000" step="100">
              </div>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6">
                <label class="form-label text-body-secondary mb-1">Limite de Ciclos</label>
                <input type="number" class="form-control form-control-sm" id="forja-max-cycles" value="${forjaState?.config?.maxCycles ?? 500}" min="1" max="10000">
              </div>
              <div class="col-6">
                <label class="form-label text-body-secondary mb-1">Qtd. Slots</label>
                <input type="number" class="form-control form-control-sm" id="forja-slots" value="${forjaState?.config?.slotCount ?? 1}" min="1" max="16">
              </div>
            </div>

            <div class="form-check form-switch mb-3">
              <input class="form-check-input" type="checkbox" id="forja-dryrun" ${forjaState?.config?.dryRun ? 'checked' : ''}>
              <label class="form-check-label text-info" for="forja-dryrun">
                <i class="bi bi-cpu"></i> Modo Simulação Rápida (sem clicar no jogo)
              </label>
            </div>

            <div class="d-flex gap-2 pt-2">
              <button class="btn btn-success flex-fill" id="forja-btn-start">
                <i class="bi bi-play-fill"></i> Iniciar Forja
              </button>
              <button class="btn btn-danger flex-fill" id="forja-btn-stop" disabled>
                <i class="bi bi-stop-fill"></i> Parar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Painel Direito: Regras de Atributos Alvo & Log em Tempo Real -->
      <div class="col-lg-7">
        <!-- Card de Atributos Desejados -->
        <div class="card mb-3 shadow-sm border-secondary-subtle">
          <div class="card-header bg-body-tertiary d-flex justify-content-between align-items-center py-2">
            <span class="fw-semibold small"><i class="bi bi-bullseye text-danger"></i> Atributos Alvo para Parar (Filtro de Sucesso)</span>
            <span class="badge text-bg-primary" id="rules-count">${targetRules.length} regra(s)</span>
          </div>
          <div class="card-body p-3">
            <div class="d-flex gap-2 mb-3">
              <select class="form-select form-select-sm" id="select-attr-pool">
                ${availableAttrs.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
              </select>
              <select class="form-select form-select-sm" id="select-attr-count" style="max-width: 140px;">
                <option value="1">1 ocorrência (1x)</option>
                <option value="2" selected>2 ocorrências (2x)</option>
                <option value="3">3 ocorrências (3x)</option>
                <option value="4">4 ocorrências (4x)</option>
              </select>
              <button class="btn btn-sm btn-primary" id="btn-add-rule"><i class="bi bi-plus-lg"></i> Adicionar</button>
            </div>

            <div class="d-flex flex-wrap gap-2" id="target-rules-container">
              ${renderRulesBadges()}
            </div>
          </div>
        </div>

        <!-- Card de Histórico & Timeline de Ciclos -->
        <div class="card shadow-sm border-secondary-subtle">
          <div class="card-header bg-body-tertiary d-flex justify-content-between align-items-center py-2">
            <span class="fw-semibold small"><i class="bi bi-clock-history"></i> Histórico em Tempo Real</span>
            <button class="btn btn-xs btn-outline-secondary" id="btn-clear-history"><i class="bi bi-trash"></i> Limpar</button>
          </div>
          <div class="card-body p-0" style="max-height: 380px; overflow-y: auto;" id="forja-history-list">
            ${renderHistoryHtml()}
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
  renderStatusBadge();
}

function renderAccountOptions(selectedId) {
  const accs = stateRef?.accounts || [];
  const running = stateRef?.running || [];
  if (!accs.length) return '<option value="">Nenhuma conta cadastrada</option>';

  return accs
    .map((a) => {
      const isRunning = running.some((r) => r.accountId === a.id);
      const isSel = a.id === selectedId;
      const statusIcon = isRunning ? '🟢' : '⚪';
      return `<option value="${a.id}" ${isSel ? 'selected' : ''}>${statusIcon} ${esc(a.character || a.login)} (${esc(a.login)})</option>`;
    })
    .join('');
}

function updateAccountSelect() {
  const sel = document.getElementById('forja-account');
  if (sel) {
    const curVal = sel.value;
    sel.innerHTML = renderAccountOptions(curVal);
  }
}

function renderRulesBadges() {
  if (!targetRules.length) {
    return '<span class="text-body-secondary fst-italic small">Nenhum atributo definido. Adicione acima para saber quando parar.</span>';
  }

  return targetRules
    .map((r, idx) => {
      const attr = availableAttrs.find((a) => a.id === r.id);
      const label = attr?.short || attr?.name || r.id;
      return `
      <span class="badge text-bg-dark border border-secondary p-2 d-inline-flex align-items-center gap-2">
        <i class="bi bi-stars text-warning"></i>
        <span><strong>${r.count}x</strong> ${esc(label)}</span>
        <button type="button" class="btn-close btn-close-white btn-xs" data-rule-idx="${idx}" aria-label="Remover"></button>
      </span>
    `;
    })
    .join('');
}

function renderStatusBadge() {
  const badge = document.getElementById('forja-status-badge');
  const btnStart = document.getElementById('forja-btn-start');
  const btnStop = document.getElementById('forja-btn-stop');
  if (!badge) return;

  const isRunning = forjaState?.running;
  const isMatched = forjaState?.matched;
  const cycle = forjaState?.cycle || 0;

  if (btnStart) btnStart.disabled = isRunning;
  if (btnStop) btnStop.disabled = !isRunning;

  if (isMatched) {
    badge.innerHTML = `
      <span class="badge text-bg-success fs-6 px-3 py-2 animate__animated animate__pulse animate__infinite">
        <i class="bi bi-trophy-fill text-warning"></i> Atributos Encontrados! (Ciclo #${cycle})
      </span>
    `;
  } else if (isRunning) {
    badge.innerHTML = `
      <span class="badge text-bg-warning fs-6 px-3 py-2 text-dark">
        <span class="spinner-border spinner-border-sm me-1" role="status"></span>
        Executando Ciclo #${cycle} (${esc(forjaState?.currentStep || 'rodando')})
      </span>
    `;
  } else {
    badge.innerHTML = `
      <span class="badge text-bg-secondary fs-6 px-3 py-2">
        <i class="bi bi-circle"></i> Parado (Último ciclo: ${cycle})
      </span>
    `;
  }
}

function renderHistoryHtml() {
  const hist = forjaState?.history || [];
  if (!hist.length) {
    return `<div class="p-4 text-center text-body-secondary small">Nenhum ciclo realizado ainda. Clique em "Iniciar Forja" para começar.</div>`;
  }

  return `
    <table class="table table-sm table-hover align-middle mb-0 small">
      <thead class="table-light">
        <tr>
          <th style="width: 70px;">Ciclo</th>
          <th style="width: 80px;">Hora</th>
          <th>Atributos Obtidos</th>
          <th style="width: 90px;" class="text-end">Status</th>
        </tr>
      </thead>
      <tbody>
        ${hist
          .map((h) => {
            const isMatch = h.matched;
            const rowClass = isMatch ? 'table-success fw-bold' : '';
            return `
            <tr class="${rowClass}">
              <td>#${h.cycle}</td>
              <td class="text-body-secondary">${esc(h.timestamp)}</td>
              <td>
                <div class="d-flex flex-wrap gap-1">
                  ${(h.attributes || [])
                    .map(
                      (a) =>
                        `<span class="badge ${isMatch ? 'text-bg-warning text-dark' : 'text-bg-dark border border-secondary-subtle'}">${esc(a.short || a.name)}</span>`,
                    )
                    .join('')}
                </div>
              </td>
              <td class="text-end">
                ${isMatch ? '<span class="badge text-bg-success"><i class="bi bi-check-circle-fill"></i> MATCH</span>' : '<span class="text-body-secondary">Tentando...</span>'}
              </td>
            </tr>
          `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderHistory() {
  const el = document.getElementById('forja-history-list');
  if (el) el.innerHTML = renderHistoryHtml();
}

function bindEvents() {
  // Adicionar regra
  document.getElementById('btn-add-rule')?.addEventListener('click', () => {
    const pool = document.getElementById('select-attr-pool');
    const cnt = document.getElementById('select-attr-count');
    if (!pool || !cnt) return;

    const id = pool.value;
    const count = parseInt(cnt.value, 10) || 1;

    // Se já existe, atualiza
    const existing = targetRules.find((r) => r.id === id);
    if (existing) {
      existing.count = count;
    } else {
      targetRules.push({ id, count });
    }

    const containerEl = document.getElementById('target-rules-container');
    if (containerEl) containerEl.innerHTML = renderRulesBadges();
    const countEl = document.getElementById('rules-count');
    if (countEl) countEl.textContent = `${targetRules.length} regra(s)`;
  });

  // Remover regra
  document.getElementById('target-rules-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rule-idx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.ruleIdx, 10);
    targetRules.splice(idx, 1);
    btn.closest('#target-rules-container').innerHTML = renderRulesBadges();
    const countEl = document.getElementById('rules-count');
    if (countEl) countEl.textContent = `${targetRules.length} regra(s)`;
  });

  // Capturar clique Máximo
  document.getElementById('btn-cap-max')?.addEventListener('click', async () => {
    const accId = document.getElementById('forja-account')?.value;
    if (!accId) return toast('Selecione um personagem primeiro.', 'warn');
    toast('Clique sobre o botão "Máximo" dentro da janela do jogo.', 'info');
    try {
      const res = await call('capture:click', accId);
      if (res) {
        document.getElementById('forja-max-rx').value = res.rx.toFixed(3);
        document.getElementById('forja-max-ry').value = res.ry.toFixed(3);
        toast('Posição do botão Máximo capturada com sucesso!', 'success');
      }
    } catch (e) {
      toast('Captura cancelada ou falhou: ' + e.message, 'warn');
    }
  });

  // Capturar clique Iniciar
  document.getElementById('btn-cap-start')?.addEventListener('click', async () => {
    const accId = document.getElementById('forja-account')?.value;
    if (!accId) return toast('Selecione um personagem primeiro.', 'warn');
    toast('Clique sobre o botão "Iniciar" dentro da janela do jogo.', 'info');
    try {
      const res = await call('capture:click', accId);
      if (res) {
        document.getElementById('forja-start-rx').value = res.rx.toFixed(3);
        document.getElementById('forja-start-ry').value = res.ry.toFixed(3);
        toast('Posição do botão Iniciar capturada com sucesso!', 'success');
      }
    } catch (e) {
      toast('Captura cancelada ou falhou: ' + e.message, 'warn');
    }
  });

  // Iniciar Forja
  document.getElementById('forja-btn-start')?.addEventListener('click', () => {
    run(async () => {
      const accountId = document.getElementById('forja-account')?.value;
      const maxRx = parseFloat(document.getElementById('forja-max-rx')?.value) || 0.485;
      const maxRy = parseFloat(document.getElementById('forja-max-ry')?.value) || 0.720;
      const startRx = parseFloat(document.getElementById('forja-start-rx')?.value) || 0.515;
      const startRy = parseFloat(document.getElementById('forja-start-ry')?.value) || 0.810;
      const confirmKey = document.getElementById('forja-key')?.value || 'Enter';
      const delayMs = parseInt(document.getElementById('forja-delay')?.value, 10) || 1500;
      const maxCycles = parseInt(document.getElementById('forja-max-cycles')?.value, 10) || 500;
      const slotCount = parseInt(document.getElementById('forja-slots')?.value, 10) || 1;
      const dryRun = document.getElementById('forja-dryrun')?.checked || false;

      if (!targetRules.length) {
        throw new Error('Adicione ao menos um atributo alvo antes de iniciar.');
      }

      const cfg = {
        accountId,
        maxBtn: { rx: maxRx, ry: maxRy },
        startBtn: { rx: startRx, ry: startRy },
        confirmKey,
        delayMs,
        maxCycles,
        slotCount,
        dryRun,
        targetAttrs: targetRules,
      };

      forjaState = await call('forja:start', cfg);
      renderStatusBadge();
    }, 'Auto Forja iniciada com sucesso!');
  });

  // Parar Forja
  document.getElementById('forja-btn-stop')?.addEventListener('click', () => {
    run(async () => {
      forjaState = await call('forja:stop');
      renderStatusBadge();
    }, 'Auto Forja interrompida.');
  });

  // Limpar Histórico
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (forjaState) forjaState.history = [];
    renderHistory();
  });
}
