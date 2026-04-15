# Changelog

Todas as mudanças notáveis do **OpenClaude Desktop** são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
o projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added
- **Agent Profiles** — perfis por conversa com overrides de provider, modelo, temperatura, system prompt e permissões. 4 built-in (Coder, Writer, Analyst, Safe Mode) + criação de custom profiles. `effectiveSettings` mergeia overrides antes de `useChat`/`useProviderConfig`.
- **Scheduled Tasks** — agendamento de prompts automáticos com 3 modos (intervalo, diário, semanal). Scheduler polling 30s, startup delay 2s, floor de 1min no intervalo. Integração com Agent Profiles para perfil por tarefa.
- Ambas features acessíveis via Command Palette (`Ctrl+K`) e registradas no Feature Registry.
- Status pill na input bar mostra perfil ativo.
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
