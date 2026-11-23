// Janelas do aplicativo: principal, janela flutuante do grupo e ícone na bandeja.
import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, Tray, Menu, nativeImage, screen } from 'electron';
import { store } from './store.js';
import { createLogger } from './logger.js';

const log = createLogger('windows');

const SRC = path.join(app.getAppPath(), 'src');
const PRELOAD = path.join(SRC, 'main', 'preload.cjs');

let mainWindow = null;
let tray = null;
const miniWindows = new Map(); // groupId -> BrowserWindow
let hudGridWindow = null;
let toolbarWindow = null;
let searchWindow = null;
let syncLogWindow = null;
let quitting = false;

export function iconPath() {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function secureWebPreferences() {
  return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };
}

function harden(win) {
  // Nenhuma navegação para fora dos arquivos do app, nenhum popup.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.on('console-message', (_e, level, msg, line, src) => {
    if (level >= 2) log.warn(`[Renderer] ${msg} (${src}:${line})`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`[Renderer] Falha ao carregar página: ${desc} (${code}) ${url}`);
  });
}

export function setQuitting(v) {
  quitting = v;
}

export function getMainWindow() {
  return mainWindow;
}

export function createMainWindow() {
  const bounds = store.settings.windowBounds;
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'PW Manager',
    icon: iconPath(),
    backgroundColor: store.settings.theme === 'light' ? '#f8f9fa' : '#1a1d21',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  mainWindow.removeMenu();
  harden(mainWindow);
  mainWindow.loadFile(path.join(SRC, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
    store.settings.windowBounds = mainWindow.getBounds();
    store.commit();
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

  mainWindow.on('close', (e) => {
    if (!quitting && store.settings.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Fechou de verdade (sem ir para a bandeja): encerra o app, inclusive janelas de grupo.
    app.quit();
  });
  return mainWindow;
}

export function showMainWindow() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Janela pequena, sempre no topo, para controlar o grupo durante o jogo. */
export function openMiniWindow(groupId) {
  const existing = miniWindows.get(groupId);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  const saved = store.group(groupId)?.miniBounds;
  const visible = saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width && saved.y < a.y + a.height;
  });
  const win = new BrowserWindow({
    width: saved?.width ?? 280,
    height: saved?.height ?? 420,
    x: visible ? saved.x : undefined,
    y: visible ? saved.y : undefined,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: store.settings.party.miniAlwaysOnTop,
    title: 'Grupo',
    icon: iconPath(),
    backgroundColor: store.settings.theme === 'light' ? '#f8f9fa' : '#1a1d21',
    webPreferences: secureWebPreferences(),
  });
  if (store.settings.party.miniAlwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver');
  harden(win);
  win.loadFile(path.join(SRC, 'renderer', 'mini.html'), { query: { group: groupId } });

  const saveBounds = () => {
    const g = store.group(groupId);
    if (!g || win.isDestroyed()) return;
    g.miniBounds = win.getBounds();
    store.commit();
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);
  win.on('closed', () => miniWindows.delete(groupId));
  miniWindows.set(groupId, win);
  return win;
}

export function closeMiniWindow(groupId) {
  miniWindows.get(groupId)?.close();
}

export function resetMiniPositions() {
  for (const g of store.db.groups) delete g.miniBounds;
  store.commit();
  const primary = screen.getPrimaryDisplay().workArea;
  for (const win of miniWindows.values()) {
    if (!win.isDestroyed()) win.setBounds({ x: primary.x + 40, y: primary.y + 40, width: 280, height: 420 });
  }
}

export function setMiniAlwaysOnTop(on) {
  for (const win of miniWindows.values()) if (!win.isDestroyed()) win.setAlwaysOnTop(on, 'screen-saver');
}

export function allWindows() {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
}

export function broadcast(channel, payload) {
  for (const w of allWindows()) w.webContents.send(channel, payload);
}

export function createTray(handlers) {
  const icon = iconPath();
  if (!icon) return null;
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
  tray.setToolTip('PW Manager');
  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir PW Manager', click: showMainWindow },
        { type: 'separator' },
        { label: 'Parar Sync action', click: handlers.stopSync },
        { label: 'Parar todos os presets', click: handlers.stopPresets },
        { type: 'separator' },
        { label: 'Sair', click: handlers.quit },
      ]),
    );
  };
  rebuild();
  tray.on('double-click', showMainWindow);
  return tray;
}

// ---------------------------------------------------------------- HUD Grid Overlay
export function openHudGrid() {
  if (hudGridWindow && !hudGridWindow.isDestroyed()) {
    hudGridWindow.show();
    return hudGridWindow;
  }
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;
  hudGridWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: secureWebPreferences(),
  });
  hudGridWindow.setAlwaysOnTop(true, 'screen-saver');
  hudGridWindow.setIgnoreMouseEvents(true, { forward: true });
  harden(hudGridWindow);
  hudGridWindow.loadFile(path.join(SRC, 'renderer', 'grid.html'));
  hudGridWindow.on('closed', () => {
    hudGridWindow = null;
  });
  return hudGridWindow;
}

export function closeHudGrid() {
  if (hudGridWindow && !hudGridWindow.isDestroyed()) {
    hudGridWindow.close();
  }
  hudGridWindow = null;
}

export function toggleHudGrid() {
  if (hudGridWindow && !hudGridWindow.isDestroyed()) {
    closeHudGrid();
    return false;
  } else {
    openHudGrid();
    return true;
  }
}

// ---------------------------------------------------------------- Barra de Ferramentas
export function openToolbar() {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.show();
    toolbarWindow.focus();
    return toolbarWindow;
  }
  const primary = screen.getPrimaryDisplay().workArea;
  const initialWidth = 560;
  const initialHeight = 50;
  toolbarWindow = new BrowserWindow({
    x: Math.round(primary.x + (primary.width - initialWidth) / 2),
    y: primary.y + 16,
    width: initialWidth,
    height: initialHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    webPreferences: secureWebPreferences(),
  });
  toolbarWindow.setAlwaysOnTop(true, 'screen-saver');
  harden(toolbarWindow);
  toolbarWindow.loadFile(path.join(SRC, 'renderer', 'toolbar.html'));
  toolbarWindow.on('closed', () => {
    toolbarWindow = null;
  });
  return toolbarWindow;
}

export function closeToolbar() {
  if (toolbarWindow && !toolbarWindow.isDestroyed()) {
    toolbarWindow.close();
  }
  toolbarWindow = null;
}

export function setToolbarOrientation(orientation) {
  if (!toolbarWindow || toolbarWindow.isDestroyed()) return;
  const bounds = toolbarWindow.getBounds();
  if (orientation === 'vertical') {
    toolbarWindow.setBounds({ x: bounds.x, y: bounds.y, width: 50, height: 560 });
  } else {
    toolbarWindow.setBounds({ x: bounds.x, y: bounds.y, width: 560, height: 50 });
  }
}

// ---------------------------------------------------------------- Busca Rápida (Spotlight)
export function openSearch() {
  if (searchWindow && !searchWindow.isDestroyed()) {
    searchWindow.show();
    searchWindow.focus();
    return searchWindow;
  }
  const primary = screen.getPrimaryDisplay().workArea;
  const width = 600;
  const height = 420;
  searchWindow = new BrowserWindow({
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 3),
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  searchWindow.setAlwaysOnTop(true, 'screen-saver');
  harden(searchWindow);
  searchWindow.loadFile(path.join(SRC, 'renderer', 'search.html'));
  searchWindow.once('ready-to-show', () => {
    searchWindow.show();
    searchWindow.focus();
  });
  searchWindow.on('blur', () => {
    if (searchWindow && !searchWindow.isDestroyed()) {
      searchWindow.close();
    }
  });
  searchWindow.on('closed', () => {
    searchWindow = null;
  });
  return searchWindow;
}

export function closeSearch() {
  if (searchWindow && !searchWindow.isDestroyed()) {
    searchWindow.close();
  }
  searchWindow = null;
}

// ---------------------------------------------------------------- Diagnóstico e Log do Sync
export function openSyncLog() {
  if (syncLogWindow && !syncLogWindow.isDestroyed()) {
    syncLogWindow.show();
    syncLogWindow.focus();
    return syncLogWindow;
  }
  syncLogWindow = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 700,
    minHeight: 450,
    title: 'Diagnóstico & Log do Sync',
    icon: iconPath(),
    backgroundColor: '#181b20',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  syncLogWindow.removeMenu();
  harden(syncLogWindow);
  syncLogWindow.loadFile(path.join(SRC, 'renderer', 'synclog.html'));
  syncLogWindow.on('closed', () => {
    syncLogWindow = null;
  });
  return syncLogWindow;
}

export function closeSyncLog() {
  if (syncLogWindow && !syncLogWindow.isDestroyed()) {
    syncLogWindow.close();
  }
  syncLogWindow = null;
}
