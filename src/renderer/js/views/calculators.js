// Calculadora de Livros Divinos (Tomos Nível 1 ao 9)
import { pw } from '../api.js';
import { toast } from '../ui.js';

const TIER_PAGES = [0, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683];
const TIER_FEES = [0, 10000, 50000, 250000, 1000000, 4000000, 15000000, 50000000, 150000000, 450000000];

const FAMOUS_BOOKS = {
  1: ['Força (+3)', 'Agilidade (+3)', 'Inteligência (+3)', 'Vitalidade (+3)'],
  2: ['Primavera das Borboletas', 'Chuva de Outono', 'Trabalho Pesado', 'Voz da Natureza'],
  3: ['A Dança dos Fantasmas', 'Chuva de Flores', 'Três Vidas', 'Vento Forte'],
  4: ['Rio Vermelho', 'Orvalho da Manhã', 'Canto Fúnebre', 'Lua Crescente'],
  5: ['Pangu (+15 Atributos)', 'Lágrimas do Paraíso', 'Sonho da Flor', 'Alma Desperta'],
  6: ['Insaciável (Pangu Aprimorado)', 'Coração Falso', 'Canto do Vento', 'Flor de Ameixa'],
  7: ['Amor Imortal', 'Chuva de Sangue', 'Destino Trágico', 'Poder do Imperador'],
  8: ['Selo do Dragão', 'Chama Eterna', 'Lorde Supremo', 'Visão Celeste'],
  9: ['Criação do Mundo', 'Eternidade Divina', 'Espírito Cósmico', 'Onipotência'],
};

export function render(container, state) {
  const calcSettings = state.settings?.calculator || {
    pagePrice: 150000,
    fragmentPrice: 50000,
    targetTier: 5,
    targetBook: 'Pangu (+15 Atributos)',
    ownedPages: 0,
    ownedBooks: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h4 class="mb-0 fw-bold"><i class="bi bi-calculator text-primary"></i> Calculadora de Livros Divinos</h4>
        <div class="text-body-secondary small">Simulação da árvore de evolução, materiais e custos de confecção (Nível 1 ao 9)</div>
      </div>
      <button class="btn btn-sm btn-outline-primary" id="btn-save-prices">
        <i class="bi bi-floppy"></i> Salvar Cotações
      </button>
    </div>

    <div class="row g-3">
      <!-- Painel de configuração -->
      <div class="col-md-5">
        <div class="card bg-body-tertiary border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="fw-bold mb-3"><i class="bi bi-sliders"></i> Livro Desejado</h6>

            <div class="mb-3">
              <label class="form-label small text-body-secondary mb-1">Nível do Tomo (Tier)</label>
              <select class="form-select form-select-sm" id="calc-tier">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9]
                  .map((t) => `<option value="${t}" ${t === calcSettings.targetTier ? 'selected' : ''}>Nível ${t} (requer ${TIER_PAGES[t]} páginas base)</option>`)
                  .join('')}
              </select>
            </div>

            <div class="mb-3">
              <label class="form-label small text-body-secondary mb-1">Livro Exemplo</label>
              <select class="form-select form-select-sm" id="calc-book"></select>
            </div>

            <hr class="border-secondary my-3" />

            <h6 class="fw-bold mb-3"><i class="bi bi-coin text-warning"></i> Cotações do Servidor (Moedas)</h6>

            <div class="mb-2">
              <label class="form-label small text-body-secondary mb-1">Preço da Página Antiga (Moedas)</label>
              <input type="number" class="form-control form-control-sm" id="price-page" value="${calcSettings.pagePrice || 150000}" min="0" step="1000" />
            </div>

            <div class="mb-2">
              <label class="form-label small text-body-secondary mb-1">Preço do Fragmento Elementar (Moedas)</label>
              <input type="number" class="form-control form-control-sm" id="price-frag" value="${calcSettings.fragmentPrice || 50000}" min="0" step="1000" />
            </div>

            <hr class="border-secondary my-3" />

            <h6 class="fw-bold mb-3"><i class="bi bi-box-seam"></i> Materiais que Você Já Possui</h6>

            <div class="mb-2">
              <label class="form-label small text-body-secondary mb-1">Páginas Antigas no Baú</label>
              <input type="number" class="form-control form-control-sm" id="owned-pages" value="${calcSettings.ownedPages || 0}" min="0" />
            </div>

            <div class="row g-2 mb-2">
              ${[1, 2, 3, 4, 5]
                .map(
                  (t) => `
                <div class="col-6">
                  <label class="form-label small text-body-secondary mb-1" style="font-size: 11px;">Tomos Nível ${t} Possuídos</label>
                  <input type="number" class="form-control form-control-sm owned-book" data-tier="${t}" value="${calcSettings.ownedBooks?.[t] || 0}" min="0" />
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Painel de Resultados -->
      <div class="col-md-7">
        <div class="card bg-body-tertiary border-0 shadow-sm mb-3">
          <div class="card-body">
            <h6 class="fw-bold mb-3"><i class="bi bi-receipt"></i> Estimativa de Custos e Confecção</h6>

            <div class="row g-2 mb-4">
              <div class="col-6">
                <div class="p-3 bg-dark-subtle rounded border border-secondary-subtle">
                  <div class="small text-body-secondary">Páginas Totais Necessárias</div>
                  <div class="fs-4 fw-bold text-primary" id="res-total-pages">0</div>
                  <div class="small text-success" id="res-remaining-pages" style="font-size: 11px;">Restantes: 0</div>
                </div>
              </div>

              <div class="col-6">
                <div class="p-3 bg-dark-subtle rounded border border-secondary-subtle">
                  <div class="small text-body-secondary">Custo Estimado em Moedas</div>
                  <div class="fs-4 fw-bold text-warning" id="res-total-coins">0</div>
                  <div class="small text-body-secondary" id="res-fees-coins" style="font-size: 11px;">Taxas de Forja: 0</div>
                </div>
              </div>
            </div>

            <h6 class="fw-bold mb-2 small text-uppercase text-body-secondary">Árvore de Síntese de Livros</h6>
            <div class="table-responsive">
              <table class="table table-sm table-bordered text-center align-middle" style="font-size: 12px;">
                <thead class="table-dark">
                  <tr>
                    <th>Nível (Tier)</th>
                    <th>Tomos Necessários</th>
                    <th>Páginas Base</th>
                    <th>Você Já Possui</th>
                    <th>Falta Produzir</th>
                  </tr>
                </thead>
                <tbody id="synthesis-table"></tbody>
              </table>
            </div>

            <div class="alert alert-info py-2 px-3 small mt-3 mb-0">
              <i class="bi bi-info-circle me-1"></i>
              Cada nível de livro consome 3 livros do nível imediatamente anterior (relação 1:3). Livros já possuídos são descontados automaticamente das etapas inferiores.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const elTier = container.querySelector('#calc-tier');
  const elBook = container.querySelector('#calc-book');
  const elPricePage = container.querySelector('#price-page');
  const elPriceFrag = container.querySelector('#price-frag');
  const elOwnedPages = container.querySelector('#owned-pages');
  const elBtnSave = container.querySelector('#btn-save-prices');

  function updateBookOptions() {
    const tier = Number(elTier.value);
    const books = FAMOUS_BOOKS[tier] || [];
    elBook.innerHTML = books.map((b) => `<option value="${b}">${b}</option>`).join('');
  }

  function calculate() {
    const targetTier = Number(elTier.value);
    const pagePrice = Number(elPricePage.value) || 0;
    const ownedPages = Number(elOwnedPages.value) || 0;

    const ownedBooks = {};
    container.querySelectorAll('.owned-book').forEach((inp) => {
      ownedBooks[inp.getAttribute('data-tier')] = Number(inp.value) || 0;
    });

    const totalRawPages = TIER_PAGES[targetTier];
    const totalForgeFee = TIER_FEES[targetTier];

    // Descontar livros já possuídos
    let equivalentOwnedPages = ownedPages;
    for (let t = 1; t <= 5; t++) {
      if (ownedBooks[t] && t <= targetTier) {
        equivalentOwnedPages += ownedBooks[t] * TIER_PAGES[t];
      }
    }

    const remainingPages = Math.max(0, totalRawPages - equivalentOwnedPages);
    const materialsCost = remainingPages * pagePrice;
    const totalCost = materialsCost + totalForgeFee;

    container.querySelector('#res-total-pages').textContent = totalRawPages.toLocaleString('pt-BR');
    container.querySelector('#res-remaining-pages').textContent = `Faltam: ${remainingPages.toLocaleString('pt-BR')} páginas`;
    container.querySelector('#res-total-coins').textContent = `${(totalCost / 1000000).toFixed(2)}kk`;
    container.querySelector('#res-fees-coins').textContent = `Taxas NPC: ${(totalForgeFee / 1000000).toFixed(2)}kk`;

    // Preencher tabela
    const tbody = container.querySelector('#synthesis-table');
    tbody.innerHTML = '';
    for (let t = targetTier; t >= 1; t--) {
      const neededForTarget = Math.pow(3, targetTier - t);
      const pagesEach = TIER_PAGES[t];
      const owned = ownedBooks[t] || 0;
      const missing = Math.max(0, neededForTarget - owned);

      const tr = document.createElement('tr');
      if (t === targetTier) tr.className = 'table-primary fw-bold';
      tr.innerHTML = `
        <td>Nível ${t}</td>
        <td>${neededForTarget.toLocaleString('pt-BR')} un</td>
        <td>${pagesEach.toLocaleString('pt-BR')} pág</td>
        <td class="${owned > 0 ? 'text-success fw-bold' : ''}">${owned}</td>
        <td class="${missing > 0 ? 'text-warning' : 'text-success'}">${missing} un</td>
      `;
      tbody.appendChild(tr);
    }
  }

  elTier.onchange = () => {
    updateBookOptions();
    calculate();
  };

  elBook.onchange = calculate;
  elPricePage.oninput = calculate;
  elPriceFrag.oninput = calculate;
  elOwnedPages.oninput = calculate;
  container.querySelectorAll('.owned-book').forEach((inp) => (inp.oninput = calculate));

  elBtnSave.onclick = async () => {
    const targetTier = Number(elTier.value);
    const ownedBooks = {};
    container.querySelectorAll('.owned-book').forEach((inp) => {
      ownedBooks[inp.getAttribute('data-tier')] = Number(inp.value) || 0;
    });

    const newCalcSettings = {
      pagePrice: Number(elPricePage.value) || 0,
      fragmentPrice: Number(elPriceFrag.value) || 0,
      targetTier,
      targetBook: elBook.value,
      ownedPages: Number(elOwnedPages.value) || 0,
      ownedBooks,
    };

    await pw.call('settings:save-calculator', newCalcSettings);
    toast('Cotações e preferências da calculadora salvas com sucesso!', 'success');
  };

  updateBookOptions();
  calculate();
}
