// Tela de presets (macros): lista, editor de comandos e captura de cliques.
import { call, getState } from '../api.js';
import { esc, run, toast, modal, confirmDialog, formData, hotkeyInput } from '../ui.js';
import { KEYS } from '../../../shared/keys.js';

const ui = { root: null };

const STEP_LABEL = { key: 'Pressionar tecla', click: 'Clique', delay: 'Esperar', focus: 'Focar janela' };

export function mount(root, st) {
  ui.root = root;
  root.innerHTML = `
    <div class="view-header">
      <h1>Presets</h1>
      <span class="text-body-secondary small">Sequências de teclas e cliques executadas nos personagens do grupo, em segundo plano.</span>
      <div class="ms-auto d-flex gap-2">
        <button class="btn btn-outline-danger btn-sm" data-act="stop-all"><i class="bi bi-stop-fill"></i> Parar todos</button>
        <button class="btn btn-primary btn-sm" data-act="new"><i class="bi bi-plus-lg"></i> Novo preset</button>
      </div>
    </div>
    <div class="panel" id="preset-list"></div>`;
  root.querySelector('[data-act=new]').addEventListener('click', () => presetEditor());
  root.querySelector('[data-act=stop-all]').addEventListener('click', () => run(() => call('presets:stop-all')));
  root.querySelector('#preset-list').addEventListener('click', onListClick);
  update(st);
}

export function unmount() {
  ui.root = null;
}

export function update(st) {
  if (!ui.root) return;
  const list = ui.root.querySelector('#preset-list');
  if (!st.presets.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-lightning-charge big"></i>
        <h5>Nenhum preset</h5>
        <p>Exemplos: buffar o grupo, todos voarem/montarem juntos, pegar o alvo do líder e atacar.</p>
        <button class="btn btn-primary" data-act="new-empty"><i class="bi bi-plus-lg"></i> Criar preset</button>
      </div>`;
    return;
  }
  list.innerHTML = `
    <table class="table table-hover m-0 align-middle">
      <thead><tr><th style="width:60px"></th><th>Nome</th><th>Grupo</th><th>Atalho</th><th>Comandos</th><th>Repetir</th><th class="text-end">Ações</th></tr></thead>
      <tbody>
      ${st.presets
        .map((p, i) => {
          const running = st.presetsRunning.includes(p.id);
          const group = st.groups.find((g) => g.id === p.groupId);
          return `
          <tr data-id="${p.id}">
            <td class="text-nowrap">
              <button class="btn btn-sm btn-link p-0" data-act="up" ${i === 0 ? 'disabled' : ''} title="Subir"><i class="bi bi-chevron-up"></i></button>
              <button class="btn btn-sm btn-link p-0" data-act="down" ${i === st.presets.length - 1 ? 'disabled' : ''} title="Descer"><i class="bi bi-chevron-down"></i></button>
            </td>
            <td><strong>${esc(p.name)}</strong>${i === 0 ? ' <span class="badge text-bg-secondary">principal</span>' : ''}</td>
            <td>${group ? esc(group.name) : '<span class="text-body-secondary">Grupo ativo</span>'}</td>
            <td>${p.hotkey ? `<span class="kbd">${esc(p.hotkey)}</span>` : '—'}</td>
            <td class="small">${esc(p.steps.map((s) => stepSummary(s)).join(' → ')).slice(0, 120)}</td>
            <td>${p.repeat === 0 ? '∞' : p.repeat ?? 1}×</td>
            <td class="text-end text-nowrap">
              <button class="btn btn-sm ${running ? 'btn-danger' : 'btn-success'}" data-act="run">
                <i class="bi ${running ? 'bi-stop-fill' : 'bi-play-fill'}"></i> ${running ? 'Parar' : 'Executar'}</button>
              <button class="btn btn-sm btn-outline-secondary btn-icon" data-act="edit" title="Editar"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-secondary btn-icon" data-act="duplicate" title="Duplicar"><i class="bi bi-copy"></i></button>
              <button class="btn btn-sm btn-outline-danger btn-icon" data-act="delete" title="Excluir"><i class="bi bi-trash"></i></button>
            </td>
          </tr>`;
        })
        .join('')}
      </tbody>
    </table>`;
}

function targetLabel(t) {
  if (t === 'all') return 'todos';
  if (t === 'leader') return 'líder';
  if (t === 'members') return 'membros';
  if (t === 'focused') return 'em foco';
  if (t?.startsWith('pos:')) return `#${t.slice(4)}`;
  return t;
}

function stepSummary(s) {
  switch (s.type) {
    case 'key':
      return `${s.key || '?'} (${targetLabel(s.target)})`;
    case 'click':
      return `clique ${s.button === 'right' ? 'dir.' : 'esq.'} (${targetLabel(s.target)})`;
    case 'delay':
      return `${s.ms}ms`;
    case 'focus':
      return `focar ${targetLabel(s.target)}`;
    default:
      return s.type;
  }
}

async function onListClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  if (t.dataset.act === 'new-empty') return presetEditor();
  const id = t.closest('tr')?.dataset.id;
  const st = getState();
  const p = st.presets.find((x) => x.id === id);
  if (!p) return;
  const ids = st.presets.map((x) => x.id);
  const i = ids.indexOf(id);
  switch (t.dataset.act) {
    case 'run':
      return run(() => call('presets:run', id));
    case 'edit':
      return presetEditor(p);
    case 'duplicate':
      return run(() => call('presets:save', { ...p, id: undefined, name: p.name + ' (cópia)', hotkey: '' }), 'Preset duplicado.');
    case 'delete':
      if (await confirmDialog('Excluir preset', `Excluir o preset "${p.name}"?`, { confirmLabel: 'Excluir' })) return run(() => call('presets:delete', id));
      return undefined;
    case 'up':
    case 'down': {
      const j = t.dataset.act === 'up' ? i - 1 : i + 1;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return run(() => call('presets:reorder', ids));
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ editor

function targetOptions(selected, { allowMulti = true } = {}) {
  const opts = [];
  if (allowMulti) opts.push(['all', 'Todos'], ['members', 'Membros (sem o líder)']);
  opts.push(['leader', 'Líder'], ['focused', 'Personagem em foco']);
  for (let i = 1; i <= 10; i++) opts.push([`pos:${i}`, `Posição ${i}`]);
  return opts.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('');
}

export function presetEditor(preset = null) {
  const st = getState();
  const steps = structuredClone(preset?.steps ?? [{ type: 'key', key: 'F1', target: 'all' }]);
  const p = preset ?? { name: '', groupId: null, hotkey: '', perTargetDelayMs: 0, repeat: 1, repeatDelayMs: 0 };
  const groups = st.groups.filter((g) => !g.archived);

  const m = modal({
    title: preset ? 'Editar preset' : 'Novo preset',
    size: 'modal-xl',
    submitLabel: 'Salvar',
    body: `
      <div class="row g-3 mb-3">
        <div class="col-md-4">
          <label class="form-label">Nome *</label>
          <input class="form-control" name="name" maxlength="60" value="${esc(p.name)}" autofocus>
        </div>
        <div class="col-md-4">
          <label class="form-label">Grupo</label>
          <select class="form-select" name="groupId">
            <option value="">Grupo ativo no momento</option>
            ${groups.map((g) => `<option value="${g.id}" ${g.id === p.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label">Atalho global <span class="text-body-secondary small">(opcional)</span></label>
          <input class="form-control" name="hotkey" value="${esc(p.hotkey)}">
          <div class="form-text">Backspace limpa. Pressionar de novo para o preset.</div>
        </div>
        <div class="col-md-4">
          <label class="form-label">Atraso entre personagens (ms)</label>
          <input class="form-control" type="number" min="0" max="10000" name="perTargetDelayMs" value="${p.perTargetDelayMs ?? 0}">
        </div>
        <div class="col-md-4">
          <label class="form-label">Repetir (0 = até parar)</label>
          <input class="form-control" type="number" min="0" max="100000" name="repeat" value="${p.repeat ?? 1}">
        </div>
        <div class="col-md-4">
          <label class="form-label">Pausa entre repetições (ms)</label>
          <input class="form-control" type="number" min="0" max="600000" name="repeatDelayMs" value="${p.repeatDelayMs ?? 0}">
        </div>
      </div>
      <div class="d-flex align-items-center mb-2">
        <h6 class="m-0">Comandos</h6>
        <div class="ms-auto btn-group btn-group-sm">
          <button type="button" class="btn btn-outline-primary" data-add="key"><i class="bi bi-keyboard"></i> Tecla</button>
          <button type="button" class="btn btn-outline-primary" data-add="click"><i class="bi bi-mouse"></i> Clique</button>
          <button type="button" class="btn btn-outline-primary" data-add="delay"><i class="bi bi-hourglass"></i> Espera</button>
          <button type="button" class="btn btn-outline-primary" data-add="focus"><i class="bi bi-window"></i> Focar</button>
        </div>
      </div>
      <div id="steps"></div>
      <div class="d-flex align-items-center gap-2 mt-2 small">
        <i class="bi bi-crosshair"></i> Capturar cliques na janela de
        <select class="form-select form-select-sm w-auto" id="capture-acc"></select>
        <button type="button" class="btn btn-sm btn-link p-0" id="capture-refresh" title="Atualizar lista"><i class="bi bi-arrow-clockwise"></i></button>
        <span class="text-body-secondary">— a posição é salva em proporção (funciona em janelas de tamanhos diferentes) e o clique não é executado no jogo.</span>
      </div>
      <div class="alert alert-secondary small mt-3 mb-0">
        <strong>Dica:</strong> coloque a habilidade (buff, voar, montaria) no mesmo slot em todos os personagens.
        Quem não vai participar, deixe o slot vazio. Para pegar o alvo do líder, configure no jogo o atalho
        "Selecionar líder" numa tecla F1–F12 e use "Pressionar tecla" seguido do ataque auxiliar.
      </div>`,
    onShow: (form) => {
      hotkeyInput(form.hotkey);
      form.querySelectorAll('[data-add]').forEach((b) =>
        b.addEventListener('click', () => {
          const type = b.dataset.add;
          steps.push(
            type === 'key'
              ? { type, key: 'F1', target: 'all' }
              : type === 'click'
                ? { type, button: 'left', target: 'all', rx: null, ry: null, activate: false }
                : type === 'delay'
                  ? { type, ms: 500 }
                  : { type, target: 'leader' },
          );
          renderSteps(form);
        }),
      );
      const box = form.querySelector('#steps');
      box.addEventListener('change', (e) => onStepChange(e, form));
      box.addEventListener('input', (e) => onStepChange(e, form));
      box.addEventListener('click', (e) => onStepClick(e, form));
      form.querySelector('#capture-refresh').addEventListener('click', () => renderCaptureSelect(form));
      renderCaptureSelect(form);
      renderSteps(form);
    },
    onSubmit: async (form) => {
      const data = formData(form);
      await call('presets:save', { ...data, id: preset?.id, groupId: data.groupId || null, steps });
      toast('Preset salvo.', 'success');
    },
  });

  function renderSteps(form) {
    const box = form.querySelector('#steps');
    if (!steps.length) {
      box.innerHTML = '<div class="text-body-secondary small text-center py-3">Nenhum comando. Use os botões acima.</div>';
      return;
    }
    box.innerHTML = steps.map((s, i) => stepRow(s, i)).join('');
  }

  function stepRow(s, i) {
    let fields = '';
    if (s.type === 'key') {
      fields = `
        <select class="form-select form-select-sm" data-f="key" style="min-width:100px">
          ${KEYS.map((k) => `<option ${k.name === s.key ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
        </select>
        <span class="small text-body-secondary">em</span>
        <select class="form-select form-select-sm" data-f="target">${targetOptions(s.target)}</select>`;
    } else if (s.type === 'click') {
      const captured = s.rx != null && s.ry != null;
      fields = `
        <select class="form-select form-select-sm" data-f="button">
          <option value="left" ${s.button !== 'right' ? 'selected' : ''}>Esquerdo</option>
          <option value="right" ${s.button === 'right' ? 'selected' : ''}>Direito</option>
        </select>
        <span class="small text-body-secondary">em</span>
        <select class="form-select form-select-sm" data-f="target">${targetOptions(s.target)}</select>
        <button type="button" class="btn btn-sm ${captured ? 'btn-outline-success' : 'btn-outline-warning'}" data-act="capture">
          <i class="bi bi-crosshair"></i> ${captured ? `X ${(s.rx * 100).toFixed(1)}% · Y ${(s.ry * 100).toFixed(1)}%` : 'Capturar posição'}
        </button>
        <div class="form-check form-check-inline m-0" title="Para servidores que ignoram clique em janela inativa">
          <input class="form-check-input" type="checkbox" data-f="activate" id="act-${i}" ${s.activate ? 'checked' : ''}>
          <label class="form-check-label small" for="act-${i}">Ativar janela</label>
        </div>
        <div class="form-check form-check-inline m-0">
          <input class="form-check-input" type="checkbox" data-f="double" id="dbl-${i}" ${s.double ? 'checked' : ''}>
          <label class="form-check-label small" for="dbl-${i}">Duplo</label>
        </div>`;
    } else if (s.type === 'delay') {
      fields = `<input class="form-control form-control-sm" type="number" min="0" max="600000" step="50" data-f="ms" value="${s.ms ?? 0}" style="width:120px"><span class="small text-body-secondary">ms</span>`;
    } else if (s.type === 'focus') {
      fields = `<select class="form-select form-select-sm" data-f="target">${targetOptions(s.target, { allowMulti: false })}</select>`;
    }
    return `
      <div class="step-row" data-i="${i}">
        <span class="step-num">${i + 1}</span>
        <span class="badge text-bg-secondary">${STEP_LABEL[s.type]}</span>
        ${fields}
        <div class="ms-auto d-flex gap-1">
          <button type="button" class="btn btn-sm btn-link p-0" data-act="up" ${i === 0 ? 'disabled' : ''}><i class="bi bi-chevron-up"></i></button>
          <button type="button" class="btn btn-sm btn-link p-0" data-act="down" ${i === steps.length - 1 ? 'disabled' : ''}><i class="bi bi-chevron-down"></i></button>
          <button type="button" class="btn btn-sm btn-link text-danger p-0" data-act="remove" title="Remover comando"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>`;
  }

  function onStepChange(e, form) {
    const f = e.target.dataset.f;
    const rowEl = e.target.closest('[data-i]');
    if (!f || !rowEl) return;
    const s = steps[Number(rowEl.dataset.i)];
    if (e.target.type === 'checkbox') s[f] = e.target.checked;
    else if (f === 'ms') s.ms = Number(e.target.value) || 0;
    else s[f] = e.target.value;
    void form;
  }

  async function onStepClick(e, form) {
    const b = e.target.closest('[data-act]');
    const rowEl = e.target.closest('[data-i]');
    if (!b || !rowEl) return;
    const i = Number(rowEl.dataset.i);
    switch (b.dataset.act) {
      case 'remove':
        steps.splice(i, 1);
        break;
      case 'up':
        [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
        break;
      case 'down':
        [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
        break;
      case 'capture':
        await captureFor(steps[i], form);
        break;
      default:
        return;
    }
    renderSteps(form);
  }

  async function captureFor(step, form) {
    const accountId = form.querySelector('#capture-acc').value;
    if (!accountId) {
      toast('Abra pelo menos um personagem para capturar a posição do clique.', 'warning');
      return;
    }
    toast('Clique no ponto desejado na janela do jogo (Esc cancela).', 'info', 3000);
    const r = await run(() => call('capture:click', accountId));
    if (r) {
      step.rx = r.rx;
      step.ry = r.ry;
      step.button = r.button;
      toast(`Clique ${r.button === 'right' ? 'DIREITO' : 'ESQUERDO'} capturado em X ${r.x} · Y ${r.y}`, 'success');
    }
  }

  function renderCaptureSelect(form) {
    const st2 = getState();
    const sel = form.querySelector('#capture-acc');
    const prev = sel.value;
    const playing = st2.running.filter((r) => r.hwnd).map((r) => st2.accounts.find((a) => a.id === r.accountId)).filter(Boolean);
    sel.innerHTML = playing.length
      ? playing.map((a) => `<option value="${a.id}" ${a.id === prev ? 'selected' : ''}>${esc(a.character || a.name)}</option>`).join('')
      : '<option value="">Nenhum personagem jogando</option>';
  }

  return m;
}
