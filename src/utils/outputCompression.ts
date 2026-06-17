// ─── Compressão de saída de ferramentas (headroom nativo) — v2.72.0 ──
//
// Inspirado no headroom (github.com/chopratejas/headroom), mas NATIVO e sem
// dependência externa: comprime a saída das ferramentas ANTES de ir ao modelo,
// removendo REDUNDÂNCIA (logs/builds repetem muito) para que mais SINAL caiba no
// mesmo orçamento de tokens. Conservador por padrão — só remove repetição óbvia,
// nunca conteúdo único:
//   - linhas idênticas consecutivas (≥3) → 1 + "(×N idênticas)"
//   - linhas quase-idênticas (mesmo esqueleto sem números, ≥8) → primeira +
//     "(×N similares)" + última (preserva o estado final, ex.: progresso)
//   - runs de linhas em branco → 1
//   - espaço em branco no fim das linhas → removido
// Tudo puro e testável. A truncagem head+tail (toolPolicy) roda DEPOIS como teto.

export interface CompressResult {
  text: string
  originalLen: number
  compressedLen: number
  /** Algo foi removido? */
  changed: boolean
}

const TRAILING_WS = /[ \t]+$/
const DIGITS = /\d+/g

/** "Esqueleto" da linha: sem números e sem espaço de borda — agrupa linhas que
 *  só diferem em contadores/timestamps (progresso, logs numerados). */
function skeleton(line: string): string {
  return line.replace(DIGITS, '#').trim()
}

/** Não comprime entradas pequenas (não vale o ruído dos marcadores). */
const MIN_COMPRESS_CHARS = 400
/** Limiares conservadores. */
const IDENTICAL_RUN = 3
const NEAR_RUN = 8
const MIN_SKELETON = 8

export function compressOutput(input: string): CompressResult {
  const original = input || ''
  if (original.length < MIN_COMPRESS_CHARS) {
    return { text: original, originalLen: original.length, compressedLen: original.length, changed: false }
  }
  const lines = original.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].replace(TRAILING_WS, '')

    // Runs de linhas em branco → uma só.
    if (line.trim() === '') {
      out.push('')
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      i = j
      continue
    }

    // Linhas IDÊNTICAS consecutivas (após trim de borda).
    let j = i + 1
    while (j < lines.length && lines[j].replace(TRAILING_WS, '') === line) j++
    const identical = j - i
    if (identical >= IDENTICAL_RUN) {
      out.push(line)
      out.push(`… (×${identical} linhas idênticas)`)
      i = j
      continue
    }

    // Linhas QUASE-idênticas (mesmo esqueleto): só colapsa em runs longos e
    // mantém a PRIMEIRA e a ÚLTIMA (não perde o estado final).
    const sk = skeleton(line)
    if (sk.length >= MIN_SKELETON) {
      let k = i + 1
      while (k < lines.length && skeleton(lines[k].replace(TRAILING_WS, '')) === sk) k++
      const near = k - i
      if (near >= NEAR_RUN) {
        out.push(line)
        out.push(`… (×${near} linhas similares omitidas)`)
        out.push(lines[k - 1].replace(TRAILING_WS, ''))
        i = k
        continue
      }
    }

    out.push(line)
    i++
  }

  const text = out.join('\n')
  // Se "comprimir" não ganhou nada (ou piorou pelos marcadores), devolve o
  // original intacto.
  if (text.length >= original.length) {
    return { text: original, originalLen: original.length, compressedLen: original.length, changed: false }
  }
  return { text, originalLen: original.length, compressedLen: text.length, changed: true }
}
