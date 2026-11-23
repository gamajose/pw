// Assistente de Templates de Grupo (PW Assistente)
import { call, getState } from './api.js';
import { esc, toast, modal } from './ui.js';

const TEMPLATES = [
  {
    id: 'follow',
    name: 'Seguir Líder (2 Cliques)',
    icon: 'bi-person-walking',
    desc: 'Sequência para seguidores: clica na barra da PT do líder e em seguida no ícone "Seguir".',
    target: 'members',
    needsClicks: 2,
    clickLabels: ['Clique na barra do Líder na lista da PT', 'Clique no botão de Ação "Seguir"'],
    defaultHotkey: 'F6',
  },
  {
    id: 'target_leader',
    name: 'Pegar Target do Líder (Assist)',
    icon: 'bi-crosshair',
    desc: 'Seguidores selecionam o líder na PT e pressionam a tecla de assistência (ex: "T").',
    target: 'members',
    needsClicks: 1,
    clickLabels: ['Clique na barra do Líder na lista da PT'],
    defaultKey: 'T',
    defaultHotkey: 'T',
  },
  {
    id: 'fly',
    name: 'Voar Simultâneo',
    icon: 'bi-clouds',
    desc: 'Ativa ou desativa as asas/voo em todos os personagens ao mesmo tempo.',
    target: 'all',
    needsClicks: 0,
    defaultKey: 'F12',
    defaultHotkey: 'F12',
  },
  {
    id: 'mount',
    name: 'Montaria Terrestre',
    icon: 'bi-speedometer',
    desc: 'Monta ou desmonta na montaria terrestre em todos os personagens.',
    target: 'all',
    needsClicks: 0,
    defaultKey: 'F11',
    defaultHotkey: 'F11',
  },
  {
    id: 'buff',
    name: 'Buff Geral (Suporte)',
    icon: 'bi-shield-plus',
    desc: 'Personagens de suporte (Clérico/Místico) buffam o grupo em sequência.',
    target: 'all',
    needsClicks: 0,
    defaultKey: 'F1',
    defaultHotkey: 'F1',
  },
  {
    id: 'boss_combo',
    name: 'Atacar Boss / Assistência Completa',
    icon: 'bi-fire',
    desc: 'Clica na PT do líder, assiste o target e executa rotação de ataque (teclas 1, 2, 3).',
    target: 'members',
    needsClicks: 1,
    clickLabels: ['Clique na barra do Líder na lista da PT'],
    defaultKey: '1',
    defaultHotkey: 'F7',
  },
  {
    id: 'pt_accept',
    name: 'Aceitar Convite de PT',
    icon: 'bi-person-check',
    desc: 'Clica no botão "Confirmar/Aceitar" da caixa de convite de grupo em todos os seguidores.',
    target: 'members',
    needsClicks: 1,
    clickLabels: ['Clique no botão Confirmar da janela de convite'],
    defaultHotkey: 'Ctrl+Y',
  },
];

export function openPartyWizard(group) {
  const st = getState();
  if (!group) {
    toast('Selecione um grupo para usar o assistente.', 'warning');
    return;
  }

  let selectedTemplate = TEMPLATES[0];
  let capturedClicks = [];
  let keyVal = selectedTemplate.defaultKey || '';
  let hotkeyVal = selectedTemplate.defaultHotkey || '';
  let presetNameVal = `${selectedTemplate.name} - ${group.name}`;
  let gridOpened = false;

  const runningAccounts = st.running.map((r) => st.accounts.find((a) => a.id === r.accountId)).filter(Boolean);
  const followerAccount = runningAccounts.find((a) => a.id !== group.leaderId) || runningAccounts[0];

  function getStepHtml() {
    const t = selectedTemplate;
    presetNameVal = `${t.name} - ${group.name}`;
    hotkeyVal = t.defaultHotkey || '';
    keyVal = t.defaultKey || '';

    let clicksHtml = '';
    if (t.needsClicks > 0) {
      clicksHtml = `
        <div class="mb-3 p-3 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="m-0 text-info"><i class="bi bi-cursor-fill me-1"></i> Captura de Cliques Sequenciais</h6>
            <button type="button" class="btn btn-outline-info btn-sm" id="btn-toggle-grid">
              <i class="bi bi-grid-3x3 me-1"></i> ${gridOpened ? 'Fechar Grid HUD' : 'Abrir Grid HUD'}
            </button>
          </div>
          <p class="small text-body-secondary mb-3">
            O alinhamento do HUD garante que o clique caia no mesmo botão em todas as janelas. Use o Grid para conferir a posição da barra da PT.
          </p>
          <div class="d-flex flex-column gap-2">
            ${Array.from({ length: t.needsClicks })
              .map((_, idx) => {
                const c = capturedClicks[idx];
                const lbl = t.clickLabels?.[idx] || `Clique ${idx + 1}`;
                return `
                <div class="d-flex align-items-center justify-content-between p-2 rounded" style="background: rgba(0,0,0,0.2);">
                  <div>
                    <span class="badge bg-secondary me-2">${idx + 1}</span>
                    <strong class="small">${esc(lbl)}</strong>
                    ${
                      c
                        ? `<div class="small text-success mt-1"><i class="bi bi-check-circle me-1"></i> Capturado: ${(c.rx * 100).toFixed(1)}% × ${(c.ry * 100).toFixed(1)}% (${c.button === 'right' ? 'Direito' : 'Esquerdo'})</div>`
                        : '<div class="small text-warning mt-1"><i class="bi bi-clock me-1"></i> Aguardando captura</div>'
                    }
                  </div>
                  <button type="button" class="btn btn-sm ${c ? 'btn-outline-success' : 'btn-primary'}" data-capture="${idx}">
                    <i class="bi bi-crosshair me-1"></i> ${c ? 'Recapturar' : 'Capturar'}
                  </button>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    let keyConfigHtml = '';
    if (t.defaultKey !== undefined) {
      keyConfigHtml = `
        <div class="mb-3">
          <label class="form-label small fw-bold">Tecla a Enviar</label>
          <input type="text" class="form-control form-control-sm" id="wizard-key" value="${esc(keyVal)}" placeholder="Ex: T, 1, F1">
        </div>
      `;
    }

    return `
      <div class="wizard-container">
        <!-- Escolha do Template -->
        <div class="mb-3">
          <label class="form-label small fw-bold">1. Escolha o Modelo de Ação</label>
          <select class="form-select form-select-sm" id="wizard-template-select">
            ${TEMPLATES.map((tpl) => `<option value="${tpl.id}" ${tpl.id === t.id ? 'selected' : ''}>${esc(tpl.name)}</option>`).join('')}
          </select>
          <div class="small text-body-secondary mt-1">${esc(t.desc)}</div>
        </div>

        <!-- Captura de Cliques (se houver) -->
        ${clicksHtml}

        <!-- Tecla (se houver) -->
        ${keyConfigHtml}

        <!-- Nome e Atalho -->
        <div class="row g-2 mb-3">
          <div class="col-7">
            <label class="form-label small fw-bold">Nome do Preset</label>
            <input type="text" class="form-control form-control-sm" id="wizard-name" value="${esc(presetNameVal)}">
          </div>
          <div class="col-5">
            <label class="form-label small fw-bold">Atalho Global</label>
            <input type="text" class="form-control form-control-sm" id="wizard-hotkey" value="${esc(hotkeyVal)}" placeholder="Ex: F6, Ctrl+1">
          </div>
        </div>

        <!-- Área de Teste -->
        <div class="d-flex align-items-center justify-content-between p-2 rounded mb-1" style="background: rgba(13, 110, 253, 0.08); border: 1px solid rgba(13, 110, 253, 0.2);">
          <div>
            <strong class="small text-primary"><i class="bi bi-play-circle me-1"></i> Testar Função Antes de Salvar</strong>
            <div class="small text-body-secondary" style="font-size: 11px;">Dispara os comandos imediatamente nos personagens jogando sem gravar no banco.</div>
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" id="btn-test-function">
            <i class="bi bi-lightning-charge-fill me-1"></i> Testar Função
          </button>
        </div>
      </div>
    `;
  }

  function compileWizardSteps() {
    const t = selectedTemplate;
    const steps = [];

    if (t.id === 'follow') {
      const c1 = capturedClicks[0] || { rx: 0.08, ry: 0.15, button: 'left' };
      const c2 = capturedClicks[1] || { rx: 0.5, ry: 0.9, button: 'left' };
      steps.push({ type: 'click', target: 'members', rx: c1.rx, ry: c1.ry, button: c1.button, activate: true });
      steps.push({ type: 'delay', ms: 250 });
      steps.push({ type: 'click', target: 'members', rx: c2.rx, ry: c2.ry, button: c2.button, activate: true });
    } else if (t.id === 'target_leader') {
      const c = capturedClicks[0] || { rx: 0.08, ry: 0.15, button: 'left' };
      steps.push({ type: 'click', target: 'members', rx: c.rx, ry: c.ry, button: c.button, activate: true });
      steps.push({ type: 'delay', ms: 150 });
      steps.push({ type: 'key', target: 'members', key: keyVal || 'T', holdMs: 50 });
    } else if (t.id === 'fly' || t.id === 'mount' || t.id === 'buff') {
      steps.push({ type: 'key', target: 'all', key: keyVal || t.defaultKey, holdMs: 50 });
    } else if (t.id === 'boss_combo') {
      const c = capturedClicks[0] || { rx: 0.08, ry: 0.15, button: 'left' };
      steps.push({ type: 'click', target: 'members', rx: c.rx, ry: c.ry, button: c.button, activate: true });
      steps.push({ type: 'delay', ms: 150 });
      steps.push({ type: 'key', target: 'members', key: 'T', holdMs: 50 });
      steps.push({ type: 'delay', ms: 200 });
      steps.push({ type: 'key', target: 'members', key: keyVal || '1', holdMs: 50 });
    } else if (t.id === 'pt_accept') {
      const c = capturedClicks[0] || { rx: 0.5, ry: 0.55, button: 'left' };
      steps.push({ type: 'click', target: 'members', rx: c.rx, ry: c.ry, button: c.button, activate: true });
    }

    return steps;
  }

  const dlg = modal({
    title: `PW Assistente — Templates de Grupo (${group.name})`,
    size: 'modal-lg',
    submitLabel: 'Salvar Preset no Grupo',
    body: '<div id="wizard-content"></div>',
    onSubmit: async () => {
      const steps = compileWizardSteps();
      if (selectedTemplate.needsClicks > capturedClicks.filter(Boolean).length) {
        if (!confirm('Alguns cliques ainda não foram capturados. Deseja salvar com as posições sugeridas?')) {
          return false;
        }
      }

      await call('presets:save', {
        name: presetNameVal,
        groupId: group.id,
        hotkey: hotkeyVal,
        steps,
        perTargetDelayMs: 0,
        repeat: 1,
        repeatDelayMs: 0,
      });

      if (gridOpened) {
        await call('windows:close-hud-grid').catch(() => {});
      }
      toast(`Preset "${presetNameVal}" criado com sucesso no grupo!`, 'success');
      return true;
    },
  });

  function bindEvents() {
    const root = dlg.node;
    const content = root.querySelector('#wizard-content');
    content.innerHTML = getStepHtml();

    // Troca de Template
    const sel = content.querySelector('#wizard-template-select');
    sel.onchange = () => {
      selectedTemplate = TEMPLATES.find((tpl) => tpl.id === sel.value) || TEMPLATES[0];
      capturedClicks = [];
      bindEvents();
    };

    // Toggle HUD Grid
    const btnGrid = content.querySelector('#btn-toggle-grid');
    if (btnGrid) {
      btnGrid.onclick = async () => {
        gridOpened = await call('windows:toggle-hud-grid');
        btnGrid.innerHTML = `<i class="bi bi-grid-3x3 me-1"></i> ${gridOpened ? 'Fechar Grid HUD' : 'Abrir Grid HUD'}`;
      };
    }

    // Input handlers
    const inputName = content.querySelector('#wizard-name');
    if (inputName) inputName.oninput = () => (presetNameVal = inputName.value);

    const inputHotkey = content.querySelector('#wizard-hotkey');
    if (inputHotkey) inputHotkey.oninput = () => (hotkeyVal = inputHotkey.value);

    const inputKey = content.querySelector('#wizard-key');
    if (inputKey) inputKey.oninput = () => (keyVal = inputKey.value);

    // Captura de Cliques
    content.querySelectorAll('[data-capture]').forEach((btn) => {
      btn.onclick = async () => {
        const idx = Number(btn.getAttribute('data-capture'));
        const accId = followerAccount?.id;
        toast('Clique na janela do jogo para capturar o ponto...', 'info', 5000);
        try {
          const res = await call('capture:click', accId);
          if (res) {
            capturedClicks[idx] = res;
            toast(`Clique ${idx + 1} capturado com sucesso!`, 'success');
            bindEvents();
          }
        } catch (err) {
          toast(`Falha na captura: ${err.message}`, 'error');
        }
      };
    });

    // Testar Função
    const btnTest = content.querySelector('#btn-test-function');
    if (btnTest) {
      btnTest.onclick = async () => {
        try {
          const steps = compileWizardSteps();
          await call('presets:test', { name: `Teste: ${presetNameVal}`, steps }, group.id);
          toast('Comandos enviados para teste nas janelas do jogo!', 'success');
        } catch (err) {
          toast(`Erro ao testar função: ${err.message}`, 'error');
        }
      };
    }
  }

  bindEvents();
}
