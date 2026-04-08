<p align="center">
  <img src="src/assets/hero.png" alt="OpenClaude Desktop" width="800" />
</p>

<h1 align="center">OpenClaude Desktop</h1>

<p align="center">
  <strong>A free, open-source, privacy-first AI desktop app.</strong><br/>
  Run local models via Ollama — or connect to OpenAI, Gemini & Anthropic.<br/>
  No telemetry. No cloud lock-in. Your data stays on your machine.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/download-v1.2.0-ff6b35?style=for-the-badge&logo=windows" alt="Download" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey?style=for-the-badge" alt="Platform" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Ollama-local-000?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJhMTAgMTAgMCAxIDAgMCAyMCAxMCAxMCAwIDAgMCAwLTIweiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==" alt="Ollama" />
</p>

---

## Why OpenClaude Desktop?

Most AI chat apps are either **cloud-only** (your data leaves your machine), **closed-source** (you can't audit what they do), or **CLI-only** (hard for non-developers). OpenClaude Desktop solves all three:

| Problem | OpenClaude Solution |
|---------|-------------------|
| Privacy concerns | Runs 100% locally via Ollama. Zero telemetry. |
| Vendor lock-in | Multi-provider: switch between Ollama, OpenAI, Gemini, Anthropic |
| CLI is intimidating | Beautiful desktop GUI with dark/light themes |
| Models are censored | Works with uncensored/abliterated models out of the box |
| No agent capabilities | Built-in Agent Mode with autonomous multi-step tool execution |
| Can't interact with your system | Tools: run commands, read/write files, browse directories, web search |

---

## Features

### Core
- **Multi-provider AI** — Ollama (local), OpenAI, Google Gemini, Anthropic Claude
- **Streaming responses** — real-time, word-by-word output
- **Agent Mode** — autonomous multi-step task execution (up to 10 steps)
- **6 built-in tools** — execute commands, read/write files, list directories, web search, open files/URLs
- **Conversation history** — auto-saved to disk, searchable, exportable to Markdown

### UI/UX
- **Dark & Light themes** — toggle with one click, persisted
- **Conversation pinning** — pin important chats to the top
- **Message actions** — copy, delete individual messages, regenerate responses
- **Drag & drop** — drop files directly into the chat
- **Collapsible sidebar** — more screen space when you need it
- **Keyboard shortcuts** — `Ctrl+N` new chat, `Ctrl+K` search, `Ctrl+,` settings
- **System tray** — minimize to tray, restore with `Ctrl+Shift+Space`
- **Code highlighting** — syntax highlighting for 190+ languages
- **Smart auto-scroll** — only scrolls if you're at the bottom

### Security & Performance
- **XSS protection** — DOMPurify sanitization on all rendered content
- **Sliding context window** — configurable message limit (10-100) to prevent token overflow
- **Real abort** — stop generation mid-stream (kills the HTTP request server-side)
- **Persistent memory** — opt-in memory system for cross-conversation context
- **Model persistence** — remembers your last selected model

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
npm run dev
```

### Option C: Build the installer yourself

```bash
git clone https://github.com/mrtjr/openclaude-desktop
cd openclaude-desktop
npm install
npm run dist:win    # outputs to release/
```

---

## Multi-Provider Setup

OpenClaude works with local models by default, but you can also connect to cloud providers:

| Provider | How to configure |
|----------|-----------------|
| **Ollama** (default) | Just install Ollama and pull a model. No API key needed. |
| **OpenAI** | Settings > Provider: OpenAI > paste your `sk-...` API key |
| **Google Gemini** | Settings > Provider: Gemini > paste your `AIza...` API key |
| **Anthropic Claude** | Settings > Provider: Anthropic > paste your `sk-ant-...` API key |

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

1. Plan the steps needed
2. Execute tools one by one
3. Analyze results and adjust
4. Continue until the task is complete (up to 10 steps)

**Example:** "Create a Python project with a web scraper that saves results to CSV"
- The agent will create directories, write files, install dependencies, and test the code — all automatically.

---

## Built-in Tools

| Tool | What it does |
|------|-------------|
| `execute_command` | Run any PowerShell command on your system |
| `read_file` | Read file contents |
| `write_file` | Create or overwrite files |
| `web_search` | Search the web via DuckDuckGo |
| `list_directory` | Browse files and folders |
| `open_file_or_url` | Open files or URLs with default app |

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
| Markdown | marked + highlight.js |
| Security | DOMPurify |
| Installer | electron-builder (NSIS) |

---

## Project Structure

```
openclaude-desktop/
├── electron/
│   ├── main.js          # Electron main process (IPC, Ollama, tools, providers)
│   └── preload.js       # Context bridge (secure API exposure)
├── src/
│   ├── App.tsx           # Main chat UI component
│   ├── Settings.tsx      # Settings modal (providers, theme, memory)
│   ├── index.css         # Dark/light theme styles
│   └── vite-env.d.ts     # TypeScript declarations
├── public/               # Static assets
├── Modelfile-uncensored  # Template for creating uncensored models
└── package.json          # Dependencies & build config
```

---

## Roadmap

- [ ] Image upload with vision model support
- [ ] PDF/DOCX document parsing
- [ ] Conversation branching (fork at any message)
- [ ] Plugin system
- [ ] Voice input/output
- [ ] LaTeX math rendering
- [ ] Linux & macOS builds
- [ ] Accurate token counting per model

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

## Comparison

| Feature | OpenClaude | ChatGPT | Claude.ai | Manus AI |
|---------|-----------|---------|-----------|----------|
| 100% local/private | Yes | No | No | No |
| Open source | Yes | No | No | No |
| Free | Yes | Freemium | Freemium | Paid |
| Local models | Yes | No | No | No |
| Cloud providers | Yes | OpenAI only | Anthropic only | Multiple |
| Agent mode | Yes | Yes | Yes | Yes |
| System tools | Yes | Sandbox only | Sandbox only | Yes |
| Uncensored models | Yes | No | No | No |
| Custom system prompt | Yes | Limited | Limited | Yes |
| Offline capable | Yes | No | No | No |

---

## License

MIT — see [LICENSE](LICENSE)

---

<p align="center">
  Inspired by <a href="https://github.com/Gitlawb/openclaude">OpenClaude CLI</a> — built with care for privacy and freedom.
</p>
