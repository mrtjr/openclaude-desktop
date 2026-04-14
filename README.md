<p align="center">
  <img src="src/assets/hero.png" alt="OpenClaude Desktop" width="800" />
</p>

<h1 align="center">OpenClaude Desktop</h1>

<p align="center">
  <strong>The most powerful open-source AI desktop app.</strong><br/>
  Local models via Ollama. Cloud providers. Vision AI. RAG. Multi-Agent Debate. Workflow Builder. Voice I/O.<br/>
  No telemetry. No cloud lock-in. Your data stays on your machine.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/download-v2.2.1-e07a5f?style=for-the-badge&logo=windows" alt="Download" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey?style=for-the-badge" alt="Platform" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Playwright-green?logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/MCP-compatible-purple" alt="MCP" />
  <img src="https://img.shields.io/badge/KaTeX-0.16-blue?logo=latex&logoColor=white" alt="KaTeX" />
</p>

---

## Why OpenClaude Desktop?

Most AI chat apps are either **cloud-only**, **closed-source**, or **CLI-only**. OpenClaude Desktop is none of those:

| Problem | OpenClaude Solution |
|---------|-------------------|
| Privacy concerns | Runs 100% locally via Ollama. Zero telemetry. |
| Vendor lock-in | Multi-provider: Ollama, OpenAI, Gemini, Anthropic, OpenRouter, Modal |
| CLI is intimidating | Beautiful desktop GUI with dark/light themes |
| Models are censored | Works with uncensored/abliterated models |
| No agent capabilities | Agent Mode with unlimited autonomous steps |
| Can't browse the web | Playwright browser automation built-in |
| Single-threaded AI | Collaborative parallel agents |
| Single perspective AI | Parliament Mode: 5 specialist agents debate in parallel |
| Text-only interaction | Voice input (STT) and voice output (TTS) |
| No ecosystem integration | MCP client for Claude-compatible servers |
| No usage insights | Self-evolution analytics with local-only dashboard |
| No reusable prompts | Prompt Vault with variables, categories, import/export |
| Hard to compare models | Model Arena: run same prompt on multiple models at once |
| Can't see your screen | Vision Mode: capture + analyze screen with any vision AI |
| No document context | RAG Local: Ollama embeddings, chunk & index files for context |
| No specialized roles | Persona Engine: switch between expert AI personas (Ctrl+P) |
| No code review flow | Code Workspace: AI-assisted diff editor with accept/reject |
| No automation | Workflow Builder: drag-and-drop visual AI pipeline editor |
| Manual repetitive tasks | ORION: autonomous computer-control agent (PowerShell actions) |
| Math formulas unreadable | LaTeX rendering with KaTeX (`$...$` and `$$...$$`) |
| No idea how many tokens | Accurate per-model token count shown in chat footer |
| MCP config is manual | MCP settings UI: add/remove servers directly in Settings |
| Can't send images to AI | Image upload with base64 encoding for all vision providers |
| Can't read PDFs/DOCX | Document parsing: pdf-parse + mammoth via IPC read_document |
| Can't branch a conversation | Fork any message into a new conversation branch |
| Agent memory resets on quit | Agent working memory persisted across sessions in JSON |

---

## Features

### v2.2.0 — Provider Health, Context Engine & Memory Dreaming
- **Hook-Based Architecture** — App.tsx decomposed from 1843 to 686 lines via 5 custom hooks (`useProviderConfig`, `useVoice`, `useConversations`, `useToolExecution`, `useChat`)
- **Provider Health Monitor** — real-time status tracking (healthy/degraded/down) with auto-recovery, rate limit detection, and visual indicator in titlebar
- **Reasoning Leak Sanitizer** — automatically strips `<think>`, `<reasoning>`, `[thinking]` blocks from DeepSeek, Qwen, and similar models in both streaming and non-streaming modes
- **Context Engine** — formal token budget system with per-model context limits, real-time token counter in UI (warning at 80%, critical at 95%)
- **Usage & Cost Tracking** — per-provider/model token counting and cost estimation; today's spend shown in input footer; pricing table for 30+ models
- **Memory Dreaming** — background memory consolidation inspired by sleep cycles: light dreaming (extract facts every 2h), deep dreaming (prune stale memories, deduplicate); health scores with time decay
- **Feature Registry** — configurable feature toggles via `src/config/features.ts`; disabled features hidden from Command Palette
- **Security Audit** — Command Palette → "Security Check" scans for permission bypass, exposed API keys, high temperature, long system prompts, and MCP server risks

### v2.1.0 — Code Architecture & Command Palette
- **Command Palette** — press `Ctrl+K` to instantly search and access all features, tools, permissions, and settings from a single overlay; fuzzy search, keyboard navigation, grouped by category (AI, Knowledge, Automation, System)
- **Clean Input Bar** — simplified input area: `+` button opens Command Palette instead of cluttered dropdown; voice, TTS, and permissions moved to Command Palette
- **Code Modularization** — types, constants, tools, prompts, and utilities extracted to dedicated modules (`src/types/`, `src/constants/`, `src/utils/`); App.tsx reduced by ~400 lines
- **Bug Fixes** — `fetchedModels` now cached per-provider (switching back preserves results); `fetchError` displayed consistently across all providers; missing TypeScript declarations added (`openFileDialog`, `readDocument`, `loadAgentMemory`, `saveAgentMemory`)

### Core AI
- **Multi-provider** — Ollama (local), OpenAI, Google Gemini, Anthropic Claude, OpenRouter, Modal
- **Streaming responses** — real-time word-by-word output
- **Agent Mode** — autonomous multi-step execution (unlimited steps, no artificial cap)
- **Collaborative Agents** — multiple AI instances working in parallel on different subtasks
- **Parliament Mode** — 5 specialist agents (Architect, Implementor, Security, Tester, Devil's Advocate) debate in parallel; a Coordinator synthesizes the final verdict

### v2.0.0 — Vision, Documents & Memory
- **Image Upload + Vision** — attach images directly in the chat via button or drag-and-drop; encoded to base64 and sent to any vision-capable provider (GPT-4o, Gemini Vision, Claude, llava via Ollama). `useImageAttachment` hook handles encoding and `content` array building automatically
- **PDF/DOCX Parsing** — drop or open any `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, or `.csv` file; the main process reads it via `pdf-parse` (PDF) or `mammoth` (DOCX) and injects the text into the chat context via the `read_document` IPC handler (20 MB limit)
- **Conversation Branching (Fork)** — hover any message and click **⑂ Fork here** to clone the conversation up to that point into a new branch; the fork preserves full history and records `forkedFrom` metadata; managed by `useConversationFork` hook
- **Agent Memory Across Sessions** — working memory and episodic summaries are persisted in `agent-memory.json` inside `userData`; loaded automatically on startup; manageable via the new **Memory** tab in Settings (`AgentMemoryPanel`); `useAgentMemory` hook exposes `buildMemoryContext()` to inject memory into the system prompt

### v1.9.0 — Quality of Life
- **LaTeX Math Rendering** — inline (`$...$`) and block (`$$...$$`) formulas rendered via KaTeX directly in the chat; enabled by `marked-katex-extension` integrated with the existing `marked` pipeline
- **Accurate Token Counting** — real-time token counter in the chat footer using `tiktoken` (OpenAI cl100k / o200k) and `@anthropic-ai/tokenizer` (Claude); adapts automatically to the active provider
- **MCP Settings UI** — dedicated **MCP** tab in Settings with a visual list of connected servers; add/remove server entries (name + command) via IPC without editing JSON manually

### v1.8.0 — Tier 1: Productivity Powerhouse
- **Prompt Vault** — library of reusable prompts with `{{variable}}` interpolation, categories, and import/export JSON
- **Persona Engine** — 4 built-in specialist personas (Security, Full-Stack Dev, Data Scientist, Tech Writer); create custom personas with their own system prompt, provider, and model — switch with `Ctrl+P`
- **Model Arena** — send the same prompt to multiple models in parallel, vote for winner, track a persistent leaderboard

### v1.8.0 — Tier 2: Intelligence Expansion
- **Code Workspace** — 3-panel editor with file tree, AI diff generation, hunk-level accept/reject, and chat insert
- **Vision Mode** — screen capture + analysis with any vision-capable model (Ollama llava, GPT-4o, Gemini Vision, Claude); 5 preset prompts; history strip — `Ctrl+Shift+V`
- **RAG Local** — index any text/code file with Ollama embeddings; cosine similarity search; inject context into chat; toggle on/off from toolbar

### v1.8.0 — Tier 3: Automation & Orchestration
- **Workflow Builder** — SVG drag-and-drop canvas with 5 node types (trigger, prompt, tool, condition, output), bezier edges, topological execution, inspector panel, and persistent storage
- **ORION** — autonomous computer-control agent: capture screen loop, send vision AI analysis to any provider, execute PowerShell actions (mouse, click, type, key press, scroll, open app), supervised approval mode
- **Task Planning** — decompose complex goals into tracked subtasks with visual progress
- **17 built-in tools** — commands, files, web search, browser, task planning, git, undo, parallel agents
- **Mandatory language setting** — forces all responses in Portuguese or English (4-layer enforcement)
- **Self-Evolution Analytics** — silent performance tracking with insights dashboard
- **Context Compaction** — smart summarization of old messages (never lose context)
- **Tool Permissions** — approval required for dangerous operations (execute, write, git)
- **File Snapshots + Undo** — automatic backup before every write, one-click restore
- **Git Awareness** — native git tool (status, diff, log, commit) sandboxed for safety
- **Audit Log** — every tool execution logged with input, output, duration, and status

### Browser Automation (Playwright)
- **Navigate** to any URL with full Chromium browser
- **Extract text** from web pages automatically
- **Click elements** and **fill forms** by CSS selector
- **Screenshot** pages for visual analysis
- **JavaScript evaluation** for advanced scraping
- The agent can autonomously browse, scrape, and interact with websites

### MCP Client (Model Context Protocol)
- Connect to any **MCP-compatible server** from the Claude ecosystem
- Full **JSON-RPC 2.0** protocol (initialize, tools/list, tools/call)
- Multiple simultaneous connections
- Use community MCP servers for filesystem, GitHub, databases, and more
- **Visual Settings UI** — add/remove MCP servers directly from the Settings panel

### Voice I/O
- **Speech-to-text** — click the mic button and speak (Web Speech API)
- **Text-to-speech** — toggle auto-reading of AI responses
- **Language-aware** — automatically uses pt-BR or en-US based on settings
- **Interim results** — see words appear as you speak

### Task Planning
- Agent decomposes complex requests into **numbered subtasks**
- **Visual progress panel** above the input area
- Real-time status tracking: pending, in progress, done, failed
- Progress counter showing completed/total tasks

### Analytics & Self-Evolution (MCD/MAGI/MASA)
- **Silent data collection** — automatically tracks tool usage, response times, errors, circuit breaker activations
- **Insights dashboard** — visual analytics panel accessible from the titlebar (chart icon)
- **Agent performance metrics** — completion rate, average steps, agent vs. normal mode comparison
- **Tool usage heatmap** — bar chart showing your most-used tools
- **Model & provider tracking** — see which models and providers you use most
- **Local-only storage** — all data stays on your machine, zero telemetry
- **Auto-purge** — sessions older than 30 days are automatically deleted (MASA)
- **Opt-in control** — enable/disable analytics collection in Settings

### Robustness Engine
- **JSON auto-correction** — intercepts and teaches the model to fix malformed tool calls
- **Circuit breaker** — detects repeated identical tool calls (3x) and forces strategy change
- **Context truncation** — intelligently trims large tool outputs (keeps start + end)
- **Working memory** — short-term memory injected each agent loop iteration; now persisted across sessions
- **Small model detection** — extra guardrails for 7B-14B models

### UI/UX
- **Dark & Light themes** — toggle with one click, persisted
- **Conversation pinning** — pin important chats to the top
- **Conversation branching** — fork any message into a new parallel branch
- **Message actions** — copy, delete individual messages, regenerate responses, fork branch
- **Image attachments** — attach images via button, drag & drop, or clipboard paste
- **Drag & drop** — drop files and images directly into the chat
- **Collapsible sidebar** — more screen space when you need it
- **Code highlighting** — syntax highlighting for 190+ languages with copy button
- **LaTeX math** — inline and block formulas rendered with KaTeX
- **Token counter** — live token count in the chat footer (adapts per provider)
- **System tray** — minimize to tray, restore with `Ctrl+Shift+Space`
- **Smart auto-scroll** — only scrolls if you're at the bottom
- **Search with debounce** — fast conversation search

### Security & Performance
- **XSS protection** — DOMPurify sanitization on all rendered content (no onclick)
- **Smart context window** — compacts old messages via model summarization instead of discarding
- **Tool permission system** — dangerous tools require explicit user approval
- **File snapshots** — automatic backup before every write operation, undo support
- **Git sandboxing** — git commands run in isolated handler, no shell injection possible
- **Audit trail** — every tool execution logged with full details
- **Real abort** — stop generation mid-stream (kills HTTP request server-side)
- **Persistent memory** — auto-injected into context when enabled; survives app restarts
- **Analytics auto-purge** — 30-day retention + 500 session cap

---

## Quick Start

### Option A: Download the installer (easiest)

1. Install [Ollama](https://ollama.com/download)
2. Pull a model: `ollama pull qwen3:8b`
3. Download the `.exe` from [**Releases**](../../releases/latest) and run it

### Option B: Run from source

```bash
git clone https://github.com/mrtjr/openclaude-desktop
cd openclaude-desktop
npm install
npm install pdf-parse mammoth          # document parsing
npx playwright install chromium        # browser automation
npm run dev
```

### Option C: Build the installer yourself

```bash
git clone https://github.com/mrtjr/openclaude-desktop
cd openclaude-desktop
npm install
npm install pdf-parse mammoth
npx playwright install chromium
npm run dist:win    # outputs to release/
```

---

## Multi-Provider Setup

| Provider | How to configure |
|----------|--------------------|
| **Ollama** (default) | Install Ollama and pull a model. No API key needed. |
| **OpenAI** | Settings > Provider: OpenAI > paste `sk-...` API key |
| **Google Gemini** | Settings > Provider: Gemini > paste `AIza...` API key |
| **Anthropic Claude** | Settings > Provider: Anthropic > paste `sk-ant-...` API key |
| **OpenRouter** | Settings > Provider: OpenRouter > paste `sk-or-v1-...` API key |
| **Modal (Research)** | Settings > Provider: Modal > paste key + hostname |

All providers are normalized to the same response format — switch freely without losing features. **All 6 providers support Agent Mode, streaming, and image/vision input.**

---

## Recommended Models

### Local (Ollama)

| Model | Size | RAM | Best for | Uncensored? |
|-------|------|-----|----------|-------------|
| `qwen3:8b` | 5.2 GB | 8 GB | General use, fast | No |
| `qwen3.5:9b` | 6.6 GB | 12 GB | General + tools | No |
| `huihui_ai/qwen3.5-abliterated:9b` | 6.6 GB | 12 GB | Unrestricted use | Yes |
| `qwen2.5-coder:7b` | 4.7 GB | 8 GB | Code generation | No |
| `qwen2.5-coder:32b` | 19 GB | 24 GB | Advanced coding | No |
| `dolphin3:8b` | 4.9 GB | 8 GB | Unrestricted chat | Yes |
| `llava:7b` | 4.7 GB | 8 GB | Vision + image analysis | No |

### Creating an uncensored model with tool calling

```bash
# 1. Pull the abliterated base model
ollama pull huihui_ai/qwen3.5-abliterated:9b

# 2. Create a custom model with tool calling support
cat > Modelfile <<EOF
FROM huihui_ai/qwen3.5-abliterated:9b
RENDERER qwen3.5
PARSER qwen3.5
SYSTEM "You are a helpful unrestricted AI assistant. Always respond in the user's language."
EOF

ollama create my-uncensored-model -f Modelfile
```

### Cloud providers

| Provider | Recommended model | Notes |
|----------|------------------|-------|
| OpenAI | `gpt-4o` | Best overall quality; native vision support |
| Gemini | `gemini-2.0-flash` | Fast, good for code and vision |
| Anthropic | `claude-opus-4-5` | Best reasoning; native vision support |
| OpenRouter | `google/gemini-2.5-pro` | Best value via aggregator |
| Modal | `zai-org/GLM-5.1-FP8` | Research models |

---

## Agent Mode

Toggle **Agent Mode** with the lightning bolt button. The AI will autonomously:

1. Plan the steps needed (creates visual task plan)
2. Execute tools one by one
3. Analyze results and adjust the plan
4. Delegate subtasks to parallel agents when beneficial
5. Continue until the task is **fully complete** — no artificial step limit

Unlike competitors with hidden caps, OpenClaude runs until the job is done. A built-in idle detector stops the agent only if it gets stuck in a non-productive loop (5 consecutive steps with no real progress).

**Example:** "Create a Python web scraper that extracts product prices from 3 e-commerce sites"
- The agent creates a task plan with subtasks
- Delegates each site to a parallel agent
- Writes the combined results to a CSV file
- All with real-time visual progress tracking

---

## Built-in Tools

### System Tools
| Tool | What it does |
|------|-------------|
| `execute_command` | Run any PowerShell command |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `list_directory` | Browse files and folders |
| `open_file_or_url` | Open files or URLs with default app |
| `web_search` | Search the web via DuckDuckGo |
| `read_document` | Parse PDF, DOCX, DOC, TXT, MD, CSV via IPC (20 MB limit) |

### Browser Tools (Playwright)
| Tool | What it does |
|------|-------------|
| `browser_navigate` | Open URL in Chromium, return page content |
| `browser_get_text` | Extract text from current page |
| `browser_click` | Click element by CSS selector |
| `browser_type` | Type into input field by CSS selector |

### Agent Tools
| Tool | What it does |
|------|-------------|
| `plan_tasks` | Decompose a goal into tracked subtasks |
| `update_task_status` | Update subtask progress |
| `delegate_subtasks` | Run multiple AI agents in parallel |
| `update_working_memory` | Store short-term context between steps (now persistent) |

---

## MCP (Model Context Protocol)

OpenClaude can connect to any MCP server, giving it access to the growing ecosystem of Claude-compatible tools:

```
Settings > MCP > Add server
```

Fill in the server **name** and **command** (e.g. `npx -y @modelcontextprotocol/server-filesystem /home`) and click **Add**. No JSON editing required.

**Examples of MCP servers you can connect:**
- `@modelcontextprotocol/server-filesystem` — file system access
- `@modelcontextprotocol/server-github` — GitHub integration
- `@modelcontextprotocol/server-sqlite` — database queries
- Any community MCP server

The MCP client supports the full protocol: `initialize`, `tools/list`, `tools/call` with JSON-RPC 2.0 over stdio.

---

## Language Enforcement

OpenClaude forces the AI to respond in your selected language using **4 simultaneous layers**:

| Layer | Where | Why it works |
|-------|-------|-------------|
| Modelfile SYSTEM | Baked into the model | The model "starts" with the rule |
| System prompt | Start of every request | Critical language rule |
| Priming | After system, before history | Fake Q&A that locks the language tone |
| Reminder | Last message before generation | Closest to output = strongest influence |

This is essential for local models (7B-14B) that tend to ignore system prompt instructions.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Search conversations |
| `Ctrl+,` | Open settings |
| `Ctrl+Shift+Space` | Show/hide window (global) |
| `Escape` | Close modals |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Electron 41 |
| UI framework | React 19 + TypeScript |
| Bundler | Vite 8 |
| AI backend | Ollama API (OpenAI-compatible) |
| Browser automation | Playwright (Chromium) |
| MCP protocol | JSON-RPC 2.0 over stdio |
| Voice | Web Speech API (STT + TTS) |
| Markdown | marked + highlight.js |
| Math rendering | KaTeX 0.16 + marked-katex-extension |
| Token counting | tiktoken (OpenAI) + @anthropic-ai/tokenizer |
| Document parsing | pdf-parse (PDF) + mammoth (DOCX) |
| Security | DOMPurify |
| Installer | electron-builder (NSIS) |

---

## Project Structure

```
openclaude-desktop/
├── electron/
│   ├── main.js               # Main process: IPC, Ollama, Playwright, MCP, parallel agents
│   ├── ipc-document.js       # IPC handlers: open-file-dialog, read-document (PDF/DOCX/images)
│   ├── ipc-agent-memory.js   # IPC handlers: load/save/append agent memory (agent-memory.json)
│   └── preload.js            # Context bridge (40+ secure API methods)
├── src/
│   ├── App.tsx                # Main UI: chat, tools, task plan, voice, agent mode, LaTeX, token counter
│   ├── Analytics.tsx          # Analytics dashboard (MAGI insights engine)
│   ├── Settings.tsx           # Settings: providers, language, API keys, memory, analytics, MCP tab
│   ├── AgentMemoryPanel.tsx   # Memory tab UI: working memory list, episode history, clear button
│   ├── hooks/
│   │   ├── useImageAttachment.ts    # Image upload + base64 encoding for vision providers
│   │   ├── useConversationFork.ts   # Fork conversation at any message index
│   │   └── useAgentMemory.ts        # Load/save/inject agent memory across sessions
│   ├── index.css              # Dark/light themes, task plan, voice, analytics, KaTeX styles
│   └── vite-env.d.ts          # TypeScript declarations (50+ API types)
├── public/                    # Static assets
├── ROADMAP.md                 # Full feature roadmap with tiers and backlog
├── Modelfile-uncensored       # Template for creating uncensored models
└── package.json               # Dependencies & build config
```

---

## Comparison

| Feature | OpenClaude | ChatGPT | Claude.ai | Manus AI |
|---------|-----------|---------|-----------|----------|
| 100% local/private | Yes | No | No | No |
| Open source | Yes | No | No | No |
| Free | Yes | Freemium | Freemium | Paid |
| Local models | Yes | No | No | No |
| Cloud providers | 4 providers | OpenAI only | Anthropic only | Multiple |
| Agent mode | Unlimited steps | Yes | Yes | Yes |
| Browser automation | Playwright | No | No | Yes |
| Parallel agents | Yes | No | No | Yes |
| Voice I/O | Yes | Yes | No | No |
| MCP compatible | Yes | No | Yes | No |
| Task planning | Visual tracker | No | No | Yes |
| System tools | Full access | Sandbox | Sandbox | Full access |
| Uncensored models | Yes | No | No | No |
| Custom system prompt | Yes | Limited | Limited | Yes |
| Offline capable | Yes | No | No | No |
| Circuit breaker | Yes | N/A | N/A | Unknown |
| Language enforcement | 4 layers | Auto | Auto | Auto |
| Usage analytics | Local-only | Cloud | Cloud | Cloud |
| Self-evolution insights | Yes | No | No | No |
| Context compaction | Auto-summarize | Truncate | Truncate | Truncate |
| Tool approval | Per-action | Per-session | None | None |
| File undo/snapshots | Yes | No | No | No |
| Git native tool | Sandboxed | No | No | No |
| Audit log | Full | No | No | No |
| LaTeX math rendering | KaTeX | No | Yes | No |
| Token counter | Per-provider | No | No | No |
| MCP settings UI | Visual | N/A | N/A | N/A |
| Image upload + vision | Yes | Yes | Yes | Yes |
| PDF/DOCX parsing | Native IPC | Limited | No | Yes |
| Conversation branching | Fork at any msg | No | No | No |
| Agent memory persistence | Cross-session | No | No | No |

---

## Changelog

### v2.0.0 — Vision, Documents & Memory (April 2026)
**4 medium-tier features from the roadmap:**

- **Image Upload + Vision** — A new attachment button in the chat toolbar lets you pick any image file; it is encoded to base64 and injected into the message `content` array in the format expected by GPT-4o, Gemini Vision, Claude, and llava (Ollama). Drag-and-drop and clipboard paste also supported. `useImageAttachment` hook handles all encoding and content building logic in `src/hooks/useImageAttachment.ts`. The IPC layer (`electron/ipc-document.js`) exposes `open-file-dialog` and `read-document` for file selection.

- **PDF/DOCX Parsing** — Drop or open any document file in the chat; the main process reads it via `pdf-parse` (PDF) or `mammoth` (DOCX/DOC) and returns plain text via the `read-document` IPC handler. Text/Markdown/CSV files are read directly. All formats enforce a 20 MB limit. Install with `npm install pdf-parse mammoth`.

- **Conversation Branching (Fork)** — Hover any message bubble and click **⑂ Fork here** to clone the conversation history up to that point into a new, independent branch. The fork is saved immediately with a `"Fork: <title> (msg N)"` label and a `forkedFrom` metadata record. Managed by `useConversationFork` hook (`src/hooks/useConversationFork.ts`).

- **Agent Memory Across Sessions** — The agent's working memory (key/value store) and episodic summaries are now persisted in `agent-memory.json` inside Electron's `userData` directory. They are loaded automatically on startup and injected into the system prompt via `buildMemoryContext()`. A new **Memory** tab in Settings (`AgentMemoryPanel`) lets you view, edit, and clear both working memory and episode history. `useAgentMemory` hook (`src/hooks/useAgentMemory.ts`) manages all read/write operations via IPC (`electron/ipc-agent-memory.js`).

### v1.9.0 — Quality of Life (April 2026)
**3 polish features shipped:**
- **LaTeX Math Rendering** — `$...$` (inline) and `$$...$$` (block) formulas now render as beautiful math via KaTeX. Powered by `marked-katex-extension` hooked into the existing `marked` pipeline in `App.tsx`. KaTeX CSS auto-loaded. Works in all messages including agent output.
- **Accurate Token Counting** — A live token counter now appears in the chat footer. Uses `tiktoken` (`cl100k_base` / `o200k_base`) for OpenAI-family models and `@anthropic-ai/tokenizer` for Claude. Automatically switches tokenizer when you change provider.
- **MCP Settings UI** — A new **MCP** tab in `Settings.tsx` lists all configured servers with their name and command. Add a new server by typing its name and command; remove any server with one click. Changes are persisted via IPC and take effect on next connection.

### v1.8.0 — Tier 1 + 2 + 3 Features (2025)
**8 major features added across 3 tiers:**
- Prompt Vault: reusable prompt library with `{{variable}}` interpolation
- Persona Engine: 4 built-in + custom AI personas with `Ctrl+P` switcher
- Model Arena: parallel model comparison with vote system and leaderboard
- Code Workspace: AI-powered diff editor with file tree and accept/reject hunks
- Vision Mode: screen capture + multi-provider vision AI analysis (`Ctrl+Shift+V`)
- RAG Local: Ollama-powered local embeddings and cosine similarity search
- Workflow Builder: SVG drag-and-drop visual pipeline builder with 5 node types
- ORION: autonomous computer-control agent with PowerShell action execution

### v1.7.0 — Parliament Mode: Multi-Agent Debate
- **Parliament Mode** — Entirely new feature: send any problem to 5 specialist AI agents simultaneously. Each agent analyzes exclusively from its domain: Architect (system design), Implementor (practical code), Security Reviewer (vulnerabilities & risks), Tester (quality & edge cases), Devil's Advocate (challenges assumptions). A Coordinator agent synthesizes all perspectives into Consensus, Divergences, Recommendation, and Next Steps.
- **Configurable per-agent providers** — Each Parliament role (including Coordinator) can use a different provider and model independently. Mix Ollama locally with cloud models in the same debate.
- **Real-time role progress** — Each agent card updates live as it completes (IPC events from main process). Coordinator activates only after all roles finish.
- **Synthesis tab** — Dedicated tab with the Coordinator's final structured analysis, separate from the individual role panels.
- **Export to chat** — One click exports the full Parliament debate transcript (all 5 roles + synthesis) into the current conversation.
- **Parliament button** — New toolbar button alongside Agent Mode. Opens as a full-screen overlay with left config panel and right results panel.

### v1.6.0 — Full Provider Parity
- **Agent Mode for Gemini**: Function calling now works with Gemini — tools are converted from OpenAI format to Gemini `functionDeclarations` automatically.
- **Agent Mode for Anthropic**: Tool use now fully supported — request/response converted between OpenAI and Anthropic native formats transparently.
- **Cloud Provider Streaming**: OpenAI, OpenRouter, Modal, and Anthropic now stream responses word-by-word (same as Ollama). Anthropic SSE events normalized to OpenAI chunk format.
- **Visual Redesign**: Refined dark/light themes with deeper contrast, gradient accents, glassmorphism modals, improved typography, table rendering, and blockquote support.
- **Repository Cleanup**: Removed Vite boilerplate files (`counter.ts`, `style.css`, `main.ts`, placeholder SVGs).
- **Build Scripts Fixed**: `build-installer.ps1` and `create-icon.ps1` now use `$PSScriptRoot` instead of hardcoded `D:\claude-desktop` path.
- **`.gitignore` Updated**: Added `*.tsbuildinfo` to prevent TypeScript build artifacts from being committed.
- **Typo Fix**: "informacoes" → "informações" in the input footer.

### v1.5.6 — UX Polish & Security Awareness
- **Security Visibility**: Added persistent visual warnings (banner + pulsing border) when "Ignore Permissions" (bypass mode) is active.
- **Bilingual Polish**: Fully translated Planning Mode prompts and permission menu (EN/PT).
- **Modal Hostname**: Hostname is now configurable in Settings (supports regional overrides).
- **State Fixes**: Model list and fetch errors now reset correctly when switching providers.
- **Redundancy Cleanup**: Removed legacy confirmation toggles in favor of the new permission system.

### v1.5.0 — Robustness & Safety Engine
- **Context Compaction**: Old messages are summarized by the model instead of being discarded. Persistent memory injected automatically.
- **Tool Permission Guardrails**: Dangerous tools (execute_command, write_file, git, browser) require user approval. Toggle in Settings.
- **File Snapshots + Undo**: Every file write creates an automatic backup. New `undo_last_write` tool to restore previous version. 50-snapshot stack.
- **Git Awareness**: Native `git_command` tool — status, diff, log, add, commit — sandboxed to git only (no shell injection).
- **Run Audit Log**: Every tool execution logged with inputs, outputs, duration, and status. Persisted to disk. Max 1000 entries with auto-purge.
- 17 built-in tools (was 14): added `git_command`, `undo_last_write`, enhanced `write_file` with auto-snapshot

### v1.4.1 — Unlimited Agent Mode
- Removed hard 25-step limit — agent now runs until task is fully complete
- Fixed critical bug: `finish_reason='stop'` from Ollama killing the loop after tool calls
- Added idle step detector (5 consecutive non-productive steps triggers safe stop)
- Improved agent system prompt for better persistence and task completion
- Enhanced small model directive to prevent premature text-only responses
- Agent badge now shows step count without a max limit

### v1.4.0 — Self-Evolution Architecture
- Silent session analytics engine (MCD — data collection module)
- Analytics & Insights dashboard (MAGI — analysis & insights module)
- Local secure storage with 30-day auto-purge (MASA — secure storage module)
- Per-session tracking: tool calls, response times, errors, circuit breakers, agent metrics
- Visual bar charts for tool usage frequency
- Model & provider usage analytics
- Agent Mode performance metrics (completion rate, avg steps)
- Analytics opt-in/opt-out toggle in Settings
- Bilingual analytics dashboard (PT/EN)

### v1.3.0 — Tier 3: Advanced
- Task planning with visual progress panel
- Browser automation via Playwright (navigate, click, type, screenshot)
- MCP client (JSON-RPC 2.0, connect to any MCP server)
- Collaborative parallel agents (delegate_subtasks)
- Voice I/O (speech-to-text + text-to-speech)

### v1.2.x — Tier 1 & 2: Core + UX
- 10 bug fixes (XSS, streaming, race conditions, stale closures)
- Multi-provider support (OpenAI, Gemini, Anthropic)
- Dark/light theme toggle
- Message copy, delete, regenerate
- Conversation pinning and search debounce
- Mandatory language setting (PT/EN) with 4-layer enforcement
- Circuit breaker, JSON validation, context truncation
- Working memory and small model detection
- Sliding context window (10-100 messages)
- Real abort-stream

### v1.0.1 — Initial Release
- Chat interface with Ollama
- Agent mode, streaming, tool execution
- Conversation history, export, drag & drop

---

## Roadmap

- [x] Agent Mode for all cloud providers (Gemini, Anthropic, OpenAI, OpenRouter, Modal)
- [x] Streaming for all cloud providers
- [x] Image upload with vision model support
- [x] PDF/DOCX document parsing
- [x] Conversation branching (fork at any message)
- [ ] Plugin system
- [x] LaTeX math rendering
- [ ] Linux & macOS builds
- [x] Accurate token counting per model
- [x] MCP settings UI (add/remove servers in Settings)
- [x] Parliament Mode (Multi-Agent Debate with Coordinator synthesis)
- [x] Agent memory persistence across sessions

See [ROADMAP.md](ROADMAP.md) for the full feature backlog with tiers and priorities.

---

## Contributing

Contributions are welcome! Whether it's a bug fix, new feature, or documentation improvement.

1. Fork the repository
2. Create your branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add: my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

See the [issue templates](.github/ISSUE_TEMPLATE/) for reporting bugs or requesting features.

---

## License

MIT — see [LICENSE](LICENSE)

---

<p align="center">
  Inspired by <a href="https://github.com/Gitlawb/openclaude">OpenClaude CLI</a> — built with care for privacy and freedom.
</p>
