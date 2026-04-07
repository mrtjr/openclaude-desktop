# OpenClaude Desktop

Interface desktop open-source para modelos de IA locais via Ollama — visual inspirado no Claude, 100% privado e gratuito.

![OpenClaude Desktop](public/icon.png)

## ✨ Funcionalidades

- 💬 **Interface estilo Claude** — chat limpo com suporte a Markdown e syntax highlight
- 🤖 **Modo Agente** — executa tarefas complexas automaticamente com múltiplos passos
- 🔧 **Ferramentas integradas** — execute comandos, leia/escreva arquivos, busque na web
- 🔴 **Streaming em tempo real** — respostas aparecem palavra por palavra
- 💾 **Histórico persistente** — conversas salvas automaticamente em disco
- 🗂️ **Multi-conversa** — sidebar com histórico, busca e renomeação
- ⚙️ **Configurações** — temperatura, system prompt, max tokens, auto-start
- 🌐 **Busca web** — DuckDuckGo integrado como ferramenta
- 📂 **Drag & Drop** — arraste arquivos diretamente no chat
- 📤 **Export** — salve conversas como Markdown
- ⌨️ **Atalhos** — `Ctrl+N`, `Ctrl+K`, `Ctrl+,`, `Ctrl+Shift+Space`
- 🔔 **System Tray** — minimiza para a bandeja do Windows
- 🟢 **Status Ollama** — indicador online/offline em tempo real

## 🚀 Pré-requisitos

- [Ollama](https://ollama.com) instalado e rodando
- Node.js 20+
- Um modelo baixado (ex: `ollama pull qwen2.5-coder:7b`)

## 📦 Instalação

### Download direto
Baixe o instalador na página de [Releases](../../releases).

### Rodar do fonte

```bash
git clone https://github.com/SEU_USUARIO/openclaude-desktop
cd openclaude-desktop
npm install
npm run dev
```

### Build

```bash
npm run build       # Build da UI
npm run dist:win    # Gerar instalador .exe para Windows
```

## 🔧 Configuração

1. Inicie o Ollama: `ollama serve`
2. Baixe um modelo: `ollama pull qwen2.5-coder:7b`
3. Abra o OpenClaude Desktop
4. Selecione o modelo no menu inferior esquerdo

### Modelos recomendados

| Modelo | RAM necessária | Ideal para |
|--------|---------------|-----------|
| `qwen2.5-coder:7b` | 8 GB | Código |
| `qwen3.5:9b` | 12 GB | Geral |
| `qwen2.5-coder:32b` | 24 GB | Código avançado |
| `dolphin3:8b` | 8 GB | Sem restrições |

## 🛠️ Stack

- **Electron** — app desktop cross-platform
- **React + TypeScript** — interface
- **Vite** — bundler
- **Tailwind / CSS customizado** — estilos
- **Ollama API** — modelos de IA locais

## 🤝 Contribuindo

Pull requests são bem-vindos! Abra uma issue para discutir mudanças maiores antes.

## 📄 Licença

MIT — veja [LICENSE](LICENSE)
