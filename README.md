# OpenClaude Desktop

> Interface desktop open-source para modelos de IA locais via Ollama — visual inspirado no Claude, 100% privado e gratuito.

![Version](https://img.shields.io/badge/version-1.0.1-orange)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)
![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)

![OpenClaude Desktop Screenshot](src/assets/hero.png)

## ✨ Funcionalidades

| Feature | Descrição |
|---------|-----------|
| 💬 **Chat estilo Claude** | Interface limpa com Markdown e syntax highlight |
| 🤖 **Modo Agente** | Executa tarefas complexas com múltiplos passos automáticos |
| 🔧 **Ferramentas** | Execute comandos, leia/escreva arquivos, busque na web |
| 🔴 **Streaming** | Respostas em tempo real palavra por palavra |
| 💾 **Histórico** | Conversas salvas automaticamente em disco |
| 🗂️ **Multi-conversa** | Sidebar com busca e renomeação |
| ⚙️ **Configurações** | Temperatura, system prompt, max tokens, auto-start |
| 🌐 **Busca Web** | DuckDuckGo integrado como ferramenta |
| 📂 **Drag & Drop** | Arraste arquivos diretamente no chat |
| 📤 **Export** | Salve conversas como Markdown |
| ⌨️ **Atalhos** | `Ctrl+N`, `Ctrl+K`, `Ctrl+,`, `Ctrl+Shift+Space` |
| 🔔 **System Tray** | Minimiza para a bandeja do Windows |
| 🟢 **Status Ollama** | Indicador online/offline em tempo real |

## 🚀 Início Rápido

### 1. Pré-requisitos

- [Ollama](https://ollama.com/download) instalado
- Node.js 20+

### 2. Baixe um modelo

```bash
ollama pull qwen2.5-coder:7b
```

### 3. Instale o app

Baixe o instalador na página de [Releases](../../releases/latest) e execute.

Ou rode do fonte:

```bash
git clone https://github.com/mrtjr/openclaude-desktop
cd openclaude-desktop
npm install
npm run dev
```

## 🤖 Modelos recomendados

| Modelo | RAM | Ideal para |
|--------|-----|-----------|
| `qwen2.5-coder:7b` | 8 GB | Código rápido |
| `qwen3.5:9b` | 12 GB | Uso geral |
| `qwen2.5-coder:32b` | 24 GB | Código avançado |
| `dolphin3:8b` | 8 GB | Sem restrições |

## 🛠️ Build

```bash
npm run build       # Build da UI
npm run dist:win    # Gerar instalador .exe Windows
```

## 🔧 Stack

- **Electron 41** — app desktop
- **React 19 + TypeScript** — UI
- **Vite** — bundler  
- **Ollama API** — modelos locais

## 🤝 Contribuindo

1. Fork o repositório
2. Crie sua branch: `git checkout -b feature/minha-feature`
3. Commit: `git commit -m 'Add: minha feature'`
4. Push: `git push origin feature/minha-feature`
5. Abra um Pull Request

Issues e sugestões são bem-vindas!

## 📄 Licença

MIT — veja [LICENSE](LICENSE)

---

> Inspirado no [OpenClaude CLI](https://github.com/Gitlawb/openclaude) — built with ❤️
