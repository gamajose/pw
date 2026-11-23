# PW Manager — Arquitetura

Documento técnico para o TCC: estrutura, decisões de projeto, protocolo entre os módulos e testes.

## 1. Visão geral

O sistema tem três camadas, cada uma com uma responsabilidade:

```
┌──────────────────────────────────────────────┐
│ Interface (renderer)                         │  HTML + Bootstrap 5 + JavaScript (módulos ES)
│  index.html (janela principal)               │  sem acesso a Node.js; fala só via window.pw
│  mini.html  (janela flutuante do grupo)      │
└───────────────▲──────────────────────────────┘
                │ IPC (ipcRenderer.invoke 'rpc' / eventos 'state', 'notify')
┌───────────────┴──────────────────────────────┐
│ Processo principal (Electron / Node.js)      │  regras de negócio, persistência,
│  store, game, party, presets, hotkeys,       │  abertura dos clientes, atalhos globais
│  backup, windows, ipc                        │
└───────────────▲──────────────────────────────┘
                │ JSON por linha (stdin/stdout)
┌───────────────┴──────────────────────────────┐
│ Módulo nativo PwNative.exe (C# / .NET 9)     │  API Win32: janelas, teclado, mouse,
│  WindowOps, Input, HookThread, Sync,         │  hooks globais, Sync action, presets
│  Capture, PresetRunner, Commands             │
└──────────────────────────────────────────────┘
```

**Por que um módulo nativo separado?** O Node.js não acessa a API Win32 diretamente.
Addons nativos (C++/N-API) exigiriam compilar para cada versão do Electron. Um executável
.NET separado:

- compila independente do Electron;
- isola falhas (se cair, o processo principal reinicia o módulo automaticamente);
- tem uma thread dedicada com loop de mensagens Win32, exigida pelos hooks globais.

## 2. Estrutura de pastas

```
src/
  main/           processo principal
    main.js       inicialização, ciclo de vida, envio do estado para as janelas
    store.js      banco JSON, gravação atômica, criptografia das senhas
    native.js     ponte com PwNative.exe (requisições, eventos, reinício automático)
    game.js       abrir/fechar clientes, achar a janela, renomear título, sessões
    party.js      grupos, Sync action, troca de personagem, organizar janelas
    presets.js    resolve alvos e manda executar presets no módulo nativo
    hotkeys.js    atalhos globais (globalShortcut)
    backup.js     backup automático/manual e restauração
    windows.js    janelas, bandeja do sistema
    ipc.js        lista fechada de métodos que a interface pode chamar
    preload.cjs   expõe window.pw (call/on) com contextIsolation
    selftest.js   teste de ponta a ponta
  renderer/       interface
    js/app.js     navegação e barra lateral
    js/views/*    telas (contas, grupos, presets, servidores, configurações, sobre)
    js/mini.js    janela flutuante do grupo
    js/forms.js   formulários de servidor e conta
    js/ui.js      utilitários (escape de HTML, modais, toasts, captura de atalho)
  shared/keys.js  tabela de teclas (nome ↔ código virtual), usada pelos dois lados
native/
  PwNative/       módulo nativo (C#)
  FakeClient/     cliente simulado para testes e demonstração
scripts/          geração do ícone, verificações
```

## 3. Modelo de dados

Arquivo `%APPDATA%\PW Manager\data\db.json`:

| Coleção | Campos principais |
|---|---|
| `servers` | id, name, clientPath, args, forceServerName, description |
| `accounts` | id, serverId, name, login, **passwordEnc**, character, characterClass, tag, favorite, archived, order, totalSeconds, lastPlayedAt |
| `groups` | id, serverId, name, memberIds (ordem = posição), leaderId, archived |
| `presets` | id, name, groupId, hotkey, perTargetDelayMs, repeat, repeatDelayMs, steps[] |
| `sessions` | accountId, start, end, seconds (últimas 5000) |
| `runtime` | clientes abertos (accountId, pid) — permite reanexar após reiniciar o app |
| `settings` | preferências (mescladas com os valores padrão a cada carga) |

**Gravação atômica:** grava em `db.json.tmp` e renomeia, então uma queda no meio da gravação
nunca corrompe o banco. Se o arquivo estiver inválido, uma cópia é preservada antes de recomeçar.

## 4. Segurança

- **Senhas:** criptografadas com `safeStorage` do Electron, que no Windows usa a DPAPI
  (chave atrelada ao usuário do Windows). A interface nunca recebe senhas no estado; só sob demanda
  ("Mostrar senha"), e isso é bloqueado no Modo Streamer.
- **Isolamento da interface:** `contextIsolation`, `sandbox`, `nodeIntegration: false`,
  Content-Security-Policy restritiva, navegação externa e popups bloqueados.
- **Superfície de IPC fechada:** a interface só chama métodos listados em `ipc.js`, e só a partir
  de páginas `file://` do próprio app. Todas as entradas são validadas e limitadas em tamanho.

## 5. Protocolo com o módulo nativo

Uma mensagem JSON por linha, em UTF-8:

```json
→ {"id": 7, "cmd": "type-login", "args": {"hwnd": 1772050, "login": "joao", "password": "...", "method": "unicode"}}
← {"id": 7, "ok": true, "result": {"ok": true}}
← {"id": 8, "ok": false, "code": "NOT_FOREGROUND", "error": "A janela do jogo não estava em primeiro plano..."}
← {"event": "foreground", "data": {"hwnd": 1772050, "pid": 28648}}
```

Cada requisição roda numa task própria; por isso um comando longo (ex.: aguardar o clique do
usuário) não bloqueia os demais. Os códigos de erro (`NOT_FOUND`, `FOCUS_LOST`, `INPUT_BLOCKED`...)
são estáveis e traduzidos em mensagens amigáveis no processo principal.

| Grupo | Comandos |
|---|---|
| Janelas | `list-windows`, `window-info`, `window-for-pid`, `foreground`, `focus`, `minimize`, `restore`, `close`, `set-title`, `move`, `alive` |
| Entrada | `send-key`, `click`, `type-login`, `capture-click`, `cancel-capture` |
| Sync action | `sync-start`, `sync-update`, `sync-stop`, `sync-pause`, `sync-state` |
| Presets | `preset-run`, `preset-stop`, `preset-list` |
| Eventos | `ready`, `foreground`, `sync-paused`, `preset-finished` |

## 6. Técnicas Win32 utilizadas

| Necessidade | Técnica |
|---|---|
| Enviar teclas/cliques para janelas em segundo plano | `PostMessage` com `WM_KEYDOWN/UP` (lParam com scan code e bit estendido, como uma tecla real) e `WM_xBUTTONDOWN/UP` com coordenadas da área cliente |
| Digitar texto com a janela em foco | `SendInput` com `KEYEVENTF_UNICODE` (independe do layout do teclado) ou `VkKeyScan` + Shift |
| Trazer janela para frente | `AttachThreadInput` + `SetForegroundWindow` (o Windows restringe roubo de foco) e, se preciso, um toque de ALT |
| Saber qual janela está em foco | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` — evento, sem polling |
| Sync action e captura de clique | Hooks globais `WH_KEYBOARD_LL` / `WH_MOUSE_LL` numa thread com loop de mensagens, instalados só enquanto necessários; eventos com a flag `INJECTED` são ignorados (evita laço infinito) |
| Janelas de tamanhos diferentes | Coordenadas salvas em proporção (0–1) da área cliente e convertidas para cada janela |
| Telas com escala (125%, 150%) | Manifesto `PerMonitorV2` no módulo nativo; o Electron converte a área do monitor com `dipToScreenRect` |

### Fluxo do Sync action

```
usuário aperta F2 no personagem em foco
        │
WH_KEYBOARD_LL (thread de hooks do PwNative)
        │  janela em foco é membro do grupo? tecla permitida? sem Ctrl/Alt/Shift? não pausado?
        ▼
PostMessage(WM_KEYDOWN F2) para cada outro membro  ──► todos usam a habilidade
        │
o evento original segue normalmente para o personagem em foco
```

## 7. Comparação com o software de referência

A análise do PW Helper (v1.7.5) foi realizada por engenharia reversa nas rotas de IPC, binários nativos e chamadas de sistema, mapeando todas as funções ausentes para implementação nativa e limpa.

| Aspecto | PW Helper (referência) | PW Manager (este trabalho) |
|---|---|---|
| Interface | Electron + Angular 19 | Electron + JavaScript puro (módulos ES) + Bootstrap 5 |
| Parte nativa | 15 executáveis separados (sync-clients, play-preset, key-listener, etc.) | 1 executável C# unificado (`PwNative.exe`) com protocolo JSON e comandos |
| Dados | SQLite + electron-store | JSON com gravação atômica + DPAPI |
| Conta/assinatura | Login online, plano PRO, telemetria | 100% local, autônomo e sem telemetria |
| Funções básicas | Contas, servidores, modo grupo, sync, presets, atalhos, backup, streamer | Implementado e testado |
| Assistente de grupo | Assistente guiado de presets para buff, voo, montaria, seguir | Implementado (`party-wizard.js`) com teste de função imediato |
| Memória e Câmera | Offsets de HP/MP/Posição e alinhamento de câmera no Sync | Implementado em C# (`ReadProcessMemory`, `AlignCamera`) |
| Desempenho e CPU | Modo de economia e medição de uso de CPU/RAM | Implementado em C# (`process-metrics`) e Electron |
| Busca rápida | Spotlight/paleta de comandos (Ctrl+Space) | Implementado (`search.html` + `search.js`) |
| Diagnóstico e Log | Painel de monitoramento do Sync e janelas | Implementado (`synclog.html` + `synclog.js`) |
| Barra rápida | Tools-bar flutuante (horizontal e vertical) | Implementado (`toolbar.html` + `toolbar.js`) |
| Calculadoras | Calculadora de Livros Divinos (árvore de tomos) | Implementado (`calculators.js`) com persistência |
| Verificador cliente | Detecção de versão e launcher do patcher | Implementado (`version.js`) |
| Fora de escopo | Loja de skins, anúncios, SignalR/controle por celular | Desnecessário para servidores locais/privados |

## 8. Testes

1. **`npm run check`**: verifica a sintaxe de todos os arquivos e testa as funções puras
   (montagem dos argumentos do cliente, tokenização com aspas, tabela de teclas, título das janelas).
2. **Autoteste de ponta a ponta** (`PW_SELFTEST=1`): sobe o app real com dados isolados, cadastra
   servidor/contas/grupo, abre dois **clientes simulados** e verifica pelo log de cada um:
   - argumentos `startbypatcher` recebidos;
   - título das janelas renomeado;
   - janelas organizadas em mosaico;
   - digitação do login (segundo plano e Unicode);
   - preset com alvos corretos (F1 em todos, clique só no líder, tecla só nos membros);
   - teste imediato de preset sem salvar ("Testar Função");
   - alinhamento de câmera entre líder e seguidores;
   - métricas de processo (CPU % e consumo de RAM) via módulo C#;
   - verificação de versão do cliente e launcher;
   - abertura e fechamento de janelas auxiliares (HUD Grid, Toolbar, Spotlight, SyncLog);
   - calculadora de Livros Divinos e persistência de dados;
   - Sync action ligando com as 2 janelas;
   - sessões registradas ao fechar e backup criado;
   - capturas de tela de todas as telas (temas escuro e claro).
