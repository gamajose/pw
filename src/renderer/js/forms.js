// Formulários reutilizados por várias telas (servidor, conta).
import { call, getState } from './api.js';
import { esc, modal, formData, classOptions, toast, duration } from './ui.js';

export function serverForm(server = null) {
  const st = getState();
  const s = server ?? { name: '', clientPath: '', args: st.app.defaultArgs, forceServerName: '', description: '' };
  modal({
    title: server ? 'Editar servidor' : 'Novo servidor',
    size: 'modal-lg',
    body: `
      <div class="mb-3">
        <label class="form-label">Nome do servidor *</label>
        <input class="form-control" name="name" maxlength="60" value="${esc(s.name)}" autofocus required>
      </div>
      <div class="mb-3">
        <label class="form-label">Caminho do element client *</label>
        <div class="input-group">
          <input class="form-control" name="clientPath" value="${esc(s.clientPath)}" placeholder="C:\\PW\\element\\elementclient.exe">
          <button type="button" class="btn btn-outline-secondary" data-act="browse"><i class="bi bi-folder2-open"></i> Procurar</button>
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label">Argumentos</label>
        <input class="form-control font-monospace" name="args" value="${esc(s.args)}">
        <div class="form-text">
          Variáveis: <span class="kbd">{login}</span> <span class="kbd">{password}</span> <span class="kbd">{character}</span>
          <span class="kbd">{server}</span> <span class="kbd">{account}</span>. Um argumento com variável vazia é omitido.
          <a href="#" data-act="default-args">Restaurar padrão</a>
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label">Forçar servidor específico <span class="text-body-secondary small">(opcional, preenche {server})</span></label>
        <input class="form-control" name="forceServerName" maxlength="60" value="${esc(s.forceServerName ?? '')}">
        <div class="form-text">Caso esteja recebendo muitas falhas ao tentar logar, deixe vazio.</div>
      </div>
      <div class="mb-1">
        <label class="form-label">Descrição</label>
        <textarea class="form-control" name="description" rows="2" maxlength="500">${esc(s.description ?? '')}</textarea>
      </div>`,
    onShow: (form) => {
      form.querySelector('[data-act=browse]').addEventListener('click', async () => {
        const p = await call('dialog:pick-client');
        if (p) form.clientPath.value = p;
      });
      form.querySelector('[data-act=default-args]').addEventListener('click', (e) => {
        e.preventDefault();
        form.args.value = st.app.defaultArgs;
      });
    },
    onSubmit: async (form) => {
      const saved = await call('servers:save', { ...formData(form), id: server?.id });
      if (!server) await call('servers:select', saved.id);
      toast('Servidor salvo.', 'success');
    },
  });
}

export function accountForm(account = null, preset = {}) {
  const st = getState();
  const serverId = account?.serverId ?? preset.serverId ?? st.settings.selectedServerId;
  if (!st.servers.length) {
    toast('Cadastre um servidor primeiro.', 'warning');
    serverForm();
    return;
  }
  const a = account ?? { name: '', login: '', character: '', characterClass: '', tag: '', email: '', notes: '', favorite: false };
  const tags = [...new Set(st.accounts.map((x) => x.tag).filter(Boolean))].sort();

  modal({
    title: account ? 'Editar conta' : 'Adicionar conta',
    size: 'modal-lg',
    body: `
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Nome da conta *</label>
          <input class="form-control" name="name" maxlength="60" value="${esc(a.name)}" autofocus>
        </div>
        <div class="col-md-6">
          <label class="form-label">Servidor *</label>
          <select class="form-select" name="serverId">
            ${st.servers.map((s) => `<option value="${s.id}" ${s.id === serverId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label">Login</label>
          <input class="form-control" name="login" maxlength="100" value="${esc(a.login)}" autocomplete="off">
        </div>
        <div class="col-md-6">
          <label class="form-label">Senha ${account?.hasPassword ? '<span class="text-body-secondary small">(deixe vazio para manter)</span>' : ''}</label>
          <div class="input-group">
            <input class="form-control" name="password" type="password" maxlength="100" autocomplete="new-password">
            <button type="button" class="btn btn-outline-secondary" data-act="toggle-pass" title="Mostrar"><i class="bi bi-eye"></i></button>
          </div>
          ${account?.hasPassword ? `<div class="form-check mt-1"><input class="form-check-input" type="checkbox" name="clearPassword" id="clr-pass"><label class="form-check-label small" for="clr-pass">Apagar senha salva</label></div>` : ''}
        </div>
        <div class="col-md-6">
          <label class="form-label">Personagem</label>
          <input class="form-control" name="character" maxlength="60" value="${esc(a.character)}">
        </div>
        <div class="col-md-6">
          <label class="form-label">Classe</label>
          <select class="form-select" name="characterClass">${classOptions(a.characterClass)}</select>
        </div>
        <div class="col-md-6">
          <label class="form-label">Tag</label>
          <input class="form-control" name="tag" maxlength="40" value="${esc(a.tag)}" list="tag-list">
          <datalist id="tag-list">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
        <div class="col-md-6">
          <label class="form-label">E-mail <span class="text-body-secondary small">(opcional)</span></label>
          <input class="form-control" name="email" maxlength="120" value="${esc(a.email)}">
        </div>
        <div class="col-12">
          <label class="form-label">Observações</label>
          <textarea class="form-control" name="notes" rows="2" maxlength="1000">${esc(a.notes)}</textarea>
        </div>
        <div class="col-12">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" name="favorite" id="fav" ${a.favorite ? 'checked' : ''}>
            <label class="form-check-label" for="fav">Favorita</label>
          </div>
        </div>
      </div>`,
    onShow: (form) => {
      form.querySelector('[data-act=toggle-pass]').addEventListener('click', () => {
        form.password.type = form.password.type === 'password' ? 'text' : 'password';
      });
    },
    onSubmit: async (form) => {
      const data = formData(form);
      const payload = { ...data, id: account?.id };
      if (data.clearPassword) payload.password = '';
      else if (!data.password) delete payload.password; // mantém a senha atual
      delete payload.clearPassword;
      await call('accounts:save', payload);
      toast(account ? 'Conta atualizada.' : 'Conta adicionada.', 'success');
    },
  });
}

export function accountInfo(account) {
  const st = getState();
  const server = st.servers.find((s) => s.id === account.serverId);
  const m = modal({
    title: account.name,
    cancelLabel: 'Fechar',
    body: `<div class="text-center text-body-secondary py-3"><div class="spinner-border spinner-border-sm"></div></div>`,
  });
  call('accounts:stats', account.id).then(({ sessions }) => {
    const rows = sessions
      .map(
        (s) => `<tr><td>${new Date(s.start).toLocaleString('pt-BR')}</td><td>${new Date(s.end).toLocaleTimeString('pt-BR')}</td><td class="text-end">${fmt(s.seconds)}</td></tr>`,
      )
      .join('');
    m.node.querySelector('.modal-body').innerHTML = `
      <dl class="row mb-3">
        <dt class="col-5">Servidor</dt><dd class="col-7">${esc(server?.name ?? '—')}</dd>
        <dt class="col-5">Personagem</dt><dd class="col-7">${esc(account.character || '—')}</dd>
        <dt class="col-5">Horas jogadas</dt><dd class="col-7">${fmt(account.totalSeconds)}</dd>
        <dt class="col-5">Última sessão</dt><dd class="col-7">${account.lastPlayedAt ? new Date(account.lastPlayedAt).toLocaleString('pt-BR') : '—'}</dd>
        <dt class="col-5">Criada em</dt><dd class="col-7">${new Date(account.createdAt).toLocaleString('pt-BR')}</dd>
      </dl>
      <h6>Últimas sessões</h6>
      ${
        rows
          ? `<table class="table table-sm"><thead><tr><th>Início</th><th>Fim</th><th class="text-end">Duração</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="text-body-secondary small">Nenhuma sessão registrada.</p>'
      }`;
  });

  const fmt = duration;
}
