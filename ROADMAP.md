# 🗺️ OpenClaude Desktop — Roadmap

## ✅ v1.9.0 — Quality of Life (Entregue · Abril 2026)

Todos os itens abaixo foram implementados e estão disponíveis na versão estável `v1.9.0`.

| Item | Estratégia | Status |
|------|-----------|--------|
| **Renderização LaTeX** | `marked-katex-extension` integrado ao pipeline `marked` em `App.tsx`; detecta `$...$` (inline) e `$$...$$` (bloco); CSS KaTeX carregado automaticamente | ✅ Concluído |
| **Contagem precisa de tokens** | `tiktoken` (`cl100k_base` / `o200k_base`) para modelos OpenAI-family; `@anthropic-ai/tokenizer` para Claude; contador ao vivo no rodapé do chat, troca de tokenizer automática ao mudar de provider | ✅ Concluído |
| **Interface MCP no Settings** | Aba **MCP** adicionada em `Settings.tsx`; lista visual dos servidores configurados; adicionar/remover entradas (nome + comando) via IPC, sem edição manual de JSON | ✅ Concluído |

---

## 🔵 Próximas Versões — Backlog

### Tier 1 — Alta Prioridade

| Item | Descrição |
|------|-----------|
| Upload de imagens | Suporte a arrastar e soltar imagens no chat para modelos com visão |
| Parsing PDF/DOCX | Indexar documentos para uso como contexto RAG |
| Conversation branching | Bifurcar o histórico a partir de qualquer mensagem |

### Tier 2 — Médio Prazo

| Item | Descrição |
|------|-----------|
| Plugin system | API pública para extensões de terceiros |
| Linux & macOS builds | Suporte a `electron-builder` em outros sistemas |
| Agent memory persistence | Memória de longo prazo entre sessões |

### Tier 3 — Ideias / Exploração

| Item | Descrição |
|------|-----------|
| Marketplace de personas | Comunidade de personas compartilhadas |
| Colaboração multi-usuário | Chat compartilhado com agentes distribuídos |
| Integração com VS Code | Extensão para usar o OpenClaude dentro do editor |

---

## 📋 Histórico de Versões

| Versão | Data | Destaque |
|--------|------|---------|
| v1.9.0 | Abril 2026 | LaTeX rendering, token counting, MCP Settings UI |
| v1.8.0 | 2025 | Prompt Vault, Persona Engine, Model Arena, Code Workspace, Vision Mode, RAG Local, Workflow Builder, ORION |
| v1.7.0 | 2025 | Parliament Mode (multi-agent debate + coordinator) |
| v1.6.0 | 2025 | Full provider parity (Gemini/Anthropic/OpenAI streaming + agent mode) |
| v1.5.0 | 2025 | Robustness Engine, Tool Permissions, File Snapshots, Git Tool, Audit Log |
| v1.4.0 | 2025 | Self-Evolution Analytics (MCD/MAGI/MASA) |
| v1.3.0 | 2025 | Playwright Browser Automation, MCP Client, Voice I/O, Parallel Agents |
| v1.0.1 | 2025 | Initial Release |
