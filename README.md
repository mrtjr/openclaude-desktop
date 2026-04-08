<p align="center">
  <img src="src/assets/hero.png" alt="OpenClaude Desktop" width="800" />
</p>

<h1 align="center">OpenClaude Desktop</h1>

<p align="center">
  <strong>The most powerful open-source AI desktop app.</strong><br/>
  Local models via Ollama. Cloud providers. Browser automation. Parallel agents. Voice I/O.<br/>
  No telemetry. No cloud lock-in. Your data stays on your machine.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/download-v1.4.1-ff6b35?style=for-the-badge&logo=windows" alt="Download" /></a>
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
</p>

---

## Why OpenClaude Desktop?

Most AI chat apps are either **cloud-only**, **closed-source**, or **CLI-only**. OpenClaude Desktop is none of those:

| Problem | OpenClaude Solution |
|---------|-------------------|
| Privacy concerns | Runs 100% locally via Ollama. Zero telemetry. |
| Vendor lock-in | Multi-provider: Ollama, OpenAI, Gemini, Anthropic |
| CLI is intimidating | Beautiful desktop GUI with dark/light themes |
| Models are censored | Works with uncensored/abliterated models |
| No agent capabilities | Agent Mode with up to 25 autonomous steps |
| Can't browse the web | Playwright browser automation built-in |
| Single-threaded AI | Collaborative parallel agents |
| Text-only interaction | Voice input (STT) and voice output (TTS) |
| No ecosystem integration | MCP client for Claude-compatible servers |
| No usage insights | Self-evolution analytics with local-only dashboard |

---

## Features

### Core AI
- **Multi-provider** — Ollama (local), OpenAI, Google Gemini, Anthropic Claude
- **Streaming responses** — real-time word-by-word output
- **Agent Mode** — autonomous multi-step execution (unlimited steps, no artificial cap)
- **Collaborative Agents** — multiple AI instances working in parallel on different subtasks
- **Task Planning** — decompose complex goals into tracked subtasks with visual progress
- **14 built-in tools** — commands, files, web search, browser, task planning, parallel agents
- **Mandatory language setting** — forces all responses in Portuguese or English (4-layer enforcement)
- **Self-Evolution Analytics** — silent performance tracking with insights dashboard

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
- **Working memory** — short-term memory injected each agent loop iteration
- **Small model detection** — extra guardrails for 7B-14B models

### UI/UX
- **Dark & Light themes** — toggle with one click, persisted
- **Conversation pinning** — pin important chats to the top
- **Message actions** — copy, delete individual messages, regenerate responses
- **Drag & drop** — drop files directly into the chat
- **Collapsible sidebar** — more screen space when you need it
- **Code highlighting** — syntax highlighting for 190+ languages with copy button
- **System tray** — minimize to tray, restore with `Ctrl+Shift+Space`
- **Smart auto-scroll** — only scrolls if you're at the bottom
- **Search with debounce** — fast conversation search

### Security & Performance
- **XSS protection** — DOMPurify sanitization on all rendered content (no onclick)
- **Sliding context window** — configurable message limit (10-100)
- **Real abort** — stop generation mid-stream (kills HTTP request server-side)
- **Persistent memory** — opt-in memory system for cross-conversation context
- **Model persistence** — remembers your last selected model
- **Analytics auto-purge** — 30-day retention + 500 session cap prevents unbounded storage growth

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
npx playwright install chromium   # for browser automation
npm run dev
```

### Option C: Build the installer yourself

```bash
git clone https://github.com/mrtjr/openclaude-desktop
cd openclaude-desktop
npm install
npx playwright install chromium
npm run dist:win    # outputs to release/
```

---

## Multi-Provider Setup

| Provider | How to configure |
|----------|-----------------|
| **Ollama** (default) | Install Ollama and pull a model. No API key needed. |
| **OpenAI** | Settings > Provider: OpenAI > paste `sk-...` API key |
| **Google Gemini** | Settings > Provider: Gemini > paste `AIza...` API key |
| **Anthropic Claude** | Settings > Provider: Anthropic > paste `sk-ant-...` API key |

All providers are normalized to the same response format — switch freely without losing features.

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
| OpenAI | `gpt-4o` | Best overall quality |
| Gemini | `gemini-2.0-flash` | Fast, good for code |
| Anthropic | `claude-sonnet-4-20250514` | Excellent reasoning |

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
| `update_working_memory` | Store short-term context between steps |

---

## MCP (Model Context Protocol)

OpenClaude can connect to any MCP server, giving it access to the growing ecosystem of Claude-compatible tools:

```
Settings > MCP > Connect to server
```

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
| Security | DOMPurify |
| Installer | electron-builder (NSIS) |

---

## Project Structure

```
openclaude-desktop/
├── electron/
│   ├── main.js          # Main process: IPC, Ollama, Playwright, MCP, parallel agents
│   └── preload.js       # Context bridge (40+ secure API methods)
├── src/
│   ├── App.tsx           # Main UI: chat, tools, task plan, voice, agent mode
│   ├── Analytics.tsx     # Analytics dashboard (MAGI insights engine)
│   ├── Settings.tsx      # Settings: providers, language, API keys, memory, analytics
│   ├── index.css         # Dark/light themes, task plan, voice, analytics styles
│   └── vite-env.d.ts     # TypeScript declarations (50+ API types)
├── public/               # Static assets
├── Modelfile-uncensored  # Template for creating uncensored models
└── package.json          # Dependencies & build config
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

---

## Changelog

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

- [ ] Image upload with vision model support
- [ ] PDF/DOCX document parsing
- [ ] Conversation branching (fork at any message)
- [ ] Plugin system
- [ ] LaTeX math rendering
- [ ] Linux & macOS builds
- [ ] Accurate token counting per model
- [ ] MCP settings UI (add/remove servers in Settings)
- [ ] Agent memory persistence across sessions

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
