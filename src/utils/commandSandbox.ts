// ─── Sandbox de comandos (v2.101.0) ─────────────────────────────────
//
// Inspirado no "sandboxed Bash tool: commands run without prompts inside
// boundaries you define" do Claude Code. NOTA HONESTA: isto é um sandbox DE
// POLÍTICA (allowlist/denylist), não isolamento de kernel — no Windows o
// isolamento OS-level (Job Objects/AppContainer) é caro e frágil. O ganho real:
//   - comandos da ALLOWLIST rodam SEM prompt (menos fricção em comandos seguros);
//   - padrões PERIGOSOS da DENYLIST são BLOQUEADOS sempre;
//   - o resto cai no gate de permissão normal.
// Decide por SUB-COMANDO (a && b | c ; d): se QUALQUER parte casa a denylist →
// deny; só se TODAS as partes casam a allowlist → allow; senão ask. Puro/testável.

export interface SandboxConfig {
  enabled: boolean
  /** Prefixos de comando liberados a rodar sem prompt (casa o início de cada
   *  sub-comando, sem diferenciar maiúsculas). Ex.: 'git status', 'npm test'. */
  allowPrefixes: string[]
  /** Substrings/padrões perigosos sempre bloqueados (casa em qualquer posição). */
  denyPatterns: string[]
}

export type SandboxVerdict = 'allow' | 'deny' | 'ask'

/** Defaults conservadores: allowlist de leitura/diagnóstico; denylist de coisas
 *  destrutivas/rede/elevação. O usuário ajusta nas configurações. */
export const DEFAULT_SANDBOX: SandboxConfig = {
  enabled: false,
  allowPrefixes: [
    'git status', 'git diff', 'git log', 'git show', 'git branch',
    'npm test', 'npm run test', 'npm run lint', 'npm run build', 'npx vitest', 'npx tsc',
    'ls', 'dir', 'cat', 'type', 'pwd', 'echo', 'node --version', 'npm --version', 'python --version',
    'rg ', 'grep ', 'find ', 'where ', 'which ',
  ],
  denyPatterns: [
    'rm -rf', 'rm -fr', ':(){', 'mkfs', 'dd if=', 'del /', 'rmdir /s', 'format ',
    'sudo ', 'runas', 'shutdown', 'reboot', 'reg delete', 'reg add',
    'curl ', 'wget ', 'invoke-webrequest', 'iwr ', 'certutil -urlcache',
    '> /dev/sd', 'chmod 777', 'chown ', 'net user', 'schtasks /create',
  ],
}

/** Quebra uma linha de shell em sub-comandos pelos separadores comuns. */
export function splitCommands(command: string): string[] {
  return String(command ?? '')
    .split(/\n|&&|\|\||[|;&]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Classifica um comando segundo a config do sandbox. enabled=false → sempre
 *  'ask' (sem efeito; o gate normal decide). */
export function classifyCommand(command: string | undefined, config: SandboxConfig | undefined): SandboxVerdict {
  if (!config || !config.enabled) return 'ask'
  const raw = String(command ?? '').trim()
  if (!raw) return 'ask'
  const lower = raw.toLowerCase()
  const deny = (config.denyPatterns || []).map((s) => s.toLowerCase().trim()).filter(Boolean)
  if (deny.some((p) => lower.includes(p))) return 'deny'

  const parts = splitCommands(raw)
  if (!parts.length) return 'ask'
  const allow = (config.allowPrefixes || []).map((s) => s.toLowerCase().trim()).filter(Boolean)
  if (!allow.length) return 'ask'
  const allAllowed = parts.every((part) => {
    const p = part.toLowerCase()
    return allow.some((pre) => p === pre || p.startsWith(pre + ' ') || p.startsWith(pre))
  })
  return allAllowed ? 'allow' : 'ask'
}
