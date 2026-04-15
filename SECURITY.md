# Política de Segurança

## Versões suportadas

Recebemos updates de segurança apenas na **versão minor atual** (e.g. `2.2.x` enquanto a minor atual for `2.2`).

| Versão | Suportada |
|--------|-----------|
| 2.2.x  | ✅ |
| 2.1.x  | ⚠️ Apenas falhas críticas |
| < 2.1  | ❌ Sem suporte |

---

## Reportando vulnerabilidades

**Por favor, NÃO abra uma issue pública para vulnerabilidades de segurança.**

### Como reportar

1. **GitHub Security Advisory** (preferido) — abra um advisory privado em:
   https://github.com/mrtjr/openclaude-desktop/security/advisories/new
2. **Alternativa**: envie email para o maintainer listado no `package.json` com o assunto prefixado `[SECURITY]`.

### O que incluir no report

- Descrição da vulnerabilidade e impacto potencial
- Passos para reproduzir (idealmente com PoC minimal)
- Versão afetada (`npm run dev` output inclui a versão)
- Seu ambiente (OS, Node version, Electron version)
- Sugestão de fix (opcional mas bem-vinda)

### Nosso processo

| Etapa | Prazo alvo |
|-------|-----------|
| Confirmação de recebimento | 48h úteis |
| Triagem inicial + severidade | 7 dias |
| Patch + release privada | Depende da severidade (crítico: 7 dias; alto: 30 dias; médio: 90 dias) |
| Disclosure público + CVE (se aplicável) | Após patch + 7 dias de grace period |

---

## Escopo

### ✅ No escopo
- Execução arbitrária de código via tools (`execute_command`, `read_file`, `write_file`)
- Path traversal em handlers IPC
- Vazamento de API keys via logs, telemetria, ou arquivos de config
- XSS em renderização de mensagens markdown
- Privilege escalation via `shell.openExternal` ou deep links
- Vulnerabilidades em dependências que afetem usuário final
- MCP server handling (injeção de comando, leitura de arquivo fora do diretório)

### ❌ Fora do escopo
- Ataques que exigem acesso físico ao dispositivo
- DoS via input massivo da UI (é um app desktop — usuário controla inputs)
- Problemas em software de terceiros não-distribuído com o app (Ollama, navegadores, etc.)
- Keys armazenadas em `localStorage` — assumimos que o dispositivo é de confiança (mas reportes de como melhorar são bem-vindos)
- Teoreticamente, qualquer coisa que exija modificação do binário instalado pelo próprio usuário

---

## Considerações de segurança conhecidas

Ser transparente sobre trade-offs do design:

### 1. API keys em localStorage
As chaves de cloud providers (OpenAI, Anthropic, Modal, etc.) ficam em `localStorage` do Electron. Não são encriptadas. **Um processo com acesso ao perfil do usuário pode lê-las.** Isso é aceitável porque:
- App desktop assume hostile-free local environment
- Encriptação seria security theater sem keychain integration
- O usuário pode revogar keys a qualquer momento no painel do provider

**Melhoria planejada**: integração com Windows Credential Manager.

### 2. Permission levels
- `ignore` permite execução sem pedir confirmação. O Security Audit no Command Palette alerta sobre isso.
- `ask` (default) pede confirmação em tools destrutivas.

### 3. Execute command
A tool `execute_command` executa shell commands. **Nunca configure `permissionLevel: 'ignore'` se usar o app com modelos de terceiros que você não controla** — um prompt injection pode levar a execução arbitrária.

### 4. MCP servers
MCP servers rodam como processos filhos via `spawn`. **Só adicione servers de fontes confiáveis.**

### 5. Browser automation
`browser_navigate`, `browser_click`, etc. controlam um Chrome instance real. URLs maliciosas podem explorar CVEs do Chrome — mantenha o Chrome atualizado.

---

## Reconhecimentos

Pesquisadores que reportarem vulnerabilidades seguindo este processo serão:
- Creditados no `CHANGELOG.md` (se desejado)
- Listados no `SECURITY.md` na seção "Hall of Fame" abaixo (se desejado)

### Hall of Fame
_Nenhum reporte ainda — seja o primeiro!_

---

## Boas práticas para usuários

1. **Desinstale versões antigas** antes de instalar nova (evita DLL hijacking)
2. **Baixe apenas de releases oficiais** no GitHub
3. **Use `permissionLevel: 'ask'` ou `'auto_edits'`** — nunca `'ignore'` em produção
4. **Revogue API keys** se desconfiar de comprometimento do dispositivo
5. **Não use ORION sem entender o que faz** — ele executa cadeias de tools sem intervenção
