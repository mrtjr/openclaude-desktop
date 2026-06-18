// ─── Hooks de SAÍDA / exibição (v2.94.0) ────────────────────────────
//
// Porta dois recursos do Claude Code:
//  1. PostToolUse `updatedToolOutput` — um hook pode SUBSTITUIR a saída de uma
//     tool (antes só ANEXAR). Ex.: redigir segredos, reformatar logs antes do
//     modelo ver. O hook recebe a saída via env (OPENCLAUDE_TOOL_OUTPUT) e seu
//     stdout vira o novo resultado quando mode='replace'.
//  2. MessageDisplay — transformar/ocultar o texto da mensagem do assistente na
//     EXIBIÇÃO. Versão client-side e segura: regras de regex (não spawna shell
//     por mensagem). Substituir por '' = ocultar o trecho.
// Tudo puro/testável.

/** Combina a saída de uma tool com o stdout/stderr de um hook PostToolUse:
 *   - 'replace': se o hook produziu stdout, ELE vira o novo resultado (a saída
 *     transformada). Sem stdout → mantém o original (anexando o stderr do hook,
 *     se houver, para não engolir erro).
 *   - 'append' (default, comportamento v2.38.0): anexa a saída do hook ao
 *     resultado, byte-idêntico ao anterior. */
export function combineHookOutput(
  prevOut: string,
  stdout: string | undefined,
  stderr: string | undefined,
  mode: 'append' | 'replace' | undefined,
  command: string,
): string {
  const o = (stdout || '').trim()
  const e = (stderr || '').trim()
  if (mode === 'replace') {
    if (o) return o
    return e ? `${prevOut}\n\n[hook PostToolUse: ${command}] stderr\n${e.slice(0, 1500)}` : prevOut
  }
  const text = [o, e].filter(Boolean).join('\n').trim()
  const tag = `[hook PostToolUse: ${command}]`
  return text ? `${prevOut}\n\n${tag}\n${text.slice(0, 1500)}` : `${prevOut}\n\n${tag} (ok, sem saída)`
}

export interface DisplayTransform {
  /** Padrão regex a casar no texto exibido. */
  pattern: string
  /** Substituição (suporta $1 etc.). Ausente/'' = OCULTA o trecho casado. */
  replacement?: string
  /** Flags da regex (default 'g'). */
  flags?: string
}

/** Aplica as transformações/redações ao texto do assistente ANTES de exibir.
 *  Cada regra inválida (regex malformada) é ignorada — best-effort, nunca
 *  quebra a renderização. Não muta o conteúdo armazenado (só a exibição). */
export function applyDisplayTransforms(text: string, transforms: DisplayTransform[] | undefined): string {
  let out = String(text ?? '')
  if (!transforms || !transforms.length) return out
  for (const t of transforms) {
    if (!t || !t.pattern) continue
    try {
      const re = new RegExp(t.pattern, t.flags ?? 'g')
      out = out.replace(re, t.replacement ?? '')
    } catch { /* regex inválida: ignora a regra */ }
  }
  return out
}

/** Parseia o editor multilinha de transforms: "padrão ==> substituição" por
 *  linha (sem "==>" → oculta o que casar). Linhas vazias/comentário ignoradas. */
export function parseDisplayTransforms(text: string): DisplayTransform[] {
  return String(text ?? '').split('\n').map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return null
    const i = t.indexOf('==>')
    if (i === -1) return { pattern: t } as DisplayTransform
    return { pattern: t.slice(0, i).trim(), replacement: t.slice(i + 3).trim() } as DisplayTransform
  }).filter(Boolean) as DisplayTransform[]
}

/** Serializa de volta para o editor multilinha. */
export function formatDisplayTransforms(transforms: DisplayTransform[] | undefined): string {
  return (transforms || [])
    .filter((t) => t && t.pattern)
    .map((t) => (t.replacement ? `${t.pattern} ==> ${t.replacement}` : t.pattern))
    .join('\n')
}
