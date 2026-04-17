# Changelog

Todas as mudanças notáveis do **OpenClaude Desktop** são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
o projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

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
