// Interface de visualização e inspeção de equipamentos (Paperdoll).
import { call } from '../api.js';
import { esc, toast, run } from '../ui.js';

let container = null;
let stateRef = null;
let currentBuild = null;
let selectedSlot = null;

export async function mount(el, state) {
  container = el;
  stateRef = state;

  const runningAccs = stateRef?.running || [];
  const initialAccId = runningAccs[0]?.accountId || stateRef?.accounts[0]?.id || '';

  try {
    currentBuild = await call('equipment:read', initialAccId);
  } catch {
    currentBuild = null;
  }

  render();
}

export function unmount() {
  container = null;
  selectedSlot = null;
}

export function update(state) {
  stateRef = state;
}

function render() {
  if (!container) return;

  const runningAccs = stateRef?.running || [];
  const accs = stateRef?.accounts || [];
  const selectedAccId = runningAccs[0]?.accountId || accs[0]?.id || '';

  container.innerHTML = `
    <div class="view-header d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="h4 mb-1"><i class="bi bi-shield-shaded text-primary"></i> Leitor de Equipamentos</h2>
        <div class="text-body-secondary small">Inspeção tática de armaduras, armas, refinos, pedras e cálculo de atributos de combate.</div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <select class="form-select form-select-sm" id="equip-select-account" style="max-width: 220px;">
          ${accs.map((a) => `<option value="${a.id}" ${a.id === selectedAccId ? 'selected' : ''}>${esc(a.character || a.login)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" id="btn-read-game"><i class="bi bi-arrow-repeat"></i> Ler do Jogo</button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-export-build"><i class="bi bi-share"></i> Exportar</button>
      </div>
    </div>

    <!-- Layout Paperdoll -->
    <div class="row g-3">
      <!-- Coluna Esquerda: Defesas e Armaduras -->
      <div class="col-lg-3 d-flex flex-column gap-2" id="slots-left">
        ${renderSlotCard(1)} <!-- Elmo -->
        ${renderSlotCard(2)} <!-- Colar -->
        ${renderSlotCard(3)} <!-- Armadura -->
        ${renderSlotCard(4)} <!-- Calça -->
        ${renderSlotCard(5)} <!-- Botas -->
      </div>

      <!-- Coluna Central: Identidade & Atributos Globais -->
      <div class="col-lg-6">
        <!-- Card de Perfil do Personagem -->
        <div class="card bg-body-tertiary border-secondary-subtle shadow-sm mb-3">
          <div class="card-body p-3 text-center">
            <div class="d-inline-flex p-3 rounded-circle bg-primary bg-opacity-10 text-primary mb-2">
              <i class="bi bi-person-badge fs-2"></i>
            </div>
            <h5 class="card-title mb-0">${esc(currentBuild?.character || 'Personagem')}</h5>
            <div class="text-body-secondary small mb-2">${esc(currentBuild?.cls || 'Guerreiro')} · Nível ${currentBuild?.level || 105} · ${esc(currentBuild?.cultivo || 'Evil 3')}</div>

            <!-- Barras de HP / MP -->
            <div class="row g-2 mb-3">
              <div class="col-6">
                <div class="d-flex justify-content-between small text-danger fw-semibold mb-1">
                  <span>HP</span>
                  <span>${(currentBuild?.totals?.hp || 18500).toLocaleString()}</span>
                </div>
                <div class="progress" style="height: 8px;">
                  <div class="progress-bar bg-danger" style="width: 100%;"></div>
                </div>
              </div>
              <div class="col-6">
                <div class="d-flex justify-content-between small text-primary fw-semibold mb-1">
                  <span>MP</span>
                  <span>${(currentBuild?.totals?.mp || 7200).toLocaleString()}</span>
                </div>
                <div class="progress" style="height: 8px;">
                  <div class="progress-bar bg-primary" style="width: 100%;"></div>
                </div>
              </div>
            </div>

            <!-- Grade de Atributos Totais de Combate -->
            <div class="row g-2 text-start small">
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Atq Físico</div>
                  <div class="fw-bold text-warning">${currentBuild?.totals?.patkMin || 14200} - ${currentBuild?.totals?.patkMax || 22400}</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Atq Mágico</div>
                  <div class="fw-bold text-info">${currentBuild?.totals?.matkMin || 4500} - ${currentBuild?.totals?.matkMax || 6200}</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Def Física</div>
                  <div class="fw-bold text-success">${(currentBuild?.totals?.pdef || 16800).toLocaleString()}</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Def Mágica</div>
                  <div class="fw-bold text-primary">${(currentBuild?.totals?.mdef || 11200).toLocaleString()}</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Crítico</div>
                  <div class="fw-bold text-danger">${currentBuild?.totals?.crit || 28}%</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Intervalo</div>
                  <div class="fw-bold text-warning">${currentBuild?.totals?.interval || -0.15}s</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Nv. Ataque</div>
                  <div class="fw-bold text-light">+${currentBuild?.totals?.atkLvl || 35}</div>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="p-2 rounded bg-dark border border-secondary-subtle">
                  <div class="text-body-secondary" style="font-size: 0.75rem;">Nv. Defesa</div>
                  <div class="fw-bold text-light">+${currentBuild?.totals?.defLvl || 42}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Linha Inferior: Slots Especiais (Livro, Voo, Amuleto, Hierograma, Astrolábio) -->
        <div class="d-flex gap-2 justify-content-center">
          ${renderMiniSlot(11)} <!-- Livro Divino -->
          ${renderMiniSlot(12)} <!-- Voo -->
          ${renderMiniSlot(13)} <!-- Amuleto -->
          ${renderMiniSlot(14)} <!-- Hierograma -->
          ${renderMiniSlot(15)} <!-- Astrolábio -->
        </div>
      </div>

      <!-- Coluna Direita: Armas e Acessórios -->
      <div class="col-lg-3 d-flex flex-column gap-2" id="slots-right">
        ${renderSlotCard(0)} <!-- Arma -->
        ${renderSlotCard(6)} <!-- Braceletes -->
        ${renderSlotCard(7)} <!-- Anel 1 -->
        ${renderSlotCard(8)} <!-- Anel 2 -->
        ${renderSlotCard(9)} <!-- Ornamento / Cinto -->
        ${renderSlotCard(10)} <!-- Capa -->
      </div>
    </div>

    <!-- Modal / Drawer de Detalhes do Item -->
    <div id="item-inspect-card" class="mt-3" style="display: none;"></div>
  `;

  bindEvents();
}

function renderSlotCard(slotIdx) {
  const slot = currentBuild?.slots?.[slotIdx];
  const item = slot?.item;
  const isSelected = selectedSlot === slotIdx;

  if (!item || slot.empty) {
    return `
      <div class="card p-2 bg-dark border border-secondary-subtle text-body-secondary d-flex flex-row align-items-center gap-2 slot-btn" data-slot="${slotIdx}" style="cursor: pointer;">
        <div class="p-2 rounded bg-body-tertiary"><i class="bi ${slot?.slotIcon || 'bi-square'}"></i></div>
        <div class="small fw-semibold">${slot?.slotName || `Slot #${slotIdx}`}</div>
        <span class="badge text-bg-secondary ms-auto">Vazio</span>
      </div>
    `;
  }

  const refineStr = item.refine ? `+${item.refine}` : '';
  const isWeapon = slotIdx === 0;
  const borderClass = isWeapon ? 'border-warning shadow-sm' : isSelected ? 'border-primary' : 'border-secondary-subtle';

  return `
    <div class="card p-2 bg-dark border ${borderClass} d-flex flex-row align-items-center gap-2 slot-btn" data-slot="${slotIdx}" style="cursor: pointer;">
      <div class="p-2 rounded ${isWeapon ? 'bg-warning bg-opacity-10 text-warning' : 'bg-body-tertiary text-primary'}">
        <i class="bi ${slot.slotIcon}"></i>
      </div>
      <div class="flex-fill text-truncate">
        <div class="fw-semibold small text-truncate ${isWeapon ? 'text-warning' : 'text-light'}">${esc(item.name)}</div>
        <div class="text-body-secondary" style="font-size: 0.72rem;">${item.sockets ? `${item.sockets} Furo(s)` : ''} ${refineStr ? `· Refino ${refineStr}` : ''}</div>
      </div>
      ${refineStr ? `<span class="badge text-bg-warning text-dark fw-bold">${refineStr}</span>` : ''}
    </div>
  `;
}

function renderMiniSlot(slotIdx) {
  const slot = currentBuild?.slots?.[slotIdx];
  const item = slot?.item;
  const isSelected = selectedSlot === slotIdx;

  return `
    <div class="card p-2 text-center bg-dark border ${isSelected ? 'border-primary' : 'border-secondary-subtle'} slot-btn" data-slot="${slotIdx}" style="cursor: pointer; width: 85px;">
      <div class="text-primary mb-1"><i class="bi ${slot?.slotIcon || 'bi-square'}"></i></div>
      <div class="text-truncate fw-semibold" style="font-size: 0.7rem;">${esc(item?.name || slot?.slotName || '')}</div>
    </div>
  `;
}

function inspectSlot(slotIdx) {
  selectedSlot = slotIdx;
  const slot = currentBuild?.slots?.[slotIdx];
  const card = document.getElementById('item-inspect-card');
  if (!card || !slot || !slot.item) {
    if (card) card.style.display = 'none';
    return;
  }

  const it = slot.item;
  card.style.display = 'block';
  card.innerHTML = `
    <div class="card border-primary bg-body-tertiary shadow-sm">
      <div class="card-header bg-dark d-flex justify-content-between align-items-center py-2">
        <span class="fw-bold text-warning small"><i class="bi ${slot.slotIcon}"></i> ${esc(it.name)} ${it.refine ? `(+${it.refine})` : ''}</span>
        <button class="btn-close btn-close-white btn-xs" id="btn-close-inspect"></button>
      </div>
      <div class="card-body p-3 small">
        <div class="row g-3">
          <div class="col-md-4">
            <div class="text-body-secondary mb-1">Grau de Raridade: <strong class="text-light">${it.grade || 15}</strong></div>
            <div class="text-body-secondary mb-1">Nível de Refino: <strong class="text-warning">+${it.refine || 0}</strong></div>
            <div class="text-body-secondary mb-1">Furos / Sockets: <strong class="text-info">${it.sockets || 0} / 4</strong></div>
          </div>
          <div class="col-md-8">
            <div class="fw-semibold text-info mb-1">Pedras Embutidas:</div>
            <div class="d-flex flex-wrap gap-1 mb-2">
              ${(it.gems || []).map((g) => `<span class="badge text-bg-dark border border-secondary">${esc(g.name)} (${esc(g.stat)})</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('btn-close-inspect')?.addEventListener('click', () => {
    card.style.display = 'none';
    selectedSlot = null;
  });
}

function bindEvents() {
  document.querySelectorAll('.slot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.slot, 10);
      inspectSlot(idx);
    });
  });

  // Ler do jogo
  document.getElementById('btn-read-game')?.addEventListener('click', () => {
    run(async () => {
      const accId = document.getElementById('equip-select-account')?.value;
      currentBuild = await call('equipment:read', accId);
      render();
    }, 'Equipamentos atualizados com sucesso!');
  });

  // Exportar build
  document.getElementById('btn-export-build')?.addEventListener('click', () => {
    if (!currentBuild) return;
    const jsonStr = JSON.stringify(currentBuild, null, 2);
    navigator.clipboard?.writeText(jsonStr).catch(() => {});
    toast('Build copiada para a área de transferência em formato JSON!', 'success');
  });
}
