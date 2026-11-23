// Utilitários de interface: escape de HTML, toasts, modais, formatação e componentes pequenos.
/* global bootstrap */

export function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Cria um elemento a partir de HTML (o HTML deve ter um único elemento raiz). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message, type = 'info', ms = 4000) {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const node = el(`<div class="pw-toast ${esc(type)}" role="status"></div>`);
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => node.remove(), type === 'error' ? Math.max(ms, 7000) : ms);
  node.addEventListener('click', () => node.remove());
}

/** Executa uma ação assíncrona mostrando erro em toast. Retorna o resultado ou undefined. */
export async function run(fn, success) {
  try {
    const r = await fn();
    if (success) toast(success, 'success');
    return r;
  } catch (err) {
    toast(err.message || String(err), 'error');
    return undefined;
  }
}

/**
 * Abre um modal Bootstrap. `body` é HTML; `onSubmit(form, modalEl)` pode lançar erro (fica aberto)
 * ou retornar false para não fechar.
 */
export function modal({ title, body, size = '', submitLabel = 'Salvar', cancelLabel = 'Cancelar', danger = false, onSubmit, onShow, footer = true }) {
  const node = el(`
    <div class="modal fade" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ${size}">
        <form class="modal-content" novalidate>
          <div class="modal-header">
            <h5 class="modal-title">${esc(title)}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>
          <div class="modal-body">${body}</div>
          ${
            footer
              ? `<div class="modal-footer">
                  <div class="modal-error text-danger small me-auto"></div>
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${esc(cancelLabel)}</button>
                  ${onSubmit ? `<button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>` : ''}
                </div>`
              : ''
          }
        </form>
      </div>
    </div>`);
  document.body.appendChild(node);
  const instance = new bootstrap.Modal(node);
  const form = node.querySelector('form');
  const errorBox = node.querySelector('.modal-error');
  let busy = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit || busy) return;
    busy = true;
    if (errorBox) errorBox.textContent = '';
    try {
      const keep = (await onSubmit(form, node)) === false;
      if (!keep) instance.hide();
    } catch (err) {
      if (errorBox) errorBox.textContent = err.message || String(err);
      else toast(err.message, 'error');
    } finally {
      busy = false;
    }
  });
  node.addEventListener('hidden.bs.modal', () => {
    instance.dispose();
    node.remove();
  });
  node.addEventListener('shown.bs.modal', () => {
    node.querySelector('[autofocus]')?.focus();
  });
  onShow?.(form, node);
  instance.show();
  return { node, form, close: () => instance.hide() };
}

export function confirmDialog(title, message, { danger = true, confirmLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title,
      body: `<p class="mb-0" style="white-space:pre-line">${esc(message)}</p>`,
      submitLabel: confirmLabel,
      danger,
      onSubmit: () => {
        ok = true;
      },
    });
    m.node.addEventListener('hidden.bs.modal', () => resolve(ok));
  });
}

export function formData(form) {
  const out = {};
  for (const elx of form.elements) {
    if (!elx.name) continue;
    if (elx.type === 'checkbox') out[elx.name] = elx.checked;
    else if (elx.type === 'number') out[elx.name] = elx.value === '' ? null : Number(elx.value);
    else out[elx.name] = elx.value;
  }
  return out;
}

// ------------------------------------------------------------------ formatação

export function duration(seconds) {
  seconds = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function relative(ts) {
  if (!ts) return 'nunca';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return `há ${Math.floor(diff / 86400)} d`;
}

// ------------------------------------------------------------------ classes

export const CLASS_INFO = {
  BLADEMASTER: { name: 'Guerreiro', short: 'GR', color: '#c0392b' },
  WIZARD: { name: 'Mago', short: 'MG', color: '#8e44ad' },
  ARCHER: { name: 'Arqueiro', short: 'AR', color: '#27ae60' },
  CLERIC: { name: 'Sacerdote', short: 'SC', color: '#2980b9' },
  BARBARIAN: { name: 'Bárbaro', short: 'BB', color: '#a0522d' },
  VENOMANCER: { name: 'Feiticeira', short: 'FT', color: '#d35400' },
  PSYCHIC: { name: 'Espiritualista', short: 'ES', color: '#16a085' },
  ASSASSIN: { name: 'Mercenário', short: 'MC', color: '#2c3e50' },
  SEEKER: { name: 'Arcano', short: 'AC', color: '#b7950b' },
  MYSTIC: { name: 'Místico', short: 'MS', color: '#1abc9c' },
  DUSKBLADE: { name: 'Retalhador', short: 'RT', color: '#7f8c8d' },
  STORMBRINGER: { name: 'Tormentador', short: 'TM', color: '#5d6d7e' },
  TECHNICIAN: { name: 'Atiradora', short: 'AT', color: '#e67e22' },
  EDGERUNNER: { name: 'Paladino', short: 'PL', color: '#f1c40f' },
  WILDWALKER: { name: 'Andarilho', short: 'AN', color: '#6e2c00' },
  BARD: { name: 'Bardo', short: 'BD', color: '#e84393' },
  STORE: { name: 'Loja', short: 'LJ', color: '#95a5a6' },
};

export function classBadge(cls) {
  const info = CLASS_INFO[cls];
  if (!info) return `<span class="class-badge" style="background:#6c757d" title="Sem classe"><i class="bi bi-person"></i></span>`;
  return `<span class="class-badge" style="background:${info.color}" title="${esc(info.name)}">${info.short}</span>`;
}

export function classOptions(selected) {
  return (
    `<option value="">— Sem classe —</option>` +
    Object.entries(CLASS_INFO)
      .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(v.name)}</option>`)
      .join('')
  );
}

// ------------------------------------------------------------------ captura de atalho

const CODE_TO_KEY = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Escape: 'Esc',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

/** Converte um KeyboardEvent num acelerador do Electron (ex.: "Ctrl+Shift+F1"). */
export function acceleratorFromEvent(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (/^Numpad\d$/.test(e.code)) key = 'num' + e.code.slice(6);
  else key = CODE_TO_KEY[e.code] ?? null;
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Problema com o atalho (ou null se for válido). Atalhos globais "roubam" a tecla do jogo. */
export function hotkeyProblem(accel) {
  if (!accel) return null;
  const parts = accel.split('+');
  const key = parts.pop();
  const hasCtrlAlt = parts.includes('Ctrl') || parts.includes('Alt');
  if (/^num\d$/.test(key) && parts.length === 0) return 'Teclas numéricas sozinhas ficam reservadas para trocar de personagem.';
  if (!hasCtrlAlt) return parts.includes('Shift') ? 'Shift sozinho não vale; use Ctrl ou Alt.' : 'Use Ctrl ou Alt junto com a tecla (senão ela deixa de funcionar no jogo).';
  if (accel === 'Alt+F4' || accel === 'Ctrl+Alt+Delete') return `${accel} é reservado pelo sistema.`;
  return null;
}

/**
 * Transforma um <input> em campo de captura de atalho.
 * Backspace/Delete limpam. O valor fica em input.value.
 */
export function hotkeyInput(input, onChange) {
  input.readOnly = true;
  input.classList.add('hotkey-input');
  input.placeholder = input.placeholder || 'Clique e pressione o atalho';
  input.addEventListener('focus', () => input.classList.add('capturing'));
  input.addEventListener('blur', () => input.classList.remove('capturing'));
  input.addEventListener('keydown', (e) => {
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey) {
      input.value = '';
      onChange?.('');
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) return;
    const accel = acceleratorFromEvent(e);
    if (!accel) return;
    const problem = hotkeyProblem(accel);
    if (problem) {
      toast(problem, 'warning');
      return;
    }
    input.value = accel;
    onChange?.(accel);
  });
}

export function maskText(text) {
  return text ? '•'.repeat(Math.min(10, Math.max(6, text.length))) : '';
}
