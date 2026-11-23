// Verificação de versão do cliente e localização de patcher/launcher.
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { createLogger } from './logger.js';

const log = createLogger('version');

const LAUNCHER_CANDIDATES = [
  ['patcher', 'patcher.exe'],
  ['launcher', 'Launcher.exe'],
  ['launcher', 'launcher.exe'],
];

export function resolveLauncher(clientExePath) {
  if (!clientExePath) return null;
  const clientDir = path.dirname(clientExePath);
  const rootDir = path.dirname(clientDir); // normalmente pasta raiz do jogo (pai de element)

  // 1. Procurar nas pastas conhecidas a partir da pasta raiz e da pasta do elementclient
  for (const base of [rootDir, clientDir]) {
    for (const [folder, exe] of LAUNCHER_CANDIDATES) {
      const candidate = path.join(base, folder, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // 2. Procurar executáveis launcher*.exe na raiz do jogo
  try {
    const files = fs.readdirSync(rootDir);
    const launcher = files.find((f) => /^launcher.*\.exe$/i.test(f));
    if (launcher) return path.join(rootDir, launcher);
  } catch {
    // ignora erros de leitura
  }

  return null;
}

export function readClientVersion(clientExePath) {
  if (!clientExePath || !fs.existsSync(clientExePath)) {
    return { exists: false, version: null, launcherPath: null };
  }

  const clientDir = path.dirname(clientExePath);
  const rootDir = path.dirname(clientDir);

  // Procurar version01 ou version em clientDir e rootDir/element
  const versionFiles = [
    path.join(clientDir, 'version01'),
    path.join(clientDir, 'version'),
    path.join(rootDir, 'element', 'version01'),
    path.join(rootDir, 'element', 'version'),
  ];

  let version = null;
  for (const vf of versionFiles) {
    if (fs.existsSync(vf)) {
      try {
        const text = fs.readFileSync(vf, 'utf8').trim();
        const match = text.match(/^\d+/);
        if (match) {
          version = match[0];
          break;
        }
      } catch (err) {
        log.warn(`falha ao ler ${vf}`, err.message);
      }
    }
  }

  const launcherPath = resolveLauncher(clientExePath);
  return {
    exists: true,
    version,
    launcherPath,
    hasLauncher: !!launcherPath,
  };
}

export async function openLauncher(clientExePath) {
  const launcherPath = resolveLauncher(clientExePath);
  if (!launcherPath) throw new Error('Executável do launcher/patcher não encontrado.');
  log.info(`abrindo launcher: ${launcherPath}`);
  await shell.openPath(launcherPath);
  return { opened: true, launcherPath };
}
