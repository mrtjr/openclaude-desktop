# Contribuindo para o OpenClaude Desktop

Obrigado pelo interesse! Este documento descreve como contribuir de forma produtiva.

---

## Ambiente de desenvolvimento

### Pré-requisitos
- **Node.js** ≥ 20
- **npm** (o projeto usa npm por padrão)
- **Windows 10/11** (o build principal é Windows; Linux/macOS rodam via `npm run dev` mas o instalador é NSIS)
- (Opcional) **Ollama** instalado para testar provider local

### Setup inicial
```bash
git clone https://github.com/mrtjr/openclaude-desktop.git
cd openclaude-desktop
npm install
npm run dev
```

O app abre em ~3s após o Vite e o Electron iniciarem.

### Scripts úteis
| Script | O que faz |
|---|---|
| `npm run dev` | Inicia Vite + Electron em modo dev com HMR |
| `npm run build` | Compila TypeScript + build Vite de produção |
| `npm run typecheck` | Apenas verifica tipos (sem emitir arquivos) |
| `npm run test` | Roda testes Vitest (modo one-shot) |
| `npm run test:watch` | Vitest em modo watch |
| `npm run test:ui` | UI interativa do Vitest |
| `npm run dist:win` | Gera instalador NSIS em `release/` |

---

## Fluxo de contribuição

1. **Abra uma issue primeiro** para mudanças não-triviais. Discussão antecipada evita PRs rejeitados.
2. **Fork + branch** a partir de `master` usando prefixo semântico:
   - `feat/nome-curto` — nova feature
   - `fix/descricao` — correção de bug
   - `docs/secao` — documentação
   - `refactor/area` — refatoração sem mudança de comportamento
   - `chore/ajuste` — manutenção / tooling
3. **Commits seguem Conventional Commits**:
   ```
   feat: adiciona pool de API keys Modal
   fix: streaming nao vaza entre conversas
   docs: atualiza README com secao de pool
   refactor: extrai useModalKeyPool hook
   ```
4. **Antes de abrir o PR**, rode:
   ```bash
   npm run typecheck
   npm run test
   npm run build
   ```
5. **Descreva o PR** com:
   - O problema resolvido / feature adicionada
   - Como testar manualmente
   - Screenshots se mudou UI

---

## Padrões de código

### TypeScript
- **Strict mode ligado** — nada de `any` em paths críticos; use os tipos em `src/types/`.
- **Hooks** devem seguir o padrão `useNomeDoHook` em `src/hooks/`.
- **Sem `any` implícito** — `noImplicitAny: true`.
- **Prefira `const` a `let`**, nunca `var`.

### React
- **Single-responsibility hooks** — se um hook passa de ~150 linhas, considere dividir.
- **`useRef` para callbacks em closures de longa duração** — evita stale closures (vide `useChat.ts`).
- **Sem estado derivado em `useState`** — calcule no render ou use `useMemo`.

### Electron / IPC
- **Handlers IPC em `electron/main.js`** — nomes com prefixo de domínio: `mcp-*`, `provider-*`, `audit-log-*`, `browser-*`, `analytics-*`.
- **Sempre exponha via `preload.js`** e tipa em `src/vite-env.d.ts`.
- **Nunca usar `shell.openExternal` com URLs vindas do usuário sem validação.**

### CSS
- Arquivo único `src/index.css` com seções comentadas.
- Variáveis CSS em `:root` (já existentes: `--bg-secondary`, `--accent`, etc.).
- Sem CSS-in-JS.

---

## Estrutura do projeto

```
D:\claude-desktop\
├── electron/
│   ├── main.js              # Processo principal Electron + IPC handlers
│   ├── preload.js           # Bridge entre renderer e main
│   ├── ipc-agent-memory.js  # IPC handlers de agent memory
│   └── ipc-document.js      # IPC handlers de document parsing (PDF/DOCX)
├── src/
│   ├── App.tsx              # Root component
│   ├── Settings.tsx         # Modal de configurações
│   ├── hooks/               # Custom hooks (useChat, useConversations, etc.)
│   ├── constants/           # Constantes (tools, pool, pricing, features)
│   ├── types/               # Tipos compartilhados (Conversation, IPC, etc.)
│   ├── utils/               # Helpers puros (formatting, sanitizers, etc.)
│   ├── config/              # Feature registry
│   └── services/            # Services (contextEngine, memoryDreaming)
└── test/                    # Testes Vitest
```

---

## Testes

Estamos construindo cobertura progressivamente. Ao adicionar features, **adicione pelo menos um teste** para:
- Funções puras em `utils/`
- Lógica de negócio em `hooks/` (use `@testing-library/react-hooks`)
- Handlers críticos em `services/`

Não escrevemos testes e2e de Electron — é caro e frágil. Focamos em unit + integration de lógica pura.

---

## Segurança

- **Nunca commite API keys**, tokens, ou credenciais. O hook `detect-secrets` bloqueia commits suspeitos.
- Bugs de segurança: **não abra issue pública** — siga o processo em [`SECURITY.md`](./SECURITY.md).

---

## O que é aceito / rejeitado

**Aceito:**
- Bugs reproduzíveis com passos claros.
- Features discutidas em issue antes do PR.
- Melhorias de acessibilidade.
- Testes novos para código existente.
- Traduções (PT/EN são prioridade; outros idiomas bem-vindos).

**Rejeitado sem discussão:**
- Reescritas massivas sem proposta prévia.
- Dependências pesadas (> 500 KB gzipped) sem justificativa forte.
- Mudanças de estilo visual massivas sem issue com screenshots antes/depois.
- Features que exigem servidor/gateway externo (escopo do projeto é local-first).

---

## Dúvidas?

Abra uma [issue](https://github.com/mrtjr/openclaude-desktop/issues) com label `question`.

Obrigado por contribuir! 🦞
