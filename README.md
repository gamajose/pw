# PW Manager

Gerenciador de contas, multi-cliente e automações para servidores de **Perfect World**
(projeto de TCC). Inspirado nas funcionalidades do PW Helper, com implementação própria.

## Funcionalidades

| Área | O que faz |
|---|---|
| **Servidores** | Cadastro do `elementclient.exe`, modelo de argumentos (`startbypatcher user:{login} pwd:{password} role:{character}`), estatísticas por servidor e por classe. |
| **Contas** | Cadastro com senha criptografada (DPAPI do Windows), tags, favoritos, arquivamento, busca, filtros, 6 ordenações, ordem manual por arrastar, seleção em massa, importação JSON/CSV, exportação. |
| **Abrir o jogo** | Abre um ou vários clientes, acompanha processo e janela, renomeia o título com o nome do personagem, registra sessões e horas jogadas. |
| **Digitar login** | Digita login → Tab → senha → Enter na janela do jogo (3 métodos: Unicode, teclas virtuais ou em segundo plano). Atalho global para o cliente em foco. |
| **Modo grupo** | Grupos de até 10 personagens com líder, ordem por arrastar, abrir/fechar todos, organizar janelas (mosaico, líder em destaque, cascata, por monitor), janela flutuante sempre no topo. |
| **Sync action** | Repete nos outros membros as teclas (F1–F12, 0–9, A–Z, Tab, Espaço) e cliques feitos no personagem em foco, com escala proporcional ao tamanho de cada janela, pausa automática para o chat (Enter) e alinhamento de câmera 3D (`yaw`/`pitch`/`zoom`). |
| **Presets & PW Assistente** | Macros com teclas, cliques, esperas e foco, com alvo por papel (todos, líder, membros, em foco, posição N), repetição e atalho global. O **PW Assistente** gera templates prontos guiados (Buff, Voar, Montaria, Seguir líder com 2 cliques, Pegar Target do Líder, Rotação de Boss e Aceitar PT) com botão de "Testar Função" imediato. |
| **Grid de Alinhamento HUD** | Overlay transparente com guias e reticulado milimétrico para igualar as posições das barras de PT nas janelas do jogo antes da captura de cliques. |
| **Barra Flutuante** | Toolbar sempre no topo com alternância rápida de orientação (horizontal/vertical), controle de Sync, presets, alinhamento de câmera e troca de clientes. |
| **Busca Rápida (Spotlight)** | Paleta de comandos centralizada acionada por `Ctrl+Space` para buscar e disparar contas, grupos, presets, ferramentas e ações do sistema. |
| **Diagnóstico & Log do Sync** | Painel em tempo real com métricas de CPU/RAM por cliente, monitoramento de janelas, barras de HP/MP e registro detalhado de eventos. |
| **Calculadora de Livros Divinos** | Árvore completa de Tomos dos Níveis 1 ao 9 com cálculo de materiais (Páginas Antigas, Fragmentos, Essências), moedas e persistência de preços. |
| **Versão e Launcher** | Leitura automática da versão do cliente (`version01`/`version`) e localização/abertura direta do `patcher.exe`/`launcher.exe`. |
| **Atalhos globais** | Digitar login, ligar/desligar Sync, próximo/anterior personagem, parar presets, busca rápida (Ctrl+Space), barra flutuante (Ctrl+Shift+T), teclado numérico para escolher personagem. |
| **Outros** | Modo Streamer, tema claro/escuro, backup automático/manual com restauração, bandeja do sistema, logs. |

## Requisitos

- Windows 10/11 x64
- [Node.js](https://nodejs.org) 20+
- [.NET SDK 9](https://dotnet.microsoft.com/download) (só para compilar o módulo nativo)

## Como rodar (desenvolvimento)

```powershell
npm install
npm run build:native      # compila native/PwNative -> bin/PwNative.exe
npm run build:icon        # gera build/icon.png e build/icon.ico
npm start
```

## Gerar o instalador

```powershell
npm run dist              # gera dist/PW Manager Setup 1.0.0.exe
```

## Testes

```powershell
npm run check             # sintaxe de todos os arquivos + testes unitários das funções puras
```

Teste de ponta a ponta (abre o app com dados isolados, usa o **cliente simulado** no lugar do
jogo e gera relatório + capturas de tela):

```powershell
dotnet build native/FakeClient/FakeClient.csproj -c Release -o native/FakeClient/out
$env:PW_MANAGER_DATA="$env:TEMP\pw-teste\data"; $env:PW_SELFTEST="1"; $env:PW_SELFTEST_OUT="$env:TEMP\pw-teste\out"
npx electron .
# resultado em $env:TEMP\pw-teste\out\report.json e *.png
```

O cliente simulado (`native/FakeClient`, gera um `elementclient.exe`) mostra na tela tudo o que recebe:
argumentos, teclas, caracteres digitados e cliques. Ótimo para demonstrar o funcionamento na apresentação
sem depender do jogo: cadastre um servidor apontando para `native/FakeClient/out/elementclient.exe`.

## Observações

- Se o jogo rodar como **administrador**, o PW Manager também precisa rodar como administrador
  (o Windows bloqueia envio de teclas de um processo comum para um elevado — UIPI).
- Atalhos globais "roubam" a tecla do jogo; por isso a interface exige Ctrl ou Alt.
- A senha é passada ao cliente pela linha de comando (`startbypatcher`), como fazem os launchers.
- Use somente em servidores próprios/locais ou onde automação é permitida.

Documentação técnica: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
