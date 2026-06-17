// ─── Relatório .md por conversa (continuidade anti-refazer — v2.85.0) ──
//
// Cada conversa tem um relatório .md FIEL e CRONOLÓGICO do que já foi feito,
// montado de forma DETERMINÍSTICA (a partir dos passos reais do turno — não da
// memória do modelo, que esquece). A IA principal lê este relatório no início
// de cada turno e continua de onde parou, SEM refazer trabalho concluído.
// Diferente do contextSummary (resumo com perda, só na compactação): este é o
// registro completo, persistido por conversa (arquivo próprio), apagado junto
// com a conversa e NUNCA injetado em outro chat.
//
// Tudo PURO/testável; a I/O (report-load/save/delete) vive no main + useChat.

/** Teto do que é INJETADO por turno (mantém o relatório barato no contexto). */
export const REPORT_INJECT_MAX = 8000
/** Teto do ARQUIVO em disco (dropa turnos antigos preservando o cabeçalho). */
export const REPORT_STORE_MAX = 120000

export interface ReportAction { tool: string; detail?: string; ok: boolean }

export function reportHeader(title: string): string {
  return `# Relatório da conversa: ${title || 'Sem título'}\n\n> Registro cronológico e COMPLETO do que foi feito NESTE chat. A IA principal lê isto no início de cada turno para CONTINUAR de onde parou e NÃO refazer trabalho já concluído.`
}

/** Bloco de um turno: pedido do usuário + ações (ferramentas) + entrega. */
export function buildTurnEntry(input: {
  n: number
  dateLabel: string
  userMessage: string
  actions: ReportAction[]
  finalAnswer: string
}): string {
  const lines: string[] = [`## Turno ${input.n} — ${input.dateLabel}`]
  const um = (input.userMessage || '').replace(/\s+/g, ' ').trim()
  if (um) lines.push(`**Pedido:** ${um.length > 600 ? um.slice(0, 600) + '…' : um}`)
  const acts = input.actions || []
  if (acts.length) {
    lines.push('**Ações:**')
    for (const a of acts) {
      const d = (a.detail || '').replace(/\s+/g, ' ').trim()
      lines.push(`- ${a.ok ? '✓' : '✕'} ${a.tool}${d ? `: ${d.length > 140 ? d.slice(0, 140) + '…' : d}` : ''}`)
    }
  }
  const fa = (input.finalAnswer || '').trim()
  if (fa) lines.push(`**Entregue:** ${fa.length > 1200 ? fa.slice(0, 1200) + '…' : fa}`)
  return lines.join('\n')
}

/** Divide o md em [cabeçalho, ...blocos de turno]. */
function splitBlocks(md: string): { header: string; blocks: string[] } {
  const parts = (md || '').split(/\n(?=## Turno )/)
  const header = parts.shift() || ''
  return { header, blocks: parts }
}

/** Acrescenta o bloco do turno ao relatório (full em disco). Se passar do teto
 *  de armazenamento, dropa os turnos MAIS ANTIGOS preservando o cabeçalho. */
export function appendTurn(md: string, title: string, entry: string, storeMax = REPORT_STORE_MAX): string {
  const base = md && md.trim() ? md : reportHeader(title)
  let next = `${base}\n\n${entry}`
  if (next.length > storeMax) {
    const { header, blocks } = splitBlocks(next)
    const head = header || reportHeader(title)
    while (blocks.length > 1 && (head.length + blocks.join('\n').length + 80) > storeMax) blocks.shift()
    next = `${head}\n\n[turnos antigos omitidos para limitar o tamanho]\n\n${blocks.join('\n')}`
  }
  return next
}

/** Bloco injetado no contexto: relatório inteiro se couber; senão cabeçalho +
 *  turnos mais RECENTES até o teto (os intermediários ficam só no arquivo). */
export function renderReportForInjection(md: string, lang: string, maxChars = REPORT_INJECT_MAX): string {
  const body = (md || '').trim()
  if (!body) return ''
  let shown = body
  if (body.length > maxChars) {
    const { header, blocks } = splitBlocks(body)
    const tail: string[] = []
    let size = header.length
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (size + blocks[i].length > maxChars && tail.length) break
      tail.unshift(blocks[i]); size += blocks[i].length
    }
    const omitted = blocks.length - tail.length
    const note = omitted > 0
      ? (lang === 'en'
          ? `\n\n[${omitted} earlier turn(s) omitted here — full record is in the conversation report file]`
          : `\n\n[${omitted} turno(s) anterior(es) omitido(s) aqui — registro completo está no arquivo do relatório]`)
      : ''
    shown = `${header}${note}\n\n${tail.join('\n')}`
  }
  const head = lang === 'en'
    ? '[CONVERSATION REPORT — complete record of what was already done in THIS chat. READ it and CONTINUE from here; do NOT redo finished work or re-run steps already completed below.]'
    : '[RELATÓRIO DA CONVERSA — registro completo do que já foi feito NESTE chat. LEIA e CONTINUE a partir daqui; NÃO refaça trabalho já concluído nem repita passos já listados abaixo.]'
  return `${head}\n\n${shown}`
}
