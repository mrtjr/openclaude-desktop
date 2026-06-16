// ─── Resumo de contexto ESTRUTURADO (v2.59.0) ───────────────────────
//
// Evolui o `contextSummary` de um parágrafo plano para um resumo seccionado
// (Objetivo / Decisões / Fatos / Arquivos / Estado / Pendências), com merge
// por seção + deduplicação. Resolve o pior defeito do `mergeSummary` antigo:
// ele cortava o RABO ao estourar o teto, jogando fora o OBJETIVO declarado no
// início da conversa. Aqui as seções DURÁVEIS (objetivo/decisões/fatos) nunca
// são truncadas; ao estourar o teto corta-se o volátil primeiro e, no limite,
// preserva-se a CABEÇA (objetivo no topo) — o oposto do comportamento antigo.
//
// `contextSummary` continua sendo uma string (markdown seccionado): zero
// migração de dados e os chamadores (useChat/App) seguem passando strings.
// O parsing é AGNÓSTICO de idioma (tabela de sinônimos PT+EN), então conteúdo
// gerado em qualquer idioma faz round-trip. Helpers PUROS/testáveis.
//
// NOTA p/ manutenção: os regex de remoção de acento usam \u0300-\u036f
// (escapes ASCII) de propósito — NUNCA colocar os chars combinantes literais
// aqui (deixariam o arquivo binário aos olhos do git).

export type SummaryLang = 'pt' | 'en' | string

export interface StructuredSummary {
  objetivo: string[]
  decisoes: string[]
  fatos: string[]
  arquivos: string[]
  estado: string[]
  pendencias: string[]
  /** Texto não-estruturado (resumos legados, contexto importado) preservado
   *  como está. Vive no fim e é o primeiro a ser cortado por caractere — mas
   *  por CABEÇA (mantém o começo, onde costuma estar o objetivo importado). */
  notas: string[]
}

interface SectionDef {
  key: keyof StructuredSummary
  labels: { pt: string; en: string }
  /** Formas normalizadas (lowercase, sem acento, alfanum+espaço) que o parser
   *  reconhece como cabeçalho desta seção. */
  synonyms: string[]
  /** true → itens novos vêm primeiro (estado volátil). false → cronológico,
   *  itens antigos preservados (objetivo/decisões duráveis). */
  recencyFirst: boolean
  /** Itens duráveis nunca são descartados no ajuste ao teto. */
  durable: boolean
  maxItems: number
}

// Ordem = ordem de SERIALIZAÇÃO. Duráveis primeiro para que um corte por
// caractere de último recurso (mantém cabeça) preserve objetivo/decisões/fatos.
export const SECTION_DEFS: SectionDef[] = [
  { key: 'objetivo', labels: { pt: 'Objetivo', en: 'Goal' },
    synonyms: ['objetivo', 'objetivos', 'meta', 'goal', 'goals', 'objective', 'objectives'],
    recencyFirst: false, durable: true, maxItems: 6 },
  { key: 'decisoes', labels: { pt: 'Decisões', en: 'Decisions' },
    synonyms: ['decisoes', 'decisao', 'decisoes tomadas', 'decisions', 'decision'],
    recencyFirst: false, durable: true, maxItems: 16 },
  { key: 'fatos', labels: { pt: 'Fatos-chave', en: 'Key facts' },
    synonyms: ['fatos chave', 'fatos', 'fatos importantes', 'key facts', 'facts', 'findings', 'achados'],
    recencyFirst: false, durable: true, maxItems: 18 },
  { key: 'arquivos', labels: { pt: 'Arquivos e comandos', en: 'Files and commands' },
    synonyms: ['arquivos e comandos', 'arquivos', 'arquivos e caminhos', 'arquivos caminhos', 'caminhos', 'comandos', 'files and commands', 'files', 'files paths', 'paths', 'commands'],
    recencyFirst: true, durable: false, maxItems: 18 },
  { key: 'estado', labels: { pt: 'Estado atual', en: 'Current state' },
    synonyms: ['estado atual', 'estado', 'status', 'progresso', 'current state', 'state', 'progress'],
    recencyFirst: true, durable: false, maxItems: 10 },
  { key: 'pendencias', labels: { pt: 'Pendências', en: 'Open items' },
    synonyms: ['pendencias', 'pendencia', 'proximos passos', 'pendencias proximos passos', 'questoes em aberto', 'perguntas em aberto', 'open items', 'next steps', 'todo', 'todos', 'open questions'],
    recencyFirst: true, durable: false, maxItems: 14 },
  { key: 'notas', labels: { pt: 'Notas', en: 'Notes' },
    synonyms: ['notas', 'nota', 'notes', 'note', 'contexto anterior', 'contexto importado', 'misc', 'outros'],
    recencyFirst: false, durable: false, maxItems: 40 },
]

/** Teto padrão do resumo (chars). Maior que o antigo (2000) porque o formato
 *  estruturado é mais denso/dedup'd; ~1000 tokens, contabilizado no budget. */
export const STRUCTURED_SUMMARY_MAX_CHARS = 4000

/** lowercase, remove acentos, troca não-alfanum por espaço, colapsa espaços. */
function normalizeHeader(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Chave de comparação para dedup de um bullet: normaliza e remove marcadores
 *  de lista / pontuação de borda. */
function dedupeKey(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[\s\-*•\d.)\]]+/, '')
    .replace(/[\s.;,:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const HEADER_LOOKUP: Record<string, keyof StructuredSummary> = (() => {
  const m: Record<string, keyof StructuredSummary> = {}
  for (const def of SECTION_DEFS) for (const syn of def.synonyms) m[syn] = def.key
  return m
})()

function emptyStructured(): StructuredSummary {
  return { objetivo: [], decisoes: [], fatos: [], arquivos: [], estado: [], pendencias: [], notas: [] }
}

/** Extrai o rótulo de cabeçalho de uma linha (`## X`, `**X:**`, `X:`) ou null. */
function headerLabel(line: string): string | null {
  const t = line.trim()
  let m = t.match(/^#{1,4}\s*(.+?)\s*:?\s*$/)
  if (m) return m[1]
  m = t.match(/^\*\*\s*(.+?)\s*:?\s*\*\*\s*:?\s*$/)
  if (m) return m[1]
  // "Rótulo:" sozinho na linha (curto, sem virar frase) — heurística conservadora
  m = t.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ /-]{2,30}):\s*$/)
  if (m) return m[1]
  return null
}

function stripBullet(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim()
}

/** true se o texto contém ao menos um cabeçalho de seção reconhecido. */
export function isStructured(text: string): boolean {
  if (!text) return false
  for (const raw of text.split('\n')) {
    const lbl = headerLabel(raw)
    if (lbl && HEADER_LOOKUP[normalizeHeader(lbl)]) return true
  }
  return false
}

/** Faz o parse de um resumo (markdown seccionado OU texto plano legado) numa
 *  StructuredSummary. Texto antes do 1º cabeçalho reconhecido, ou sob cabeçalho
 *  não-reconhecido, cai em `notas` (preservado, nunca perdido). */
export function parseStructuredSummary(text: string): StructuredSummary {
  const out = emptyStructured()
  if (!text || !text.trim()) return out
  let current: keyof StructuredSummary | null = null
  let buffer: string[] = []
  const flushBufferToNotas = () => {
    const joined = buffer.join('\n').trim()
    if (joined) out.notas.push(joined)
    buffer = []
  }
  for (const raw of text.split('\n')) {
    const lbl = headerLabel(raw)
    const key = lbl ? HEADER_LOOKUP[normalizeHeader(lbl)] : undefined
    if (key) {
      if (current === null) flushBufferToNotas()
      current = key
      continue
    }
    if (lbl && current === null) {
      // cabeçalho não-reconhecido antes de qualquer seção: mantém como nota
      buffer.push(raw)
      continue
    }
    if (current === null) {
      if (raw.trim()) buffer.push(raw)
      continue
    }
    const item = stripBullet(raw)
    if (item) out[current].push(item)
  }
  flushBufferToNotas()
  // dedup intra-seção preservando ordem
  for (const def of SECTION_DEFS) out[def.key] = dedupeList(out[def.key])
  return out
}

function dedupeList(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const it of items) {
    const k = dedupeKey(it)
    if (!k || seen.has(k)) continue
    seen.add(k)
    result.push(it.trim())
  }
  return result
}

/** Une duas seções respeitando recência e dedup, com corte em maxItems
 *  mantendo a CABEÇA (que, pela ordem escolhida, é o que importa preservar). */
function mergeSection(prev: string[], next: string[], def: SectionDef): string[] {
  const combined = def.recencyFirst ? [...next, ...prev] : [...prev, ...next]
  return dedupeList(combined).slice(0, def.maxItems)
}

/** Merge estrutural de dois resumos. */
export function mergeStructured(prev: StructuredSummary, next: StructuredSummary): StructuredSummary {
  const out = emptyStructured()
  for (const def of SECTION_DEFS) out[def.key] = mergeSection(prev[def.key], next[def.key], def)
  return out
}

/** Serializa para markdown seccionado (seções vazias são omitidas). */
export function serializeStructuredSummary(s: StructuredSummary, lang: SummaryLang = 'pt'): string {
  const isPt = lang === 'pt'
  const parts: string[] = []
  for (const def of SECTION_DEFS) {
    const items = s[def.key]
    if (!items?.length) continue
    const label = isPt ? def.labels.pt : def.labels.en
    parts.push(`## ${label}\n` + items.map(i => `- ${i}`).join('\n'))
  }
  return parts.join('\n\n').trim()
}

/** Serializa ajustando ao teto: corta seções VOLÁTEIS primeiro (estado →
 *  pendências → arquivos → notas), removendo do fim (mais antigo); duráveis
 *  nunca são tocadas. Se ainda exceder (caso raro: só duráveis), corta a
 *  string serializada pela CAUDA mas preservando a cabeça (objetivo no topo). */
export function fitToBudget(s: StructuredSummary, lang: SummaryLang, maxChars: number): string {
  const work: StructuredSummary = {
    objetivo: [...s.objetivo], decisoes: [...s.decisoes], fatos: [...s.fatos],
    arquivos: [...s.arquivos], estado: [...s.estado], pendencias: [...s.pendencias], notas: [...s.notas],
  }
  let serialized = serializeStructuredSummary(work, lang)
  if (serialized.length <= maxChars) return serialized

  // 1) Apara itens de seções voláteis, do fim, na ordem de prioridade de corte.
  //    `notas` fica de fora aqui — ela é tratada por CHAR-trim (mantém cabeça)
  //    no passo 2, para não descartar o objetivo importado de uma vez só.
  const trimOrder: (keyof StructuredSummary)[] = ['estado', 'pendencias', 'arquivos']
  for (const key of trimOrder) {
    while (serialized.length > maxChars && work[key].length > 0) {
      work[key].pop()
      serialized = serializeStructuredSummary(work, lang)
    }
    if (serialized.length <= maxChars) return serialized
  }

  // 2) Último recurso: char-trim de `notas` mantendo a CABEÇA (objetivo
  //    importado costuma estar no começo). Reconta o overflow só das duráveis.
  if (work.notas.length) {
    const withoutNotas = serializeStructuredSummary({ ...work, notas: [] }, lang)
    // Reserva p/ cabeçalho "## Notas\n- " + marcador " …[corte]" + separador.
    const room = maxChars - withoutNotas.length - 32
    if (room > 0) {
      const notasText = work.notas.join('\n\n')
      work.notas = [notasText.slice(0, room).trim() + ' …[corte]']
    } else {
      work.notas = []
    }
    serialized = serializeStructuredSummary(work, lang)
    if (serialized.length <= maxChars) return serialized
  }

  // 3) Só duráveis ainda excedem (muito raro): mantém a CABEÇA da string.
  return serialized.length > maxChars ? serialized.slice(0, maxChars).trim() : serialized
}

/** Orquestrador: faz merge de dois resumos (string→struct→string), dedup e
 *  ajuste ao teto. Substitui o `mergeSummary` plano antigo preservando a
 *  assinatura (prev, next, maxChars). Lang controla os rótulos de saída. */
export function mergeSummaryStructured(
  prev: string,
  next: string,
  maxChars: number = STRUCTURED_SUMMARY_MAX_CHARS,
  lang: SummaryLang = 'pt',
): string {
  if (!prev?.trim()) {
    const parsed = parseStructuredSummary(next || '')
    return fitToBudget(parsed, lang, maxChars)
  }
  if (!next?.trim()) {
    const parsed = parseStructuredSummary(prev)
    return fitToBudget(parsed, lang, maxChars)
  }
  const merged = mergeStructured(parseStructuredSummary(prev), parseStructuredSummary(next))
  return fitToBudget(merged, lang, maxChars)
}

/** Prompt de compactação que pede o formato ESTRUTURADO. */
export function buildStructuredCompactionPrompt(lang: SummaryLang, instructions?: string): string {
  const isPt = lang === 'pt'
  let prompt = isPt
    ? [
        'Resuma a conversa abaixo em um resumo ESTRUTURADO em Markdown, usando EXATAMENTE estas seções (omita as que não se aplicam; NÃO invente conteúdo):',
        '',
        '## Objetivo',
        '- o que o usuário quer alcançar (1-3 itens, duráveis)',
        '## Decisões',
        '- decisões tomadas e o porquê',
        '## Fatos-chave',
        '- fatos técnicos relevantes descobertos',
        '## Arquivos e comandos',
        '- arquivos/caminhos editados e comandos importantes (com caminho exato)',
        '## Estado atual',
        '- o que já foi feito / está em andamento agora',
        '## Pendências',
        '- próximos passos e questões em aberto',
        '',
        'Use bullets curtos e densos, sem floreios. NÃO repita itens. Preserve caminhos de arquivo, nomes de símbolos e números exatos.',
      ].join('\n')
    : [
        'Summarize the conversation below as a STRUCTURED Markdown summary, using EXACTLY these sections (omit those that do not apply; do NOT invent content):',
        '',
        '## Goal',
        '- what the user wants to achieve (1-3 durable items)',
        '## Decisions',
        '- decisions made and why',
        '## Key facts',
        '- relevant technical facts discovered',
        '## Files and commands',
        '- files/paths edited and important commands (with exact path)',
        '## Current state',
        '- what is done / in progress now',
        '## Open items',
        '- next steps and open questions',
        '',
        'Use short, dense bullets, no fluff. Do NOT repeat items. Preserve file paths, symbol names and exact numbers.',
      ].join('\n')
  const extra = (instructions || '').trim()
  if (extra) prompt += isPt ? `\n\nInstruções adicionais do usuário: ${extra}` : `\n\nAdditional user instructions: ${extra}`
  return prompt
}
