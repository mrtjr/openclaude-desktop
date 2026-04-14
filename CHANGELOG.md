# Changelog

## v2.2.1 — Patch de Estabilidade (2026-04-13)

### Bug Fixes Criticos

- **Chat sem resposta (regressao v2.2.0):** Corrigido handler de streaming que verificava `chunk.done` antes de `chunk.error`, engolindo erros silenciosamente e deixando o chat sem resposta
- **Stop Agent bloqueava chat permanentemente:** `stopAgent` nao resetava `sendingRef`, fazendo com que apos pressionar Stop, nenhuma mensagem futura pudesse ser enviada
- **Crash na inicializacao (`SyntaxError: Identifier 'os' already declared`):** Removido `require('os')` duplicado em main.js

### Correcoes de Closures Stale (React Hooks)

- **useChat.ts:** Adicionado padrao `useRef` para `onProviderSuccess`, `onProviderError`, `onUsage` e `activeConvId` — previne callbacks com valores desatualizados
- **useToolExecution.ts:** `activeConvId` agora usa ref em vez de captura direta no closure do `useCallback`
- **useConversationFork.ts:** Trocado `conversations` (stale) por `conversationsRef` (sempre atualizado)
- **App.tsx:** `handleSend` e `regenerateResponse` agora usam `sendMessageRef` para evitar closures stale

### Robustez do Backend (main.js)

- **HTTP status check:** Ollama e cloud providers agora verificam status >= 400 antes de processar streaming
- **Timeouts:** Ollama 120s, cloud providers 60s (streaming e non-streaming)
- **Path sandboxing:** `read-file` e `write-file` agora validam caminhos com `isPathSafe()`
- **IPC modules carregados:** `ipc-agent-memory.js` e `ipc-document.js` agora sao `require()`'d corretamente
- **Anthropic error events:** Handler para `evType === 'error'` no streaming Anthropic
- **Stream abort:** Separado `activeOllamaStream` / `activeProviderStream` para abort preciso
- **Catch blocks:** Todos os `catch {}` vazios substituidos por `console.error()` com contexto

### Correcoes de Logica

- **`isSmallModel()`:** Modelos cloud (GPT, Claude, Gemini, DeepSeek) nao sao mais classificados como "small"; modelos sem indicador de tamanho assumem "nao-small" em vez de "small"
- **`getRelativeTime()`:** Corrigido plural — "ha 1 meses" → "ha 1 mes", "ha 1 dias" → "ontem"
- **`delegate_subtasks`:** Model fallback corrigido de `settings.openaiModel` para `selectedModel || 'llama3'` (usa Ollama, nao OpenAI)
- **`browser_navigate`:** Tenta navegar primeiro, so lanca browser se falhar (antes lancava sempre)
- **`useTokenCounter`:** Dependencia corrigida de `messages?.length` para `messages` (detecta mudancas no conteudo)
- **`useConversations`:** Adicionado `saveNow()` para save imediato; `exportConversation` agora inclui working memory e task plan

### Melhorias de UX

- **Streaming cleanup:** `useEffect` cleanup remove listener de stream no unmount
- **`processToolCalls`:** Recebe `convId` como parametro explicito em vez de capturar do closure

---

## v2.2.0 — Refatoracao de Hooks (2026-04-12)

- Extracao de hooks: `useChat`, `useToolExecution`, `useConversations`, `useTokenCounter`, `useConversationFork`
- Extracao de utilitarios: `src/utils/formatting.ts`
- Reducao de ~500 linhas em App.tsx

## v2.1.0

- Agent mode com tool execution
- Provider multi-backend (Ollama, OpenAI, Anthropic, Gemini, OpenRouter)
- Task planning system
- Browser automation tools
- Analytics dashboard
