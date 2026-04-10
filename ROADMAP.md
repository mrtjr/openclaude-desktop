# 🗺️ OpenClaude Desktop — Roadmap

> **Versão atual:** `v1.9.0`

---

## ✅ v1.9.0 — Concluído

### 🟢 Fácil (Tier 1)

| Item | Implementação |
|------|---------------|
| **Renderização LaTeX** | `marked-katex-extension` integrado ao pipeline `marked` em `App.tsx`; detecta `$...$` (inline) e `$$...$$` (bloco) |
| **Contagem precisa de tokens** | `tiktoken` (OpenAI) + `@anthropic-ai/tokenizer`; contador ao vivo no rodapé do chat; troca automática por provider |
| **Interface MCP no Settings** | Aba MCP em `Settings.tsx`; adicionar/remover servidores via IPC sem editar JSON |

### 🟡 Médio (Tier 2)

| Item | Implementação |
|------|---------------|
| **Upload de imagem + Visão** | `useImageAttachment` hook; botão 📎 no chat; base64 via `read-document` IPC; compatível com GPT-4o, Claude, Gemini Vision e llava/Ollama |
| **Parsing PDF/DOCX** | `ipc-document.js` no processo main; `pdf-parse` para PDF, `mammoth` para DOCX; exposto via `read-document` e `open-file-dialog` IPC; injetado no contexto do chat |
| **Bifurcação de conversas** | `useConversationFork` hook; botão "⎇ Fork aqui" em cada mensagem; clona mensagens [0…N]; nova conversa com metadado `forkedFrom` |
| **Memória do agente entre sessões** | `useAgentMemory` hook; `ipc-agent-memory.js` no processo main; `agent-memory.json` em userData; `buildMemoryContext()` injetado no system prompt; aba "Memória" em Settings via `AgentMemoryPanel.tsx` |

---

## 🔵 Backlog

### Tier 1 — Alta prioridade

| Item | Estratégia sugerida |
|------|---------------------|
| Exportar conversa como PDF | `electron-pdf` ou `puppeteer`; botão na toolbar |
| Busca full-text em conversas | índice simples em memória; atalho `Ctrl+F` |
| Atalhos de teclado customizáveis | mapa configurável em Settings + `globalShortcut` |

### Tier 2 — Médio prazo

| Item | Estratégia sugerida |
|------|---------------------|
| Plugin system | API de plugins via módulos CommonJS carregados dinamicamente |
| Builds Linux / macOS | GitHub Actions matrix com `electron-builder` |
| Themes customizáveis | CSS variables exportadas; editor visual em Settings |

### Tier 3 — Exploração

| Item | Estratégia sugerida |
|------|---------------------|
| Marketplace de personas | JSON hospedado + fetch; instalação com um clique |
| Colaboração multi-usuário | WebRTC ou WebSocket com sala de sessão |
| Integração VS Code | extensão que chama o app via IPC ou socket local |

---

## 📋 Histórico de Versões

| Versão | Destaques |
|--------|-----------|
| v1.9.0 | LaTeX, token counter, MCP UI, image upload, PDF/DOCX, conversation fork, agent memory |
| v1.8.0 | Parliament Mode, RAG Local, ORION Computer Control, Workflow Builder, Model Arena |
| v1.7.0 | Provider streaming (OpenAI/Anthropic/Gemini), Vision Mode, Code Workspace |
| v1.6.0 | Prompt Vault, Persona Engine, Analytics (MCD/MAGI/MASA), Audit Log |
| v1.5.0 | MCP Client, Browser Automation (Playwright), Parallel Agents |
| v1.4.0 | Multi-provider (OpenAI, Gemini, Anthropic, OpenRouter, Modal) |
| v1.3.0 | Compaction de contexto, DuckDuckGo search, Git integration |
| v1.2.0 | Tray, auto-start, snapshot/undo para edição de arquivos |
| v1.1.0 | Conversations persistence, dark mode, token counter básico |
| v1.0.1 | Hotfix frame/crash inicial |
| v1.0.0 | Release inicial — Ollama local, chat, tool use |
