// Interface do Mapa Interativo do Continente de Pan Gu (Perfect World).
import { call, onEvent } from '../api.js';
import { esc, toast, run } from '../ui.js';

let container = null;
let stateRef = null;
let mapData = { players: [], pois: [], routes: [] };
let unlistenCoords = null;

// Parâmetros de renderização do Canvas
let canvas = null;
let ctx = null;
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isDragging = false;
let startDragX = 0;
let startDragY = 0;
let activeFilters = { city: true, dungeon: true, boss: true, resource: true };
let followPlayerId = null;
let routeMode = false;
let currentRoute = [];
let hoveredPoi = null;
let mouseWorldPos = { x: 550, z: 650 };

export async function mount(el, state) {
  container = el;
  stateRef = state;

  try {
    mapData = await call('map:state');
  } catch {
    mapData = { players: [], pois: [], routes: [] };
  }

  // Centraliza inicialmente na Cidade do Dragão (552, 653)
  panX = -552 * 0.8 + 350;
  panY = -653 * 0.8 + 250;
  zoom = 0.9;

  unlistenCoords = onEvent('map:coords', (payload) => {
    mapData.players = payload.players || [];
    renderPlayersList();
    if (followPlayerId) {
      const p = mapData.players.find((x) => x.accountId === followPlayerId);
      if (p) centerOn(p.x, p.z);
    }
    draw();
  });

  render();
}

export function unmount() {
  if (unlistenCoords) {
    unlistenCoords();
    unlistenCoords = null;
  }
  container = null;
}

export function update(state) {
  stateRef = state;
}

function render() {
  if (!container) return;

  container.innerHTML = `
    <div class="view-header d-flex justify-content-between align-items-center mb-2">
      <div>
        <h2 class="h4 mb-0"><i class="bi bi-map text-info"></i> Mapa Interativo de Pan Gu</h2>
        <div class="text-body-secondary small">Rastreamento de coordenadas em tempo real, navegação tática e criador de rotas de farm.</div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" id="btn-zoom-in" title="Aproximar"><i class="bi bi-zoom-in"></i></button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-zoom-out" title="Afastar"><i class="bi bi-zoom-out"></i></button>
        <button class="btn btn-sm btn-outline-secondary" id="btn-zoom-reset" title="Centralizar na CDD"><i class="bi bi-arrows-fullscreen"></i></button>
        <button class="btn btn-sm btn-outline-info" id="btn-toggle-route"><i class="bi bi-bezier2"></i> Criador de Rotas</button>
      </div>
    </div>

    <!-- Barra de Filtros e Busca Rápida -->
    <div class="card bg-body-tertiary border-secondary-subtle p-2 mb-2 small shadow-sm">
      <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="text-body-secondary me-1"><i class="bi bi-funnel"></i> Filtros:</span>
          <button class="btn btn-xs btn-outline-primary active filter-btn" data-category="city">🏰 Cidades</button>
          <button class="btn btn-xs btn-outline-purple active filter-btn" data-category="dungeon">⛩️ Dungeons</button>
          <button class="btn btn-xs btn-outline-danger active filter-btn" data-category="boss">🐉 Chefes</button>
          <button class="btn btn-xs btn-outline-warning active filter-btn" data-category="resource">⛏️ Recursos</button>
        </div>

        <div class="d-flex align-items-center gap-2">
          <div class="input-group input-group-sm" style="max-width: 260px;">
            <span class="input-group-text"><i class="bi bi-crosshair"></i></span>
            <input type="number" class="form-control" id="search-x" placeholder="X (ex: 552)" style="width: 70px;">
            <input type="number" class="form-control" id="search-z" placeholder="Z (ex: 653)" style="width: 70px;">
            <button class="btn btn-primary" id="btn-search-coords">Ir</button>
          </div>
          <span class="badge text-bg-dark border border-secondary px-2 py-1" id="coords-display">X: 552 | Z: 653</span>
        </div>
      </div>
    </div>

    <div class="row g-2">
      <!-- Área do Mapa (Canvas Interativo) -->
      <div class="col-lg-9">
        <div class="card bg-dark border-secondary position-relative shadow-sm" style="overflow: hidden; height: 600px;">
          <canvas id="pw-map-canvas" width="1000" height="600" style="cursor: grab; display: block; width: 100%; height: 100%;"></canvas>
          
          <div id="route-builder-overlay" class="position-absolute top-0 start-0 m-2 p-2 bg-dark bg-opacity-75 border border-info rounded text-white small" style="display: none; max-width: 340px;">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <strong class="text-info"><i class="bi bi-bezier2"></i> Modo Rota Ativo</strong>
              <button class="btn-close btn-close-white btn-xs" id="btn-close-route-mode"></button>
            </div>
            <div class="text-body-secondary mb-2" style="font-size: 0.8rem;">Clique no mapa para adicionar pontos.</div>
            <div id="route-metrics" class="mb-2">Pontos: 0 | Distância: 0m</div>
            <div class="d-flex gap-1">
              <button class="btn btn-xs btn-outline-light" id="btn-clear-route">Limpar</button>
              <button class="btn btn-xs btn-primary" id="btn-save-route">Salvar Rota</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Barra Lateral: Personagens Ativos & Rotas Salvas -->
      <div class="col-lg-3">
        <!-- Card de Personagens Ativos -->
        <div class="card bg-body-tertiary border-secondary-subtle shadow-sm mb-2">
          <div class="card-header py-2 d-flex justify-content-between align-items-center">
            <span class="fw-semibold small"><i class="bi bi-people-fill text-success"></i> Jogadores Conectados</span>
            <span class="badge text-bg-success" id="players-count">0</span>
          </div>
          <div class="card-body p-2" id="players-list" style="max-height: 250px; overflow-y: auto;">
            <div class="text-body-secondary small text-center p-3">Nenhum jogador rastreado no momento.</div>
          </div>
        </div>

        <!-- Card de Rotas Salvas -->
        <div class="card bg-body-tertiary border-secondary-subtle shadow-sm">
          <div class="card-header py-2 d-flex justify-content-between align-items-center">
            <span class="fw-semibold small"><i class="bi bi-signpost-split text-info"></i> Rotas de Farm</span>
          </div>
          <div class="card-body p-2" id="routes-list" style="max-height: 250px; overflow-y: auto;">
            ${renderRoutesList()}
          </div>
        </div>
      </div>
    </div>
  `;

  setupCanvas();
  bindEvents();
  renderPlayersList();
}

function setupCanvas() {
  canvas = document.getElementById('pw-map-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  // Ajusta resolução do canvas para o tamanho do container
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  draw();
}

function screenToWorld(sx, sy) {
  const worldX = (sx - panX) / zoom;
  const worldZ = (sy - panY) / zoom;
  return { x: Math.round(worldX), z: Math.round(worldZ) };
}

function worldToScreen(wx, wz) {
  const sx = wx * zoom + panX;
  const sy = wz * zoom + panY;
  return { x: sx, y: sy };
}

function centerOn(wx, wz) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  panX = rect.width / 2 - wx * zoom;
  panY = rect.height / 2 - wz * zoom;
  draw();
}

function draw() {
  if (!ctx || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  // Limpa o fundo do oceano / mapa
  ctx.fillStyle = '#0f172a'; // Oceano escuro elegante
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Desenha Continente de Pan Gu (Terreno principal: 0 a 1024)
  drawTerrain();

  // Grade de coordenadas
  drawGrid();

  // Linhas de Rotas Ativas
  drawActiveRoute();

  // Pontos de Interesse (POIs)
  drawPOIs();

  // Jogadores Conectados
  drawPlayers();

  ctx.restore();

  // Tooltip se estiver sobre um POI
  if (hoveredPoi) {
    drawPoiTooltip(hoveredPoi);
  }
}

function drawTerrain() {
  // Massas de terra principais de Pan Gu
  ctx.fillStyle = '#1e293b'; // Base do continente
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;

  // Continente Central
  ctx.beginPath();
  ctx.roundRect(100, 100, 824, 824, 40);
  ctx.fill();
  ctx.stroke();

  // Rios principais (Rio da Seda, Rio Celestial)
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(100, 500);
  ctx.bezierCurveTo(400, 520, 500, 480, 924, 600);
  ctx.stroke();

  // Lago dos Espelhos
  ctx.fillStyle = '#0369a1';
  ctx.beginPath();
  ctx.arc(480, 450, 40, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';

  for (let c = 0; c <= 1024; c += 100) {
    // Linhas verticais (X)
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c, 1024);
    ctx.stroke();
    ctx.fillText(`${c}`, c + 4, 16);

    // Linhas horizontais (Z)
    ctx.beginPath();
    ctx.moveTo(0, c);
    ctx.lineTo(1024, c);
    ctx.stroke();
    ctx.fillText(`${c}`, 4, c - 4);
  }
}

function drawPOIs() {
  const pois = mapData.pois || [];
  for (const poi of pois) {
    if (!activeFilters[poi.category]) continue;

    const { x, z } = poi;
    ctx.save();
    ctx.translate(x, z);

    let color = '#38bdf8';
    let icon = '🏰';
    if (poi.category === 'dungeon') {
      color = '#c084fc';
      icon = '⛩️';
    } else if (poi.category === 'boss') {
      color = '#f87171';
      icon = '🐉';
    } else if (poi.category === 'resource') {
      color = '#facc15';
      icon = '⛏️';
    }

    // Marcador
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    // Borda
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Rótulo
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(poi.name, 10, 3);

    ctx.restore();
  }
}

function drawPlayers() {
  const players = mapData.players || [];
  for (const p of players) {
    const { x, z, yaw, character } = p;
    ctx.save();
    ctx.translate(x, z);

    // Halo pulsante
    ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();

    // Pino central
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cone de visão / Direção (Yaw)
    if (yaw !== undefined) {
      ctx.rotate(yaw);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(-5, -4);
      ctx.lineTo(5, -4);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-yaw);
    }

    // Rótulo do jogador
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 5;
    ctx.fillText(character, 12, 4);

    ctx.restore();
  }
}

function drawActiveRoute() {
  if (!currentRoute.length) return;

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  for (let i = 0; i < currentRoute.length; i++) {
    const pt = currentRoute[i];
    if (i === 0) ctx.moveTo(pt.x, pt.z);
    else ctx.lineTo(pt.x, pt.z);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Pontos numerados
  for (let i = 0; i < currentRoute.length; i++) {
    const pt = currentRoute[i];
    ctx.save();
    ctx.translate(pt.x, pt.z);
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}`, 0, 0);
    ctx.restore();
  }
}

function drawPoiTooltip(poi) {
  const s = worldToScreen(poi.x, poi.z);
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.roundRect(s.x + 12, s.y - 25, 160, 50, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(poi.name, s.x + 20, s.y - 8);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(`X: ${poi.x} | Z: ${poi.z}`, s.x + 20, s.y + 12);
  ctx.restore();
}

function renderPlayersList() {
  const el = document.getElementById('players-list');
  const countEl = document.getElementById('players-count');
  const players = mapData.players || [];
  if (countEl) countEl.textContent = `${players.length}`;

  if (!el) return;
  if (!players.length) {
    el.innerHTML = '<div class="text-body-secondary small text-center p-3">Nenhum jogador rastreado no momento.</div>';
    return;
  }

  el.innerHTML = players
    .map((p) => {
      const isFollowing = followPlayerId === p.accountId;
      return `
      <div class="d-flex justify-content-between align-items-center p-2 mb-1 bg-body rounded border border-secondary-subtle">
        <div>
          <div class="fw-semibold text-success small"><i class="bi bi-person-fill"></i> ${esc(p.character)}</div>
          <div class="text-body-secondary" style="font-size: 0.75rem;">X: ${p.x} | Y: ${p.y} | Z: ${p.z}</div>
        </div>
        <div class="btn-group btn-group-xs">
          <button class="btn btn-outline-secondary btn-center-player" data-x="${p.x}" data-z="${p.z}" title="Centralizar"><i class="bi bi-geo-alt"></i></button>
          <button class="btn ${isFollowing ? 'btn-success' : 'btn-outline-primary'} btn-follow-player" data-acc="${p.accountId}" title="${isFollowing ? 'Parar de seguir' : 'Seguir'}">
            <i class="bi bi-eye"></i>
          </button>
        </div>
      </div>
    `;
    })
    .join('');

  el.querySelectorAll('.btn-center-player').forEach((btn) => {
    btn.addEventListener('click', () => {
      centerOn(parseFloat(btn.dataset.x), parseFloat(btn.dataset.z));
    });
  });

  el.querySelectorAll('.btn-follow-player').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.acc;
      followPlayerId = followPlayerId === id ? null : id;
      renderPlayersList();
      toast(followPlayerId ? 'Câmera travada no jogador.' : 'Câmera livre.', 'info');
    });
  });
}

function renderRoutesList() {
  const routes = mapData.routes || [];
  if (!routes.length) return '<div class="text-body-secondary small text-center p-3">Nenhuma rota salva.</div>';

  return routes
    .map(
      (r) => `
    <div class="p-2 mb-1 bg-body rounded border border-secondary-subtle d-flex justify-content-between align-items-center">
      <div>
        <div class="fw-semibold small">${esc(r.name)}</div>
        <div class="text-body-secondary" style="font-size: 0.75rem;">${r.waypoints.length} pontos</div>
      </div>
      <div class="btn-group btn-group-xs">
        <button class="btn btn-outline-primary btn-load-route" data-id="${r.id}" title="Carregar na tela"><i class="bi bi-play-circle"></i></button>
        <button class="btn btn-outline-danger btn-del-route" data-id="${r.id}" title="Excluir"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `,
    )
    .join('');
}

function bindEvents() {
  // Zoom
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    zoom = Math.min(4.0, zoom * 1.25);
    draw();
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    zoom = Math.max(0.4, zoom / 1.25);
    draw();
  });
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
    centerOn(552, 653);
    zoom = 1.0;
  });

  // Filtros
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      activeFilters[cat] = !activeFilters[cat];
      btn.classList.toggle('active', activeFilters[cat]);
      draw();
    });
  });

  // Busca de coordenadas
  document.getElementById('btn-search-coords')?.addEventListener('click', () => {
    const x = parseFloat(document.getElementById('search-x')?.value);
    const z = parseFloat(document.getElementById('search-z')?.value);
    if (!isNaN(x) && !isNaN(z)) {
      centerOn(x, z);
      toast(`Câmera focada em X: ${x}, Z: ${z}`, 'info');
    }
  });

  // Modo Criador de Rotas
  document.getElementById('btn-toggle-route')?.addEventListener('click', () => {
    routeMode = !routeMode;
    const overlay = document.getElementById('route-builder-overlay');
    if (overlay) overlay.style.display = routeMode ? 'block' : 'none';
    if (!routeMode) currentRoute = [];
    draw();
  });

  document.getElementById('btn-close-route-mode')?.addEventListener('click', () => {
    routeMode = false;
    document.getElementById('route-builder-overlay').style.display = 'none';
    draw();
  });

  document.getElementById('btn-clear-route')?.addEventListener('click', () => {
    currentRoute = [];
    updateRouteMetrics();
    draw();
  });

  document.getElementById('btn-save-route')?.addEventListener('click', () => {
    if (currentRoute.length < 2) return toast('Adicione ao menos 2 pontos para salvar uma rota.', 'warn');
    const name = prompt('Digite um nome para a rota:', 'Minha Rota de Farm');
    if (!name) return;
    run(async () => {
      await call('map:save-route', { name, waypoints: currentRoute });
      mapData = await call('map:state');
      document.getElementById('routes-list').innerHTML = renderRoutesList();
    }, 'Rota salva com sucesso!');
  });

  // Interações de Mouse no Canvas
  if (!canvas) return;

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    startDragX = e.clientX - panX;
    startDragY = e.clientY - panY;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    if (canvas) canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isDragging) {
      panX = e.clientX - startDragX;
      panY = e.clientY - startDragY;
      followPlayerId = null; // Libera trava da câmera
      draw();
    }

    const world = screenToWorld(sx, sy);
    mouseWorldPos = world;
    const display = document.getElementById('coords-display');
    if (display) display.textContent = `X: ${world.x} | Z: ${world.z}`;

    // Checa hover em POI
    hoveredPoi = null;
    for (const poi of mapData.pois || []) {
      const dist = Math.hypot(poi.x - world.x, poi.z - world.z);
      if (dist < 12 / zoom) {
        hoveredPoi = poi;
        break;
      }
    }
    draw();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.min(4.0, Math.max(0.4, zoom * zoomFactor));

    // Zoom centrado na posição do cursor
    panX = sx - ((sx - panX) * newZoom) / zoom;
    panY = sy - ((sy - panY) * newZoom) / zoom;
    zoom = newZoom;
    draw();
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    if (routeMode) {
      currentRoute.push({ x: world.x, y: 22, z: world.z, label: `Ponto ${currentRoute.length + 1}` });
      updateRouteMetrics();
      draw();
    } else {
      // Copia comando de auto-caminho do PW para área de transferência
      const cmd = `/autopath ${world.x} 22 ${world.z}`;
      navigator.clipboard?.writeText(cmd).catch(() => {});
      toast(`Coordenadas copiadas: ${cmd}`, 'info');
    }
  });
}

function updateRouteMetrics() {
  const metricsEl = document.getElementById('route-metrics');
  if (!metricsEl) return;

  let totalDist = 0;
  for (let i = 1; i < currentRoute.length; i++) {
    const p1 = currentRoute[i - 1];
    const p2 = currentRoute[i];
    totalDist += Math.hypot(p2.x - p1.x, p2.z - p1.z);
  }

  const meters = Math.round(totalDist);
  const flySeconds = Math.round(totalDist / 6.3);
  metricsEl.textContent = `Pontos: ${currentRoute.length} | Distância: ${meters}m (~${flySeconds}s de voo)`;
}
