# Changelog

Todas as mudanças notáveis do **OpenClaude Desktop** são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
o projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [2.37.0] — 2026-06-15

### Added — Checkpoint / rewind por turno (reverter alterações de arquivos)

Antes só dava para desfazer 1 arquivo (`undo_last_write`). Agora cada turno tem
um checkpoint e, se ele alterar arquivos, aparece um toast **"N arquivo(s)
alterado(s) — Reverter"** que restaura tudo de uma vez — como o rewind do Claude
Code.

- `snapshotFile` ganhou `seq` monotônico e passou a registrar também arquivos
  CRIADOS (marcador `created`) — o rewind agora **apaga** os criados, além de
  repor os modificados (antes criação era irreversível).
- IPCs `checkpoint-mark` (marca o seq no início do turno), `checkpoint-count`
  (quantos arquivos distintos mudaram) e `checkpoint-restore` (restaura LIFO
  tudo com seq > marca — caminha o estado de volta ao início do turno).
- `useChat` marca o checkpoint no início e oferece o "Reverter" no fim.
- `undo_last_write` também passou a desfazer criações (apaga o arquivo).

3ª das 5 áreas do plano "vs Claude". 663 testes, typecheck e build OK.

## [2.36.0] — 2026-06-15

### Fixed — Confiabilidade: retry seguro para erro "unknown" pré-resposta

A telemetria mostrava ~45% dos turnos com erro; depois do `timeout` (já com
retry de cold-start), a 2ª categoria era `unknown` (6×) — e ela não tinha
nenhuma recuperação. Como um erro `unknown` que ocorre ANTES de qualquer
conteúdo transmitido é uma falha pré-resposta (nada foi commitado nem cobrado),
agora ele recebe **1 retry seguro** (orçamento próprio `MAX_UNKNOWN_RETRIES`),
nos dois caminhos (streaming e não-streaming). Guardado por `!accumulated`
(streaming) e respeitando o Parar. 2ª das 5 áreas do plano "vs Claude".
663 testes, typecheck OK.

## [2.35.0] — 2026-06-15

### Added — MCP ponta a ponta (as tools dos servidores chegam ao modelo)

Era um recurso fantasma: havia UI em Settings e o backend conectava/chamava
servidores MCP, mas as tools nunca eram expostas ao modelo (`mcpTools` ficava
hardcoded em 0 e `mcpCallTool` não era chamado em lugar nenhum do chat). Agora o
MCP funciona de verdade, como no Claude:

- Hook `useMcp` conecta nos servidores configurados, faz `tools/list` e expõe as
  tools ao modelo namespaced no padrão do Claude `mcp__<servidor>__<tool>`.
- `useChat` mescla as tools MCP às nativas (`extraTools`) antes do deferral/
  partição — o modelo realmente recebe e pode chamar.
- `useToolExecution` roteia chamadas `mcp__*` de volta ao servidor certo
  (`mcp-call-tool`).
- Segurança: tools MCP são tratadas como perigosas no gate de aprovação
  (`toolNeedsApproval`) — pedem permissão por padrão (em 'ignore' não), já que
  podem ler/escrever arquivos e acessar a rede.
- Helpers puros testáveis `src/utils/mcpTools.ts` (parse de comando, namespacing,
  conversão de inputSchema) + 13 testes.

Esta é a 1ª das 5 áreas de melhoria do plano "vs Claude". 663 testes, typecheck
e build de produção OK.

## [2.34.0] — 2026-06-14

### Fixed — IA entregava relatório com o plano em "0/7" (tarefas nunca concluídas)

Bug relatado: o modelo criava um plano, fazia o trabalho e entregava a resposta
final SEM chamar `update_task_status` — o painel ficava em 0/7 para sempre. O
harness só tinha um nudge de "execute o passo 1" logo após `plan_tasks` (uma vez
só), insuficiente para um plano de vários passos, e nenhuma checagem no fim do
turno.

- **Espelho local do plano** (`src/utils/planTracker.ts`, puro + testado):
  `applyPlanToolCalls` reconstrói o estado do plano a partir das tool calls
  `plan_tasks` / `update_task_status` (igual ao monitor de todos do Claude Agent
  SDK), e `planIsIncomplete` diz se sobrou tarefa em pending/in_progress.
- **Nudge de fim de turno (capado)**: quando o modelo dá a resposta final com o
  plano incompleto, o loop do `useChat` injeta `[CONCLUA O PLANO]` e continua —
  no máximo 3 vezes, para não loopar. Aplicado nos 4 pontos de término
  (streaming + não-streaming, resposta final + finish_reason), só em modo agente
  e respeitando o Parar.
- **Steering reforçado** no system prompt (pt/en): antes da resposta final,
  reconcilie o plano — marque cada etapa como done/failed; nunca entregue com
  tarefas pendentes.

9 testes novos (planTracker). 653 testes, typecheck e build de produção OK.

## [2.33.0] — 2026-06-14

### Added — `fetch_url`: ler página sem abrir navegador (estilo WebFetch)

Nova ferramenta `fetch_url` (read-only, em `SAFE_TOOLS`): faz um HTTP GET puro e
devolve título + texto extraído da página, **sem subir o motor do navegador nem
abrir janela**. É o caminho padrão para ler/varrer uma página — espelha o
WebFetch do Claude. Sinaliza `(thin/JS-rendered)` quando o texto vem fino (SPA),
indicando ao modelo para cair para `browser_navigate`. Suporta redirects (até 5),
timeout de 15s, cap de 2 MB e content-type não-texto recusado com dica.

- Pure helper testável `electron/web-fetch-util.js` (`htmlToText`,
  `extractTitle`, `decodeEntities`, `looksThin`) + 10 testes.
- IPC `fetch-url` em `main.js`; `fetchUrl` no preload e nos tipos.

### Changed — Navegador embutido agora roda OCULTO por padrão

Antes, `browser_navigate` forçava `show()` a cada navegação — daí "qualquer ação
abre a página". Agora o navegador é **headless por padrão** (`browserVisible =
false`): navegar/ler não abre janela. A janela só aparece para ferramentas
visuais (screenshot / clique por coordenada), via `ensureTabVisible`
(`showInactive`, sem roubar foco). Descrições de `browser_navigate` /
`browser_get_text` reescritas para direcionar: **ler → `fetch_url`; interagir →
`browser_navigate`**. (`web_search` já era headless.)

Como o Claude gerencia: WebSearch (API) e WebFetch (HTTP→texto) sem navegador;
navegador real só para interação. Esta versão alinha o app a esse modelo.

Nota: dirigir o Chrome instalado do sistema (CDP/puppeteer) seria um recurso
maior e foi descartado — o headless por padrão já resolve o popup. 644 testes,
typecheck e build de produção OK.

## [2.32.0] — 2026-06-14

### Added — Auto-fechar o plano ao concluir (estilo Claude)

No Claude Code o todo-list não fica num painel fixo que você fecha: ele é
efêmero e, pelo ciclo de vida oficial, é *removido quando todas as tarefas do
grupo concluem*. Adotamos esse comportamento: quando **todas** as tarefas do
`task-plan-panel` chegam a `done`, o painel some sozinho após ~4s (atraso para
ver o "tudo verde" antes). Durante esses segundos, a pílula de progresso e o
título ficam **verdes** (classe `is-complete`) sinalizando a conclusão.

- `useEffect` em `App.tsx` observa `activeConv.taskPlan`; quando todo `done`,
  agenda a limpeza de `taskPlan` (mesmo efeito do X manual). O timer é cancelado
  se um novo plano substituir o atual antes do prazo.
- O botão **X** continua para fechar antes da hora.

Typecheck, build de produção e 634 testes OK.

## [2.31.0] — 2026-06-14

### Added — Botão de fechar o painel de plano de tarefas

Antes só dava para *minimizar* o `task-plan-panel` (o cabeçalho continuava
visível); não havia como removê-lo da tela. Agora o cabeçalho tem um botão **X**
(ao lado do contador) que fecha o plano de vez — limpa `taskPlan` da conversa
ativa via `setConversations`. O clique no X usa `stopPropagation` para não
disparar o minimizar do cabeçalho. O painel reaparece se o modelo criar um novo
plano (`plan_tasks`); enquanto fechado, `update_task_status` é no-op (não
ressuscita o painel). CSS `.task-plan-close` restaurado (hover vermelho, suporte
a tema claro). Typecheck, build e 634 testes OK.

## [2.30.0] — 2026-06-14

### Fixed — Painel de plano de tarefas: drift CSS↔JSX (itens sem estilo)

O widget `task-plan-panel` (acima do compositor) renderizava os itens da lista
sem estilo nenhum: o JSX usava as classes `task-plan-list` / `task-plan-item` /
`task-${status}` (ex.: `task-done`, `task-in_progress`), mas o CSS só estilizava
`.task-list` / `.task-item.done` / `.task-item.in-progress` (com hífen). Nenhuma
regra de item casava — daí "ficava errado": tudo na mesma cor, sem destaque do
ativo nem riscado no concluído.

### Changed — Redesign do checklist no padrão do Claude (Agent SDK / TodoWrite)

A partir da doc oficial de todo-tracking (estados pending→in_progress→completed,
exatamente uma tarefa ativa, ativa destacada, concluídas com check+riscado,
progresso "X/Y"):

- Classes do JSX e do CSS realinhadas (`is-${status}`); CSS órfão `.task-item`/
  `.task-list` removido.
- Estados visuais claros: **pendente** apagado (círculo vazio), **em progresso**
  destacado (acento + leve fundo + spinner), **concluído** esmaecido + riscado +
  check verde, **falhou** em vermelho.
- **Barra de progresso fina** sob o cabeçalho, visível inclusive colapsado.
- Quando colapsado, mostra a **tarefa atual** (não perde o foco de vista).
- Cabeçalho com `goal` truncado por ellipsis + contador "X/Y" em pílula
  (tabular-nums).

Só JSX (`App.tsx`) + CSS (`index.css`); sem mudança de modelo de dados. 634
testes passando, typecheck e build de produção OK. Próximo passo possível:
adotar `activeForm` (gerúndio da tarefa ativa) — exige um campo no `plan_tasks`.

## [2.29.0] — 2026-06-14

### Added — Skill builtin de pentest (segurança ofensiva ética)

Nova skill builtin `pentest`: um ciclo de penetration testing ético, ativada
sob demanda (load_skill) ou por palavra-chave (pentest/vulnerabilidade/OWASP/
exploit/CVE/red team…). Complementa a persona **Sentinela** — a persona troca a
identidade do assistente; a skill é uma capacidade carregável que injeta só o
playbook quando relevante.

- **Gate de autorização (passo 0) inegociável**: antes de qualquer recon ou PoC,
  exige autorização explícita do dono, escopo (alvos in/out), janela e regras de
  engajamento (sem DoS, sem exfiltrar dados reais). Sem escopo claro → PARE.
- Ciclo: recon (passivo→ativo) → enumeração → análise de vulnerabilidades
  (OWASP/CWE/CVE + CVSS) → PoC controlada (mínima, não destrutiva) → verificação
  adversarial sem falso positivo → relatório com remediação concreta e disclosure
  responsável → persistir/limpar artefatos.
- Reusa as ferramentas do harness (web_search, execute_command, search_files,
  plan_tasks, remember_fact…), no mesmo padrão das skills `code` e
  `pesquisa-com-fontes`.
- Testes: presença da skill, ênfase em autorização/escopo, passo 0 antes do 1, e
  unicidade de nomes/ids dos builtins.

## [2.28.0] — 2026-06-14

### Changed — Skills builtin de code e pesquisa reescritas (pesquisa + verificação adversarial)

As duas skills builtin mais importantes foram elevadas a playbooks de alto nível,
a partir de pesquisa web em fontes autoritativas (Anthropic Engineering —
context engineering / harnesses / building effective agents / agent skills;
SWE-agent ACI; SWE-bench fail-to-pass; Google eng-practices; lateral reading/SIFT),
sintetizadas e passadas por verificação adversarial.

- **`code`** (antes "code-review", raso): agora um ciclo completo de coding —
  entender (search_files/read_file) → planejar (plan_tasks) → reproduzir →
  mudança mínima e cirúrgica (edit_file, não write_file; undo_last_write no
  erro) → verificar com ground truth (execute_command) → disciplina em erros →
  auto-revisar o diff (git_command) com escada de severidade. Triggers de
  implementação (implementar/corrigir/bug/refatorar…).
- **`pesquisa-com-fontes`** (antes rasa): pesquisa robusta — decompor/calibrar
  esforço → busca em leque com parcimônia (sem repetir query, cache de 5min) →
  citar dos resultados do web_search (só navegar quando load-bearing) →
  triangular 2-3 fontes independentes → verificação adversarial → citação
  anti-alucinação em passada separada → persistir com remember_fact.
- A verificação adversarial corrigiu imprecisões sobre as tools reais do app
  (web_search já traz URL; remember_fact vs update_working_memory; git_command;
  undo_last_write) e o overlap de triggers entre as skills.
- IDs estáveis (merge/reset preservados); 632 testes verdes.

## [2.27.0] — 2026-06-14

### Added — Skills: capacidades reutilizáveis invocadas pelo modelo (Fases 1–3)

Novo sistema de **Skills**, distinto de personas (identidade exclusiva) e do
prompt-vault (trechos manuais). Uma skill é uma capacidade *on-demand* com
progressive disclosure — espelha o padrão de tool-deferral, mantendo o contexto
barato.

**Fase 1 — Núcleo no chat:**
- Modelo `Skill` (nome, descrição, instruções, gatilhos, enabled, pinned) +
  persistência `skills.json` (IPC `skill-load`/`skill-save`, no backup).
- **Manifesto no system prompt**: nome+descrição das skills ativas + instrução
  para o modelo chamar `load_skill("nome")` quando relevante (custo de token
  mínimo até usar — preenche o slot "skills" do painel de contexto, antes stub).
- **Tool `load_skill`** (SAFE): devolve as instruções completas sob demanda;
  execução pura em useToolExecution.
- 3 skills builtin (code-review, pesquisa-com-fontes, commit-e-pr).

**Fase 2 — Configuração (criar skills):**
- Painel **SkillManager** (Command Palette → "Skills"): criar/editar/ativar/
  fixar/excluir, com formulário de nome/descrição/instruções/gatilhos.

**Fase 3 — Avançado:**
- **Pin manual**: injeta as instruções completas sempre (fallback confiável
  para modelos pequenos que não chamam `load_skill` sozinhos).
- **Gatilhos por palavra-chave**: se uma palavra do gatilho aparece na mensagem,
  a skill é auto-injetada naquele turno.
- **Import/Export** de skills em JSON.

- Helpers puros/testáveis em `utils/skills.ts`; 15 testes novos (632 no total).
- Nota de escopo: allowlist de tools por skill foi deixada como refinamento
  futuro (mexeria no pipeline crítico de partição de tools).

## [2.26.0] — 2026-06-14

### Fixed — Robustez: auto-retry de timeout de cold-start (o erro nº1 da telemetria)

Decisão guiada por dados. A telemetria mostrava o problema de robustez mais
grave do projeto: **17 de 23 turnos com erro (74%)**, e o drill-down revelou
**14 deles no Modal/GLM-5.1, dominados por timeout (13), com ZERO retries** —
porque timeout era classificado como `retryable: false`. Cada timeout matava o
turno sem nenhuma tentativa.

A causa é cold-start: o GLM-5.1 (744B MoE) demora a subir o container no Modal.
Mas a 1ª tentativa que "falhou" **já aqueceu o container** — então uma 2ª
tentativa pega ele pronto e responde. A política de não-retry era o bug.

- **`isColdStartTimeout(kind, hasContent)`** (puro/testável): um timeout SEM
  conteúdo transmitido é tratado como cold-start e refeito. COM conteúdo já no
  ar, não (evita resposta duplicada).
- Branch dedicado nos caminhos streaming e não-streaming (mesma arquitetura da
  recuperação de stall, v2.22.0), com orçamento próprio (`MAX_TIMEOUT_RETRIES=1`)
  e toast "Provedor aquecendo — tentando de novo…". Timeout ≠ provider morto
  (morto dá ECONNREFUSED/network, não timeout), então o retry é bem-mirado.
- `logInsight` registra o retry de timeout — o próximo digest vai mostrar a
  conversão de timeout→sucesso.
- 4 testes novos (617 no total).

Nota: a eliminação definitiva do cold-start é server-side (Modal `min_containers=1`),
config na sua conta. Este ciclo torna o app **resiliente** a ele.

## [2.25.0] — 2026-06-14

### Added — Controle de esforço de raciocínio por provider

Evolução do raciocínio escolhida pelo usuário. Um único setting (`reasoningEffort`)
controla quanto o modelo "pensa", mapeado para o parâmetro correto de cada
provider — verificado contra as APIs de 2026:

- **GLM-5.1 (Modal/vLLM)**: `chat_template_kwargs.enable_thinking` (binário —
  desligar acelera tarefas simples, atacando de quebra a latência/cold-start).
- **Ollama**: `think` on/off (melhor-esforço no endpoint OpenAI-compat).
- **OpenAI / OpenRouter / Custom**: `reasoning_effort` (low/medium/high).
- **Anthropic**: `thinking.budget_tokens` por nível — e remove `temperature`
  (incompatível) + garante `max_tokens > budget`.

- **Seguro por padrão**: `default` (o padrão) **não envia nada** — comportamento
  atual preservado, sem risco de quebrar o GLM. O usuário escolhe
  desligar/baixo/médio/alto em Configurações.
- Mapeador puro/testável em `electron/reasoning-control.js` (mesmo padrão do
  `provider-timeouts.js`), aplicado nos 4 handlers (provider stream/non-stream
  + Ollama stream/non-stream). 8 testes novos (613 no total).
- Nota honesta: profundidade (baixo/médio/alto) só vale onde o provider suporta
  (OpenAI/Anthropic); GLM e Ollama são liga/desliga.

## [2.24.0] — 2026-06-13

### Fixed — Timeout ao usar modelo local com contexto grande (janela de contexto real para Ollama)

Sintoma (relatado pelo usuário): ao trocar para um modelo local do Ollama com a
conversa já grande (~132k), o envio dava "O provedor demorou demais para
responder". Causa raiz, confirmada no código: o orçamento de contexto para
modelos locais era **fictício** — o app usava a janela *teórica* do modelo
(`qwen3.5` → 128k via `getModelContextLimit`) e, pior, **nunca informava o
`num_ctx` ao Ollama** (só mandava `temperature`). Resultado: ou o Ollama
truncava em silêncio no seu default pequeno, ou tentava processar ~130k tokens
num GPU de 12 GB — o KV-cache estoura a VRAM, escorre pra RAM e a geração trava
até o timeout. Na nuvem (GLM 200k) isso roda fácil; no local, não.

- **`effectiveContextLimit(provider, model, ollamaNumCtx)`**: para Ollama usa a
  janela REAL configurada (não a teórica); nuvem continua usando a janela do
  modelo. Aplicado em 3 lugares: orçamento de mensagens (compacta/trunca antes
  de enviar), decisão de tool-deferral, e o painel de contexto (acaba o falso
  "106%" ao trocar para local).
- **`num_ctx` enviado ao Ollama** nos handlers de chat (stream e não-stream) —
  o Ollama de fato aloca a janela que o app orçou, alinhando contagem e
  realidade.
- **Setting novo `ollamaNumCtx`** (default **8192**, configurável em
  Configurações) — seguro contra timeout em qualquer 12 GB; suba se sua
  VRAM/modelo aguentar.
- 7 testes novos (605 no total).


## [2.23.0] — 2026-06-13

### Added — Troca rápida de modelo/provider no chat (estilo Claude)

Atende ao pedido do usuário: alternar entre **Modal** e **Ollama** (e qualquer
provider configurado) **direto no chat**, sem abrir Configurações. Antes, o
seletor só listava modelos quando o provider era Ollama; para Modal ele apenas
abria as Configurações — trocar de provider exigia navegar no menu.

- **Switcher unificado** no seletor de modelo (acima do composer): um clique
  abre um dropdown agrupado por provider, estilo Claude, com **check no ativo**.
- Lista cada **modelo Ollama local** + o **modelo configurado** de cada provider
  cloud que tenha credencial (Modal, Anthropic, OpenAI, OpenRouter, Gemini,
  Custom). O provider atual sempre aparece, mesmo sem credencial.
- Selecionar troca na hora e **persiste** (provider em settings; modelo Ollama
  em localStorage) — reusa os padrões existentes, o chat já lê via
  `useProviderConfig`. Rodapé com "Configurar providers…" para o resto.
- Lógica pura/testável em `utils/modelSwitcher.ts` (`buildSwitchOptions` +
  `groupSwitchOptions`); 7 testes novos (602 no total).

## [2.22.0] — 2026-06-13

### Added — Auto-recuperação de stream travado (stall) em vez de matar o turno

Atende ao pedido direto do usuário: quando aparecia "Erro do provedor: Stream
travado: provider parou de enviar conteúdo por 150s (só keep-alive)", o turno
morria e era preciso reenviar à mão. Agora o passo é refeito automaticamente.
Causa: a mensagem caía em `unknown` (não-retryável) e, mesmo se não caísse, o
retry transitório tinha a trava `!accumulated` (stall costuma pegar no meio).
Desenho validado por painel multi-agente + verificação adversarial (escolhido
retry-do-zero sobre continuação por ser estruturalmente seguro).

- **Classificação `stall`** (`providerErrors.ts`): casa os fragmentos ASCII
  da mensagem real (`travado`/`parou de enviar`/`keep-alive`), antes do check
  de timeout; retryável, com mensagem amigável ("O provedor travou no meio da
  resposta").
- **Recuperação retry-do-zero** no loop de chat: ao detectar stall, espera
  1,2s e refaz o MESMO passo. Seguro por construção — nada parcial é commitado
  no erro (o commit só roda no sucesso), então não há texto duplicado nem
  tool-call com JSON truncado (o catch precede a execução de tools); os
  acumuladores são re-declarados zerados na nova iteração.
- **Orçamento `stallRecovery.ts`** (puro/testável): 1 retry por passo, teto de
  3 por turno — recupera stalls isolados ao longo de um run agêntico longo
  (pior caso GLM/Modal) sem re-cobrar em loop. É o ÚNICO guard de término do
  stall (o `safetyLimit` global não conta porque o retry rebobina o passo).
- Esgotado o orçamento, degrada exatamente como antes (mensagem amigável,
  turno encerra) — nunca pior. `logInsight` registra cada stall-retry para o
  Dev Insights.
- 12 testes novos (595 no total).

## [2.21.0] — 2026-06-13

### Added — Dev Insights: cold-start client-fixável determinável + conselho no-op corrigido

Segunda rodada guiada por dados. Os dados apontaram dois sinks de latência:
espera/cold-start (52%) e montagem de execute_command (37%). Decisão validada
por painel multi-agente + verificação adversarial — que descartou o alvo óbvio
(instrumentar execute_command) por dois motivos convergentes: (a) o conteúdo dos
comandos é inacessível (telemetria privacy-safe; conversations.json vazio), e
(b) mover script para arquivo NÃO reduz tokens, então a bifurcação seria
inconclusiva. Pivot para o sink MAIOR, com bifurcação limpa.

- **Instrumentação `prevToolMs`**: cada `stream_profile` agora carrega a duração
  da execução de tool do passo anterior (só um número; nenhum conteúdo). Permite
  correlacionar "execução local longa → espera longa no passo seguinte".
- **Finding `cold-start-after-local-exec` (crítico)**: quando a espera média
  após execução longa ≥ 1,5× a espera após execução curta, conclui que o
  container Modal **esfria durante a execução local** — parte do cold-start é
  **client-fixable** (keep-warm durante tool longa), uma hipótese agora
  *validável* em vez de chute. Caso contrário, `cold-start-provider-idle` (info)
  conclui que é idle puro do provider (server-side).
- **Conselho no-op corrigido (×2 lugares)**: os findings `tool-assembly-dominant`
  e `long-tool-assemblies` recomendavam "escrever scripts em arquivo e rodar" —
  um NO-OP, pois são os mesmos tokens em `write_file.content`. Agora dizem a
  verdade: só MENOS tokens (comandos menores; edit_file para editar em vez de
  regenerar) ou provider mais rápido reduzem o tempo de montagem.
- **Cold-start enriquecido** com os knobs exatos do Modal: `min_containers=1` e
  `scaledown_window`/`container_idle_timeout`, com nota de custo (1 GPU ociosa).
- 4 testes novos (587 no total). Validado sobre a telemetria real.

## [2.20.0] — 2026-06-13

### Fixed — Dev Insights mentia no diagnóstico de latência (1ª rodada guiada por dados reais)

Com dados reais acumulados, o próprio digest revelou que **sua conclusão
principal estava errada**. O finding de topo dizia "montagem de tool consome
76% → use edit_file em vez de write_file", mas a telemetria mostrava write_file
com **0 usos**; e o maior sorvedouro de tempo nem era montagem de tool. Decisão
validada por painel multi-agente + verificação adversarial contra o arquivo de
eventos cru.

- **Denominador honesto**: `buildFindings` e `compareVersionSegments` calculavam
  o share de tempo excluindo a espera de 1º token (`gen = reasoning+tool+content`),
  escondendo que o **cold start do provider é o maior custo** — agora rankeiam
  sobre o wall-clock total (wait+reasoning+tool+content), igual ao .md e ao painel
  (que já estavam certos e se contradiziam com os findings).
- **Finding novo `cold-start-wait-dominant` (crítico)**: dispara quando a espera
  é a maior fatia; nos dados reais = **52% (2790s)**. Recomendação marcada como
  server-side (keep-warm / min_containers no Modal) — diagnóstico, não conserto
  no escuro.
- **Atribuição por ferramenta**: `streamShare.toolMsByName` junta
  `stream_profile`↔`tool/use` por (turn,step) — chaves auto-injetadas desde a
  v2.14.0 — e atribui a montagem à tool REAL. Nos dados reais: **execute_command
  = 70%** da montagem (o modelo emite scripts gigantes inline), write_file
  ausente. Passos sem par 1:1 caem em `unattributed` (honesto, não inventa).
- Findings `tool-assembly-dominant` e `long-tool-assemblies` reescritos para
  nomear a tool real e recomendar mover scripts longos do execute_command para
  arquivo — a frase hardcoded sobre write_file/edit_file só aparece quando os
  dados a sustentam.
- Painel e relatório .md ganham a quebra "montagem por ferramenta".
- 4 testes novos (585 no total). Validação extra sobre a telemetria real:
  o digest deixou de citar write_file e passou a apontar cold-start + execute_command.

## [2.19.0] — 2026-06-12

### Changed — Fazer o modelo USAR o edit_file (steering + coaching + medição)

Dev Insights revelou: o edit_file existe completo de ponta a ponta, mas o
modelo nunca o usou — 0 chamadas em 30 dias contra 9 write_file (cada um
podendo levar 13 min montando o arquivo inteiro no Modal/GLM). O ciclo ataca
o comportamento, não a infra:

- **Steering**: regra nova no AGENT_SYSTEM_PROMPT (pt + en) — "EDITE, NÃO
  REESCREVA": edit_file para alterar arquivo existente; write_file só para
  arquivo novo ou reescrita total intencional.
- **Coaching in-context**: o handler write-file agora reporta `existed`/`bytes`;
  quando o modelo reescreve um arquivo existente com 1500+ chars, o tool
  result vem com a nota "este arquivo já existia — use edit_file na próxima
  alteração parcial". O feedback chega exatamente onde um modelo não-frontier
  aprende: no resultado da própria chamada.
- **Medição**: evento novo `tool/rewrite_existing` + contador no atrito +
  finding `prefer-edit-file` (aviso quando ≥3 reescritas; drill-down incluso)
  — o painel passa a denunciar o anti-padrão sozinho.
- 6 testes novos (583 no total).

## [2.18.0] — 2026-06-12

### Added — Dev Insights ciclo 5 (final do plano): auto-análise pelo modelo configurado

Opção 5 — o app analisa a si mesmo. Botão "Analisar com IA" no painel envia o
digest formatado + amostra dos 120 eventos mais recentes (apenas metadados —
nunca conteúdo de mensagens, garantido por construção da telemetria) ao
provider configurado e exibe um relatório narrativo.

- **`services/insightsAnalysis.ts`**: prompt builder puro com seções
  obrigatórias (Diagnóstico, Top 3 prioridades com evidência numérica,
  Hipóteses, Próximo ciclo sugerido, Monitorar) e regras anti-alucinação
  ("cite números reais; não invente; declare amostra insuficiente").
- Mesma arquitetura da compactação cloud: roteado pelo `provider-chat` /
  `ollama-chat` não-streaming (ambos OpenAI-shaped); nunca lança.
- Resultado renderizado em markdown no topo do painel; o "Exportar .md"
  inclui a análise quando ela rodou.
- 5 testes novos (577 no total). Fecha o plano de 5 ciclos do Dev Insights.

## [2.17.0] — 2026-06-12

### Added — Dev Insights ciclo 4: drill-down (do achado à timeline dos eventos)

Opção 4 do plano. O digest dizia "1 turno zumbi"; agora dá para clicar e ver
o que aconteceu — sem sair do painel, sem IPC novo (os eventos crus já eram
carregados).

- **`DrillSelector` + `drillEvents`**: cada finding carrega o seletor dos
  eventos que o sustentam (erros por tipo/versão, turnos zumbis, perfis com
  montagem longa, tool/feature por nome, ações de atrito). Resolução pura,
  mais novos primeiro, cap de 50.
- **Timeline inline no painel**: clicar num achado expande a lista de eventos
  (hora · categoria/ação · meta compacto). Achados com drill mostram chevron.
- **Pulo para a timeline do turno**: qualquer evento com `turn` ganha o botão
  "ver turno" — abre TUDO que aquele turno fez, em ordem. Para um zumbi:
  o último ato antes de morrer fica visível em dois cliques (era exatamente
  a arqueologia manual do diagnóstico v2.13.x).
- 7 testes novos (572 no total).

## [2.16.0] — 2026-06-12

### Changed — Dev Insights ciclo 3: motor de findings no lugar das notas fixas

Opção 3 do plano. As notas eram frases de threshold fixo, sempre iguais e sem
hierarquia — quem lia não sabia o que atacar primeiro.

- **`buildFindings`**: achados estruturados com **severidade**
  (crítico/aviso/info), **evidência** (os números que sustentam — achado sem
  evidência não entra), **recomendação acionável** e **score de impacto** para
  ranquear. Catálogo: zumbis, regressão/melhora entre versões, erros
  novos/resolvidos, montagem de tool dominante, raciocínio dominante,
  montagens longas, erro frequente, circuit-breaks, respostas vazias, pressão
  de contexto, tools negadas, latência, feature/tool mais usada.
- **Recomendação específica por categoria de erro** (timeout → watchdog;
  auth → credenciais; unknown → melhorar classificação; etc.).
- Painel: seção "Achados (por impacto)" com bolinha de severidade colorida,
  evidência e recomendação por item. Relatório .md: "## Achados" com 🔴🟡🔵.
- `notes` continua existindo, agora derivado 1:1 dos findings (compatibilidade
  com quem lê o digest JSON) — todos os textos antigos preservados.
- 5 testes novos (565 no total).

## [2.15.0] — 2026-06-12

### Added — Dev Insights ciclo 2: digest comparativo ("o que mudou desde a versão anterior")

Opção 2 do plano de evolução. Como desde o v2.14.0 todo evento carrega a
versão do app, a comparação sai pura dos próprios eventos — sem snapshots
persistidos, sem IPC novo.

- **`compareVersionSegments`**: segmenta os eventos pelas duas versões mais
  recentes com amostra suficiente (≥3 turnos cada) e compara métricas
  **normalizadas por turno** (volumes de uso diferem entre versões): erros,
  zumbis e retries por turno, latência média, share de montagem de tool e de
  raciocínio. Eventos legados sem versão caem no balde `pré-2.14.0` — baseline
  imediato.
- **Erros novos × resolvidos**: tipos de erro que estrearam na versão atual e
  os que sumiram desde a anterior.
- **Notas comparativas**: "taxa de erro caiu de X para Y/turno — o ciclo
  funcionou", "⚠ possível regressão", "erro novo na vX", "zumbis zerados".
- Painel ganha a seção "O que mudou (vA → vB)" com verde/vermelho por direção
  da métrica; relatório .md ganha a seção equivalente.
- 7 testes novos (560 no total).

## [2.14.0] — 2026-06-12

### Added — Dev Insights ciclo 1: lifecycle de turno, perfil de geração e versões

Evolução da telemetria (opção 1 de 5 do plano de melhoria): antes os eventos
eram um fluxo achatado — impossível responder "o turno terminou?", "onde foi
o tempo?", "qual versão introduziu o problema?". O diagnóstico do falso
travamento (v2.13.3) exigiu arqueologia manual de eventos + netstat; agora o
digest responde sozinho.

- **Correlação por turno**: todo evento durante um turno ganha `turn` (id),
  `step` (passo do loop agêntico) e `v` (versão do app) automaticamente.
- **Desfecho explícito**: `chat/complete` agora carrega `outcome`
  (ok/error/aborted). Turno sem complete = **zumbi** (app fechado no meio,
  crash ou stream preso) — contado no digest com nota de alerta.
- **Perfil de geração** (`chat/stream_profile` por passo): onde foi o tempo —
  espera do 1º token, raciocínio, montagem de tool call, texto. O caso "13 min
  montando um write_file" vira linha de digest ("montagem de tool consome X%")
  com nota sugerindo a tool de edição por trecho quando domina (≥40%).
- **Mix de versões**: turnos por versão do app — mede o efeito de cada release.
- Painel Dev Insights e relatório .md ganham as seções Turnos, Perfil de
  geração e Versões (zumbis destacados em vermelho).
- Novos puros/testáveis: `classifyDelta` + `createPhaseProfiler` em
  streamPhase.ts; 16 testes novos (553 no total).

## [2.13.4] — 2026-06-12

### Fixed — Corretor ortográfico sem sugestões (faltava o menu de contexto)

O Chromium sublinhava a palavra errada no composer, mas botão direito não
abria nada: o Electron NÃO cria menu de contexto sozinho — o app precisa
montá-lo no evento `context-menu` com `params.dictionarySuggestions`.

- Menu de contexto na janela principal: até 6 sugestões de correção (clicou,
  `replaceMisspelling` troca a palavra), "Adicionar ao dicionário", e as ações
  de edição padrão (Recortar/Copiar/Colar/Selecionar tudo) em campos editáveis
  + Copiar em texto selecionado fora deles.
- Dicionários fixados em pt-BR + en-US (`setSpellCheckerLanguages`) — antes
  dependia do locale do SO; inglês junto evita falso-positivo em termo técnico.

## [2.13.3] — 2026-06-12

### Fixed — "Travou de novo" que não era travamento: progresso invisível agora é visível

Diagnóstico via Dev Insights + netstat: o "congelamento" relatado após o 2.13.2
era o stream VIVO (conexão ESTABLISHED com o Modal, turno de 12+ min) — mas o
GLM-5.1 estava raciocinando (`delta.reasoning_content`) ou montando uma tool
call grande (`delta.tool_calls`), e a UI só renderiza `delta.content`. Minutos
de progresso real com um cursor parado piscando.

- Novo `utils/streamPhase.ts`: redutor puro que deriva a fase invisível dos
  deltas (raciocínio vLLM/DeepSeek `reasoning_content`, OpenRouter `reasoning`,
  argumentos de tool) com contador acumulado de chars.
- Indicador vivo na UI: "raciocinando… 3,4k chars" / "montando write_file…
  12,1k chars" — junto ao cursor na bolha de streaming E na fase de espera
  (raciocínio antes do primeiro token). O contador subindo é o sinal de vida.
  Atualização com throttle de 300ms para não re-renderizar a cada delta.
- Anthropic extended thinking (`thinking_delta`) agora é encaminhado como
  `reasoning_content` — mesmo indicador, antes era descartado em silêncio.
- 9 testes novos do redutor/formatadores.

## [2.13.2] — 2026-06-12

### Fixed — Mais dois buracos da mesma família do congelamento (varredura pós-2.13.1)

- **Invoke que resolve com `{error}` sem chunk `done`**: o handler
  `provider-chat-stream` tem early-returns que RESOLVEM a promise do invoke com
  `{error}` antes de qualquer chunk (baseUrl custom inválida; provider sem
  suporte a streaming, ex. Gemini). O renderer só tinha `.catch` — a promise do
  stream nunca assentava e a UI congelava igual ao bug do 2.13.1. Agora o
  `.then` rejeita quando o invoke resolve com `{error}`.
- **Mensagem de timeout enganosa**: quando o idle de socket disparava na fase
  `stream` (90s/150s), a mensagem reportava o budget de `connect` (120s/300s).
  O budget vigente agora é lido na hora do disparo.

## [2.13.1] — 2026-06-12

### Fixed — Stream congelado mid-resposta (keep-alive resetava o timeout)

A entrega da resposta podia congelar para sempre com o cursor piscando: o guarda
de mid-stream era o **idle timeout de socket** (`req.setTimeout`), que reseta com
*qualquer* byte — inclusive keep-alives SSE (`: OPENROUTER PROCESSING`,
`data: {"type":"ping"}` da Anthropic). Provider travava a geração mas seguia
pingando → timeout nunca disparava → turno preso sem erro nem retry.

- Novo `createStallWatchdog` em `electron/provider-timeouts.js`: timer em nível
  de **conteúdo**, resetado só por eventos SSE reais (deltas de texto/tool/usage);
  pings da Anthropic explicitamente não contam. Comentários SSE já nem chegam ao
  parser.
- No stall (mesmo budget da fase `stream`: 90s, Modal 150s), o main destrói a
  request e emite `done` com erro — o renderer rejeita, destrava a UI e o turno
  termina com mensagem clara em vez de congelar.
- O idle de socket continua valendo para silêncio total na conexão; o watchdog
  cobre o caso "socket vivo, geração morta".
- 4 testes novos com fake timers (estouro, reset por touch, stop definitivo,
  dispara no máximo 1x).

## [2.12.46] — 2026-06-06

### Fixed — Auditoria (ciclo 2): `isSmallModel` cobre todos os tamanhos ≤14B

Varredura continuada. Em `utils/formatting.ts`, `isSmallModel` (decide se injeta a
"diretiva crítica de agente" para modelos pequenos) usava uma **lista fixa**
(`0.5/1/3/7/8/9/14b`) que **ignorava 2b/4b/5b/10b–13b** — então modelos pequenos
comuns (gemma-2b, qwen-4b, llama-13b) rodando em modo agente não recebiam o reforço
de que precisam. Também havia dead code (uma checagem `hasSize` cujos dois ramos
retornavam `false`).

- Novo `parseModelSizeB(name)` (puro/testável) extrai a contagem de parâmetros em
  bilhões ("llama3.1-8b" → 8, "qwen2.5-0.5b" → 0.5).
- `isSmallModel` agora classifica **qualquer modelo ≤14B** como pequeno; 30B/70B
  ficam médio/grande; modelos namespaced/cloud (ex: seu `zai-org/GLM-5.1-FP8`)
  seguem **não-pequenos** (inalterado). Dead code removido.
- **+5 testes** (cobertura nova + `parseModelSizeB`); 364 no total. Auditoria sem
  achados em: SSE streaming (buffer parcial robusto) e tokenizer (já lazy).

## [2.12.45] — 2026-06-06

### Changed — Auditoria ponta a ponta (ciclo 1): detecção de progresso do agente testada

Início da varredura completa do projeto buscando melhorias. Achado: a lógica de
**idle/no-progress** do loop agêntico (decide quando parar um agente que não está
avançando o objetivo) estava **inline no `useChat.processToolCalls` e sem teste** —
um caminho crítico para quem usa muito o modo agente (execute_command é o tool nº1).

- **`utils/circuitBreaker.ts`** ganhou dois helpers puros: `isProgressResult` (um
  resultado conta como progresso, exceto writes de working-memory e guardas
  `[SYSTEM INTERCEPT]`) e `computeAgentProgress` (calcula idleSteps + se o loop
  continua, parando após `threshold` passos sem progresso).
- **`useChat.ts`** agora usa `computeAgentProgress` em vez da lógica inline —
  **comportamento idêntico**, mas isolado e coberto por testes.
- **+9 testes** (`circuitBreaker.test.ts`); 359 no total.

## [2.12.44] — 2026-06-06

### Added — Projects ciclo 3: pasta de trabalho por projeto (guiado por dados)

Loop CEO retomado. O digest mostrou uma virada: **`execute_command` virou o tool nº1
(32×)** — código/automação. (Investiguei o tratamento de saída dele: a truncagem
head+tail já existe em `truncateToolOutput`, então nada a fazer ali.) Conectei os
Projects a esse uso real: cada projeto pode ter uma **pasta de trabalho**, e os
comandos/arquivos das conversas daquele projeto rodam a partir dela.

- **Modelo**: `Project.cwd?`.
- **`utils/projects.ts`**: `projectCwdAddition(project)` (puro/testável) injeta a nota
  "rode comandos e arquivos a partir de \<pasta\>" no system prompt.
- **`App.tsx`**: `effectiveSettingsWithProject` agora anexa instruções **+** pasta.
- **`ProjectEditModal`**: campo "Pasta de trabalho" (opcional).
- **+2 testes**; 350 no total. Fecha a fundação do épico Projects (organização +
  instruções + pasta de trabalho).

## [2.12.43] — 2026-06-05

### Added — Projects ciclo 2: instruções por projeto (a "mágica")

Cada projeto agora tem **instruções próprias** (system prompt) injetadas
automaticamente em toda conversa daquele projeto — o coração do Projects do Claude.

- **Modelo**: `Project.instructions?`.
- **`utils/projects.ts`**: `projectInstructionsAddition(project)` (puro/testável) monta
  o bloco `# Projeto: <nome>\n<instruções>` (ou '' quando vazio).
- **`App.tsx`**: nova camada `effectiveSettingsWithProject` anexa as instruções do
  projeto da conversa ativa ao `systemPrompt` — **sem tocar o `useChat`** (ele já lê
  `settings.systemPrompt`). Injeção reativa: editar as instruções reflete na hora.
- **Novo `src/components/ProjectEditModal.tsx`**: editor de nome + instruções (textarea).
- **`ProjectsBar`**: ícone de lápis (hover) abre o editor; `useProjects.updateProject`.
- **+2 testes** (`projectInstructionsAddition`); 348 no total.

## [2.12.42] — 2026-06-05

### Added — Projects (workspaces) — ciclo 1: fundação (organização)

A pedido do usuário (igual ao Claude). Ele tem dezenas de conversas relacionadas
(robôs/estratégias/código/pesquisa) e pediu para agrupá-las. **Épico em ciclos** —
este é o 1º (organização); instruções por projeto e arquivos vêm depois.

- **Modelo**: `Project { id, name, color, createdAt }` + `Conversation.projectId`.
- **Novo `src/utils/projects.ts`** (puro/testável): `validateProjectName`,
  `conversationsInProject` (filtro, "Todas" = sem filtro), `countByProject`,
  `removeProject` (exclui o projeto e **preserva** as conversas, que voltam a "Todas"),
  `colorForIndex`/`PROJECT_COLORS`.
- **Novo `src/hooks/useProjects.ts`**: persistência em localStorage + CRUD + projeto ativo.
- **Novo `src/components/ProjectsBar.tsx`**: chips de projeto na sidebar (criar inline,
  filtrar, excluir com conversas preservadas). Os mesmos chips viram o **seletor de
  projeto** ao mover uma conversa (sem popover separado).
- **`App.tsx`**: barra de projetos na sidebar; "Nova conversa" herda o projeto ativo;
  ícone de pasta em cada conversa para **mover para um projeto**; lista filtrada pelo
  projeto selecionado.
- **+9 testes** (`test/projects.test.ts`); 346 no total.

## [2.12.41] — 2026-06-05

### Changed — Pesquisa web turbinada (web_search é o tool nº1, 19×)

Escolha do usuário, guiada por dados: `web_search` é de longe o tool mais usado.
A engine (scraping do DuckDuckGo) não tinha dedup, nem cache, e o formato não era
bom para citação.

- **Novo `electron/web-search-util.js`** (puro/testável): `normalizeUrl` + `dedupeResults`
  (colapsa URLs que apontam pra mesma página), `formatResults` (markdown numerado
  **com link clicável + domínio**, pronto pra o modelo citar [1],[2]…), `cacheKey`/`isFresh`.
- **`main.js`** — handler `web-search` agora **dedupa** + usa o formato de citação +
  **cache em memória com TTL de 5 min** (um loop agêntico que refina a mesma query
  não re-scrapa; cap de 50 entradas, evicção do mais antigo).
- **`App.tsx` + `index.css`** — o resultado do `web_search` é renderizado como
  **markdown** (fontes **clicáveis**) em vez de texto puro `<pre>`.
- **+12 testes** (`test/webSearchUtil.test.ts`); 337 no total.

## [2.12.40] — 2026-06-05

### Added — Auto-update estilo Claude ("Reiniciar para atualizar")

A pedido do usuário (mostrou o botão do Claude Desktop) e resolvendo uma dor real:
ele **instalava cada build manualmente**. Antes só havia um check manual que abria a
página de release no browser — e o feed de releases do GitHub estava **parado no
v2.8.1**, então nunca avisava.

- **Novo `electron/updater.js`** — integra `electron-updater`: baixa a nova versão
  **em background** e emite `update-status`. Erros são engolidos (um update quebrado
  nunca pode travar o boot); o polling só roda em build empacotado (`app.isPackaged`).
- **`main.js`** — `initAutoUpdater(() => win, app.isPackaged)` no `whenReady` (guardado
  em try/catch) + IPC `quit-and-install`.
- **`preload.js`** — `quitAndInstall()` + `onUpdateStatus(cb)`.
- **`App.tsx` + `index.css`** — botão **"Reiniciar para atualizar"** no rodapé da
  sidebar (estilo Claude: ícone + texto + versão), exibido quando o download termina;
  clique → `quitAndInstall()` → relança na nova versão. O banner manual antigo
  permanece como fallback.
- **`package.json`** — `electron-updater` em dependencies + `build.publish` (github
  `mrtjr/openclaude-desktop`). **As releases voltam a ser publicadas no GitHub** como
  parte do fluxo de ship, então o feed fica vivo (.exe + .blockmap + latest.yml).
- 325 testes (módulo é glue de Electron, sem unit test próprio).

## [2.12.39] — 2026-06-05

### Fixed — Contexto do GLM mal-detectado causava `tool_search` + timeout (bug reportado)

**Causa-raiz de um bug real** (print do usuário: pesquisa de preço no Modal/GLM →
`tool_search` → "O provedor demorou demais para responder"). Rastreado:
`getModelContextLimit('zai-org/GLM-5.1-FP8')` **não tinha entrada GLM** e caía no
default **8192**. Com 8.2k de contexto, a auto-deferral de ferramentas dispara
(24 tools ≈ 2.2k / 8.2k ≈ **27% ≥ 15%**), forçando um **round-trip extra de
`tool_search`** antes de poder usar as ferramentas — e essa segunda chamada no
Modal/GLM (cold-start de GPU) estourava o `timeout` (o único erro do digest). Ou
seja, contexto errado → deferral espúrio → round-trip extra → timeout.

- **`contextEngine.ts`** — adicionadas entradas Z.ai/GLM ao `MODEL_CONTEXT_LIMITS`
  (ordem específico→genérico): `glm-5.1`/`glm-5`/`glm-4.6` = 200k (janela nativa do
  GLM-5.1, MoE 744B, abr/2026), `glm-4.5`/`glm-4`/`glm` = 128k. Cobre tanto o id do
  Modal (`zai-org/GLM-…`) quanto o do OpenRouter (`z-ai/glm-…`).
- Efeito: GLM agora resolve ≥128k → tools ≈ 1,7% do contexto → **deferral NÃO
  dispara** → sem round-trip extra → o `tool_search` some do fluxo normal e a
  pressão de timeout cai. Também corrige o corte agressivo de contexto a 8.2k.
- **+2 testes** (id exato do bug `zai-org/GLM-5.1-FP8` → 200k; invariante de
  deferral < 15%); 325 no total.

## [2.12.38] — 2026-06-05

### Added — Cronômetro de "pensando" (latência percebida em turnos longos)

Fecha o pivô de browser/agente atacando a **latência percebida**. O digest mostra
turnos de ~5–10 min no Modal/GLM (p95 629s) e o cold-start de GPU do Modal pode
levar minutos até o primeiro token. Até agora, durante essa espera o usuário via
**só três pontinhos pulando** — parece travado.

- **Novo `src/components/ThinkingTimer.tsx`** — readout de tempo decorrido ao lado
  dos pontos. O App renderiza o indicador **só na janela de espera** (loading sem
  texto ainda), então o tempo-desde-a-montagem do componente **é** o tempo de
  espera (sem relógio externo). Aparece após 3s (evita flicker em respostas
  rápidas) e, após 20s, mostra a dica "modelos grandes podem levar 1–2 min…".
- **Novo `src/utils/elapsed.ts`** (`formatElapsed`, puro/testável): `"12s"` /
  `"2m 05s"`, com guarda p/ negativo/NaN. **+4 testes**; 323 no total.
- `App.tsx` insere `<ThinkingTimer />` no indicador existente; `index.css` ganha
  estilos sutis (`--text-muted`, `tabular-nums`). Sinal de vida, zero mudança de
  backend.

## [2.12.37] — 2026-06-05

### Fixed — Timeout de provider por fase (mata o `timeout` no cold-start do Modal)

Segue o pivô guiado por dados. O **único erro** do digest é `timeout` (5×, sempre
em `modal`, e **não-retryable** — o usuário perde o turno). Causa: o request usa o
**idle timeout do socket** (`req.setTimeout`, 180s) para cobrir duas esperas muito
diferentes com um número só — (1) o **primeiro byte**, que no cold-start de GPU do
Modal (GLM-5.1-FP8) pode passar de 180s, e (2) os **gaps entre tokens** depois que
o stream começa. Um valor único é um trade-off ruim: alto p/ cold-start = esperar
esse tempão todo num stall no meio do stream.

- **`electron/provider-timeouts.js`** agora é **por fase**: `providerTimeoutMs(provider, phase)`
  - `connect` (primeiro byte / cold-start): **modal 300s**, outros 120s.
  - `stream` (idle entre bytes, já fluindo): modal 150s, outros 90s.
- **`main.js` streaming** começa no orçamento `connect` (cobre o cold-start) e, quando
  os **headers chegam**, aperta o socket para `stream` — pega um stall no meio do
  stream em 2,5 min em vez de esperar os 5 min. O listener de `timeout` original
  permanece anexado; só o valor diminui.
- **`main.js` não-streaming** usa `connect` no request inteiro (resposta vem de uma
  vez; não há cadência intra-corpo confiável para apertar) — já estritamente mais
  seguro que os 180s de antes.
- Cold-start do modal nunca regride (≥180s garantido por teste). **+4 testes
  líquidos** (`test/providerTimeouts.test.ts` reescrito p/ as duas fases); 319 no total.

## [2.12.36] — 2026-06-05

### Changed — `browser_screenshot` otimizado: JPEG comprimido + dimensões + resultado honesto

Segue o pivô guiado por dados (browser automation domina o digest; `browser_screenshot`
é 4× no hot path). O handler capturava um **PNG full-res do viewport 1280×800 (~1–3 MB)**,
serializava o base64 pelo IPC **e o renderer descartava os bytes** (usava só o tamanho),
devolvendo ao modelo um texto **enganoso** ("Base64 available for vision analysis" —
falso) e **sem as dimensões** que o `browser_click_at` precisa. Puro desperdício +
decisão pior do agente.

- **Novo `electron/screenshot-util.js`** (puro/testável): `planScreenshot` reduz a
  largura para ≤1024 preservando o aspect ratio.
- **`browser-screenshot` (main.js)** agora faz downscale + `toJPEG(70)` (≈10× menor
  que o PNG antigo) e retorna `mime`, `width`, `height`, `size`.
- **`useToolExecution.ts`** devolve um resultado **honesto e útil**: dimensões do
  viewport + orientação para usar `browser_get_text`/`browser_get_forms` (o que o
  modelo de chat realmente consegue ler) e `browser_click_at (x,y)` dentro do viewport.
- **Descrição do tool** (`tools.ts`) corrigida: deixa claro que os pixels NÃO voltam
  para o modelo no loop de chat. Caminho Vision (ORION/`vision-chat`) intocado.
- **+7 testes** (`test/screenshotUtil.test.ts`); 315 no total.

## [2.12.35] — 2026-06-05

### Fixed — Navegação de browser resiliente (timeout/redirect não descartam a página)

Pivô **guiado por dados** (Dev Insights): automação de browser é o uso real
dominante (navigate 7×, screenshot 4×…), o **único erro** é `timeout` (4×) e a
latência é altíssima (média ~6,5 min, p95 ~10,5 min/turno). Causa-raiz no handler
`browser-navigate`: ele corria `loadURL` contra um `NAV_TIMEOUT` de 30s e, em
**qualquer** timeout ou rejeição (inclusive `ERR_ABORTED` de redirect), **descartava
a página inteira e retornava `{ error }`** — mesmo com conteúdo já renderizado. O
renderer então tratava isso como "browser não lançado", **relançava e re-navegava
do zero** (outro ciclo de 30s + round-trip do LLM = a latência desperdiçada do digest).

- **Novo `electron/browser-nav.js`** (puro, testável): `isBenignNavError` detecta
  cargas interrompidas benignas (`ERR_ABORTED`/`-3`, `ERR_BLOCKED_BY_CLIENT`);
  `resolveNavOutcome` decide **ok / parcial / falha real** a partir de
  erro+timeout+URL final+texto capturado.
- **`browser-navigate` (main.js)** agora, em timeout, dá `webContents.stop()` e
  **extrai o que já renderizou** (sucesso **parcial**) em vez de erro; redirect
  benigno com página presente vira sucesso; só falha de verdade quando nada útil
  carregou. Mata o único erro observado e elimina a rodada de retry.
- **`useToolExecution.ts`** surfacia `⚠️ Partial load` ao modelo, para ele saber
  que a página pode estar incompleta. Retry de relançamento fica só p/ erro real.
- **+14 testes** (`test/browserNav.test.ts`) cobrindo benigno/timeout-parcial/falha.

## [2.12.34] — 2026-06-05

### Changed — Extended Thinking v2: caminho não-streaming + toggle de controle

Completa o Extended Thinking (v2.12.32, que cobria só streaming).

- **`useChat.ts`** — o caminho **não-streaming** (Gemini, etc.) agora também captura
  o raciocínio (antes de sanitizar) e o anexa à mensagem final.
- **Setting `showThinking` (default on)** em `settingsConfig.ts` + **toggle
  "Mostrar raciocínio (Extended Thinking)"** nas Configurações. O bloco 💭 só
  aparece se ligado — controle do usuário sobre uma feature que era sempre-ligada.

### Notas

- 294 testes (eram 293). +1: default `showThinking` ligado. Typecheck limpo.
- **Estado do backlog "portar Anthropic":** os itens de maior valor estão
  entregues (modelos 2026, prompt caching, Extended Thinking, Artifacts). Os
  demais já existiam no projeto — **editor de memória** (o `AgentMemoryPanel` já
  é um editor completo) e **web search com fontes** (o `web_search` já retorna
  title+url+snippet, então o modelo já cita). Próximos ciclos: polish desses, ou
  pivô guiado pelos dados de uso (browser automation é o hotspot real).

## [2.12.33] — 2026-06-05

### Added — Artifacts: preview ao vivo de HTML/SVG (porta os Artifacts da Claude)

Item #4 do backlog. Inspirado nos **Artifacts** da Claude.ai: quando a resposta
contém um bloco `html` ou `svg` autocontido, aparece um botão **🎨 Visualizar
artefato** que renderiza o conteúdo **ao vivo** num iframe isolado.

- **`utils/artifacts.ts` (novo)** — `extractArtifacts(content)` detecta fences
  ```` ```html ```` / ```` ```svg ```` (pura); `artifactSrcDoc(a)` monta o
  documento (SVG centralizado, HTML direto).
- **`ArtifactPanel.tsx` (novo, lazy)** — modal com `<iframe sandbox="allow-scripts
  allow-modals allow-popups">` (sem same-origin → o script roda mas não acessa o
  app, cookies ou storage). Fecha no Esc/clique fora.
- **`App.tsx`** — botão por mensagem do assistente quando há artefato; abre o
  painel com o primeiro.

### Notas

- 293 testes (eram 289). +4 (`extractArtifacts`/`artifactSrcDoc`): detecção
  html/svg, ignora js/vazios, e o wrapping do srcDoc. Typecheck limpo. Painel
  lazy (fora do boot).
- Segurança: sandbox sem `allow-same-origin` por design. Follow-up: react/charts,
  edição inline, persistência.

## [2.12.32] — 2026-06-05

### Added — Extended Thinking: exibe o raciocínio do modelo (porta a feature da Anthropic)

Item #3 do backlog. Modelos de raciocínio (GLM, DeepSeek, Qwen…) emitem
"pensamento" que o app **descartava**. Agora ele é **capturado e exibido** num
bloco recolhível "💭 Raciocínio" acima da resposta — espelhando o Extended
Thinking da Claude, e útil para entender os passos do agente.

- **`sanitizers.ts`** — `extractThinking(raw)` (novo): contraparte *capturante*
  do sanitizer. Usa o mesmo registro `REASONING_TAGS`, então separa exatamente o
  que o sanitizer removeria — só que **mantém** o reasoning em vez de jogá-lo
  fora. Só blocos completos; vazamentos parciais seguem sendo limpos.
- **`useChat.ts`** — no streaming, captura o reasoning de `accumulated` **antes**
  da sanitização e o anexa à mensagem final (`Message.thinking`, novo campo —
  nunca reenviado ao provedor).
- **`App.tsx`** — render `<details>` recolhível (colapsado por padrão) com o
  raciocínio em markdown, acima da resposta.

### Notas

- 289 testes (eram 285). +4 (`extractThinking`): separa `<think>`, múltiplos
  blocos/estilos, ausência de reasoning, e o answer limpo bate com
  `sanitizeReasoningLeaks`. Typecheck limpo.
- v1 cobre o caminho streaming (o usado por cloud/modal). Caminho não-streaming +
  toggle nas Configurações ficam para follow-up.

## [2.12.31] — 2026-06-05

### Added — Prompt caching da Anthropic (porta a feature de cache da Anthropic)

Item #2 do backlog "portar Anthropic". As requisições nativas à Anthropic
(`/v1/messages`) agora marcam o **prefixo grande e estável** (schemas de tools +
system prompt) com `cache_control: {type:'ephemeral'}`. Em turnos repetidos /
loops de agente, os tokens em cache custam **~10%** e pulam o reprocessamento —
corta custo e latência para quem usa Claude.

- **`electron/anthropic-cache.js` (novo)** — `cachedSystem(text)` (system como
  bloco de texto cacheado) e `withCachedTools(tools)` (cache_control na última
  tool → cacheia todo o prefixo de schemas; não muta a entrada).
- **`electron/main.js`** — aplicado nos dois builders Anthropic (stream +
  non-stream). Aditivo e seguro: abaixo do mínimo (~1024 tokens) a Anthropic
  ignora o breakpoint; nenhum outro provedor é afetado.

### Notas

- 285 testes (eram 280). +5 (`anthropicCache.test.ts`): wrap do system, last-tool
  cache_control, imutabilidade da entrada, vazios. `node --check` no main;
  typecheck limpo.
- Próximos do backlog: Extended Thinking (exibir raciocínio), Artifacts (preview
  ao vivo), editor de memória, web search + citações.

## [2.12.30] — 2026-06-05

### Changed — Modelos Claude 2026 (paridade com o catálogo da Anthropic)

Primeiro ciclo do foco "comparar com a Anthropic e portar melhorias": o catálogo
de modelos Claude estava preso em meados de 2025. Atualizado para a linha **2026**
(fonte: docs oficiais da Anthropic).

- **`pricing.ts`** — adicionados `claude-opus-4-8/4-7/4-6/4-5` (**$5/$25**, não os
  antigos $15/$75!), `claude-sonnet-4-6/4-5` ($3/$15), `claude-haiku-4-5` ($1/$5),
  `claude-opus-4-1` ($15/$75). Corrige superestimativa de ~3× no custo do Opus
  moderno.
- **`contextEngine.ts`** — **Opus 4.6–4.8 e Sonnet 4.6 = janela de 1M tokens**
  (eram tratados como 200k pelo partial-match); 4.5 e Haiku 4.5 = 200k.
- **`settingsConfig.ts`** — default Anthropic deixa de ser
  `claude-sonnet-4-20250514` (**DEPRECATED**, aposenta 15/06/2026) e passa a
  `claude-sonnet-4-6`.
- **`modelSuggestions.ts`** — atalhos Anthropic agora `opus-4-8`/`sonnet-4-6`/
  `haiku-4-5` (e OpenRouter `anthropic/claude-sonnet-4-6`).

### Notas

- 280 testes (eram 278). +2: preços 2026 (Opus 4.8 $5/$25, com variante datada
  via longest-match) e janela de 1M dos modelos 2026. Typecheck limpo.
- Candidatos a próximos ciclos (deste foco): prompt caching (Anthropic
  `cache_control`), exibição de Extended Thinking, Artifacts (preview ao vivo),
  visualizador/editor de memória, web-search tool com citações.

## [2.12.29] — 2026-06-05

### Changed — Dev Insights: latência por-passo (confiável) + nota da tool mais usada

**Guiado pelos dados reais:** o digest mostrou `latency.avg = 385s` — porque a
métrica media a **sessão de agente inteira** (browsing multi-step de minutos),
não a latência de resposta. Conflava duração-da-tarefa com velocidade-de-resposta.

- **`useChat.ts`** — o evento `chat/complete` agora reporta `ms` = **tempo médio
  de resposta por passo** (`avgRT`, reusado do registro de analytics), com
  `totalMs` (duração total) e `steps` à parte. A métrica de latência do digest
  passa a refletir **velocidade de resposta de verdade**, decoplada do nº de
  passos do agente.
- **`devInsights.ts`** — `buildNotes` ganha "Tool mais usada" (≥3×), destacando o
  hotspot de uso real. (Os dados atuais apontam **browser automation** —
  navigate/screenshot/get_text/scroll/links/forms — como a área mais usada.)

### Notas

- 278 testes (eram 277). +1 caso: nota da tool mais usada. Typecheck limpo.
- **Direção de dados:** com 24 eventos reais, o uso se concentra em **automação
  de browser** via agente no provider `modal`. Próximos ciclos guiados por dados
  devem priorizar essa área.

## [2.12.28] — 2026-06-05

### Added — Painel "Dev Insights" in-app + export `.md` (visibilidade ao usuário)

Conclui a feature Dev Insights: agora **você** também vê os próprios dados de
uso (não só eu lendo o digest). Botão **Activity** na barra de título abre um
painel com: erros por categoria, uso de features, tools, provedores/modelos,
atrito (breaks/retries/denials/empty/compactações), latência (avg/p95) e as
notas de priorização — tudo agregado por `summarizeInsights`.

- **`DevInsightsPanel.tsx` (novo)** — carrega os eventos (`devInsightsLoad`),
  agrega e renderiza; reusa o frame dos painéis (`settings-overlay`/
  `analytics-modal`). Lazy-loaded (fora do boot). Botões **Exportar .md**
  (via `formatInsightsReport` + `saveDialog`/`writeFile`) e **Limpar**
  (`devInsightsClear`).
- **`devInsights.ts`** — `formatInsightsReport(digest)` (puro): relatório
  Markdown legível, usado no export e compartilhável.
- **`App.tsx`** — lazy import, botão na title bar, render, fechar-no-Esc e a
  abertura entra na própria telemetria de features.

### Notas

- 277 testes (eram 276). +1 caso: `formatInsightsReport` gera o markdown
  esperado. Typecheck limpo. Painel é UI (coberto pelos testes puros de
  `summarizeInsights`/`formatInsightsReport`). Só eventos+metadados.
- Fecha o plano "Dev Insights" (Ciclo A telemetria + Ciclo B visibilidade).

## [2.12.27] — 2026-06-05

### Added — Dev Insights: sinal `empty_reply` (telemetria completa)

Último sinal de atrito que faltava: `useChat` agora emite `chat/empty_reply`
(com provider/model) quando o modelo retorna uma resposta vazia — nos dois
caminhos (streaming e não-streaming), exatamente onde a `emptyReplyNotice` é
usada. Alimenta `friction.emptyReplies` no digest, fechando a cobertura de
telemetria (erros, atrito, features, latência, mix).

### Notas

- 276 testes (a agregação de `empty_reply` já era coberta em `devInsights.test.ts`).
  Typecheck limpo. Só eventos+metadados.
- **Estado do backlog:** com a telemetria completa, as melhorias de alto/médio
  impacto identificáveis por leitura de código estão esgotadas (18 ciclos + 2
  features). Daqui pra frente, o maior valor vem de **dados reais de uso** — use
  a build e o digest guiará os próximos ciclos.

## [2.12.26] — 2026-06-05

### Fixed — Timeout de provider por categoria (1º ciclo guiado por dados do Dev Insights)

**Motivado pela telemetria:** o digest do Dev Insights registrou um erro
`timeout` real no provider **`modal`** (modelo GLM-5.1-FP8). O Modal Research
faz cold-start de um modelo grande num container de GPU, que pode levar bem mais
de 60s até o primeiro byte — e o timeout **fixo de 60s** do processo main
abortava a requisição espuriamente.

- **`electron/provider-timeouts.js` (novo)** — `providerTimeoutMs(provider)`:
  **Modal → 180s** (cold start + inferência de modelo grande); **demais → 90s**
  (folga para primeiro-token lento / modelos de raciocínio). Sempre acima dos
  60s antigos.
- **`electron/main.js`** — os dois sites de timeout (provider-chat e
  provider-chat-stream) usam o helper; a mensagem de erro reflete o valor real.

### Notas

- 276 testes (eram 273). +3 casos (`providerTimeouts.test.ts`): Modal mais
  longo, default generoso para os demais, e sempre > 60s. `node --check` no
  main; typecheck limpo.
- **Marco:** primeira melhoria escolhida a partir de dados reais de uso (o loop
  de evolução guiada por dados está funcionando — o app reporta, eu priorizo).

## [2.12.25] — 2026-06-05

### Added — Dev Insights: sinais de latência e retry (telemetria mais completa)

Validado que a telemetria do v2.12.24 funciona ponta a ponta (o digest já
capturou turnos reais). Este ciclo completa os sinais de maior valor que
faltavam para priorização guiada por dados:

- **Latência por turno** — `useChat` emite `chat/complete` com a duração total
  (`ms`) e nº de passos no `finally`; `summarizeInsights` agrega
  `latency: { count, avgMs, p95Ms }` e gera nota quando p95 ≥ 30 s (perf é
  atrito real, ainda mais em provedores cloud lentos).
- **Retries transitórios** — os dois auto-retries (rate-limit/overload/rede,
  Ciclo 10) agora emitem `chat/retry` com a categoria, alimentando
  `friction.retries` — mede quão frequentes são as falhas transitórias.

### Notas

- 273 testes (eram 272). +1 caso de agregação de latência (avg/p95) e asserção
  de latência zerada no digest vazio. Typecheck limpo. Só eventos+metadados,
  sem conteúdo (inalterado). Follow-up restante: `empty_reply` + painel in-app.

## [2.12.24] — 2026-06-05

### Added — Dev Insights: telemetria de uso (privada, local) para evolução guiada por dados

Novo: o app agora **gera um log de uso** (chat + features) que o mantenedor lê a
cada ciclo para priorizar melhorias com **dados reais**, em vez de palpite
("você usa → eu evoluo"). **Só eventos + metadados — nunca conteúdo de mensagem.**

- **`devInsights.ts` (novo)** — `logInsight(category, action, meta)` com buffer em
  memória; `meta` aceita **só primitivos** (objetos/arrays são descartados — guarda
  de privacidade por construção). `summarizeInsights(events)` (pura) agrega num
  **digest**: erros por categoria, ranking de uso de features, atrito
  (circuit-breaks, denials, respostas vazias, compactações), mix provedor/modelo,
  uso de tools, e **notas de priorização** auto-geradas.
- **`useDevInsights.ts` (novo)** — flush em lote (intervalo + `beforeunload`, padrão
  do Ciclo 11), gated pelo setting existente `analyticsEnabled`.
- **`electron/main.js` + `preload.js`** — IPC `dev-insights-flush/load/clear`. Grava
  `dev-insights.json` (cru, cap 5000, auto-purge 30 dias) e
  `dev-insights-digest.json` (resumo) em `userData`, via `atomicWriteJSON` (Ciclo 8).
- **Instrumentação** — `useChat`: turno (provider/model), **erro por categoria**
  (via `classifyProviderError`, Ciclo 10 — categoria, não o texto), compactação de
  contexto, circuit-break. `useToolExecution`: tool usada / **negada**. `App`: abertura
  dos 14 painéis de feature (ORION, Parliament, RAG, Arena, …). Tudo evento+nome,
  sem conteúdo.

### Notas

- **Coleta:** o digest mora em `userData\openclaude-desktop\dev-insights-digest.json`
  — pré-agregado e pequeno; é o que eu leio no início de cada ciclo. Respeita o
  opt-out de analytics; `dev-insights-clear` apaga tudo.
- 272 testes passando (eram 265). +7 casos (`devInsights.test.ts`): buffer/drain,
  desabilitado não grava, **guarda de privacidade** (descarta não-primitivos),
  agregação (erros/features/mix/atrito), janela de dias, notas, e vazio→zerado.
  `node --check` nos arquivos do main; typecheck limpo.
- Próximo (follow-up): painel "Dev Insights" in-app + export `.md` + instrumentação
  adicional (retry/empty-reply/latência).

## [2.12.23] — 2026-06-04

### Changed — Streaming mais fluido: `formatMarkdown` com cache por conteúdo

As mensagens são renderizadas inline em `App` chamando `formatMarkdown(msg.content)`
direto no `.map`. Como o `App` re-renderiza **a cada token** do streaming
(`setStreamingText`), uma conversa de N mensagens re-parseava **todo** o
markdown (marked + DOMPurify + highlight) a cada token — `O(N)` por token,
travando visivelmente em conversas longas.

- **`formatting.ts`** — `formatMarkdown` ganha um **cache por texto-fonte**
  (`Map`, cap 600). Mensagens estáveis viram **`O(1)`** (formatam uma vez); só o
  texto em streaming, que muda a cada token, re-renderiza. O cache é **limpo
  quando o KaTeX termina de carregar** (a saída de matemática muda de cru para
  tipografado). A chamada do streaming passa `cache=false` para não poluir/
  despejar as entradas estáveis com strings transitórias.

### Notas

- 265 testes passando (eram 260). +5 casos: render correto, consistência em
  chamadas repetidas (cache hit), concordância caminho cacheado vs não, ausência
  de contaminação entre entradas distintas, e input vazio. O teste de KaTeX
  lazy segue verde (o clear-on-ready garante que a matemática "sobe" para
  tipografada). Typecheck limpo.
- Sem mudança visual — só elimina o trabalho redundante de render durante o
  streaming. Determinístico: a única transição de saída (KaTeX) invalida o cache.

## [2.12.22] — 2026-06-04

### Changed — Política de tools (gate de aprovação + truncamento) testada e isolada

A decisão de **pedir aprovação do usuário** antes de rodar uma tool perigosa
(`execute_command`, `write_file`, `git_command`, `browser_*`…) e o **clamp de
saída** moravam inline em `useToolExecution` — o hook mais sensível depois do
chat, e **sem nenhum teste**. Uma regressão ali poderia rodar uma tool
destrutiva sem perguntar.

- **`toolPolicy.ts` (novo)** — `toolNeedsApproval(level, name)` (pura) encapsula
  a regra: `ask`/`planning` pedem aprovação de toda tool perigosa; `auto_edits`
  libera os edit tools (`write_file`/`git_command`/`undo_last_write`) mas ainda
  pede o resto (ex.: `execute_command`); `ignore` não pede nada.
  `truncateToolOutput(out)` clampa saídas > 4000 chars (cabeça+cauda+marcador).
- **`useToolExecution.ts`** — usa os dois helpers; some o bloco inline e os
  imports de `SAFE_TOOLS`/`DANGEROUS_TOOLS` que ficaram sem uso. Comportamento
  idêntico — só extraído e agora coberto.

### Notas

- 260 testes passando (eram 253). +7 casos (`toolPolicy.test.ts`): tools
  perigosas barradas em ask/planning, edit tools liberados só em auto_edits
  (mas execute_command ainda barrado), `ignore` libera tudo, tools seguras nunca
  pedem, e o truncamento (curto/limite/acima com cabeça+cauda+marcador).
  Typecheck limpo.

## [2.12.21] — 2026-06-04

### Fixed — Circuit breaker do agente: janela deslizante (sem falso-positivo em reuso)

O circuit breaker do loop do agente contava chamadas idênticas (nome + args)
em **toda a sessão**: `recentToolCalls.filter(c => c === sig).length >= 2`.
Numa sessão longa, uma tool legitimamente reusada bem depois (o mesmo
`list_directory` no mesmo path no passo 3 e no 40) **disparava um break falso**
— "você já chamou isso, mude de estratégia" — mesmo sem loop nenhum. E o array
de assinaturas crescia **sem limite**.

- **`circuitBreaker.ts` (novo)** — `countRecentRepeats(recent, sig, window)`
  conta repetições só nas **últimas `CIRCUIT_WINDOW` (8) chamadas**. Um loop
  travado é repetição rápida (cai na janela e dispara no 3º idêntico, como
  antes); reuso distante sai da janela e não dispara.
- **`useChat.ts`** — o breaker usa o helper, e `recentToolCalls` é **limitado**
  à janela após cada push (não cresce mais indefinidamente em sessões longas de
  agente).

### Notas

- 253 testes passando (eram 249). +4 casos (`circuitBreaker.test.ts`): contagem
  na janela, disparo no 3º consecutivo, repetição antiga fora da janela
  ignorada, e janela customizada. Typecheck limpo.
- Comportamento para loops reais é idêntico (3 chamadas idênticas seguidas ainda
  disparam); só elimina o falso-positivo em reuso espaçado.

## [2.12.20] — 2026-06-04

### Changed — Boot mais leve: modal de Settings agora é lazy + carga de settings testada

`App` importava `SettingsModal` de forma **estática** (só para pegar
`loadSettings` no boot), arrastando o modal pesado — ícones lucide + painéis de
provider (`ProviderList`/`ProviderDetail`) — para o bundle inicial, mesmo o
modal só aparecendo quando o usuário abre Configurações.

- **`settingsConfig.ts` (novo)** — extrai a parte *leve* de boot: tipos
  (`AppSettings`, `Provider`, …), `DEFAULT_SETTINGS`, `loadSettings` e
  `saveSettings`. Sem React/lucide. `Settings.tsx` importa daqui e
  **re-exporta tudo**, então os ~6 arquivos que faziam `… from './Settings'`
  seguem funcionando sem mudança.
- **`App.tsx`** — `loadSettings` vem do módulo leve (eager); o `SettingsModal`
  virou `lazy(() => import('./Settings'))` e só é **montado quando aberto**
  (`{showSettings && <Suspense>…}`) — então o chunk carrega sob demanda, não no
  boot. Mesmo padrão dos 14 painéis já lazy.

### Notas

- **Boot:** chunk de entrada **382 → 362 KB (−20 KB)**; o modal foi para um
  chunk próprio (`Settings-*.js`, ~23 KB) carregado no primeiro clique em
  Configurações.
- 249 testes passando (eram 242). +7 casos (`settingsConfig.test.ts`) cobrindo a
  **carga de settings, que não tinha teste algum**: defaults, merge, migração do
  `modalApiKey` legado, upgrade de `modalModel` 404, modo de deferral explícito
  vs default, JSON corrompido → defaults, e round-trip do `saveSettings`.
  Typecheck limpo.

## [2.12.19] — 2026-06-04

### Fixed — Usage/custo: provedores não-streaming deixavam de ser contabilizados

O reporte de uso de tokens só existia no caminho **streaming** — o
**não-streaming não reportava nada**, então provedores que rodam por ali
(Gemini, Ollama não-stream, custom OpenAI-compat sem streaming) apareciam com
**$0 no dashboard de custo/uso**. E o fallback do streaming ainda estimava por
`char/4`, agora que há tokenizer real (Ciclo 5).

- **`usage.ts` (novo)** — `resolveTurnUsage(providerUsage, requestMessages,
  outputText)`: usa os números reais do provedor quando ambos input e output
  vêm (`prompt_tokens/completion_tokens` ou `input_tokens/output_tokens`);
  senão estima com o **tokenizer real** (que cai em char/4 só enquanto carrega).
  Usage parcial (um campo faltando) é descartado e estimado — sem misturar.
- **`useChat.ts`** — o caminho streaming passou a usar o helper (some o cálculo
  `char/4` inline e o dança de narrowing do TS). O caminho **não-streaming ganhou
  reporte de usage** (não tinha): após a resposta, reporta uso real do provedor
  ou estimado. Junto com o fix de pricing (Ciclo 9), o custo fica correto para
  **todos** os provedores.

### Notas

- 242 testes passando (eram 236). +6 casos (`usage.test.ts`): preferência pelo
  usage do provedor (com aliases Anthropic), estimativa quando ausente, conteúdo
  não-string via JSON, descarte de usage parcial, e output vazio. Typecheck limpo.
- Modelos locais (Ollama) seguem custo $0 via `pricing.ts`; isto só corrige a
  **contagem** que alimenta o dashboard.

## [2.12.18] — 2026-06-04

### Fixed — Flush no fechamento: a última mensagem não se perde mais ao sair

O save de conversas é *debounced* em 1 s. Se o app fechasse dentro dessa
janela (mandar a mensagem e fechar logo em seguida), o `setTimeout` pendente
nunca disparava e **a última mensagem era perdida**. Complementa o Ciclo 8
(escrita atômica evita corrupção; isto evita perder o que é recente). O
`saveNow` exposto pelo hook existia mas **não era chamado em lugar nenhum** —
o flush no fechamento estava de fato ausente.

- **`useConversations.ts`** — novo efeito que escuta `beforeunload`: limpa o
  timer pendente e grava **imediatamente**, lendo de `conversationsRef.current`
  (sempre atual, sem closure obsoleto). É fire-and-forget — `beforeunload` não
  pode `await` —, mas o handler do main escreve de forma síncrona
  (`atomicWriteJSON`, v2.12.15), então o save chega antes do renderer encerrar.

### Notas

- 236 testes passando (eram 234). +2 casos (`useConversations.test.ts`, via
  `renderHook` + `dispatchEvent('beforeunload')`): o flush grava a conversa
  carregada ao sair, e grava a versão **mais recente** (conversa adicionada
  após o mount aparece no save — prova o uso do ref). Typecheck limpo.
- Sem mudança no caminho feliz — só fecha a janela de perda no encerramento.

## [2.12.17] — 2026-06-04

### Added — Resiliência do chat: erros humanizados + auto-retry de falhas transitórias

Quando um provider falhava, o chat despejava `Erro: <mensagem crua>` (um
`API error 429: {…}`, `HTTP 401`, um `ECONNRESET`) e a rodada simplesmente
morria — sem recuperação para blips transitórios.

- **`providerErrors.ts` (novo)** — `classifyProviderError(raw)` mapeia a
  mensagem (códigos HTTP + palavras-chave que o `main.js` já embute) em 8 tipos
  (`auth`, `rate_limit`, `overloaded`, `network`, `timeout`, `context`,
  `not_found`, `unknown`) e marca como **retryable** só os genuinamente
  transitórios (rate-limit / overload / blip de rede).
  `humanizeProviderError(raw, lang)` devolve uma mensagem **acionável** (chave
  inválida → "verifique em Configurações"; 429 → "aguarde alguns segundos";
  contexto → "compacte ou inicie nova conversa"). Erros desconhecidos preservam
  o detalhe cru, rotulado — nada fica escondido.
- **`useChat.ts`** — em ambos os caminhos (streaming e não-streaming), uma falha
  transitória dispara **um** auto-retry com backoff de 1,5 s, espelhando a
  recuperação de "tools não suportadas" já existente. No streaming, o retry é
  guardado por `!accumulated` — nunca refaz a chamada se já houve saída parcial
  (sem dupla cobrança / texto duplicado). A bolha de erro final agora usa a
  versão humanizada.

### Notas

- 234 testes passando (eram 216). +18 casos: classificação de cada tipo
  (401/429/503/ECONNRESET/timeout/contexto/404/desconhecido), o flag retryable
  (só transitórios), entradas vazias, e a humanização pt/en com preservação do
  detalhe cru. Typecheck limpo.
- O classificador é puro e testado; a fiação do retry segue o padrão de retry já
  existente no loop (cap de 1, `steps--`, backoff). Sem mudança no caminho feliz.

## [2.12.16] — 2026-06-04

### Fixed — Custo: variantes mini/nano não são mais cobradas como o irmão maior

`getModelPricing` resolvia modelos não-exatos pegando a **primeira** chave de
`PRICING` que fosse substring do id. Como `gpt-4o` vem antes de `gpt-4o-mini`,
`o1` antes de `o1-mini` e `o3` antes de `o3-mini`, qualquer id datado caía no
irmão **maior e mais caro**:

| Modelo (id datado) | Resolvia para | Erro de custo |
|--------------------|---------------|:---:|
| `gpt-4o-mini-2024-07-18` | `gpt-4o` | **16×** |
| `o3-mini-2025-01-31` | `o3` | **9×** |
| `o1-mini-2024-09-12` | `o1` | **5×** |

- **Match mais longo/específico** — o passo de substring agora escolhe a
  **chave mais longa** que casa (`gpt-4o-mini` vence `gpt-4o`), em vez da
  primeira na ordem de inserção. Determinístico e imune à ordem do objeto.
- **Família `gpt-4.1` adicionada** (`gpt-4.1` $2/$8, `-mini` $0.40/$1.60,
  `-nano` $0.10/$0.40). Antes não estava na tabela e caía no fallback
  `/^gpt-4/` → tier do **gpt-4 legado ($10/$30)**, ~5× caro demais.
- Header atualizado (estava "April 2025").

### Notas

- 216 testes passando (eram 214). +2 casos: variantes datadas mini/nano
  resolvem ao próprio tier (não ao irmão maior), e a família `gpt-4.1` é mais
  barata que o `gpt-4` legado. O `FAMILY_FALLBACK` (já ordenado específico-
  primeiro) e a detecção de modelos locais seguem inalterados. Typecheck limpo.
- Só afeta o dashboard de custo/uso (estimativa); modelos locais continuam $0.

## [2.12.15] — 2026-06-04

### Fixed — Persistência atômica: fim do risco de perder TODAS as conversas

Todo store do processo main gravava com `fs.writeFileSync(PATH, JSON.stringify(...))`,
que **trunca o arquivo antes de escrever**. Um crash, disco cheio ou queda de
energia **no meio da escrita** deixava o arquivo pela metade → o `JSON.parse` do
próximo boot estourava e **o store inteiro se perdia** (conversas, vault,
personas, memória do agente, workflows, RAG…). Para um app cujo valor primário é
o histórico do usuário, essa era a falha de maior severidade — e silenciosa.

- **`electron/atomic-write.js` (novo)** — `atomicWriteJSON(path, data, pretty?)`
  escreve num `.tmp` irmão, faz `fsync`, **rotaciona** o arquivo atual para
  `.bak` (rename barato, sem cópia) e então faz `rename` do `.tmp` sobre o alvo.
  `rename` é **atômico** no mesmo filesystem: um leitor sempre vê o arquivo
  antigo completo ou o novo completo — nunca um truncado.
  `readJSONWithFallback(path, fallback)` lê o alvo e, se faltar ou estiver
  corrompido, cai para o `.bak` e depois para o `fallback`. Nunca lança.
- **`electron/main.js`** — as 10 escritas de stores passaram a usar
  `atomicWriteJSON` (conversas, analytics, audit-log, memória, vault, personas,
  arena, workflows, índice RAG e o clear do RAG). `loadConversations` agora usa
  `readJSONWithFallback`, então um desligamento ruim não zera o histórico —
  recupera a versão anterior do `.bak`. (As escritas de `write_file` do usuário e
  do script temporário do ORION seguem diretas de propósito: path arbitrário /
  efêmero, onde o rename de irmão não se aplica.)
- **`electron/ipc-agent-memory.js`** — mesma blindagem no store de memória do
  agente (save atômico + load com fallback).

### Notas

- 214 testes passando (eram 208). +6 casos (`atomicWrite.test.ts`, contra o
  filesystem real num dir temporário): round-trip, fallback sem arquivo, sem
  `.tmp` residual, rotação para `.bak`, **recuperação do `.bak` quando o primário
  é corrompido**, e saída compacta vs pretty. `node --check` confirma a sintaxe
  dos arquivos do main process (que o vitest não executa). Typecheck limpo.
- Sem mudança de comportamento visível — só durabilidade. Os arquivos `.bak`
  aparecem ao lado dos stores em `userData` (uma versão anterior de cada).

## [2.12.14] — 2026-06-04

### Changed — Boot −196 KB: SDK do Supabase agora é lazy (local-first não paga mais)

`services/supabase.ts` importava `@supabase/supabase-js` **estaticamente**, então
o SDK inteiro (~198 KB / GoTrue + PostgREST + Realtime + Storage) entrava no
**chunk de boot de todo mundo** — apesar de cloud sync/contas serem **opt-in** e
o app ser local-first por padrão. A maioria que nunca loga pagava o custo.

- **`getSupabase()` agora é `async`** e faz `await import('@supabase/supabase-js')`
  por baixo — o SDK vira um **chunk dinâmico próprio**, carregado só quando um
  usuário *configurado* realmente loga ou sincroniza. O import de tipo virou
  `import type` (apagado no build, custo zero). O cliente continua cacheado e
  reusado pelo resto da sessão.
- **`isSupabaseConfigured()` segue síncrono e barato** (só lê `localStorage`) —
  é o gate que decide *sem* tocar no SDK, então o caminho local-first nunca
  dispara o load.
- **`auth.ts` / `sync.ts`** — os 10 sites `getSupabase()` viraram
  `await getSupabase()` (já estavam em funções async). `onAuthStateChange`
  mantém a assinatura síncrona: faz o load lazy e fia a subscription quando o
  cliente resolve; o cleanup retornado cancela o load pendente ou a subscription
  viva.

### Notas

- **Boot:** o chunk de entrada caiu de **578 KB → 382 KB (−196 KB, −34 %)**; o
  SDK (198 KB) foi para um chunk lazy separado — confirmado no build:
  `GoTrueClient` aparece **só** no chunk dinâmico, não no entry. Zero custo no
  boot para quem não usa contas; quem usa paga um load único no primeiro login.
- 208 testes passando (eram 205). +3 casos (`supabase.test.ts`): gate falso sem
  credenciais, `getSupabase()` rejeita quando não configurado (decidido antes de
  carregar o SDK), e construção lazy do cliente real quando há credenciais.
  Typecheck limpo.

## [2.12.13] — 2026-06-04

### Changed — Orçamento de contexto preciso: `limite − overhead real` no lugar do `0.60` cego

O truncamento de histórico em `useChat` usava `tokenBudget = limite × 0,60` —
um fator fixo que **ignorava o overhead real** da requisição. Errado nos dois
sentidos, e o Ciclo 5 (contagem real) deixou o conserto à mão:

- **Modelos pequenos (8k):** o system prompt (agente!) + schemas de tools +
  memória **não eram subtraídos**, então prompt+resposta podiam ultrapassar a
  janela real → erro "context length exceeded". O `0.60` deixava ~40 % de folga
  que, somada ao overhead não-contado, não bastava.
- **Modelos grandes (200k/1M):** reservava 40 % fixos **independente do uso** —
  80k+ no Claude ficavam ociosos e o loop **compactava cedo demais** (chamada de
  API extra de sumarização + perda de contexto) muito antes do necessário.

- **`computeMessageBudget(limit, {systemTokens, toolTokens, memoryTokens, responseReserve})`
  (novo, `contextEngine.ts`)** — orçamento = `limite − systemPrompt − schemas
  eager − memória − reserva-de-resposta − BUDGET_SAFETY_SLACK (256)`, com clamp
  em `[0, limite]`. As contagens vêm do **tokenizer real (v2.12.12)**, então o
  orçamento é exato. O `slack` cobre o que não é modelado explicitamente
  (priming de idioma, lembretes por turno, cauda da memória persistente).
- **`useChat.ts`** passa o overhead concreto do turno: tokens reais do
  `systemPrompt` (que já inclui o manifesto de tools diferidas), os
  `eagerTokens` da partição (ou o set completo quando o deferral está off), o
  resumo de contexto conhecido, e `settings.maxTokens` (piso 2k) como reserva
  da resposta. `assemble()` segue garantindo a mensagem mais recente mesmo se o
  overhead deixar o orçamento perto de zero — degradação correta num modelo
  minúsculo com prompt gigante.

### Notas

- Efeito prático: **−estouros** em janelas pequenas e **−compactações
  prematuras** em janelas grandes (ex.: num modelo de 128k, mensagens podem usar
  ~122k em vez dos antigos ~77k). A decisão real de truncamento agora bate com a
  contabilidade do painel `/context`.
- 205 testes passando (eram 200). +5 casos: subtração exata, modelo grande
  sobrando >190k, clamp em 0 quando o overhead estoura, campos ausentes, e a
  conservadoria em 8k vs o `0.60`. Typecheck limpo.

## [2.12.12] — 2026-06-04

### Changed — Tokenização real (lazy): fim da heurística `char/4` no núcleo de contexto

Toda a contagem de tokens do app era uma heurística `char/4` — incluindo a
decisão de **truncar/compactar contexto** em `useChat` (`contextEngine.assemble`).
Pior: `tiktoken` e `@anthropic-ai/tokenizer` eram **dependências de produção
mortas** (importadas em zero lugares), e o README/ROADMAP *anunciavam*
"Accurate Token Counting using tiktoken" — uma afirmação falsa, com o próprio
rodapé do painel `/context` admitindo "~4 chars/token".

O problema não é cosmético. `char/4` **subestima** justamente o conteúdo denso
que domina turnos de agente, e subestimar é a direção perigosa — deixa o loop
manter mais histórico do que cabe, estourando a janela real do modelo (erro de
API) em vez de compactar a tempo. Medido contra o tokenizer real:

| Conteúdo | Real (o200k) | `char/4` | Erro |
|----------|:---:|:---:|:---:|
| `{"a":1,"b":[2,3]}` (resultado de tool é JSON) | 11 | 5 | **−54 %** |
| `文文文文文` (CJK) | 5 | 2 | **−60 %** |
| código JS | 9 | 8 | −11 % |

- **`tokenizer.ts` (novo)** — carrega o tokenizer BPE real (`js-tiktoken`,
  `o200k_base`, **pure-JS, sem WASM**) **uma vez, lazy, após o primeiro paint**.
  A tabela de ranks (~2,3 MB) fica num **chunk dinâmico separado** — mesmo
  padrão custo-zero-no-boot do KaTeX lazy (Ciclo 3). Máquina de estados
  idle→loading→ready single-flight + assinatura `onTokenizerReady` + memo
  limitado por conteúdo (o rodapé re-soma a conversa a cada tecla). `realTokenCount`
  nunca lança (degrada a `null` → heurística) e ignora marcadores `<|…|>`.
- **`contextEngine.ts`** — `estimateTokens` usa o count real quando pronto,
  caindo na heurística `char/4` enquanto carrega (e em contextos não-UI como
  os testes). A mesma função alimenta o contador do rodapé, o painel `/context`
  **e** o orçamento de truncamento — os três passam a ser exatos juntos.
- **`useTokenizerReady.ts` (novo)** — dispara o load após o primeiro paint e
  re-renderiza quando pronto, espelhando `useMathReady`. `useTokenCounter` e
  `useContextBreakdown` incluem o flag `ready` nas deps do `useMemo`, então a
  contagem "afia" de `char/4` para BPE real assim que a lib chega.
- **`o200k_base` para todo modelo** — exato para as famílias OpenAI modernas
  (gpt-4o, gpt-4.1, o1/o3/o4) e aproximação próxima para Claude/Gemini/local
  (que não publicam tokenizer exato) — em qualquer caso, muito melhor que `char/4`.
- **Limpeza de deps** — removidos `tiktoken` (WASM) e `@anthropic-ai/tokenizer`
  (era Claude 2, aproximação fraca p/ Claude 3/4), ambos mortos. README/ROADMAP
  e o rodapé do `/context` agora descrevem a implementação real.

### Notas

- **Boot inalterado:** o chunk de entrada foi de 578,08 → 578,62 KB (+~0,5 KB,
  só o código leve do `tokenizer.ts`); o rank de 2,3 MB e o `lite` (6,9 KB)
  ficam em chunks lazy — zero custo para quem não tem o counter à vista.
- 200 testes passando (eram 193). +7 casos: estado idle/fallback, count exato,
  densidade JSON/CJK > `char/4`, single-flight, memo, imunidade a `<|endoftext|>`,
  e a prova de fiação `contextEngine.countTokens === realTokenCount`. Typecheck limpo.
- Trade-off conhecido: o build agora emite **um** aviso de chunk > 800 KB — o
  rank `o200k_base` lazy. Mantido o limite em 800 (que pegou o chunk markdown no
  Ciclo 2); como o aviso nomeia o chunk, uma regressão real de boot apareceria
  como uma segunda linha, então o sinal é preservado.

## [2.12.11] — 2026-06-04

### Changed — Tool Deferral inteligente (auto por pressão de contexto)

O diferimento de tools (v2.12.6) existia mas era *default-off* — inerte
para quase todos. Agora é decidido **automaticamente por modelo**, com
default `auto`.

- **`decideDeferral(mode, contextLimit, toolTokens)` (novo, `toolDeferral.ts`)**
  — heurística de *pressão de contexto*: liga o diferimento quando os schemas
  das tools ocupariam ≥ `AUTO_DEFER_CONTEXT_RATIO` (15 %) da janela do modelo.
  **Medido:** 24 tools built-in ≈ 2.237 tokens → crossover em ~14,9k de
  contexto, ou seja **modelos 8k diferem (~27 %)** e 16k+ ficam eager (onde o
  round-trip extra seria puro overhead). A regra é auto-escalável: se o
  conjunto de tools crescer, o crossover sobe sozinho.
- **Setting tri-state `toolDeferralMode: 'auto' | 'on' | 'off'`** (default
  `auto`), substituindo o booleano `toolDeferralEnabled`. Migração automática
  em `loadSettings`: quem tinha o booleano ligado vira `'on'`; o resto vira
  `'auto'`. A UI vira um controle segmentado (Auto / Lig. / Desl.) com hint
  explicando o gatilho.
- **`useChat.ts`** decide por turno usando o modelo real da requisição e loga
  a economia (`eager Xt, ~Yt deferred`) — a medição fica visível no console.
  **`App.tsx`** usa a mesma decisão no painel `/context`, então o que o painel
  mostra bate com o que vai de fato na request.

### Notas

- Mudança de comportamento: usuários em contexto pequeno (Ollama 8k) passam
  a ter diferimento ligado automaticamente. Override manual via Settings
  (Auto / Lig. / Desl.). Tools hot-path (`update_working_memory`,
  `plan_tasks`, `update_task_status`) seguem sempre eager.
- 193 testes passando (eram 185). +8 casos cobrindo a heurística (on/off
  explícito, auto em janelas 8k–200k, fronteira exata do threshold,
  divisão-por-zero e default de mode indefinido). Typecheck limpo.

## [2.12.10] — 2026-06-04

### Added — Renderização de matemática (KaTeX) lazy no chat

Transforma a dependência morta `katex` + `marked-katex-extension`
(sinalizada como achado no Ciclo 2) numa feature real, sem custo no boot.
Fórmulas `$inline$` e `$$display$$` agora são tipografadas no chat (e em
Parliament/Arena, que compartilham o `marked` singleton).

- **`katexLoader.ts` (novo)** — carregamento sob demanda *por conteúdo*:
  KaTeX (~280 KB) + seu CSS só são importados (dinamicamente) na primeira
  mensagem que contém matemática. Detecção via `hasMath()` com regex
  conservadora que ignora cifrão de moeda ("$5 e $10" não dispara). Máquina
  de estado idle→loading→ready single-flight + assinatura `onKatexReady`.
- **`useMathReady.ts` (novo)** — hook que re-renderiza quando o KaTeX fica
  pronto: a primeira mensagem (pintada como `$…$` cru) "sobe" para a fórmula
  tipografada assim que a lib carrega. Chamado uma vez em `App`.
- **`formatting.ts`** — `formatMarkdown` dispara `ensureKatex()` ao detectar
  matemática se a lib ainda não estiver pronta; o registro usa `output:'html'`
  + `throwOnError:false` para sobreviver ao passe DOMPurify e degradar uma
  expressão inválida em texto vermelho em vez de quebrar o render.

### Notas

- Boot inalterado: KaTeX fica num **chunk lazy** separado, fora do bundle
  inicial — zero custo para quem nunca usa matemática.
- 185 testes passando (eram 178). +7 casos: detecção (`hasMath`, incl.
  imunidade a moeda e a quebra de linha) e um teste de integração que
  renderiza `$x^2$` e confirma que a saída KaTeX **sobrevive ao DOMPurify**.
- Typecheck limpo.

## [2.12.9] — 2026-06-04

### Changed — Boot ~778 KB mais leve: highlight.js slim + chunks limpos

Ciclo de performance guiado por evidência do próprio build (o Vite avisava
`markdown` chunk = 976 KB, acima do limite de 800 KB).

- **`highlight.js` completo → `highlight.js/lib/common`** em
  `formatting.ts`. O bundle completo trazia ~190 linguagens (~900 KB)
  carregadas no boot, mesmo no caminho eager de render do chat. O build
  slim cobre as ~37 linguagens comuns (js, ts, python, bash, json, sql,
  rust, go, xml, yaml, …) e cai em **plaintext** para o resto — fallback
  já tratado pelo guard `getLanguage(lang) ? lang : 'plaintext'`.
  - Chunk `markdown`: **976 KB → 197 KB** (−778 KB / −80 %; gzip 322 → 64 KB).
- **`vite.config.ts` — `manualChunks` enxuto.** Removidas duas entradas
  mortas: `katex` (o pacote não é importado em lugar nenhum) e
  `docs`/`mammoth` (mammoth/pdf-parse são `require()` do processo Electron,
  nunca entram no bundle do renderer — a entrada só gerava um chunk vazio
  + warning de build).

### Notas

- 178 testes seguem passando; typecheck limpo; build sem warning de chunk.
- Trade-off conhecido: linguagens fora do set comum (ex.: elixir, haskell,
  dockerfile, toml) renderizam sem realce (plaintext), mas continuam
  legíveis. Reversível trocando o import de volta para `highlight.js`.
- Achado p/ ciclo futuro (não alterado agora): `katex` +
  `marked-katex-extension` são dependências mortas — decidir entre
  **remover** ou **ativar renderização de matemática** (lazy) no chat.

## [2.12.8] — 2026-06-04

### Changed — Núcleo de sanitização de reasoning: fonte-única-de-verdade

Endurecimento do hot-path de chat/streaming (toda resposta, de qualquer
feature e provedor, passa por aqui). A correção da v2.12.7 foi reativa;
esta torna o pipeline estruturalmente sólido, fechando a *classe* de
bugs "reasoning piscando / bolha em branco" em vez de sintomas isolados.

- **Registro único `REASONING_TAGS`** em `sanitizers.ts` — cada formato de
  tag (`<think>`, `<thinking>`, `<reasoning>`, `<inner_monologue>`,
  `[thinking]`, `[reasoning]`, marcadores DeepSeek) é declarado **uma vez**.
  Tanto o passe one-shot (`sanitizeReasoningLeaks`) quanto o
  `StreamingSanitizer` derivam dessa lista. Antes as duas divergiam: o
  one-shot cobria 8 formatos, o streaming só 5 (apenas XML). Resultado:
  blocos bracket-style `[thinking]…[/thinking]` **vazavam ao vivo durante o
  streaming** e só sumiam quando o passe final rodava na mensagem salva
  (efeito "pisca e some"). Agora ambos removem o mesmo conjunto.

- **`sanitizeReasoningLeaksSafe()`** — o invariante "nunca-em-branco" da
  v2.12.7 (preferir texto cru a uma bolha vazia quando a sanitização
  zeraria a resposta inteira) estava **duplicado em 4 lugares** no
  `useChat.ts` como ternários inline. Agora vive numa função única que os 4
  call-sites consomem. Mudar a regra passa a ser um único ponto de edição.

- **`emptyReplyNotice(lang)`** — o placeholder de resposta vazia
  (`_(resposta vazia do modelo…)_`), antes duplicado 2× literal em PT/EN no
  `useChat.ts`, virou helper único. Streaming e não-streaming não podem
  mais divergir no texto.

- **`StreamingSanitizer.process()` agora drena o buffer por completo a cada
  chunk** — um loop trata múltiplas transições abre/fecha numa só passada.
  Antes, ao fechar um bloco dava `flush()` e despejava o resto do buffer
  cru; um segundo bloco (ou texto após o fechamento) no mesmo chunk vazava.
  Também passa a abrir o tag de **posição mais cedo** no buffer quando dois
  formatos coexistem, em vez de seguir a ordem do registro.

### Notas

- `useChat.ts`: import + 4 call-sites simplificados; comportamento
  preservado (verificado por testes).
- Testes: **178 passando** (eram 156). +22 casos: bracket-style no
  streaming, abertura por posição, invariante seguro (incl. all-reasoning e
  whitespace), placeholder PT/EN, e um teste de **consistência do registro**
  que cobre automaticamente qualquer tag novo em `REASONING_TAGS`.
- Typecheck limpo. Mudança interna — nenhuma API pública alterada
  (`sanitizeReasoningLeaks` e `StreamingSanitizer` mantêm assinatura).

## [2.12.7] — 2026-04-19

### Fixed — "Chat interrompido depois do plan_tasks"

Usuário reportou que o modelo criava um `plan_tasks` e o chat
aparentemente parava sem executar nem entregar nada — acontecia em
todos os provedores/modelos, o que descartava bug específico de um
backend. Investigação localizou três defeitos cooperantes no pipeline
de sanitização de reasoning:

- **`sanitizeReasoningLeaks` podia zerar a resposta inteira** — quando
  o modelo (Qwen3 / DeepSeek-R1 / afins) envolvia TODA a resposta
  final em `<think>…</think>`, o regex removia o bloco e o `accumulated`
  virava `''`. A mensagem salva ficava com `content: ''` e o usuário
  via uma bolha em branco logo depois do card de plan. Fix: se o
  resultado saneado for vazio mas o texto cru tiver conteúdo,
  preservamos o cru. Leaked reasoning > silêncio.
- **`StreamingSanitizer.flush()` descartava o buffer quando o stream
  cortava antes do `</think>`** — outro caminho pra ficar com
  `accumulated = ''` em streaming real. Agora o `flush` emite o que
  estava no buffer em vez de jogar fora.
- **Mensagem final com `content: ''` era gravada sem aviso** — mesmo
  depois dos dois fixes acima, qualquer outra causa de resposta vazia
  (max_tokens=0, glitch de provider) acabaria exibindo bolha em
  branco. Agora caímos num placeholder claro: _"(resposta vazia do
  modelo — tente novamente, reduza max_tokens ou troque o modelo)"_.

Aplicado aos dois caminhos (streaming e não-streaming). Teste
`sanitizers.test.ts` atualizado para o novo comportamento de `flush()`.

## [2.12.6] — 2026-04-19

### Added — Fase 13: Janela de contexto estilo Claude Code

Pesquisa revelou que o contador `0/8.2k (0%)` no rodapé era apenas um
mostrador escalar — não refletia o modelo do Claude Code, que quebra o
contexto em categorias (mensagens / system prompt / memória / tools /
MCP / skills / buffer de autocompact / espaço livre) e oferece
`tool_search` para diferir schemas raramente usados. Fase 13 implementa
o mesmo modelo mental no OpenClaude Desktop.

- **`ContextWindowPanel.tsx`** (novo, ~130 linhas) — popover ancorado no
  contador de tokens, exibe barra empilhada colorida por categoria e
  lista com swatches + ícones. Fecha com Escape ou clique fora. Alerta
  "Compactar agora" aparece quando `usedRatio ≥ 0.85`.
- **`useContextBreakdown.ts`** (novo) — hook superset de
  `useTokenCounter` que retorna `ContextBreakdown` completo com todas
  as categorias + flags `warning` / `critical` / `shouldAutocompact`.
- **`contextEngine.ts`** — expandida tabela `MODEL_CONTEXT_LIMITS`
  (Claude 4.x, gpt-4.1, qwen3, phi4, gemma3, llama3.3), novos
  `AUTOCOMPACT_BUFFER_RATIO = 0.15` e `AUTOCOMPACT_TRIGGER_RATIO = 0.85`,
  funções `countToolSchemas` / `countTextTokens` e interface
  `ContextBreakdown` exportada.
- **`toolDeferral.ts`** (novo) — infraestrutura de diferimento:
  `ALWAYS_EAGER_TOOLS` (hot-path: `update_working_memory`,
  `plan_tasks`, `update_task_status`), `partitionTools`,
  `renderDeferredManifest`, `resolveToolSearch`,
  `formatToolSearchResult` e a meta-tool `TOOL_SEARCH_TOOL`.
- **`useChat.ts`** — quando `settings.toolDeferralEnabled`, a request
  usa apenas `toolPartition.eager + metaTool` em vez de todas as 20+
  tools; o manifesto das diferidas é renderizado no system prompt.
- **`useToolExecution.ts`** — lida com `tool_search`: aceita
  `select:name1,name2` (seleção direta) ou keyword query, retorna
  schemas no formato `<functions>...</functions>`.
- **Slash commands** — `/context` abre o painel, `/compact [instruções]`
  força compactação manual do histórico via `compactContext` IPC.
- **Settings** — novo toggle "Diferir schemas de ferramentas" com hint
  explicando a economia de ~5k tokens. Default `false` (seguro).
- **Contador clicável** — `span.token-counter` virou `button` ancorado
  para o popover, preservando a aparência anterior.
- **CSS** — `.ctx-panel*` em `tech-panels.css` com tones dedicados
  (messages/system/memory/tools/toolsDeferred/mcp/mcpDeferred/skills/buffer)
  e listras diagonais para categorias diferidas.

### Why

Na configuração atual, o system prompt + esquemas de 20+ tools consome
~7-8k tokens **antes de qualquer mensagem do usuário**. Em modelos de
128k isso é irrelevante, mas em Ollama 8k (llama3 default) sobra pouco.
Diferimento corta ~3-5k do custo-fixo; o painel torna visível o que
estava escondido — usuário vê onde o orçamento está indo e decide se
compacta ou troca de modelo.

## [2.12.5] — 2026-04-18

### Fixed — Alinhamento do pill de permissão (pedido do usuário)

Usuário mostrou dois prints: (1) 2.12.4 com "Ignorar permissões" no
rodapé abaixo do input, parecendo desalinhado/órfão; (2) referência
com "BYPASS MODE" logo acima do botão `+` do input, compacto.
Pedido: "ajustado igual exemplo da imagem 2".

- **Pill de permissão migrou do `.input-footer` para
  `.input-status-bar`** — agora fica **acima** do `.input-pill`,
  alinhado com os demais status pills transientes (Agente, Persona,
  RAG, Loading). Ocupa a primeira posição da linha (esquerda).
- **`.input-status-bar` agora é sempre renderizada** (antes só
  aparecia quando havia algum status ativo). O pill de permissão é
  permanente, justifica a presença constante da linha.
- **Status pill `"Bypass Mode"` removida** — era redundante com o
  pill de permissão no modo `ignore` (mesma informação duplicada no
  mesmo lugar).
- **`.input-footer`** voltou ao layout original: hint completo
  (`Enter para enviar · Shift+Enter nova linha · Ctrl+N nova
  conversa · Ctrl+, config`) à esquerda, token/custo à direita. Sem
  mais `.input-footer-left`.

### Notas

- Typecheck limpo, 156 testes continuam passando.
- `PermissionModeButton` em si não mudou — só o ponto de montagem.
- Atalhos continuam: `Ctrl+Shift+M` abre popover, `1-4` seleciona,
  `Escape` fecha.

## [2.12.4] — 2026-04-18

### Added — Seletor de modo de permissão no input (estilo Claude Anthropic)

Usuário: "nível de permissão está hoje em configuração e gostei muito.
porem quero adicionar ele igual ao do chat da Claude Anthropic segue
imagem." — print mostra pill "Ignorar permissões" no rodapé esquerdo
do input e popover com 4 modos numerados (1-4).

- **`src/components/PermissionModeButton.tsx`** (novo, ~130 linhas):
  pill no `input-footer-left` exibindo o modo atual, com dot
  color-coded pela tonalidade (cinza / accent / azul / vermelho).
  Clique abre popover para cima com 4 opções:
  1. **Solicitar permissões** (`ask`) — default seguro
  2. **Aceitar edições** (`auto_edits`) — pilar da accent color
  3. **Modo de planejamento** (`planning`) — azul info
  4. **Ignorar permissões** (`ignore`) — vermelho + dot pulsante
- Atalhos:
  - `Ctrl+Shift+M` (global) abre/fecha o popover de qualquer lugar.
  - Com popover aberto, `1`-`4` seleciona e fecha.
  - `Escape` fecha sem alterar.
- **Source of truth é `settings.permissionLevel`** — o componente é
  puramente apresentacional + dispatch via `onChange`. Settings.tsx
  continua sendo a tela canônica de edição; o pill é um atalho
  visual no fluxo de chat.
- **Pulse animation** no dot do modo `ignore` (bypass) — lembra que o
  modo perigoso está ativo mesmo quando o usuário não olha os status
  pills acima do input.

### Changed

- `.input-footer` agora tem layout grid com `.input-footer-left`
  contendo o pill de permissão + hint reduzido ("Enter · Shift+Enter
  · Ctrl+N · Ctrl+,") — o hint anterior era longo demais para
  coexistir com o pill.
- Hint ficou em monospace uppercase-leve com opacidade reduzida —
  mais discreto, para o pill ser o protagonista visual.

### Notas

- Typecheck limpo, 156 testes continuam passando.
- Compatível com `permissionLevel` existente — nada muda em
  `useToolExecution.ts`, `useChat.ts`, `securityAudit.ts`,
  `ProfilesPanel.tsx` — todos já consomem `settings.permissionLevel`.
  O pill apenas oferece um ponto de edição mais rápido.

## [2.12.3] — 2026-04-18

### Changed — Desduplicação titlebar ↔ UserMenu (pedido do usuário)

Usuário: "tire a parte duplicada, AccountPanel do Supabase perdeu
sentido e ficou duplicado algumas coisas que está no UserMenu. O
painel do agente deve vir para o UserMenu e deixar na parte superior
tudo que for relacionado Analytics & Insights, restante deve vir
para o UserMenu."

- **Titlebar enxugada.** Removidos os seguintes botões (todos agora
  exclusivamente no UserMenu ou na linha `.sidebar-user`):
  - Agent Dashboard (ícone Activity) → UserMenu
  - Tema (Sun/Moon/Contrast) → inline ao lado do avatar + entrada no
    UserMenu
  - Accent color (Palette) → UserMenu
  - Conta (User) → deletado inteiramente
  - Configurações (Settings icon) → UserMenu

  Restam na titlebar: toggle da sidebar, Regen/Export (específicos da
  conversa atual) e **Analytics & Insights** — o único item de
  "visão geral" que pertence ao topo.

- **AccountPanel removido.** O modal Supabase-based com formulário de
  sign-in, frase-senha E2EE e toggles de sync não tinha mais sentido
  aqui — OpenClaude Desktop é app **local**, não tem conta para
  fazer login. Removido:
  - `lazy(() => import('./AccountPanel'))` em `App.tsx`
  - import `isSupabaseConfigured`
  - state `showAccount` + todas as suas referências (handler de
    escape, lista de dependências do useEffect)
  - bloco JSX `{showAccount && <Suspense><AccountPanel.../></Suspense>}`
  - Hooks `useAuth` e `useSync` continuam sendo chamados para manter
    background sync se alguém tiver Supabase configurado via
    localStorage — não há mais UI para isso, mas também não quebra
    nada. O arquivo `AccountPanel.tsx` permanece no repo (código morto
    a limpar futuramente).

- **UserMenu reescrito.** Sem mais conceito de email/sessão:
  - Header agora é um **nome de perfil local editável** (`profileName`
    em `AppSettings`, default "OpenClaude"). Clica, edita inline com
    input estilizado, Enter salva, Escape cancela. Abaixo, subtítulo
    "Modo local · sem conta" em monospace uppercase.
  - Itens: Configurações, Idioma (PT/EN), **Tema**, **Cor de
    destaque**, **Dashboard do agente**, Receber ajuda, Obter apps,
    Saiba mais (submenu), versão.
  - Removidos: "Entrar ou criar conta", "Fazer upgrade do plano",
    "Sair" — não fazem sentido sem auth.

- **`.sidebar-user-avatar`** agora mostra a inicial do `profileName`
  (em vez da inicial do email).

### Added

- **`settings.profileName?: string`** em `AppSettings` — string livre
  local, editável via UserMenu. Funciona sem configuração (default
  "OpenClaude").
- CSS `.user-menu-name-display` / `.user-menu-name-input` /
  `.user-menu-subhead` / `.user-menu-hint` — edição inline do nome
  com hover revelando ícone de lápis, foco com ring accent.

### Notas

- Typecheck limpo, 156 testes continuam passando.
- Migração: usuários em 2.12.2 abrem 2.12.3 e veem "OpenClaude" no
  avatar até renomearem — sem perda de dados.

## [2.12.2] — 2026-04-18

### Added — UserMenu estilo Claude Desktop

Usuário compartilhou dois prints: (1) o AccountPanel atual mostrando
estatísticas de modelos/provedores — não é o que ele quer; (2) o menu
de perfil do Claude Desktop (avatar "martim" no canto inferior, menu
com Configurações, Idioma, Receber ajuda, Upgrade, Apps, Presentear,
Saiba mais, Sair). Pedido: "sistema de login e perfil igual ao do
Claude".

- **`src/components/UserMenu.tsx`** (novo, ~200 linhas) — popover que
  abre para cima ancorado na linha de identidade da sidebar:
  - Header com email (quando logado) ou botão "Entrar ou criar conta"
    que abre o AccountPanel existente.
  - **Configurações** (atalho `Ctrl+,`) → abre Settings.
  - **Idioma** (submenu accordion inline) → PT / EN com check na
    seleção atual; troca `settings.language` em tempo real.
  - **Receber ajuda** → abre README no GitHub via `openTarget`.
  - **Fazer upgrade do plano** → abre AccountPanel (onde fica a
    sincronização Supabase, equivalente de "plano" neste app local).
  - **Obter apps e extensões** → abre página de releases no GitHub.
  - **Dashboard do agente** (`Ctrl+⇧D`) — substituição tech para
    "Presentear com Claude" (não faz sentido em OpenClaude).
  - **Saiba mais** (submenu) → GitHub, Changelog, badge de versão em
    monospace.
  - **Sair** (destacado em vermelho suave no hover) — só aparece
    quando há sessão; sem sessão, mostra hint "Sem conta — tudo local".
  - Fecha em `Escape`, clique fora, ou após qualquer ação executada.

- **`src/App.tsx`** — nova linha `.sidebar-user` abaixo do model-selector
  no `.sidebar-footer`:
  - Avatar circular com gradiente `accent → accent-2` exibindo a
    inicial do email (ou "U" sem sessão).
  - Nome: parte do email antes do `@` (ou "Convidado" / "Guest").
  - Botão de tema (sol/lua/contraste) à direita, redundante com o da
    titlebar mas no local que o usuário espera pelo print de
    referência.
  - Clique no trigger abre o `UserMenu`.

- **`src/tech-panels.css`** — ~200 linhas de CSS novo:
  - `.sidebar-user`, `.sidebar-user-trigger`, `.sidebar-user-avatar`
    (gradiente accent + glow sutil), `.sidebar-user-name`,
    `.sidebar-user-theme`.
  - `.user-menu` com glassmorphism (`backdrop-filter: blur(14px)
    saturate(140%)`), borda accent, sombra multicamada com destaque
    interno superior, animação de entrada `translateY(4px) → 0`.
  - `.user-menu-item` com hover accent, `.user-menu-kbd` para atalhos
    em monospace, `.user-menu-submenu` como accordion com borda
    esquerda accent, `.user-menu-danger` para o botão Sair.

### Notas

- O `AccountPanel` existente (com a tela de estatísticas
  modelos/provedores que o usuário não queria assim) permanece como
  tela de gerenciamento de sincronização — agora acessado através
  do item "Upgrade do plano" do UserMenu. A visibilidade dele caiu:
  só aparece quando o usuário pede explicitamente. A linha de
  identidade na sidebar é o novo ponto focal do perfil.
- 156 testes continuam passando. Typecheck limpo.

## [2.12.1] — 2026-04-18

### Fixed — Agent Dashboard renderizava sem estilo (regressão crítica do 2.12.0)

- **`src/main.tsx` não importava `ui-improvements.css`.** Todo o CSS das
  classes `.ad-*` (Agent Dashboard), `.cmd-*` (Command Palette novas
  ações), `.shortcuts-*` (Cheat Sheet) e vários refinamentos da v2.12.0
  foram enviados como **dead code** — o arquivo existia no bundle mas
  nunca era carregado. Resultado nas capturas do usuário: dashboard em
  pilha vertical sem grid, KPIs sem borda, dots de saúde sem animação,
  tabs de Settings coladas ("GeralProvedorMCP"), barras do Analytics
  empilhadas, botão de submit do Account em roxo cru fora do tema.
- Correção: `main.tsx` agora importa `./index.css`, `./ui-improvements.css`
  e `./tech-panels.css` nessa ordem.

### Added — `tech-panels.css` (~600 linhas) / visual mais tecnológico

Seguindo pedido do usuário ("pegue referências de painel e melhore os
painéis do desktop para algo mais tecnológico"), um stylesheet novo
dedicado ao polimento tech:

- **Tokens tech** no topo: `--tech-mono` (JetBrains Mono / Fira Code /
  Consolas), `--tech-glow` (halo com accent), `--tech-panel-bg`
  (gradient sutil via `color-mix`).
- **Agent Dashboard**: `.ad-kpi-row` com `grid-template-columns: repeat(4, minmax(0, 1fr))` forçado (evita colapso), cada `.ad-kpi`
  ganha borda superior em gradient `accent → accent-2` de 2px, valores
  em `font-variant-numeric: tabular-nums` + monospace para sensação de
  telemetria. Dots de saúde pulsam via `@keyframes`.
- **Settings tabs**: layout flex com padding lateral, tipografia
  uppercase em mono, underline accent na tab ativa e halo radial sutil
  abaixo — resolve a colagem "GeralProvedorMCP" vista no print.
- **Analytics "Custos"**: `.analytics-bar-row` agora é grid
  `180px / 1fr / 90px` com track arredondada e fill em gradient accent,
  valores alinhados à direita em tabular-nums. Cards do Analytics
  recebem a mesma borda superior em gradient.
- **Account**: submit button passa de roxo cru para
  `linear-gradient(135deg, var(--accent), var(--accent-2))`, coerente
  com o resto do tema.
- **Model dropdown**: glassmorphism com `backdrop-filter: blur()`, IDs
  de modelo em monospace, hover com halo accent.
- **Shortcut keys do cheat sheet**: aparência 3D pressionada
  (inset shadow + border top clara) — visual de tecla física.
- **Command palette**: `.cmd-item.cmd-action` com borda esquerda accent
  de 2px destacando ações executáveis.

### Notas

- Mudança é CSS-only (zero impacto em tipos / lógica). Nenhum teste
  precisou ser ajustado, nenhum componente React foi alterado nesta
  versão além dos imports em `main.tsx`.
- Migração do Modal Research (v2.11.6) e `AgentDashboard` (v2.12.0)
  permanecem como vieram.

## [2.12.0] — 2026-04-18

### Added — "Command Center + Ops" (inspirado em Paperclip + Claude Desktop)

Sessão de melhorias de alto impacto, focada em **visibilidade** (saber o
que o app está fazendo) e **controle** (agir rápido sem navegar por
menus). Referências cruzadas: `paperclipai/paperclip` (visão unificada
de frota de agentes) e Claude Desktop (polimento de interações).

- **Agent Dashboard** (`AgentDashboard.tsx`, `Ctrl+Shift+D` ou novo botão
  na titlebar com ícone de atividade). Painel único que responde às
  perguntas que antes exigiam abrir 4 modais:
  - Quanto gastei hoje? E nos últimos 30 dias?
  - Quantas tarefas agendadas estão ativas? Qual a próxima?
  - Qual persona está selecionada?
  - Meus provedores estão saudáveis?
  - Modo Agente está ligado?

  Cada card é interativo — "Run now" dispara uma scheduled task sem sair
  do painel; botões de "abrir ..." levam ao CRUD especializado quando
  precisa editar. Atualiza os contadores relativos ("em 5min") a cada
  30s enquanto aberto.

- **Notificações nativas do sistema operacional** quando uma resposta
  termina **com a janela desfocada**. Zero spam: só dispara na borda
  loading→done, só se `isWindowFocused() === false`. Clique na
  notificação traz a janela para o primeiro plano (padrão Slack/Discord).
  Opt-out via `settings.notifyOnComplete` (default on). Implementado no
  main process com `electron.Notification`.

- **Cheat sheet de atalhos do teclado** — pressione `?` em qualquer lugar
  fora de um campo de texto. Modal lista todos os atalhos agrupados
  (Navegação / Recursos / Chat) com `<kbd>` estilizados. Novo atalho
  `Ctrl+Shift+D` para o Agent Dashboard também entrou aqui.

- **Per-message regenerate + branch** — cada mensagem do assistente agora
  tem três ações no hover: copiar, regenerar (ícone refresh) e bifurcar
  (ícone GitBranch). O fork reusa o `useConversationFork` existente que
  não estava conectado ao main chat. Bifurcar cria nova conversa no topo
  da sidebar preservando o histórico até aquela mensagem.

- **Command Palette com ações reais**, não só toggles de feature. Nova
  categoria **Ações** no topo (tintada com accent):
  - Nova conversa (`Ctrl+N`)
  - Painel do Agente (`Ctrl+Shift+D`)
  - Exportar conversa
  - Limpar conversa atual
  - Abrir configurações (`Ctrl+,`)
  - Atalhos do teclado (`?`)

### Changed

- IPC API expandida: `showNotification`, `isWindowFocused`,
  `oauthGoogleStart` agora tipados em `vite-env.d.ts`.
- `AppSettings.notifyOnComplete?: boolean` (default `true`).

## [2.11.6] — 2026-04-18

### Fixed — Migração de `modalModel` legacy persistido

A v2.11.5 corrigiu apenas o **default** de `modalModel` e as shortlists,
mas usuários que já tinham o app instalado continuavam com o valor
antigo (`llama-3.1-70b`, etc.) salvo em `localStorage`. Como
`loadSettings()` faz `{ ...DEFAULT_SETTINGS, ...stored }`, o valor
persistido sobrescrevia o novo default, e toda request Modal ainda
retornava `Unknown model: llama-3.1-70b`.

- **Settings.loadSettings:** agora detecta valores stale de
  `modalModel` (`llama-3.1-70b`, `llama-3.1-8b`, `mixtral-8x7b`,
  `llama-3.1-405b`, `llama-3-70b`) e os substitui automaticamente por
  `DEFAULT_SETTINGS.modalModel` (`zai-org/GLM-5.1-FP8`) ao carregar.
  Usuários existentes recebem o fix sem precisar mexer em Settings.

## [2.11.5] — 2026-04-18

### Fixed — Modal Research: model shortlist correto

A shortlist exibida no menu "regenerar com" e o default em
`PersonaEngine.getDefaultModel('modal')` usavam nomes estilo Groq
(`llama-3.1-70b`, `llama-3.1-8b`, `mixtral-8x7b`) que não existem no
endpoint Modal Research — toda tentativa de regen ou persona com Modal
retornava 404 no `/v1/chat/completions`. Substituídos pelos IDs reais
do catálogo Modal:

- `zai-org/GLM-5.1-FP8`
- `Qwen/Qwen2.5-Coder-32B-Instruct`
- `deepseek-ai/DeepSeek-V3`

## [2.11.4] — 2026-04-18

### Fixed — Auto-retry para modelos sem tool use (OpenRouter etc.)

- **useChat:** quando o provider rejeita a request com
  _"No endpoints found that support tool use"_ (OpenRouter em modelos
  sem endpoint tool-capable) ou variações (`"doesn't support tools"`,
  `"tool use is not supported"`), o hook:
  1. detecta o erro específico via `isToolsUnsupportedError()`,
  2. marca o par `provider:model` em `openclaude-no-tools-models`
     (localStorage, persistente),
  3. mostra toast explicando a situação no idioma do usuário,
  4. desconta o step e re-executa a mesma iteração do loop sem
     `tools`, então o usuário recebe pelo menos uma resposta de
     chat simples em vez de um erro.
  Funciona nos dois caminhos (streaming + non-streaming). Requests
  futuros para o mesmo modelo pulam `tools` automaticamente até o
  usuário limpar a flag (futuro: botão em Settings).

## [2.11.3] — 2026-04-18

### Fixed — Segunda rodada de varredura

Segunda passada de bug-hunt em áreas não cobertas pela 2.11.2 (streaming
avançado, memory dreaming, pool de chaves, auth). 8 correções, typecheck
+ 156 testes + build limpos.

- **StreamingSanitizer.flush:** se o stream terminasse dentro de
  `<thinking>` sem fechar a tag, `flush()` devolvia o buffer cru —
  vazando exatamente o reasoning que o sanitizer existe para esconder.
  Agora descarta o buffer e reseta estado quando `inTag === true`.
- **useChat + electron/main.js (compact-context):** o IPC handler
  ignorava o `provider` do caller e sempre batia em `localhost:11434`.
  Para usuários 100% cloud (sem Ollama instalado), toda conversa longa
  logava "compaction failed" e perdia o summary. Agora o caller passa
  `settings.provider` e o handler faz short-circuit quando não é ollama
  (fallback para truncação simples, silencioso).
- **useChat (stopAgent):** pressionar Stop durante um stream com tool
  calls acumuladas ainda disparava `processToolCalls` no fluxo pós-stream,
  executando `write_file`/`exec_command` que o usuário pediu para
  cancelar. Adicionado guard `stopRequestedRef.current` após a Promise
  do stream (e no ramo non-streaming).
- **services/memoryDreaming:** `lastDreamTime` era compartilhado entre
  ciclos light (2h) e deep (24h) — cada light stamp empurrava o deep
  indefinidamente, então deep dreams nunca disparavam enquanto o app
  rodasse regularmente. Split em `lastLightDreamTime` / `lastDeepDreamTime`,
  com fallback para o campo legado nos arquivos existentes.
- **useUsageTracking:** o state React crescia sem limite (retornava
  `updated` não-truncado do `setEntries`), enquanto o disco era capado em
  1000 entries — divergência observável após a entrada 1001 e vazamento
  de memória em sessões longas. Agora trimado também na memória.
- **useModalKeyPool:** erros desconhecidos (5xx, DNS, resposta malformada)
  não aplicavam cooldown, resultando em loop apertado
  `acquire → fail → markError → drainWaiter → acquire` martelando uma
  key quebrada. Agora recebem o cooldown curto (COOLDOWN_CONCURRENT_MS).
- **useProviderHealth.reportSuccess:** o spread `{ status: 'healthy',
  consecutiveErrors: 0 }` dropava `rateLimitUntil`. Um chunk bem-sucedido
  após 429 limpava a flag, deixando `isRateLimited()` retornar false e
  novos requests caindo no mesmo 429. Agora preserva `rateLimitUntil`
  enquanto ainda for futuro.
- **useAuth:** `passphrase` só era limpo em sign-out, nunca em troca de
  identidade (account A → B via OAuth callback). Operações de cripto em
  blobs da conta B decriptavam com a passphrase de A, lançando erros que
  pareciam "dados corrompidos". Agora `onAuthStateChange` compara
  `user.id` e limpa em mudança.

- **useMemoryDreaming (health stale):** `updateHealthScores` estava
  importado mas nunca chamado no light dream, então scores ficavam
  congelados no valor do último deep (até 24h). Agora o light dream
  também refresca os scores antes de salvar.
- **useImageAttachment (silent failure):** ambos os ramos de erro
  (`openFileDialog` e `readDocument`) retornavam sem nenhum sinal ao
  usuário — clique em "Anexar", nada acontece, sem ideia do motivo
  (arquivo >5MB rejeitado, não-imagem, erro de leitura). Hook agora
  aceita `onToast?` opcional e loga/notifica cada falha distintamente;
  cancelamento do dialog permanece silencioso.

### Testes
- Atualizado `test/sanitizers.test.ts` para refletir o novo comportamento
  do `flush()` mid-tag (não vaza).
- Atualizado `test/useModalKeyPool.test.ts` — a asserção "sem cooldown em
  erro genérico" virou "aplica cooldown curto em erro desconhecido".

## [2.11.2] — 2026-04-18

### Fixed — Bug sweep em todo o projeto

Varredura completa procurando bugs reais de alta confiança. 12 correções
aplicadas, nenhuma regressão visível para o usuário. Todos os 156 testes
seguem passando (typecheck + vitest + build limpos).

- **useChat:** working memory nunca atualizava — o pipeline tentava
  `JSON.parse` do texto de confirmação do tool (literal, não JSON).
  Agora lê direto de `toolCallsData.arguments` da chamada
  `update_working_memory`.
- **App.tsx (drag overlay):** o overlay piscava ao atravessar elementos
  filhos porque `dragleave` dispara a cada borda. Substituído por
  contador de profundidade (`dragenter`++ / `dragleave`--), só esconde
  em zero.
- **App.tsx + useConversations:** lote de tarefas agendadas colidia na
  mesma conversa — `newConversation()` não devolvia o id, então a ref
  só via a última. `newConversation()` agora retorna `string` e
  `sendMessage` aceita `overrideConvId?` opcional.
- **useSync:** após primeira falha de `pullNow` (rede, passphrase
  errada, erro de servidor), a flag `pulledForUser` ficava travada e o
  usuário precisava reabrir o app. Agora `pullNow().catch(() => flag = null)`.
- **electron/main.js (ollama-chat):** requisição não-streaming não era
  registrada em `activeOllamaStream`, então `abort-stream` não
  destruía. Registrada e zerada em end/error.
- **useConversations:** `filteredConversations` era um IIFE
  recalculado a cada render (incluindo cada toque de tecla). Agora em
  `useMemo([conversations, debouncedSearch, pinnedConvs])`.
- **useVoice:** `SpeechRecognition` e `speechSynthesis` não tinham
  cleanup no unmount, deixando o microfone ativo se o componente
  sumisse com gravação em andamento. Adicionado `useEffect(return
  stop+cancel)`.
- **utils/formatting (generateId):** id de 7 chars base36 (~36 bits)
  tem aniversário em ~9k ids — real para históricos longos. Migrado
  para `crypto.randomUUID()` com fallback mais entrópico.
- **useToolExecution (LANGUAGE_RULE):** `LANGUAGE_RULE[lang]` retornava
  `undefined` para idiomas fora do dicionário, concatenando a string
  "undefined" no system prompt dos subtasks. Adicionado `?? LANGUAGE_RULE.pt`.
- **App.tsx (regenerateResponse):** o updater de `setConversations`
  usava `msgs`/`lastUserIdx` capturados antes do setState, então cliques
  rápidos em regen ou mensagens chegando durante o stream poderiam
  cortar mensagens vivas. Agora o índice é recalculado dentro do
  updater contra o `c.messages` fresco.
- **electron/main.js (web-search):** resposta original de redirect não
  era drenada antes de seguir o `Location`, deixando o socket semi-aberto.
  Adicionado `res.resume()`.
- **useToolExecution (pendingApproval):** clique duplo em Permitir/Negar
  antes do rerender poderia disparar `resolve()` em sequência — agora
  `resolve` é embrulhado com flag `settled` que garante primeira
  decisão vence.



### Changed — Internal refactor (sem mudança de comportamento)

Decomposição de App.tsx em componentes folha, consolidando JSX repetido
da v2.11.0. App.tsx: 1325 → 1254 linhas (-71, -5%). Nenhuma mudança
visível para o usuário; todos os 133 testes seguem passando.

- **Novo:** `src/components/RegenSplit.tsx` — split-button de regen
  (main + chevron + menu por provider). Anteriormente ~50 linhas de
  JSX inline no titlebar com IIFE de filtragem. Suporta modo
  controlado (via `open` + `onOpenChange`) para integração com a
  Esc-overlay stack, ou autônomo.
- **Novo:** `src/components/AmbientOrb.tsx` — envolvedor do blob
  gradiente de streaming. Apenas 1 prop (`visible`); a estilização
  continua 100% em CSS.
- **Novo:** `src/components/SlashPopover.tsx` — popover do parser de
  slash commands. Mouse interactions (hover + click) internas ao
  componente; navegação por teclado segue no App.tsx porque precisa
  coexistir com o key-flow do textarea.
- **Verificado:** `ProviderList`/`ProviderDetail`/`config/providers.ts`
  já existem (DRY de 5 blocos de provider em Settings feito em release
  anterior). `config/features.ts` já existe (Feature Registry).
  Fases 3.4 e 4.1 do plano original estão concluídas — plano atualizado
  por este release para refletir a realidade.

## [2.11.0] — 2026-04-18

### Added — Polish pass P3 (differenciais visuais & produtividade)

Fecha o roadmap de polimento aberto após o audit cruzado com apps
desktop modernos. P0/P1/P2 foram liberados em 2.10.0; P3 reúne os
itens de **identidade visual** (tema OLED, cor de destaque customizável,
ambient orb) e **produtividade avançada** (slash commands, regenerate
com modelo alternativo) que dependiam da base de design tokens
estabelecida pela P1.

#### Identidade visual

- **Tema OLED como terceira opção.** O toggle de tema no titlebar agora
  cicla entre `dark → light → oled → dark`, com ícone adaptativo
  (Sun / Moon / Contrast). OLED usa preto puro `#000` como `--bg-primary`
  e tokens agressivamente escuros para AMOLED — nunca é selecionado
  automaticamente (apenas `light` cai em `prefers-color-scheme`); é
  uma preferência explícita de hardware, não um default sensato.
  Persistido em `openclaude-theme` e sincronizado via Supabase snapshot.
- **Cor de destaque customizável.** Novo botão Palette no titlebar abre
  `AccentPicker` com 8 presets (Terracota, Azul, Roxo, Verde, Rosa,
  Âmbar, Vermelho, Ciano) e campo hex livre (texto ou color input
  nativo). O hook `useAccentColor` escreve `--accent / --accent-2 /
  --accent-hover / --accent-dim / --accent-border` em `:root` — como a
  v2.10.0 já havia centralizado esses tokens, todas as superfícies
  (gradientes, borders, cursor de streaming, links) retingem sem
  alteração de componente. Persistido em `openclaude-accent`.
- **Ambient orb durante streaming.** Blob gradiente difuso (dois layers
  blurados com `backdrop-filter` não é usado; apenas `filter: blur`
  para manter barato) posicionado atrás do composer, animado com
  pulse + drift suaves. Aparece apenas enquanto `isActiveConvLoading`
  é true. Usa `--accent` + `--accent-2` — acompanha a cor de destaque.
  Respeita `prefers-reduced-motion` (congela sem animação) e ajusta
  opacidade para light / OLED. `aria-hidden` porque o indicador textual
  de streaming já atende acessibilidade.

#### Produtividade

- **Slash commands no composer.** Quando o input começa com `/`, um
  popover lista comandos matching pelo prefixo. Navegação: `↑↓` muda
  seleção, `Tab` completa o nome (adiciona espaço para args), `Enter`
  executa, `Esc` limpa. Comandos disponíveis:
  - `/clear` — inicia nova conversa (equivalente a Ctrl+N).
  - `/model [nome]` — troca para o modelo informado (match exato ou
    substring nos modelos Ollama carregados) ou abre o dropdown se
    ausente / não encontrado.
  - `/system <prompt>` — define system prompt da sessão (salva em
    settings). Sem argumento, abre o painel Settings.
  - `/regen` — regenera a última resposta.
  - `/theme [dark|light|oled]` — aplica tema ou cicla se sem arg.
  - `//` como prefixo envia texto literal iniciado por `/`.
- **Regenerate com modelo alternativo.** O botão de regenerar no
  titlebar agora é um split-button: clique principal regenera com o
  modelo atual (comportamento anterior preservado); chevron à direita
  abre um menu com shortlist por provider (`PROVIDER_MODEL_SUGGESTIONS`
  para cloud; `models` do Ollama para local). Selecionar um modelo
  aplica-o (permanentemente — é o padrão em ChatGPT/Claude.ai) e
  dispara regen. O modelo atualmente ativo é marcado com chip "atual".
  `Esc` fecha o menu (stack de overlays).

### Technical

- Novo hook: `src/hooks/useAccentColor.ts` (apply + persist accent).
- Novo componente: `src/components/AccentPicker.tsx` (modal presets +
  custom hex + color picker nativo).
- Novo utilitário: `src/utils/slashCommands.ts` (parser + registry).
- Novo constante: `src/constants/modelSuggestions.ts` (shortlist por
  provider para regenerate menu).
- `regenerateResponse` agora aceita `modelOverride?: string` e aplica
  o modelo ao settings/selectedModel antes do send (80ms timeout para
  flush de state antes que `useChat` leia o novo `providerConfig`).
- Overlays adicionados à stack Esc: `showAccentPicker`, `showRegenMenu`.
- Remote sync (`useSync` snapshot) aceita `'oled'` como valor válido
  de `theme` — rollout multi-dispositivo preserva a preferência OLED.
- Tema OLED e accent custom são independentes — usuário pode combinar
  qualquer preset/hex com qualquer dos 3 temas.

## [2.10.0] — 2026-04-17

### Added / Changed — Polish pass (P0 + P1 + P2 from design audit)

Release guiada por audit independente cruzado com referências de apps
desktop modernos (Claude Desktop, ChatGPT, Raycast, Linear, Arc, Cursor).
Foco: acessibilidade de teclado, robustez de feedback visual, e
padronização de design tokens.

#### P0 — Acessibilidade & robustez

- **Esc universal fecha todos os overlays.** Antes só fechava Settings
  e o model dropdown — 14 outros painéis (Analytics, Vision, Persona,
  Vault, Arena, Workspace, ORION, WorkflowBuilder, RAG, AccountPanel,
  Parliament, CommandPalette, Profiles, Scheduler) só fechavam via
  clique. Agora a stack de overlays é percorrida em ordem (dropdowns
  primeiro, modais depois) e só o mais recente fecha por Esc.
- **`/` foca o composer** quando não está em campo de texto (padrão
  Discord/GitHub/Slack). `Ctrl/Cmd+Enter` envia mensagem (atalho
  ChatGPT/Claude.ai para usuários que desabilitam Enter via IME).
  `Ctrl/Cmd+\` toggle sidebar (VS Code).
- **macOS support nos atalhos.** Todo handler agora checa
  `ctrlKey || metaKey`. Antes nenhum atalho funcionava no build mac.
- **Toast stack com cap (5) + dedupe.** Mensagem+severity idênticas
  em janela de 800ms são swallowed. Oldest-out quando excede. Timers
  rastreados por `Map<id, TimeoutHandle>` e cancelados no dismiss
  (antes vazavam e às vezes fechavam o toast errado após ID recycle).
- **Race condition do streaming resolvida.** Antes, janela curta onde
  cursor piscante + typing dots apareciam simultaneamente ao começar
  a receber tokens. Agora typing indicator some assim que
  `streamingText` tem conteúdo.

#### P1 — Design tokens

- **Variáveis CSS novas** em `:root`: `--radius-sm/md/lg/xl/pill`,
  `--tr-fast/base/slow` (com easing `cubic-bezier(0.16, 1, 0.3, 1)`
  do sistema de design do Linear/Arc), `--z-dropdown/modal/overlay/
  toast/tooltip`. Valores legacy mantidos para compat.
- **`.update-banner` sem `!important`.** Os 9 `!important` empilhados
  foram substituídos por especificidade via `body .update-banner` +
  uso de `--z-overlay`. Queda total de ~20 → ~13 `!important`
  no index.css.
- **Headers de modal unificados.** Audit achou 8 classes divergindo
  em font-size (16 vs 17), weight (600 vs 700) e padding (4 combos
  diferentes). Novo seletor `:where(...)` normaliza padding 16×20 e
  h2 17px/600 sem alterar classes, preservando overrides locais
  (ex: `.orion-header h2` mantém cor/fonte customizadas).

#### P2 — UX com referência direta

- **Agrupamento temporal no sidebar** (ChatGPT/Claude Desktop pattern).
  Buckets "Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias",
  "Anterior". Labels sticky no scroll com blur backdrop. Fixadas no
  topo sob seção "Fixadas" separada. Helpers novos em
  `utils/formatting.ts`: `timeBucket`, `groupByBucket`, `bucketLabel`.
- **Send button vira Stop** durante streaming (mesma posição, troca
  ícone + handler). Já existia via `send-circle.stop` mas não estava
  consistentemente documentado.
- Empty state já tinha suggestion chips (`.suggestions-grid`) — só
  reforçamos a apresentação.

### Testes

- **+8 testes** em `test/formatting-buckets.test.ts` cobrindo
  `timeBucket` (classificação em 5 buckets relativos a start-of-today,
  aceita Date/string/number), `groupByBucket` (ordem cronológica,
  omissão de buckets vazios, preservação de ordem interna) e
  `bucketLabel` (PT/EN).
- Total: **133 testes passando** (era 125 em v2.9.3).

### Verificação

- `npm run typecheck` — 0 erros
- `npx vitest run` — 15/15 test files, 133/133 tests passing
- `npm run build` — ok

## [2.9.3] — 2026-04-17

### Changed — Desktop UX polish + runtime Supabase setup

Feedback direto do usuário: "não estou vendo o campo de criar conta e
login no desktop". O gate `isSupabaseConfigured()` introduzido em v2.9.2
escondia o botão em vez de educar — correto seria dar ao usuário um
caminho para configurar. Além disso, uma passada de polimento visual
usando referências de apps desktop modernos (Linear, Raycast).

#### Contas

- **Botão Conta sempre visível.** O gate de v2.9.2 foi substituído por
  uma tela de setup inline: quando Supabase não está configurado, o
  AccountPanel agora mostra dois campos (URL + anon key) + link para
  o dashboard Supabase. O usuário cola as credenciais, clica
  "Conectar e recarregar" e o app reinicia com sync habilitada.
- **Credenciais em `localStorage`.** `services/supabase.ts` agora lê
  `oc.supabaseUrl` e `oc.supabaseAnonKey` antes do env de build. Novas
  funções exportadas: `setSupabaseCredentials(url, key)` e
  `clearSupabaseCredentials()`. Build-time env continua funcionando
  como fallback, então builds auto-hospedados não precisam mudar nada.
- **Tooltip contextual no botão.** Mostra "conectar Supabase" se não
  configurado, email logado se conectado, ou "Conta & Sincronização"
  genérico.

#### Titlebar

- **Título truncado no centro removido quando não há conversa ativa.**
  O "poderia buscar por falhas criticas no me…" que o usuário viu no
  screenshot só aparece agora se `activeConv.title` existir, e com
  `title` HTML (tooltip nativo) para ver o nome completo em hover.
- **Badges de status unificadas em `.status-pill`.** Antes havia duas
  classes divergentes (`.ollama-status` e `.provider-health`) com
  estilos inconsistentes. Agora é um único componente redondo/pill
  com três variantes (`ok`/`warn`/`err`) que usa o mesmo visual do
  resto da UI.
- Logo reusando `titlebar-logo-mark` (classe já existente no CSS),
  eliminando o `oc-logo-small` ad-hoc.

#### Sidebar

- **Indicador ativo redesenhado.** Barrinha vertical animada à
  esquerda (cubic-bezier easing) em vez de border-left estático.
  Fundo em gradient sutil esquerda→direita, não cor chapada.
- **Novo botão "Nova conversa"** com transições mais sutis (brilho +
  translateY em vez de scale agressivo) e sombra dupla camada.
- **Search input** com focus ring em accent-dim + hover state.
- Item de conversa: ícone ganha cor accent quando ativo.

#### Chat

- **Input bar**: padding interno maior (16px esquerda vs 14px),
  radius 18px, hover sutil em `bg-tertiary`, focus ring triplo
  (shadow + accent border + glow).
- **Gradient suave** no topo do input area (transição invisível do
  chat para o composer).
- **Message footer** (copy/regenerate) aparece em `:hover` da
  mensagem, não só do próprio footer — mais descobrível.
- Banner "Modo Bypass Ativo" com dot pulsante à esquerda em vez
  de ícone estático.

### Verificação

- `npm run typecheck` — 0 erros
- `npx vitest run` — 14/14 test files, 125/125 tests passing
- `npm run build` — ok

## [2.9.2] — 2026-04-17

### Fixed — Audit-fix release: correcting regressions from v2.7–v2.9

Após feedback direto do usuário ("revise todo o trabalho ficou mau feito,
feito as pressas com falhas"), um audit independente identificou 25
problemas reais introduzidos durante os Sprints 4–8. Esta versão corrige
os 9 mais críticos, todos validados com `npm run typecheck` limpo e
**125/125 testes passando** (salto de 50 → 125 ao desbloquear suites
que estavam silenciosamente falhando ao importar).

- **Cost tracking agora usa usage real do provider.** O pipeline antigo
  estimava `chars/4` a cada turno e somava a conversa inteira, causando
  double-counting grave. Agora:
  - `electron/main.js` envia `stream_options.include_usage: true` para
    OpenAI/OpenRouter/Modal, capturando o chunk final com
    `{prompt_tokens, completion_tokens}`.
  - Handler Anthropic captura `message_start.usage` + `message_delta.usage`
    e emite chunk sintético no formato OpenAI antes do `[DONE]`.
  - `useChat.ts` consome `chunk.usage` e reporta uso por turno; se o
    provider não enviar, a heurística `chars/4` aplica apenas ao turno
    atual (não re-soma o histórico).
- **Account button oculto quando Supabase não está configurado.** Era o
  exemplo dado pelo usuário — clicar mostrava um dead-end "Sincronização
  não habilitada". Agora `isSupabaseConfigured()` gate no botão.
- **Sync snapshot completo.** `snapshotProvider` ficou async e inclui
  custom profiles (`useProfiles.replaceAll`), scheduled tasks
  (`useScheduledTasks.replaceAll` com recompute de `nextRun`) e personas
  (via IPC `personaLoad`/`personaSave`). Antes só ia settings + conversas.
- **Pricing family-regex fallback.** Modelos futuros (gpt-5-turbo-2025-01,
  claude-opus-5, gemini-3.0-flash) agora caem na tier correta em vez de
  retornar `$0` silenciosamente. Prefixos locais reconhecidos
  (llama/qwen/mistral/deepseek-r1-distill/phi/gemma…) retornam `$0`
  corretamente sem warning. Modelos realmente desconhecidos logam
  warning único via `WARNED_UNKNOWN` set.
- **Fallback toast acionável.** `onProviderError` agora oferece botão
  "Trocar para X" quando há `fallbackProvider` configurado, em vez de
  apenas mostrar mensagem passiva.
- **Truncation code morto removido.** `Math.max(droppedByTokens,
  droppedByCount)` com `MAX_CONTEXT_MESSAGES=50` fazia o token-budget do
  contextEngine ser ignorado na maioria das conversas. Agora
  `droppedCount = history.length - assembled.length` vem puro do budget.
- **`getCurrentUser()` usa API pública supabase-js v2.** A implementação
  antiga chamava `(sb.auth as any).session?.()` — acessor privado da v1
  removido na v2, que sempre retornava `undefined`. Agora delega para
  `getCurrentSession()` (async).
- **`@testing-library/dom` adicionada como devDep.** No npm 7+ peers não
  são auto-instaladas — 4 suites (`useModalKeyPool`, `useProfiles`,
  `useScheduledTasks`, `useToast`) falhavam silenciosamente no import.
  Com a dep declarada, contagem de testes saltou de 50 → 125.
- **Imports lucide-react limpos.** Removidos ~12 ícones importados mas
  não usados em `App.tsx`.

### Verificação

- `npm run typecheck` — 0 erros
- `npm run build` — ok
- `npx vitest run` — 14/14 test files, 125/125 tests passing

## [2.9.1] — 2026-04-17

### Added — Sprint 8: Test coverage for Security Audit & Memory Dreaming

Sprint 8 was re-scoped from an App.tsx refactor (already completed in
prior work — App.tsx is down from 1 843 → 947 lines) to hardening
the two least-tested modules on the roadmap. Both were functional but
had zero automated coverage.

- `test/securityAudit.test.ts` — 7 tests: all-clear on pristine
  config, permission-bypass = danger, API-key-in-localStorage warning
  lists providers + counts them, high-temperature warning, long
  system-prompt info, MCP server inventory, severity ordering
  (danger < warn < info).
- `test/memoryDreaming.test.ts` — 9 tests: `calculateHealth` half-life
  math + floor clamp, `updateHealthScores` assigns health to every
  entry, `lightDream` no-op + promotion semantics, `deepDream` prunes
  low-health entries, `shouldDream` gating on unconsolidated episodes.

Combined Sprint 4-8 green tests: **50 passing** across crypto (6),
contextEngine (11), providerHealth (4), pricing (10), usageTracking
(3), securityAudit (7), memoryDreaming (9).

## [2.9.0] — 2026-04-17

### Added — Sprint 7: Usage & Cost tracking dashboard (Fase 10)

- **"Custos" tab in Analytics** — new tab beside the existing
  "Analytics" view. Shows:
  - Total cost over the last 30 days and today's cost
  - Aggregate input/output token counts
  - Bar chart of cost by provider (ordered, with call counts)
  - Bar chart of cost by model (top 10)
  - Clear-usage button + pricing-estimate disclaimer
- Labels fully translated (pt/en). Empty state when no usage recorded.
- Reuses the pre-existing `useUsageTracking` hook and `PRICING`
  table — `recordUsage` was already wired via `useChat`'s `onUsage`
  callback; this sprint surfaces the data.
- **`.analytics-tabs` styling** — tab bar with active accent,
  light-theme overrides.

### Tests

- `test/pricing.test.ts` — 10 tests: exact match, case-insensitive
  prefix match, unknown→zero, linear scaling of `calculateCost`,
  `formatCost` tier thresholds ($0.00 / sub-cent / sub-dollar / dollar).
- `test/usageTracking.test.ts` — 3 tests: aggregation by provider &
  model, 30-day window filtering, Ollama zero-cost semantics.
- Combined Sprint 4→7 green tests: **34 passing** across crypto (6),
  contextEngine (11), providerHealth (4), pricing (10),
  usageTracking (3).

## [2.8.1] — 2026-04-17

### Added — Sprint 6: Provider fallback toast & health coverage

- **Fallback suggestion toast** — when a provider trips the "down"
  threshold (5 consecutive errors), the error handler now calls
  `providerHealth.suggestFallback()` and surfaces a toast pointing the
  user at a healthy alternative. We deliberately **do not** auto-switch
  (cost safety) — the user makes the call.
- **Custom provider included in health inventory** — fixes a gap where
  a user's self-hosted endpoint wouldn't be considered a valid fallback
  target. Requires both API key and base URL to be set.
- `test/providerHealth.test.ts` — 4 new tests covering
  `getConfiguredProviders` (ollama always present, gated by keys,
  custom requires baseUrl+key) and a null-healthy `suggestFallback`.

### Notes

- `sanitizers.test.ts` (13 tests) already covered reasoning-leak
  sanitisation from v2.5. No changes needed to `StreamingSanitizer`
  itself for this sprint.

## [2.8.0] — 2026-04-17

### Added — Sprint 5: Context Engine wired into the chat loop

A formal `ContextEngine` had been defined in v2.5 but the chat loop was
still truncating by raw message count (fixed 50-message cap). That
penalised large-context models (Gemini 1M wasted) and under-protected
small ones (gpt-4 8k). This sprint wires `engine.assemble()` into the
actual request pipeline.

- **Token-budget truncation** — budget = `getModelContextLimit(model) *
  0.60`, reserving 40% headroom for the response + tools + system +
  memory injections. Walks back from the newest message accumulating
  until the budget is hit.
- **Summarisation fallback preserved** — oldest dropped messages still
  flow through `compactContext` to produce a `contextSummary` injected
  as a system message on subsequent turns.
- **Model limit table broadened** — exact match first, then prefix match
  (so `gpt-4o-2024-08-06` resolves to `gpt-4o`'s 128k). Safe 8192
  default for unknown IDs.
- **Always-keep-one invariant** — even with a tiny budget, the newest
  message is never dropped (otherwise the user's prompt would vanish).

### Tests

- `test/contextEngine.test.ts` — 11 tests covering assemble budget
  compliance, always-keep-one, token-count sums, CJK density heuristic,
  and model-limit resolution (exact / prefix / default / coverage).

## [2.7.1] — 2026-04-17

### Added

- **Custom OpenAI-compatible provider runtime** — wiring that was deferred
  in v2.6.0 is now complete. The `custom` provider now runs real traffic
  through `provider-chat`, `provider-chat-stream`, and
  `list-provider-models` IPC handlers.
  - New `parseCustomBase(baseUrl)` helper in `electron/main.js` resolves
    protocol (http vs https), hostname, port, and path prefix. LM Studio
    (`http://localhost:1234/v1`), Groq, Together, Ollama OpenAI-compat
    endpoints, and proxies all work with one setting.
  - Transport (`http` vs `https`) is selected dynamically — no more
    silent failures against local servers over HTTP.
  - `ProviderTestButton` and `useChat` now forward `customBaseUrl` on all
    3 IPC surfaces.

## [2.7.0] — 2026-04-17

### Added — Sprint 4: Accounts & Cloud Sync (zero-knowledge E2EE)

Primeira versão do sistema de contas + sincronização na nuvem, **opcional** e
**end-to-end-encrypted**. Sem conta, OpenClaude continua funcionando 100%
offline como sempre.

- **Supabase Auth** (email + password e Google OAuth via loopback PKCE).
  - `src/services/supabase.ts` — client factory com graceful degradation. Se
    `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` não forem setados no build,
    toda a feature desaparece da UI.
  - `src/services/auth.ts` — wrapper fino sobre `@supabase/supabase-js`
    (signUp, signIn, signOut, password reset, onAuthStateChange).
  - `electron/oauth-loopback.js` — servidor HTTP efêmero em
    `127.0.0.1:<porta>` implementando **RFC 8252** (OAuth 2.0 for Native
    Apps). Sem custom scheme, sem webview embarcado. Fluxo PKCE completo
    (S256 challenge) com validação de `state` contra CSRF.
- **E2EE de chaves de API** — obrigatória para sincronizar `apiKeys`.
  - `src/services/crypto.ts` — WebCrypto API puro (zero native deps).
    PBKDF2-SHA256 **600 000 iterações** (OWASP 2023) → AES-256-GCM com IV de
    12 bytes gerado por blob. Salt de 16 bytes por blob permite rotação de
    passphrase.
  - Canary blob: conteúdo conhecido encriptado com a mesma passphrase para
    validar o desbloqueio antes de tentar decriptar dados reais.
  - Passphrase vive **só em memória** — nunca no disco. Perdeu? Não há
    recuperação (essa é a garantia zero-knowledge).
- **`useAuth` / `useSync`** — hooks que isolam ciclo de vida da sessão,
  debounce de push automático, pull automático no sign-in, e estado
  `idle | syncing | error | offline | conflict`.
- **`sync_items` table + RLS** — schema genérico `(user_id, kind, payload)`
  com `kind in ('settings','profiles','personas','scheduledTasks','apiKeys','canary')`.
  Row-Level Security garante que cada usuário só lê/escreve suas próprias
  rows. Veja `supabase/migrations/001_initial.sql`.
- **AccountPanel** (`src/AccountPanel.tsx`) — botão de avatar na titlebar
  abre modal com 3 views:
  - **Auth** — tabs Entrar / Criar conta + "Continuar com Google".
  - **Passphrase** — tabs "Desbloquear existente" / "Criar nova" com
    indicador de força (weak/medium/strong) e confirmação.
  - **Dashboard** — email, meta de provedor, toggles por categoria
    (Settings, Keys E2EE, Profiles, Scheduled, Personas), botões Push/Pull
    manuais, status de sincronização, botão "Bloquear (esquecer
    passphrase)".
- **Preferências por categoria** persistidas em `localStorage`
  (`openclaude-sync-prefs`). `conversations` e `agentMemory` ficam **off by
  default** (volume + privacidade).
- **`docs/ACCOUNTS.md`** — guia completo para quem quer rodar o próprio
  backend: criar projeto Supabase, rodar a migration, configurar Google
  OAuth, buildar com credenciais. Inclui threat model explícito (o que
  protege, o que não protege).

### Tests

- `test/crypto.test.ts` — 6 testes cobrindo round-trip, passphrase errada
  (GCM auth failure), IV/salt únicos por encrypt, canary verify, rejeição
  de versão desconhecida, e `passphraseStrength`.

### Security notes

- `service_role` key **nunca** vai pro client. RLS só vale para `anon` —
  `service_role` bypassa tudo. Este é um aviso em `docs/ACCOUNTS.md`.
- localStorage do renderer é isolado graças a `contextIsolation` já
  habilitado desde v1.x — terceiros não acessam a session.

## [2.6.0] — 2026-04-17

### Added — Sprint 3: Providers Polish + Health UX

- **Aba Provedores redesenhada** — layout split view inspirado em Linear + Cherry Studio: sidebar à esquerda com lista de provedores + busca; detalhe à direita. Cada provider mostra:
  - **Health dot** colorido (🟢 healthy, 🟡 degraded, 🔴 down, ⚫ unconfigured)
  - **Badge de key ativa** quando provider está selecionado como padrão
  - **Badge de pool** (ex: `2`) quando Modal tem múltiplas keys no pool
- **`src/config/providers.ts`** — registro declarativo único fonte-da-verdade. Adicionar um novo provider = 1 entrada, zero JSX.
- **`<KeyField />`** — input password com toggle de visibilidade (👁), botão de limpar (×), e trim automático ao colar (elimina bug comum de newline na key).
- **`<ProviderTestButton />`** — botão "Testar conexão" com feedback formatado: `✓ 342 ms • 47 modelos` ou `✗ 401 Unauthorized`. Inclui ícone Zap e Loader2 animado durante o teste.
- **`<ProviderList />`** — sidebar com `role="navigation"`, `aria-current` no selecionado, `:focus-visible` ring.
- **`<ProviderDetail />`** — renderiza fields dinamicamente conforme `providers.config.ts`. Suporta botão "Usar como padrão" (estrela) que promove o provider visualizado a `settings.provider`.
- **Link "Como obter uma key"** em cada provider — abre URL da doc no navegador padrão via IPC `openTarget`.
- **Custom OpenAI-compatible provider** (7º provider) — suporta Groq, Together, Fireworks, DeepInfra e similares via `customBaseUrl`. UI completa; roteamento runtime em v2.6.1 (follow-up).

### Changed
- `Settings.tsx` de **720 → 535 linhas (-185)**. Eliminada duplicação de ~180 linhas (6 blocos `{provider === 'X' && ...}`).
- `DEFAULT_SETTINGS` ganha campos `customApiKey`, `customModel`, `customBaseUrl`, `customLabel`.
- `Provider` union passa a incluir `'custom'`.

### Fixed — Patch 2.5.1 (incluso)
- **Pool de keys Modal: cooldown separado por tipo de erro.** Antes, "Too many concurrent requests" (limite de paralelismo) era tratado igual a 429 de quota (30s de cooldown) — UX ruim pois o erro resolve em segundos. Agora:
  - `concurrent` → `COOLDOWN_CONCURRENT_MS = 5s`
  - `429` / `rate limit` / `quota` → `COOLDOWN_429_MS = 30s` (inalterado)
- Regex expandida: `/concurrent/i` tem precedência sobre `/429|rate.?limit|quota|too.?many.?request/i`.

### Testing
- Total de testes: **73 passando** (67 antes + 8 novos). Novo arquivo: `test/providers.config.test.ts` (8 casos cobrindo integridade do registro).
- Novo caso em `useModalKeyPool.test.ts`: garante cooldown de 5s para "Too many concurrent requests" (não 30s).

### Arquitetura
```
src/
├── config/
│   └── providers.ts           ← registro declarativo (1 entrada por provider)
└── components/settings/
    ├── KeyField.tsx           ← password + eye + clear + paste-trim
    ├── ProviderTestButton.tsx ← latency + error formatted
    ├── ProviderList.tsx       ← sidebar com health dots
    └── ProviderDetail.tsx     ← renderiza por config, zero duplicação
```

## [2.5.0] — 2026-04-16

### Added — Polish Sprint 2
- **Code-splitting agressivo** via `React.lazy` + `<Suspense>` para 12 painéis pesados (Analytics, ParliamentMode, PromptVault, PersonaEngine, ModelArena, CodeWorkspace, VisionMode, RAGPanel, ORION, WorkflowBuilder, ProfilesPanel, ScheduledTasksPanel). Bundle principal **1541 KB → 313 KB (-80 %)**. Fallback unificado com spinner.
- **`manualChunks` no Vite** — markdown+highlight.js (~976 KB), katex (~260 KB) e mammoth (~150 KB) isolados em chunks que cacheiam independentemente de updates do app.
- **`prefers-color-scheme` detection** — sem `openclaude-theme` salvo, o app respeita o tema do sistema na primeira abertura. Override manual continua persistindo.
- **Testes de hooks críticos** — `useToast` (9 casos), `useProfiles` (9 casos), `useScheduledTasks` (11 casos incluindo `calcNextRun` para interval/daily/weekly). Total 64 testes passando em 1.5s.
- **CI workflow quality gate** — `typecheck` + `test` + `build` rodam em Ubuntu em todo push/PR (fast path). Windows installer só roda em release/manual dispatch, com `needs: quality`. Cache de npm via `actions/setup-node@v4 cache: 'npm'`.

### Changed
- `.github/workflows/build.yml` renomeado para "CI + Windows Installer"; agora dispara em push/PR além de release.

## [2.4.0] — 2026-04-16

### Added — Polish Sprint 1
- **First-run onboarding** (`OnboardingModal`) — fluxo 3-step para novos usuários: escolha de provider (Ollama/Anthropic/OpenAI/Gemini/OpenRouter com ícone + tagline) → paste de API key + botão de **teste de conexão inline** (usa `listProviderModels`) → confirmação. Flag `oc.onboarded` em localStorage; nunca aparece de novo.
- **Toasts com severidade** (`useToast` + `<Toasts />`) — 4 níveis (success/info/warn/error) com ícone colorido, dismiss manual, suporte a `action` inline, e erros persistem até dispensa explícita. API tipada: `toast.success(msg)`, `toast.error(msg)`, etc. Posição mudou para bottom-right (padrão Linear/Vercel).
- **EmptyState reutilizável** (`<EmptyState />`) — componente unificado para todos os painéis vazios: ícone Lucide + título + body + CTA opcional. Modo `compact` para contextos inline.
- **Skeleton loaders** (`Skeleton`, `SkeletonLines`, `SkeletonMessage`, `SkeletonListItem`) — shimmer CSS com suporte a light mode, para substituir estados "pop" de listas assíncronas.
- **CopyButton** — componente self-contained com feedback visual (ícone muda para ✓ por 1.5s após clique). Substitui o botão de copy inline nas mensagens.
- **Command Palette a11y completo** — `role="combobox"` + `role="listbox"` + `role="option"` + `aria-selected` + `aria-activedescendant` + `aria-controls`. Focus ring visível (borda lateral de 3px + background) no item selecionado. Scroll automático ao navegar por teclado. `:focus-visible` global para todos os botões.

### Changed
- Toast container movido de top-right para bottom-right; animação de entrada refinada (cubic-bezier 0.16, 1, 0.3, 1).
- `msg-action-btn` agora é composto pelo `<CopyButton />` com animação de check.

### Added
- **Agent Profiles** — perfis por conversa com overrides de provider, modelo, temperatura, system prompt e permissões. 4 built-in (Coder, Writer, Analyst, Safe Mode) + criação de custom profiles. `effectiveSettings` mergeia overrides antes de `useChat`/`useProviderConfig`.
- **Scheduled Tasks** — agendamento de prompts automáticos com 3 modos (intervalo, diário, semanal). Scheduler polling 30s, startup delay 2s, floor de 1min no intervalo. Integração com Agent Profiles para perfil por tarefa.
- Ambas features acessíveis via Command Palette (`Ctrl+K`) e registradas no Feature Registry.
- Status pill na input bar mostra perfil ativo.
- **Browser nativo (Electron BrowserWindow)** — substitui Playwright (que não empacotava no .exe). Zero dependência externa, multi-tab (5), `browser_wait`, `browser_get_links`, `browser_get_forms`, `browser_screenshot` via `capturePage`, sandbox + contextIsolation.
- **Computer Use (vision-based browser)** — mesma arquitetura de Claude/Manus/Perplexity: janela de browser **visível** ao lado do app, screenshot → AI de visão → ação por coordenada. Novas tools: `browser_click_at(x,y)`, `browser_type_text`, `browser_key_press`, `browser_scroll`. `webContents.sendInputEvent()` para mouse/teclado por pixel; `webContents.capturePage()` para screenshot; evento `browser-page-loaded` reativo no renderer.
- `CONTRIBUTING.md`, `SECURITY.md` — documentação de contribuição e política de segurança.
- `.pre-commit-config.yaml` + baseline `detect-secrets` — previne commit acidental de API keys.
- Setup Vitest com testes unitários para `useModalKeyPool`, sanitizers e cooldown do pool.
- Script `npm run test` e `npm run test:watch`.

---

## [2.2.1] — 2026-04-14

### Added
- **Pool de API Keys Modal** — gerencie até 10 keys Modal em Settings; `delegate_subtasks` distribui subtarefas em paralelo, contornando o limite de 1 request concorrente do GLM-5.1.
- **Worker-pool dispatcher** — N workers paralelos (N = keys ativas) puxam de fila compartilhada; extras aguardam a primeira key livre (sem deadlock quando tasks > keys).
- **HTTPS keep-alive agent** — reutiliza conexões TLS entre subtasks (~200ms economizados após a 1ª request).
- **Fallback Ollama opcional** — se o pool esgotar, subtarefas caem per-task para o Ollama local.
- **Task Plan minimizer** — chevron no header colapsa/expande a lista com transição suave.
- Tipos IPC compartilhados (`src/types/ipc.ts`) e constantes centralizadas (`src/constants/pool.ts`).
- Script `npm run typecheck`.

### Fixed
- Streaming não vaza mais entre conversas — isolamento por `streamingConvId`.
- Criar novo chat durante streaming anterior não bloqueia mais o input.
- System prompt agora reflete o provider selecionado (não fica travado em "Ollama").
- `catch {}` vazios em `electron/main.js` agora logam o erro.
- `sendingRef` resetado em `stopAgent` (antes bloqueava o chat permanentemente).
- HTTP status check em cloud providers antes de processar streaming.
- `isSmallModel()` não classifica mais modelos cloud (GPT/Claude/Gemini/DeepSeek) como "small".
- Path sandboxing em `read-file` / `write-file` via `isPathSafe()`.

### Changed
- `useModalKeyPool` trocou polling (150ms) por event-driven waiters — keys liberam sem latência extra.
- Validação mínima de key (≥20 chars) antes de entrar no pool.
- Refs (`useRef`) adotados em `useChat`, `useToolExecution`, `useConversationFork` — previne stale closures.

---

## [2.2.0] — 2026-04-13

### Added
- **Arquitetura baseada em hooks** — `App.tsx` caiu de 1843 → 686 linhas via 5 hooks: `useProviderConfig`, `useVoice`, `useConversations`, `useToolExecution`, `useChat`.
- **Provider Health Monitor** — rastreia status (healthy/degraded/down) com auto-recovery, detecção de rate limit, indicador visual no titlebar.
- **Reasoning Leak Sanitizer** — remove blocos `<think>`, `<reasoning>`, `[thinking]` de DeepSeek, Qwen e similares (streaming e non-streaming).
- **Context Engine** — sistema formal de token budget com limites por modelo; contador em tempo real (warning a 80%, crítico a 95%).
- **Usage & Cost Tracking** — contagem de tokens por provider/modelo + estimativa de custo; tabela de preços para 30+ modelos.
- **Memory Dreaming** — consolidação de memória em background: light dreaming (2h), deep dreaming (prune + dedup); scores com decaimento temporal.
- **Feature Registry** — toggles em `src/config/features.ts`.
- **Security Audit** — Command Palette → "Security Check" varre permission bypass, API keys expostas, temperatura alta, etc.

---

## [2.1.0] — 2026-04-11

### Added
- **Command Palette** (`Ctrl+K`) — busca fuzzy de features, tools, permissions, settings; agrupada por categoria.
- **Clean Input Bar** — botão `+` abre Command Palette em vez de dropdown poluído.
- **Modularização** — extração de `src/types/`, `src/constants/`, `src/utils/`.

### Fixed
- `fetchedModels` em cache por provider.
- `fetchError` exibido de forma consistente entre providers.
- Declarações TypeScript faltantes (`openFileDialog`, `readDocument`, `loadAgentMemory`, `saveAgentMemory`).

---

## [2.0.0] — 2026-04-10

### Added
- **Image Upload + Vision** — anexe imagens via botão ou drag-and-drop; base64 → qualquer provider com visão (GPT-4o, Gemini Vision, Claude, llava).
- **PDF/DOCX Parsing** — solte arquivos `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.csv` (via `pdf-parse` / `mammoth`, limite 20 MB).
- **Conversation Branching (Fork)** — clone uma conversa até qualquer mensagem em uma nova branch com metadata `forkedFrom`.
- **Agent Memory Persistence** — memória de trabalho persiste entre sessões.

---

## [1.9.0] — 2026-04-10

### Added
- Renderização LaTeX (`marked-katex-extension`).
- Contador de tokens na UI.
- Aba MCP Settings com add/remove de servidor.

---

## [1.8.0] — 2026-04-10

### Added
- **Tier 1+2+3**: Prompt Vault, Persona Engine, Model Arena, Code Workspace, Vision Mode, RAG Local, Workflow Builder, ORION.

---

## [1.7.0] — 2026-04-10

### Added
- **Parliament Mode** — 5 agentes especialistas (Architect, Implementor, Security, Tester, Devil's Advocate) debatem em paralelo; Coordenador sintetiza o veredito.

---

## [1.6.0] — 2026-04-10

### Added
- Paridade total de providers: OpenAI, OpenRouter, Modal, Anthropic com streaming palavra-a-palavra.
- Redesign visual: labels amigáveis, toolbar limpo, empty state moderno.

### Changed
- Eventos SSE Anthropic normalizados para o formato de chunk OpenAI.

---

## [1.5.6] — 2026-04-09

### Added
- Avisos de segurança para operações arriscadas.
- Hostname Modal configurável (overrides regionais).

---

## [1.5.0] — 2026-04-09

### Added
- Robustness & Safety Engine — circuit breaker, tratamento gracioso de erros.

---

## [1.4.1] — 2026-04-08

### Added
- **Unlimited Agent Mode** — removido cap artificial de steps.

### Fixed
- Bug de `finish_reason`.

---

## [1.4.0] — 2026-04-08

### Added
- **Self-Evolution Architecture (MCD/MAGI/MASA)** — loops de auto-melhoria baseados em analytics.

---

## [1.3.0] — 2026-04-08

### Added
- **Tier 3**: Task Planner, Browser automation, suporte MCP, Parallel Agents, Voice (TTS/STT).

---

## [1.2.x] — 2026-04-08

### Added
- Multi-provider (OpenAI, Gemini, Anthropic, OpenRouter).
- Tema Dark/Light.
- Message actions (copy, regenerate, edit).
- Enforcement de idioma em 4 camadas (PT/EN).
- Circuit breaker e detecção de modelo pequeno.

---

## [1.0.1] — 2026-04-07

### Added
- Release público inicial — app Electron para Ollama com streaming, edição de system prompt e histórico de conversas.

---

[Unreleased]: https://github.com/mrtjr/openclaude-desktop/compare/v2.2.1...HEAD
[2.2.1]: https://github.com/mrtjr/openclaude-desktop/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/mrtjr/openclaude-desktop/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/mrtjr/openclaude-desktop/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.9.0...v2.0.0
[1.9.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.5.6...v1.6.0
[1.5.6]: https://github.com/mrtjr/openclaude-desktop/compare/v1.5.0...v1.5.6
[1.5.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/mrtjr/openclaude-desktop/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/mrtjr/openclaude-desktop/compare/v1.2.4...v1.3.0
[1.2.x]: https://github.com/mrtjr/openclaude-desktop/compare/v1.0.1...v1.2.4
[1.0.1]: https://github.com/mrtjr/openclaude-desktop/releases/tag/v1.0.1
