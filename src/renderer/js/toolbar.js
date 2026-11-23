// Lógica da Barra de Ferramentas Flutuante
const pw = window.pw;
let state = null;
let vertical = false;
let clientsHidden = false;
let gridActive = false;

const elToolbar = document.getElementById('toolbar');
const elBtnSync = document.getElementById('btn-sync');
const elBtnToggleClients = document.getElementById('btn-toggle-clients');
const elBtnAlignCam = document.getElementById('btn-align-cam');
const elBtnGrid = document.getElementById('btn-grid');
const elCharButtons = document.getElementById('char-buttons');
const elBtnPresets = document.getElementById('btn-presets');
const elBtnStopAll = document.getElementById('btn-stop-all');
const elBtnSearch = document.getElementById('btn-search');
const elBtnCalc = document.getElementById('btn-calc');
const elBtnSyncLog = document.getElementById('btn-synclog');
const elBtnOrientation = document.getElementById('btn-orientation');
const elBtnClose = document.getElementById('btn-close');
const elDragIcon = document.getElementById('drag-icon');

function updateUI() {
  if (!state) return;

  // Sync button status
  const syncRunning = !!state.party?.syncRunning;
  elBtnSync.classList.toggle('active', syncRunning);
  elBtnSync.title = syncRunning ? 'Sync Action LIGADO (clique para parar)' : 'Sync Action DESLIGADO (clique para ligar)';

  // Char buttons for running accounts
  const running = state.running || [];
  elCharButtons.innerHTML = '';
  running.slice(0, 10).forEach((cli, idx) => {
    const acc = state.accounts?.find((a) => a.id === cli.accountId);
    const charName = acc?.character || acc?.name || `P${idx + 1}`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-tool char-badge';
    btn.textContent = `${idx + 1}`;
    btn.title = `Focar ${charName} (Alt+${idx + 1})`;
    if (state.foregroundAccountId === cli.accountId) btn.classList.add('active');
    btn.onclick = () => pw.call('game:focus', cli.accountId).catch(() => {});
    elCharButtons.appendChild(btn);
  });

  // Presets icon status
  const presetsRunning = (state.presetsRunning || []).length > 0;
  elBtnPresets.classList.toggle('active', presetsRunning);
}

elBtnSync.onclick = async () => {
  try {
    const isRunning = !!state?.party?.syncRunning;
    if (isRunning) await pw.call('party:sync-stop');
    else await pw.call('party:sync-start');
  } catch (err) {
    console.error('Falha ao alternar Sync:', err);
  }
};

elBtnToggleClients.onclick = async () => {
  try {
    clientsHidden = !clientsHidden;
    await pw.call('game:set-all-visibility', !clientsHidden);
    elBtnToggleClients.classList.toggle('active', clientsHidden);
    elBtnToggleClients.innerHTML = clientsHidden ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
    elBtnToggleClients.title = clientsHidden ? 'Mostrar janelas do jogo' : 'Ocultar janelas do jogo';
  } catch (err) {
    console.error('Falha ao alternar visibilidade:', err);
  }
};

elBtnAlignCam.onclick = async () => {
  try {
    const res = await pw.call('party:align-camera');
    elBtnAlignCam.classList.add('active');
    setTimeout(() => elBtnAlignCam.classList.remove('active'), 800);
  } catch (err) {
    console.error('Falha ao alinhar câmera:', err);
  }
};

elBtnGrid.onclick = async () => {
  try {
    gridActive = !gridActive;
    if (gridActive) await pw.call('windows:open-hud-grid');
    else await pw.call('windows:close-hud-grid');
    elBtnGrid.classList.toggle('active', gridActive);
  } catch (err) {
    console.error('Falha no grid:', err);
  }
};

elBtnPresets.onclick = async () => {
  try {
    const activeGroup = state?.groups?.[0];
    const groupPresets = (state?.presets || []).filter((p) => !p.groupId || p.groupId === activeGroup?.id);
    if (groupPresets.length > 0) {
      await pw.call('presets:run', groupPresets[0].id);
    }
  } catch (err) {
    console.error('Falha ao executar preset:', err);
  }
};

elBtnStopAll.onclick = async () => {
  try {
    await pw.call('party:stop-all');
  } catch (err) {
    console.error('Falha ao parar tudo:', err);
  }
};

elBtnSearch.onclick = () => pw.call('windows:open-search');
elBtnCalc.onclick = () => pw.call('windows:open-calc');
elBtnSyncLog.onclick = () => pw.call('windows:open-synclog');

elBtnOrientation.onclick = async () => {
  vertical = !vertical;
  elToolbar.classList.toggle('vertical', vertical);
  elDragIcon.className = vertical ? 'bi bi-grip-horizontal' : 'bi bi-grip-vertical';
  await pw.call('windows:set-toolbar-orientation', vertical ? 'vertical' : 'horizontal');
};

elBtnClose.onclick = () => pw.call('windows:close-toolbar');

pw.on('state', (next) => {
  state = next;
  updateUI();
});

pw.call('state:get').then((s) => {
  state = s;
  updateUI();
});
