// Serviço de Mapa Interativo e Rastreamento de Coordenadas de Jogadores em Tempo Real.
import { EventEmitter } from 'node:events';
import { native } from './native.js';
import { game } from './game.js';
import { store } from './store.js';
import { createLogger } from './logger.js';
import { broadcast } from './windows.js';

const log = createLogger('map');

// Base de Pontos de Interesse (POIs) canônicos do continente de Pan Gu (Perfect World)
export const PAN_GU_POIS = [
  // --- Capitais e Cidades Principais ---
  { id: 'cdd_sul', category: 'city', name: 'Cidade do Dragão (Sul)', x: 552, y: 22, z: 653, level: '1-105' },
  { id: 'cdd_oeste', category: 'city', name: 'Cidade do Dragão (Oeste)', x: 524, y: 22, z: 653, level: '1-105' },
  { id: 'cdd_norte', category: 'city', name: 'Cidade do Dragão (Norte)', x: 553, y: 22, z: 676, level: '1-105' },
  { id: 'plumas', category: 'city', name: 'Cidade das Plumas', x: 328, y: 23, z: 428, level: '1-20' },
  { id: 'feras', category: 'city', name: 'Cidade das Feras', x: 246, y: 21, z: 644, level: '1-20' },
  { id: 'espadas', category: 'city', name: 'Cidade das Espadas', x: 442, y: 27, z: 878, level: '1-20' },
  { id: 'dor', category: 'city', name: 'Cidade da Dor Celestial', x: 470, y: 27, z: 568, level: '70-80' },
  { id: 'universal', category: 'city', name: 'Cidade Universal', x: 131, y: 22, z: 858, level: '90-105' },
  { id: 'sonhos', category: 'city', name: 'Porto dos Sonhos', x: 662, y: 22, z: 375, level: '70-80' },
  { id: 'tormentas', category: 'city', name: 'Cidade das Tormentas', x: 665, y: 22, z: 128, level: '1-20' },
  { id: 'nevada', category: 'city', name: 'Vila Nevada', x: 148, y: 26, z: 960, level: '80-90' },
  { id: 'nevoa', category: 'city', name: 'Cidade da Névoa Oculta', x: 233, y: 21, z: 555, level: '40-50' },
  { id: 'por_do_sol', category: 'city', name: 'Cidade do Pôr do Sol', x: 124, y: 21, z: 590, level: '50-60' },

  // --- Dungeons & Instâncias ---
  { id: 'dg19_hum', category: 'dungeon', name: 'DG 19 (Humanos - Mina das Feras)', x: 434, y: 24, z: 887, level: '19' },
  { id: 'dg19_ala', category: 'dungeon', name: 'DG 19 (Alados - Caverna do Fogo)', x: 380, y: 22, z: 225, level: '19' },
  { id: 'dg19_sel', category: 'dungeon', name: 'DG 19 (Selvagens - Templo Escorpião)', x: 180, y: 22, z: 560, level: '19' },
  { id: 'dg29', category: 'dungeon', name: 'DG 29 (Túmulo do Herói)', x: 579, y: 22, z: 747, level: '29' },
  { id: 'dg39', category: 'dungeon', name: 'DG 39 (Portão da Terra)', x: 448, y: 22, z: 404, level: '39' },
  { id: 'dg49', category: 'dungeon', name: 'DG 49 (Vale do Desespero)', x: 283, y: 22, z: 444, level: '49' },
  { id: 'dg59', category: 'dungeon', name: 'DG 59 (Vale Primordial)', x: 434, y: 22, z: 537, level: '59' },
  { id: 'dg69', category: 'dungeon', name: 'DG 69 (Portão Fantasma)', x: 626, y: 22, z: 368, level: '69' },
  { id: 'dg79', category: 'dungeon', name: 'DG 79 (Caverna do Tesouro)', x: 676, y: 22, z: 362, level: '79' },
  { id: 'dg89_dem', category: 'dungeon', name: 'DG 89 (Terra Demoníaca)', x: 118, y: 22, z: 995, level: '89' },
  { id: 'dg89_imo', category: 'dungeon', name: 'DG 89 (Terra dos Imortais)', x: 118, y: 22, z: 990, level: '89' },
  { id: 'dusk', category: 'dungeon', name: 'Palácio dos Crepúsculos (Dusk / TT)', x: 130, y: 22, z: 668, level: '60-100' },
  { id: 'nirvana', category: 'dungeon', name: 'Palácio Nirvana', x: 677, y: 22, z: 618, level: '100+' },
  { id: 'vale_lua', category: 'dungeon', name: 'Vale da Lua (Moon)', x: 435, y: 22, z: 878, level: '85-95' },
  { id: 'vale_fenix', category: 'dungeon', name: 'Vale da Fênix', x: 585, y: 22, z: 620, level: '30-105' },

  // --- Chefes do Mundo (World Bosses) ---
  { id: 'boss_touro', category: 'boss', name: 'Rei Touro Terrestre', x: 113, y: 30, z: 686, respawn: '24-48h' },
  { id: 'boss_donzela', category: 'boss', name: 'Donzela de Ferro', x: 282, y: 22, z: 403, respawn: '24-48h' },
  { id: 'boss_general', category: 'boss', name: 'General Esqueleto', x: 172, y: 28, z: 787, respawn: '24-48h' },
  { id: 'boss_barba', category: 'boss', name: 'Barba Sangrenta', x: 288, y: 23, z: 946, respawn: '24-48h' },
  { id: 'boss_rato', category: 'boss', name: 'Rato Gigante Mascarado', x: 465, y: 22, z: 342, respawn: '24-48h' },
  { id: 'boss_serpente', category: 'boss', name: 'Serpente Primordial', x: 236, y: 24, z: 866, respawn: '24-48h' },

  // --- Recursos & Minérios Estratégicos ---
  { id: 'res_ferro_1', category: 'resource', name: 'Mina de Ferro Puro', x: 538, y: 22, z: 631, tier: 'Lv 4' },
  { id: 'res_carvao_1', category: 'resource', name: 'Mina de Carvão de Pedra', x: 564, y: 23, z: 692, tier: 'Lv 4' },
  { id: 'res_ginseng_1', category: 'resource', name: 'Erva Ginseng da Montanha', x: 460, y: 28, z: 580, tier: 'Lv 4' },
  { id: 'res_lotus_1', category: 'resource', name: 'Flor de Lótus Branca', x: 640, y: 22, z: 390, tier: 'Lv 4' },
];

class InteractiveMapService extends EventEmitter {
  constructor() {
    super();
    this.pollTimer = null;
    this.positions = new Map(); // accountId -> { x, y, z, yaw, hp, mp, maxHp, maxMp, target, updatedAt }
    this.routes = [];
    this.manualCoords = new Map();
  }

  init() {
    this.loadRoutes();
    this.startTracking();
  }

  loadRoutes() {
    try {
      this.routes = store.db.settings?.mapRoutes || [
        {
          id: 'route_daily_cdd',
          name: 'Missões Diárias - Cidade do Dragão',
          waypoints: [
            { x: 552, y: 22, z: 653, label: 'CDD Sul - Emissário' },
            { x: 524, y: 22, z: 653, label: 'CDD Oeste - Banheiro' },
            { x: 553, y: 22, z: 676, label: 'CDD Norte - General' },
          ],
        },
      ];
    } catch {
      this.routes = [];
    }
  }

  saveRoute(route) {
    if (!route.name || !Array.isArray(route.waypoints) || route.waypoints.length === 0) {
      throw new Error('A rota precisa ter um nome e ao menos 1 ponto.');
    }

    const id = route.id || 'route_' + Date.now();
    const existingIdx = this.routes.findIndex((r) => r.id === id);
    const item = { ...route, id, updatedAt: Date.now() };

    if (existingIdx >= 0) {
      this.routes[existingIdx] = item;
    } else {
      this.routes.push(item);
    }

    if (store.settings) store.settings.mapRoutes = this.routes;
    store.commit();

    return item;
  }

  deleteRoute(id) {
    this.routes = this.routes.filter((r) => r.id !== id);
    if (store.settings) store.settings.mapRoutes = this.routes;
    store.commit();
    return true;
  }

  startTracking() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    // Poll a cada 500ms para atualizar coordenadas de clientes ativos
    this.pollTimer = setInterval(() => this.pollCoordinates(), 500);
  }

  stopTracking() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollCoordinates() {
    const running = game.list();
    if (!running.length && !this.manualCoords.size) return;

    let updated = false;

    for (const r of running) {
      const acc = store.account(r.accountId);
      const server = store.server(acc?.serverId);

      // Se temos coordenadas manuais simuladas para teste
      if (this.manualCoords.has(r.accountId)) {
        const mc = this.manualCoords.get(r.accountId);
        this.positions.set(r.accountId, {
          accountId: r.accountId,
          character: r.character || acc?.character || 'Personagem',
          pid: r.pid,
          x: mc.x,
          y: mc.y ?? 22,
          z: mc.z,
          yaw: mc.yaw ?? 0,
          hp: 5000,
          maxHp: 5000,
          mp: 4000,
          maxMp: 4000,
          updatedAt: Date.now(),
        });
        updated = true;
        continue;
      }

      // Leitura via memória se nativo estiver disponível
      if (native.available && r.pid) {
        try {
          const config = {
            module: 'ElementClient.exe',
            base: '0xA1D6F4',
            attributes: {
              pos_x: { chain: ['0x4', '0x3F0', '0x0', '0x3C'], type: 'float' },
              pos_y: { chain: ['0x4', '0x3F0', '0x0', '0x40'], type: 'float' },
              pos_z: { chain: ['0x4', '0x3F0', '0x0', '0x44'], type: 'float' },
              yaw: { chain: ['0x4', '0x3F0', '0x0', '0xA30'], type: 'float' },
              hp: { chain: ['0x4', '0x3F0', '0x0', '0x4CC'], type: 'int' },
              maxHp: { chain: ['0x4', '0x3F0', '0x0', '0x518'], type: 'int' },
            },
          };

          const res = await native.call('read-memory', { pid: r.pid, config });
          if (res?.ok && res.attributes) {
            const attrs = res.attributes;
            this.positions.set(r.accountId, {
              accountId: r.accountId,
              character: r.character || acc?.character || 'Personagem',
              pid: r.pid,
              x: Math.round((attrs.pos_x ?? 552) * 10) / 10,
              y: Math.round((attrs.pos_y ?? 22) * 10) / 10,
              z: Math.round((attrs.pos_z ?? 653) * 10) / 10,
              yaw: attrs.yaw ?? 0,
              hp: attrs.hp ?? 0,
              maxHp: attrs.maxHp ?? 1,
              updatedAt: Date.now(),
            });
            updated = true;
          }
        } catch {
          // memória indisponível no ciclo
        }
      }
    }

    if (updated) {
      const payload = this.getState();
      broadcast('map:coords', payload);
      this.emit('coords', payload);
    }
  }

  setManualCoords(accountId, coords) {
    if (!accountId) return;
    this.manualCoords.set(accountId, coords);
    this.positions.set(accountId, {
      accountId,
      character: coords.character || 'Personagem',
      x: coords.x,
      y: coords.y ?? 22,
      z: coords.z,
      yaw: coords.yaw ?? 0,
      updatedAt: Date.now(),
    });
    const payload = this.getState();
    broadcast('map:coords', payload);
  }

  getState() {
    return {
      players: Array.from(this.positions.values()),
      pois: PAN_GU_POIS,
      routes: this.routes,
    };
  }
}

export const mapService = new InteractiveMapService();
mapService.init();
