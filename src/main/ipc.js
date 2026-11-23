// Ponte interface <-> processo principal. A interface só pode chamar os métodos listados aqui.
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, dialog, clipboard, shell, screen, BrowserWindow, app } from 'electron';
import { store, DEFAULT_SETTINGS } from './store.js';
import { native } from './native.js';
import { game, DEFAULT_ARGS } from './game.js';
import { party } from './party.js';
import { presets } from './presets.js';
import { hotkeys, HOTKEY_LABELS } from './hotkeys.js';
import { backup } from './backup.js';
import { logDir, createLogger } from './logger.js';
import * as windows from './windows.js';
import { readClientVersion, openLauncher } from './version.js';
import { forja, COMMON_FORGE_ATTRIBUTES } from './forja.js';
import { mapService } from './map.js';
import { equipmentService } from './equipment.js';
import { updater } from './updater.js';

const log = createLogger('ipc');

const CLASSES = [
  'BLADEMASTER', 'WIZARD', 'ARCHER', 'CLERIC', 'BARBARIAN', 'VENOMANCER', 'PSYCHIC', 'ASSASSIN', 'SEEKER',
  'MYSTIC', 'DUSKBLADE', 'STORMBRINGER', 'TECHNICIAN', 'EDGERUNNER', 'WILDWALKER', 'BARD', 'STORE',
];

// ------------------------------------------------------------------ estado público

export function publicState() {
  const db = store.db;
  return {
    app: { version: app.getVersion(), defaultArgs: DEFAULT_ARGS, hotkeyLabels: HOTKEY_LABELS, classes: CLASSES },
    servers: db.servers,
    accounts: db.accounts.map(({ passwordEnc, ...a }) => ({ ...a, hasPassword: !!passwordEnc })),
    groups: db.groups.map(({ miniBounds, ...g }) => g),
    presets: db.presets,
    settings: db.settings,
    running: game.list(),
    foregroundAccountId: game.foregroundAccountId,
    party: party.state(),
    presetsRunning: [...presets.running],
    native: { available: native.available },
    hotkeyFailures: hotkeys.failures,
    backupFolder: backup.folder,
  };
}

// ------------------------------------------------------------------ utilitários

const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const now = () => Date.now();

function requireServer(id) {
  const s = store.server(id);
  if (!s) throw new Error('Servidor não encontrado.');
  return s;
}

function requireAccount(id) {
  const a = store.account(id);
  if (!a) throw new Error('Conta não encontrada.');
  return a;
}

function requireGroup(id) {
  const g = store.group(id);
  if (!g) throw new Error('Grupo não encontrado.');
  return g;
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in target) && !(k in DEFAULT_SETTINGS)) continue; // ignora chaves desconhecidas
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

function parentWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function nextOrder() {
  return store.db.accounts.reduce((m, a) => Math.max(m, a.order ?? 0), -1) + 1;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const header = rows[0].map((h) => h.toLowerCase());
  const known = ['nome', 'name', 'login', 'senha', 'password'];
  const hasHeader = header.some((h) => known.includes(h));
  const cols = hasHeader ? header : ['nome', 'login', 'senha', 'personagem', 'classe', 'tag', 'servidor'];
  const idx = (...names) => cols.findIndex((c) => names.includes(c));
  const map = {
    name: idx('nome', 'name', 'conta', 'account'),
    login: idx('login', 'usuario', 'usuário', 'user'),
    password: idx('senha', 'password', 'pwd'),
    character: idx('personagem', 'character', 'role'),
    characterClass: idx('classe', 'class'),
    tag: idx('tag', 'grupo'),
    server: idx('servidor', 'server'),
  };
  return rows.slice(hasHeader ? 1 : 0).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, i >= 0 ? r[i] ?? '' : ''])));
}

// ------------------------------------------------------------------ métodos

const methods = {
  'state:get': () => publicState(),

  // ----- servidores -----
  'servers:save': (_e, data) => {
    const name = str(data.name, 60);
    if (!name) throw new Error('Informe o nome do servidor.');
    const clientPath = str(data.clientPath, 500);
    if (!clientPath) throw new Error('Informe o caminho do elementclient.exe.');
    if (!fs.existsSync(clientPath)) throw new Error('O arquivo do element client não existe nesse caminho.');
    const fields = {
      name,
      clientPath,
      args: str(data.args, 500) || DEFAULT_ARGS,
      forceServerName: str(data.forceServerName, 60),
      description: str(data.description, 500),
      updatedAt: now(),
    };
    let server = data.id ? requireServer(data.id) : null;
    if (server) Object.assign(server, fields);
    else {
      server = { id: store.id(), createdAt: now(), ...fields };
      store.db.servers.push(server);
      if (!store.settings.selectedServerId) store.settings.selectedServerId = server.id;
    }
    store.commit();
    return server;
  },

  'servers:delete': (_e, id) => {
    requireServer(id);
    const count = store.db.accounts.filter((a) => a.serverId === id).length;
    if (count) throw new Error(`Este servidor tem ${count} conta(s). Exclua ou mova as contas antes.`);
    store.db.servers = store.db.servers.filter((s) => s.id !== id);
    store.db.groups = store.db.groups.filter((g) => g.serverId !== id);
    if (store.settings.selectedServerId === id) store.settings.selectedServerId = store.db.servers[0]?.id ?? null;
    store.commit();
  },

  'servers:select': (_e, id) => {
    store.settings.selectedServerId = id ? requireServer(id).id : null;
    store.commit();
  },

  // ----- contas -----
  'accounts:save': (_e, data) => {
    const name = str(data.name, 60);
    if (!name) throw new Error('Informe o nome da conta.');
    const serverId = requireServer(data.serverId).id;
    const fields = {
      serverId,
      name,
      login: str(data.login, 100),
      character: str(data.character, 60),
      characterClass: CLASSES.includes(data.characterClass) ? data.characterClass : '',
      tag: str(data.tag, 40),
      email: str(data.email, 120),
      notes: str(data.notes, 1000),
      favorite: !!data.favorite,
      updatedAt: now(),
    };
    let account = data.id ? requireAccount(data.id) : null;
    if (account) Object.assign(account, fields);
    else {
      account = { id: store.id(), createdAt: now(), order: nextOrder(), archived: false, totalSeconds: 0, lastPlayedAt: null, passwordEnc: '', ...fields };
      store.db.accounts.push(account);
    }
    if (typeof data.password === 'string') account.passwordEnc = store.encrypt(data.password);
    store.commit();
    return { id: account.id };
  },

  'accounts:delete': async (_e, ids) => {
    for (const id of ids) if (game.running.has(id)) await game.stop(id).catch(() => {});
    const set = new Set(ids);
    store.db.accounts = store.db.accounts.filter((a) => !set.has(a.id));
    for (const g of store.db.groups) {
      g.memberIds = g.memberIds.filter((id) => !set.has(id));
      if (set.has(g.leaderId)) g.leaderId = g.memberIds[0] ?? null;
    }
    store.commit();
  },

  'accounts:archive': (_e, ids, archived) => {
    for (const id of ids) requireAccount(id).archived = !!archived;
    store.commit();
  },

  'accounts:favorite': (_e, id, favorite) => {
    requireAccount(id).favorite = !!favorite;
    store.commit();
  },

  'accounts:set-tag': (_e, ids, tag) => {
    for (const id of ids) requireAccount(id).tag = str(tag, 40);
    store.commit();
  },

  'accounts:reorder': (_e, orderedIds) => {
    orderedIds.forEach((id, i) => {
      const a = store.account(id);
      if (a) a.order = i;
    });
    store.settings.accountSort = 'manual';
    store.commit();
  },

  'accounts:move': (_e, id, where) => {
    const a = requireAccount(id);
    const orders = store.db.accounts.map((x) => x.order ?? 0);
    a.order = where === 'start' ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
    store.settings.accountSort = 'manual';
    store.commit();
  },

  'accounts:reveal-password': (_e, id) => {
    if (store.settings.streamerMode) throw new Error('Modo Streamer ligado: mostrar senhas está bloqueado.');
    return store.decrypt(requireAccount(id).passwordEnc);
  },

  'accounts:copy': (_e, id, field) => {
    const a = requireAccount(id);
    const value = field === 'password' ? store.decrypt(a.passwordEnc) : field === 'login' ? a.login : a.character;
    if (!value) throw new Error('Não há nada para copiar.');
    clipboard.writeText(value);
  },

  'accounts:stats': (_e, id) => {
    const sessions = store.db.sessions.filter((s) => s.accountId === id).slice(-50).reverse();
    return { sessions };
  },

  'accounts:import': async (event) => {
    const res = await dialog.showOpenDialog(parentWindow(event), {
      title: 'Importar contas',
      filters: [{ name: 'Contas (JSON ou CSV)', extensions: ['json', 'csv', 'txt'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return { imported: 0 };
    const file = res.filePaths[0];
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    let rows;
    if (file.toLowerCase().endsWith('.json')) {
      const raw = JSON.parse(text);
      rows = Array.isArray(raw) ? raw : raw.accounts;
      if (!Array.isArray(rows)) throw new Error('JSON sem lista de contas.');
    } else rows = parseCsv(text);

    let imported = 0;
    let order = nextOrder();
    for (const r of rows) {
      const name = str(r.name ?? r.nome, 60);
      if (!name) continue;
      const server =
        store.db.servers.find((s) => s.id === r.serverId) ??
        store.db.servers.find((s) => s.name.toLowerCase() === str(r.server ?? r.servidor).toLowerCase()) ??
        store.server(store.settings.selectedServerId);
      if (!server) throw new Error('Cadastre um servidor antes de importar contas.');
      const cls = str(r.characterClass ?? r.classe).toUpperCase();
      store.db.accounts.push({
        id: store.id(),
        createdAt: now(),
        updatedAt: now(),
        order: order++,
        archived: false,
        totalSeconds: 0,
        lastPlayedAt: null,
        serverId: server.id,
        name,
        login: str(r.login, 100),
        passwordEnc: r.password ?? r.senha ? store.encrypt(String(r.password ?? r.senha)) : '',
        character: str(r.character ?? r.personagem, 60),
        characterClass: CLASSES.includes(cls) ? cls : '',
        tag: str(r.tag, 40),
        email: str(r.email, 120),
        notes: str(r.notes, 1000),
        favorite: !!r.favorite,
      });
      imported++;
    }
    store.commit();
    return { imported };
  },

  'accounts:export': async (event, { ids, includePasswords }) => {
    const res = await dialog.showSaveDialog(parentWindow(event), {
      title: 'Exportar contas',
      defaultPath: 'contas-pw-manager.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { exported: 0 };
    const set = ids?.length ? new Set(ids) : null;
    const accounts = store.db.accounts
      .filter((a) => !set || set.has(a.id))
      .map(({ passwordEnc, ...a }) => ({
        ...a,
        server: store.server(a.serverId)?.name ?? '',
        ...(includePasswords ? { password: store.decrypt(passwordEnc) } : {}),
      }));
    fs.writeFileSync(res.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), accounts }, null, 2), 'utf8');
    return { exported: accounts.length, file: res.filePath };
  },

  // ----- jogo -----
  'game:launch': async (_e, ids) => {
    const errors = [];
    let first = true;
    for (const id of ids) {
      if (!first && !game.running.has(id)) await new Promise((r) => setTimeout(r, store.settings.launch.delayBetweenMs));
      first = false;
      try {
        await game.launch(id);
      } catch (err) {
        errors.push(`${store.account(id)?.name ?? id}: ${err.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  },
  'game:stop': async (_e, ids) => {
    for (const id of ids) await game.stop(id);
  },
  'game:stop-all': async () => {
    for (const id of [...game.running.keys()]) await game.stop(id).catch(() => {});
  },
  'game:focus': (_e, id) => game.focus(id),
  'game:type-login': (_e, id) => game.typeLogin(id),
  'game:minimize-others': (_e, id) => party.minimizeOthers(id),

  // ----- grupos -----
  'groups:save': (_e, data) => {
    const name = str(data.name, 60);
    if (!name) throw new Error('Informe o nome do grupo.');
    const serverId = requireServer(data.serverId).id;
    const memberIds = [...new Set((data.memberIds ?? []).filter((id) => store.account(id)))];
    if (memberIds.length > 10) throw new Error('Um grupo pode ter no máximo 10 personagens.');
    const leaderId = memberIds.includes(data.leaderId) ? data.leaderId : memberIds[0] ?? null;
    let g = data.id ? requireGroup(data.id) : null;
    if (g) Object.assign(g, { name, serverId, memberIds, leaderId, updatedAt: now() });
    else {
      g = { id: store.id(), name, serverId, memberIds, leaderId, archived: false, createdAt: now(), updatedAt: now() };
      store.db.groups.push(g);
    }
    store.commit();
    party.refreshSync().catch(() => {});
    return { id: g.id };
  },
  'groups:delete': async (_e, id) => {
    if (party.sync.groupId === id) await party.stopSync();
    windows.closeMiniWindow(id);
    store.db.groups = store.db.groups.filter((g) => g.id !== id);
    for (const p of store.db.presets) if (p.groupId === id) p.groupId = null;
    if (party.activeGroupId === id) party.setActiveGroup(null);
    store.commit();
  },
  'groups:archive': (_e, id, archived) => {
    requireGroup(id).archived = !!archived;
    store.commit();
  },
  'groups:launch': (_e, id) => party.launchGroup(id),
  'groups:stop': (_e, id) => party.stopGroup(id),
  'groups:arrange': (_e, id, layout, displayId) => party.arrange(id, layout, displayId),
  'groups:set-active': (_e, id) => party.setActiveGroup(id),
  'groups:open-mini': (_e, id) => {
    requireGroup(id);
    party.setActiveGroup(id);
    windows.openMiniWindow(id);
  },
  'groups:focus-position': (_e, id, pos) => party.focusPosition(pos, id),

  // ----- sync action -----
  'sync:toggle': (_e, groupId) => party.toggleSync(groupId),
  'sync:pause': (_e, paused) => party.setSyncPaused(paused),

  // ----- presets -----
  'presets:save': (_e, data) => {
    const name = str(data.name, 60);
    if (!name) throw new Error('Informe o nome do preset.');
    const steps = (data.steps ?? []).map((s) => ({
      type: ['key', 'click', 'delay', 'focus'].includes(s.type) ? s.type : 'key',
      key: str(s.key, 20),
      target: str(s.target, 20) || 'all',
      button: s.button === 'right' ? 'right' : 'left',
      rx: s.rx == null ? null : Number(s.rx),
      ry: s.ry == null ? null : Number(s.ry),
      activate: !!s.activate,
      double: !!s.double,
      ms: Math.max(0, Math.min(600000, Number(s.ms) || 0)),
      holdMs: Math.max(0, Math.min(5000, Number(s.holdMs ?? 30) || 0)),
    }));
    const fields = {
      name,
      groupId: data.groupId && store.group(data.groupId) ? data.groupId : null,
      hotkey: str(data.hotkey, 40),
      perTargetDelayMs: Math.max(0, Math.min(10000, Number(data.perTargetDelayMs) || 0)),
      repeat: Math.max(0, Math.min(100000, Number(data.repeat ?? 1) || 0)),
      repeatDelayMs: Math.max(0, Math.min(600000, Number(data.repeatDelayMs) || 0)),
      steps,
      updatedAt: now(),
    };
    let p = data.id ? store.preset(data.id) : null;
    if (p) Object.assign(p, fields);
    else {
      p = { id: store.id(), createdAt: now(), ...fields };
      store.db.presets.push(p);
    }
    store.commit();
    hotkeys.register();
    return { id: p.id };
  },
  'presets:delete': async (_e, id) => {
    await presets.stop(id);
    store.db.presets = store.db.presets.filter((p) => p.id !== id);
    store.commit();
    hotkeys.register();
  },
  'presets:reorder': (_e, ids) => {
    const map = new Map(store.db.presets.map((p) => [p.id, p]));
    store.db.presets = [...ids.map((id) => map.get(id)).filter(Boolean), ...store.db.presets.filter((p) => !ids.includes(p.id))];
    store.commit();
  },
  'presets:run': (_e, id, groupId) => presets.run(id, { groupId }),
  'presets:stop': (_e, id) => presets.stop(id),
  'presets:stop-all': () => {
    forja.stop('stop_all');
    return presets.stopAll();
  },

  // ----- captura de clique (configuração de presets) -----
  'capture:click': async (event, accountId) => {
    const hwnd = accountId ? game.hwndOf(accountId) : 0;
    if (accountId && !hwnd) throw new Error('Este personagem não está jogando. Abra a conta para capturar o clique.');
    try {
      return await native.call('capture-click', { hwnd, focus: true, timeoutMs: 30000 }, 35000);
    } finally {
      const win = parentWindow(event);
      if (win) {
        win.show();
        win.focus();
      }
    }
  },
  'capture:cancel': () => native.call('cancel-capture'),

  // ----- configurações -----
  'settings:save': (_e, patch) => {
    const before = JSON.stringify([store.settings.hotkeys, store.settings.party.numpadSwitch]);
    deepMerge(store.settings, patch);
    store.settings.typing.charDelayMs = Math.max(0, Math.min(500, Number(store.settings.typing.charDelayMs) || 0));
    store.settings.backup.intervalHours = Math.max(1, Number(store.settings.backup.intervalHours) || 24);
    store.commit();
    if (JSON.stringify([store.settings.hotkeys, store.settings.party.numpadSwitch]) !== before) hotkeys.register();
    if (patch.sync) party.refreshSync().catch(() => {});
    if (patch.party && 'miniAlwaysOnTop' in patch.party) windows.setMiniAlwaysOnTop(store.settings.party.miniAlwaysOnTop);
    return store.settings;
  },
  'settings:reset-mini-position': () => windows.resetMiniPositions(),

  // ----- backup -----
  'backup:now': () => backup.run('manual'),
  'backup:list': () => backup.list(),
  'backup:open-folder': () => {
    fs.mkdirSync(backup.folder, { recursive: true });
    return shell.openPath(backup.folder);
  },
  'backup:choose-folder': async (event) => {
    const res = await dialog.showOpenDialog(parentWindow(event), { title: 'Pasta de backup', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    store.settings.backup.path = res.filePaths[0];
    store.commit();
    return res.filePaths[0];
  },
  'backup:restore': async (event, file) => {
    if (!file) {
      const res = await dialog.showOpenDialog(parentWindow(event), {
        title: 'Restaurar backup',
        defaultPath: backup.folder,
        filters: [{ name: 'Backup do PW Manager', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths[0]) return false;
      file = res.filePaths[0];
    }
    backup.restore(file);
    hotkeys.register();
    return true;
  },

  // ----- diversos -----
  'dialog:pick-client': async (event) => {
    const res = await dialog.showOpenDialog(parentWindow(event), {
      title: 'Selecione o elementclient.exe',
      filters: [{ name: 'Executável', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  },
  'app:displays': () =>
    screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' — principal' : ''}`,
    })),
  'app:open-logs': () => shell.openPath(logDir()),
  'app:open-data': () => shell.openPath(store.dataDir),
  'app:show-main': () => windows.showMainWindow(),
  'window:close': (event) => parentWindow(event)?.close(),
  'window:minimize': (event) => parentWindow(event)?.minimize(),
  'window:toggle-on-top': (event) => {
    const w = parentWindow(event);
    if (!w) return false;
    w.setAlwaysOnTop(!w.isAlwaysOnTop(), 'screen-saver');
    return w.isAlwaysOnTop();
  },

  // ----- estado e janelas extras -----
  'state:get': () => publicState(),
  'windows:open-hud-grid': () => windows.openHudGrid(),
  'windows:close-hud-grid': () => windows.closeHudGrid(),
  'windows:toggle-hud-grid': () => windows.toggleHudGrid(),
  'windows:open-toolbar': () => windows.openToolbar(),
  'windows:close-toolbar': () => windows.closeToolbar(),
  'windows:set-toolbar-orientation': (_e, ori) => windows.setToolbarOrientation(ori),
  'windows:open-search': () => windows.openSearch(),
  'windows:close-search': () => windows.closeSearch(),
  'windows:open-synclog': () => windows.openSyncLog(),
  'windows:close-synclog': () => windows.closeSyncLog(),
  'windows:open-calc': () => {
    windows.showMainWindow();
    windows.broadcast('navigate', 'calculators');
  },

  // ----- sincronização e alinhamento -----
  'party:sync-start': (_e, groupId) => party.startSync(groupId),
  'party:sync-stop': () => party.stopSync(),
  'party:stop-all': async () => {
    await presets.stopAll();
    if (party.sync.on) await party.stopSync();
  },
  'party:align-camera': async (_e, groupId) => {
    const res = await party.alignCamera(groupId);
    windows.broadcast('sync:log', { tag: 'CAMERA', message: 'Câmera sincronizada com o líder para seguidores.', kind: 'cam' });
    return res;
  },

  // ----- presets avançados / teste -----
  'presets:test': (_e, data, groupId) => presets.test(data, groupId),

  // ----- diagnóstico e métricas de desempenho -----
  'system:process-metrics': async (_e, pids) => {
    if (!pids || pids.length === 0) return [];
    return native.call('process-metrics', { pids });
  },
  'system:set-performance-mode': async (_e, enabled) => {
    store.settings.performanceMode = !!enabled;
    store.commit();
    windows.broadcast('sync:log', { tag: 'PERF', message: `Modo Desempenho ${enabled ? 'LIGADO' : 'DESLIGADO'}`, kind: 'perf' });
    return store.settings.performanceMode;
  },
  'game:set-all-visibility': async (_e, visible) => {
    for (const r of game.running.values()) {
      if (r.hwnd) await native.call(visible ? 'show' : 'hide', { hwnd: r.hwnd }).catch(() => {});
    }
    windows.broadcast('sync:log', { tag: 'WINDOW', message: `Todas as janelas do jogo ${visible ? 'exibidas' : 'ocultadas'}`, kind: 'win' });
  },
  'game:set-visibility': async (_e, accountId, visible) => {
    const hwnd = game.hwndOf(accountId);
    if (!hwnd) throw new Error('Personagem não está jogando.');
    await native.call(visible ? 'show' : 'hide', { hwnd });
  },
  'game:resize': async (_e, accountId, width, height) => {
    const hwnd = game.hwndOf(accountId);
    if (!hwnd) throw new Error('Personagem não está jogando.');
    await native.call('move', { hwnd, x: 100, y: 100, width, height });
  },

  // ----- calculadoras e preferências -----
  'settings:save-calculator': (_e, data) => {
    store.settings.calculator = data;
    store.commit();
    return store.settings.calculator;
  },

  // ----- verificação de versão do cliente -----
  'element:check-version': async (_e, serverId) => {
    const s = requireServer(serverId);
    return readClientVersion(s.clientPath);
  },
  'element:open-launcher': async (_e, serverId) => {
    const s = requireServer(serverId);
    return openLauncher(s.clientPath);
  },

  // ----- auto forja -----
  'forja:state': () => forja.state(),
  'forja:get-attributes': () => COMMON_FORGE_ATTRIBUTES,
  'forja:start': async (_e, cfg) => forja.start(cfg),
  'forja:stop': async () => forja.stop('user'),

  // ----- mapa interativo -----
  'map:state': () => mapService.getState(),
  'map:save-route': (_e, route) => mapService.saveRoute(route),
  'map:delete-route': (_e, id) => mapService.deleteRoute(id),
  'map:set-manual-coords': (_e, accountId, coords) => {
    mapService.setManualCoords(accountId, coords);
    return true;
  },

  // ----- leitor de equipamento -----
  'equipment:read': async (_e, accountId) => equipmentService.readFromGame(accountId),
  'equipment:save-build': (_e, build) => equipmentService.saveBuild(build),
  'equipment:list-builds': () => equipmentService.listBuilds(),
  'equipment:delete-build': (_e, id) => equipmentService.deleteBuild(id),

  // ----- atualizador automático (auto-update) -----
  'updater:state': () => updater.getState(),
  'updater:check': async () => updater.checkForUpdates(),
  'updater:install': () => updater.quitAndInstall(),
  'updater:save-config': (_e, cfg) => {
    if (!store.settings.updater) store.settings.updater = {};
    if (cfg.autoCheck !== undefined) store.settings.updater.autoCheck = !!cfg.autoCheck;
    if (cfg.feedUrl !== undefined) store.settings.updater.feedUrl = String(cfg.feedUrl).trim();
    store.commit();
    updater.applyFeedConfig();
    return store.settings.updater;
  },
};

/** Chama um método diretamente (usado pelo autoteste). */
export function invoke(sender, method, ...args) {
  return methods[method]({ sender, senderFrame: { url: 'file://selftest' } }, ...args);
}

export function registerIpc() {
  ipcMain.handle('rpc', async (event, method, ...args) => {
    // Só aceita chamadas das páginas do próprio app.
    if (!event.senderFrame?.url?.startsWith('file://')) throw new Error('Origem não autorizada.');
    const fn = methods[method];
    if (!fn) throw new Error(`Método desconhecido: ${method}`);
    try {
      return await fn(event, ...args);
    } catch (err) {
      log.warn(`${method} falhou: ${err.message}`);
      throw err;
    }
  });
}
