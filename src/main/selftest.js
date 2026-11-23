// Autoteste de ponta a ponta (PW_SELFTEST=1). Usa o cliente simulado (native/FakeClient)
// no lugar do elementclient e grava relatório + capturas de tela em PW_SELFTEST_OUT.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { invoke } from './ipc.js';
import { native } from './native.js';
import { game } from './game.js';
import { party } from './party.js';
import { presets } from './presets.js';
import { store } from './store.js';
import * as windows from './windows.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cond();
    if (v) return v;
    await sleep(200);
  }
  throw new Error('timeout: ' + label);
}

export async function runSelfTest() {
  const out = process.env.PW_SELFTEST_OUT || path.join(app.getPath('temp'), 'pw-selftest');
  fs.mkdirSync(out, { recursive: true });
  const fakeExe = process.env.PW_FAKE_CLIENT || path.join(app.getAppPath(), 'native', 'FakeClient', 'out', 'elementclient.exe');
  const logFile = path.join(out, 'fake-client.log');
  try {
    fs.unlinkSync(logFile);
  } catch {
    /* não existia */
  }

  // Backups do teste ficam na pasta do teste, nunca nos Documentos do usuário.
  store.settings.backup.path = path.join(out, 'backups');
  store.db.servers = [];
  store.db.accounts = [];
  store.db.groups = [];
  store.db.presets = [];
  store.db.sessions = [];
  store.db.runtime = [];
  store.commit();

  const results = [];
  const step = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail ?? null });
    } catch (err) {
      // Informa qual janela estava em foco: outro programa pode estar roubando o foco.
      const fg = await native.call('foreground').catch(() => null);
      const info = fg?.hwnd ? await native.call('window-info', { hwnd: fg.hwnd }).catch(() => null) : null;
      results.push({ name, ok: false, error: err.message, foregroundNow: info ? `${info.processName} — ${info.title}` : null });
    }
  };
  const main = windows.getMainWindow();
  const sender = main.webContents;
  const call = (m, ...a) => invoke(sender, m, ...a);
  const shot = async (win, name) => {
    await sleep(500);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  };
  const showView = (view) => sender.executeJavaScript(`document.querySelector('[data-view="${view}"]').click()`);

  try {
    await waitFor(() => native.available, 40000, 'módulo nativo');
    await new Promise((r) => (sender.isLoading() ? sender.once('did-finish-load', r) : r()));
    await sleep(800);
    await shot(main, '00-inicio-vazio');

    let serverId, a1, a2, a3, groupId, presetId;

    store.db.servers = [];
    store.db.accounts = [];
    store.db.groups = [];
    store.db.presets = [];
    store.db.sessions = [];
    store.commit();

  await step('cadastrar servidor', async () => {
    const s = await call('servers:save', {
      name: 'Servidor Local (teste)',
      clientPath: fakeExe,
      args: `startbypatcher user:{login} pwd:{password} role:{character} "log:${logFile}"`,
      description: 'Cliente simulado',
    });
    serverId = s.id;
    await call('servers:select', serverId);
    return s.id;
  });

  await step('cadastrar contas (senha criptografada)', async () => {
    a1 = (await call('accounts:save', { serverId, name: 'Conta Líder', login: 'lider01', password: 'Senha#1', character: 'Guerreiro', characterClass: 'BLADEMASTER', tag: 'Main', favorite: true })).id;
    a2 = (await call('accounts:save', { serverId, name: 'Conta Suporte', login: 'sup02', password: 'abc@2', character: 'Sacerdote', characterClass: 'CLERIC', tag: 'Main' })).id;
    a3 = (await call('accounts:save', { serverId, name: 'Conta Loja', login: 'loja03', password: 'x', character: 'Lojinha', characterClass: 'STORE', tag: 'Lojas' })).id;
    const raw = fs.readFileSync(store.file + '', 'utf8');
    if (raw.includes('Senha#1')) throw new Error('senha em texto puro no db.json!');
    const enc = store.account(a1).passwordEnc;
    if (!enc.startsWith('dpapi:')) throw new Error('senha não usa DPAPI: ' + enc.slice(0, 6));
    if ((await call('accounts:reveal-password', a1)) !== 'Senha#1') throw new Error('descriptografia falhou');
    return 'dpapi ok';
  });

  await step('criar grupo', async () => {
    groupId = (await call('groups:save', { name: 'Grupo PVE', serverId, memberIds: [a1, a2, a3], leaderId: a1 })).id;
    await call('groups:set-active', groupId);
  });

  await showView('accounts');
  await shot(main, '01-contas');

  await step('abrir 2 clientes do grupo', async () => {
    await call('game:launch', [a1, a2]);
    await waitFor(() => game.hwndOf(a1) && game.hwndOf(a2), 20000, 'janelas dos clientes');
    return game.list().map((r) => ({ pid: r.pid, hwnd: r.hwnd }));
  });

  await step('argumentos startbypatcher recebidos', async () => {
    await sleep(500);
    const log = fs.readFileSync(logFile, 'utf8');
    if (!log.includes('user:lider01') || !log.includes('role:Guerreiro')) throw new Error('argumentos não chegaram: ' + log);
    return 'ok';
  });

  await step('renomear janelas', async () => {
    await sleep(2500);
    const t1 = (await native.call('window-info', { hwnd: game.hwndOf(a1) })).title;
    const t2 = (await native.call('window-info', { hwnd: game.hwndOf(a2) })).title;
    if (t1 !== 'Guerreiro [Conta Líder]') throw new Error('título 1: ' + t1);
    return [t1, t2];
  });

  await step('organizar janelas (mosaico)', async () => {
    await call('groups:arrange', groupId, 'grid', null);
    const i1 = await native.call('window-info', { hwnd: game.hwndOf(a1) });
    const i2 = await native.call('window-info', { hwnd: game.hwndOf(a2) });
    if (i1.x === i2.x && i1.y === i2.y) throw new Error('janelas na mesma posição');
    return [`${i1.x},${i1.y} ${i1.width}x${i1.height}`, `${i2.x},${i2.y} ${i2.width}x${i2.height}`];
  });

  await step('digitar login (segundo plano / post)', async () => {
    store.settings.typing.method = 'post';
    await call('game:type-login', a2);
    await sleep(800);
    const log = fs.readFileSync(logFile, 'utf8');
    if (!log.includes('TYPED-FIELD "sup02"') || !log.includes('TYPED-FIELD "abc@2"')) throw new Error('digitação não registrada');
    return 'ok';
  });

  await step('digitar login (primeiro plano / unicode)', async () => {
    store.settings.typing.method = 'unicode';
    await call('game:focus', a1);
    await sleep(400);
    await call('game:type-login', a1);
    await sleep(800);
    const log = fs.readFileSync(logFile, 'utf8');
    if (!log.includes('TYPED-FIELD "lider01"') || !log.includes('TYPED-FIELD "Senha#1"')) throw new Error('digitação unicode não registrada');
    return 'ok';
  });

  await step('foco no personagem e detecção do primeiro plano', async () => {
    await call('game:focus', a2);
    await waitFor(() => game.foregroundAccountId === a2, 3000, 'evento de foreground');
    return 'ok';
  });

  await step('preset: F1 em todos + clique no líder', async () => {
    presetId = (
      await call('presets:save', {
        name: 'Buff do grupo',
        groupId,
        hotkey: 'Ctrl+Alt+F1',
        perTargetDelayMs: 50,
        repeat: 1,
        steps: [
          { type: 'key', key: 'F1', target: 'all' },
          { type: 'delay', ms: 100 },
          { type: 'click', button: 'right', rx: 0.5, ry: 0.5, target: 'leader' },
          { type: 'key', key: '3', target: 'members' },
        ],
      })
    ).id;
    const offset = fs.readFileSync(logFile, 'utf8').length; // analisa só o que o preset gerou
    await call('presets:run', presetId, groupId);
    await waitFor(() => !presets.running.has(presetId), 5000, 'fim do preset');
    await sleep(300);
    const lines = fs.readFileSync(logFile, 'utf8').slice(offset).split('\n');
    const pid1 = game.running.get(a1).pid;
    const pid2 = game.running.get(a2).pid;
    const has = (pid, text) => lines.some((l) => l.startsWith(pid + ' ') && l.includes(text));
    if (!has(pid1, 'KEYDOWN F1') || !has(pid2, 'KEYDOWN F1')) throw new Error('F1 não chegou nos dois');
    if (!has(pid1, 'RDOWN') || has(pid2, 'RDOWN')) throw new Error('clique deveria ir só para o líder');
    if (has(pid1, 'KEYDOWN D3') || !has(pid2, 'KEYDOWN D3')) throw new Error('tecla 3 deveria ir só para os membros');
    return 'ok';
  });

  await step('Sync action liga/desliga', async () => {
    await call('sync:toggle', groupId);
    if (!party.sync.on) throw new Error('não ligou');
    const st = await native.call('sync-state');
    if (st.members.length !== 2) throw new Error('membros: ' + st.members.length);
    await showView('groups');
    await shot(main, '02-modo-grupo-sync');
    await call('sync:toggle', groupId);
    if (party.sync.on) throw new Error('não desligou');
    return 'ok';
  });

  await step('janela do grupo (flutuante)', async () => {
    const win = windows.openMiniWindow(groupId);
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    await sleep(800);
    await shot(win, '03-janela-do-grupo');
    win.close();
  });

  await step('métricas de processo (PwNative)', async () => {
    const pids = [game.running.get(a1).pid, game.running.get(a2).pid];
    const met = await call('system:process-metrics', pids);
    if (!Array.isArray(met) || met.length !== 2) throw new Error('métricas inválidas: ' + JSON.stringify(met));
    return met;
  });

  await step('verificar versão do cliente', async () => {
    const ver = await call('element:check-version', serverId);
    if (!ver.exists || ver.version !== '155') throw new Error('versão inválida: ' + JSON.stringify(ver));
    return ver.version;
  });

  await step('alinhamento de câmera', async () => {
    const res = await call('party:align-camera', groupId);
    return res;
  });

  await step('testar função do preset (sem salvar)', async () => {
    const res = await call('presets:test', {
      name: 'Teste Rápido',
      steps: [{ type: 'key', key: 'F2', target: 'all' }],
    }, groupId);
    return res;
  });

  await step('janelas auxiliares (HUD Grid, Toolbar, Search, SyncLog)', async () => {
    await call('windows:open-hud-grid');
    await sleep(200);
    await call('windows:close-hud-grid');

    await call('windows:open-toolbar');
    await sleep(200);
    await call('windows:close-toolbar');

    await call('windows:open-synclog');
    await sleep(200);
    await call('windows:close-synclog');

    await call('windows:open-search');
    await sleep(200);
    await call('windows:close-search');
    return 'ok';
  });

  for (const [view, name] of [
    ['presets', '04-presets'],
    ['servers', '05-servidores'],
    ['settings', '06-configuracoes'],
    ['about', '07-sobre'],
    ['calculators', '10-calculadoras'],
    ['forja', '11-auto-forja'],
    ['map', '12-mapa-interativo'],
    ['equipment', '13-leitor-equipamento'],
  ]) {
    await showView(view);
    await shot(main, name);
  }

  await step('auto forja (teste de ciclo e atributos)', async () => {
    const attrs = await call('forja:get-attributes');
    if (!attrs || attrs.length === 0) throw new Error('sem atributos');
    const startRes = await call('forja:start', {
      accountId: a1,
      dryRun: true,
      maxCycles: 5,
      delayMs: 50,
      targetAttrs: [{ id: 'intervalo', count: 1 }],
    });
    if (!startRes || !startRes.running) throw new Error('forja não iniciou');
    await sleep(350);
    const stopped = await call('forja:stop');
    return `atributos: ${attrs.length}, ciclos: ${stopped.cycle}`;
  });

  await step('mapa interativo (coordenadas e rotas)', async () => {
    await call('map:set-manual-coords', a1, { x: 552, y: 22, z: 653 });
    const st = await call('map:state');
    if (!st || !st.pois.length) throw new Error('pois vazios');
    const route = await call('map:save-route', {
      name: 'Rota Teste',
      waypoints: [
        { x: 552, y: 22, z: 653 },
        { x: 524, y: 22, z: 653 },
      ],
    });
    await call('map:delete-route', route.id);
    return `pois: ${st.pois.length}, jogadores: ${st.players.length}`;
  });

  await step('leitor de equipamentos (inspeção de slots)', async () => {
    const build = await call('equipment:read', a1);
    if (!build || !build.slots || build.slots.length !== 16) throw new Error('slots inválidos: ' + build?.slots?.length);
    const saved = await call('equipment:save-build', { ...build, name: 'Build Teste' });
    await call('equipment:delete-build', saved.id);
    return `${build.character}: ${build.slots.filter((s) => !s.empty).length} itens equipados`;
  });
  await step('editor de preset (captura de tela)', async () => {
    await showView('presets');
    await sleep(600);
    await sender.executeJavaScript(`
      const btn = document.querySelector('[data-act="edit"]');
      if (btn) btn.click();
    `);
    await sleep(600);
    await shot(main, '08-editor-preset');
    await sender.executeJavaScript(`
      const closeBtn = document.querySelector('.modal .btn-close') || document.querySelector('[data-bs-dismiss="modal"]');
      if (closeBtn) closeBtn.click();
    `);
  });
  await step('tema claro', async () => {
    await call('settings:save', { theme: 'light' });
    await showView('accounts');
    await shot(main, '09-contas-tema-claro');
    await call('settings:save', { theme: 'dark' });
  });

  await step('parar clientes e registrar sessões', async () => {
    await call('game:stop-all');
    await waitFor(() => game.running.size === 0, 10000, 'clientes fechados');
    const sessions = store.db.sessions.length;
    if (sessions < 2) throw new Error('sessões: ' + sessions);
    return `${sessions} sessões`;
  });

  await step('backup manual', async () => {
    const file = await call('backup:now');
    if (!fs.existsSync(file)) throw new Error('arquivo não criado');
    return path.basename(file);
  });
  } catch (err) {
    results.push({ name: 'inicialização selftest', ok: false, error: err.message });
  } finally {
    const report = { ok: results.length > 0 && results.every((r) => r.ok), results };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('SELFTEST REPORT:', JSON.stringify(report, null, 2));
  }
}
