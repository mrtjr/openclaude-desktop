// ─── Consciência de data + frescor de conhecimento (v2.61.0) ────────
//
// Resolve o problema "o modelo não sabe que dia é hoje e confia na memória
// desatualizada". Três peças, todas puras/testáveis:
//   1. buildDateLine  — injeta a DATA atual no system prompt (o modelo treinado
//      em ~2023/2024 acha que ainda é a época do treino se ninguém disser).
//   2. FRESHNESS_RULE — instrução padrão: "seu conhecimento tem corte e pode
//      estar velho; para coisas sensíveis a tempo, verifique com web_search/
//      fetch_url em vez de confiar na memória".
//   3. detectFreshness — heurística LOCAL (sem chamada extra de LLM, no molde do
//      adaptiveEffort) que sinaliza quando a mensagem do usuário é sensível a
//      tempo; aí o useChat injeta um nudge de verificação NAQUELE turno.
//
// Filosofia: não dá pra confiar no julgamento do modelo p/ decidir "quando
// buscar" — é justamente a parte desatualizada. Então o SISTEMA decide, barato.

export interface FreshnessResult {
  timeSensitive: boolean
  /** Rótulos dos sinais que dispararam (para o nudge e para depuração). */
  signals: string[]
}

/** Normaliza p/ casamento: NFD + remove diacríticos (via \p{Diacritic}, sem
 *  chars combinantes literais no fonte) + lowercase + colapsa espaços. */
function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Sinais FORTES: qualquer um já marca a mensagem como sensível a tempo. São
// termos que implicam o ESTADO ATUAL do mundo (não fatos atemporais). Já em
// forma sem acento (a entrada é normalizada antes de comparar).
const HARD_SIGNALS: { needle: string; label: string }[] = [
  { needle: 'atualizad', label: 'atualizado' },
  { needle: 'atualmente', label: 'atualmente' },
  { needle: 'mais recente', label: 'mais recente' },
  { needle: 'mais novo', label: 'mais novo' },
  { needle: 'ultima versao', label: 'última versão' },
  { needle: 'ultimas versoes', label: 'últimas versões' },
  { needle: 'versao mais', label: 'versão mais recente' },
  { needle: 'lancament', label: 'lançamento' },
  { needle: 'novidade', label: 'novidade' },
  { needle: 'recem', label: 'recém' },
  { needle: 'deprecated', label: 'deprecated' },
  { needle: 'obsolet', label: 'obsoleto' },
  { needle: 'descontinuad', label: 'descontinuado' },
  { needle: 'breaking change', label: 'breaking change' },
  { needle: 'changelog', label: 'changelog' },
  { needle: 'release notes', label: 'release notes' },
  { needle: 'cotacao', label: 'cotação' },
  { needle: 'noticia', label: 'notícia' },
  { needle: 'ano que vem', label: 'ano que vem' },
  { needle: 'este ano', label: 'este ano' },
  // EN
  { needle: 'latest', label: 'latest' },
  { needle: 'newest', label: 'newest' },
  { needle: 'most recent', label: 'most recent' },
  { needle: 'up to date', label: 'up to date' },
  { needle: 'up-to-date', label: 'up-to-date' },
  { needle: 'nowadays', label: 'nowadays' },
  { needle: 'this year', label: 'this year' },
  { needle: 'just released', label: 'just released' },
  { needle: 'still works', label: 'still works' },
  { needle: 'still supported', label: 'still supported' },
  { needle: 'current version', label: 'current version' },
]

// Sinais FRACOS: sozinhos não bastam (evita falso-positivo em "explique agora
// como funciona X"); 2+ deles, ou 1 forte, marcam a mensagem.
const SOFT_SIGNALS: { needle: string; label: string }[] = [
  { needle: 'hoje', label: 'hoje' },
  { needle: 'agora', label: 'agora' },
  { needle: 'atual', label: 'atual' },
  { needle: 'recente', label: 'recente' },
  { needle: 'today', label: 'today' },
  { needle: 'current', label: 'current' },
  { needle: 'recently', label: 'recently' },
  { needle: 'versao', label: 'versão' },
  { needle: 'version', label: 'version' },
  { needle: 'preco', label: 'preço' },
  { needle: 'price', label: 'price' },
  { needle: 'news', label: 'news' },
  { needle: 'release', label: 'release' },
  { needle: 'api', label: 'api' },
  { needle: 'sdk', label: 'sdk' },
  { needle: 'biblioteca', label: 'biblioteca' },
  { needle: 'library', label: 'library' },
  { needle: 'framework', label: 'framework' },
  { needle: 'documentacao', label: 'documentação' },
  { needle: 'docs', label: 'docs' },
]

/** Heurística local: a mensagem do usuário é sensível a tempo? Marca quando há
 *  ≥1 sinal forte, ≥2 fracos, ou menção a um ano >= o ano corrente. */
export function detectFreshness(text: string, currentYear: number): FreshnessResult {
  const t = normalize(text || '')
  if (!t) return { timeSensitive: false, signals: [] }
  const signals: string[] = []

  let hard = 0
  for (const s of HARD_SIGNALS) {
    if (t.includes(s.needle)) { signals.push(s.label); hard++ }
  }
  let soft = 0
  for (const s of SOFT_SIGNALS) {
    // \b em torno do needle p/ não casar "api" dentro de "rapido" etc.
    const re = new RegExp(`(^|[^a-z0-9])${s.needle}([^a-z0-9]|$)`)
    if (re.test(t)) { signals.push(s.label); soft++ }
  }
  // Ano >= corrente (menção a 2026+ implica fato atual). Anos passados não.
  const years = t.match(/\b20\d{2}\b/g)
  let yearHit = false
  if (years) {
    for (const y of years) {
      if (parseInt(y, 10) >= currentYear) { signals.push(`ano ${y}`); yearHit = true }
    }
  }

  const timeSensitive = hard >= 1 || soft >= 2 || yearHit
  return { timeSensitive, signals }
}

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** Linha de data para o system prompt (determinística, sem depender de Intl). */
export function buildDateLine(lang: string, now: Date): string {
  const d = now.getDate()
  const m = now.getMonth()
  const y = now.getFullYear()
  return lang === 'en'
    ? `Today's date: ${MONTHS_EN[m]} ${d}, ${y}.`
    : `Data de hoje: ${d} de ${MONTHS_PT[m]} de ${y}.`
}

/** Instrução padrão de frescor — sempre injetada (chat e agente). */
export const FRESHNESS_RULE: Record<string, string> = {
  pt: 'FRESCOR DE CONHECIMENTO: seu treinamento tem uma data de corte e PODE estar desatualizado em relação à data de hoje. Para qualquer coisa sensível a tempo — versões de bibliotecas/APIs, preços, eventos atuais, "mais recente/atual", lançamentos e datas — NÃO confie só na memória: verifique com web_search/fetch_url antes de afirmar, e deixe claro quando a informação veio de busca. Após verificar, registre o fato com remember_fresh_fact (incluindo a fonte) para reuso futuro. Para fatos atemporais (conceitos, lógica, código já presente), responda direto.',
  en: 'KNOWLEDGE FRESHNESS: your training has a cutoff date and MAY be outdated relative to today. For anything time-sensitive — library/API versions, prices, current events, "latest/current", releases and dates — do NOT rely on memory alone: verify with web_search/fetch_url before asserting, and make clear when info came from a search. After verifying, record the fact with remember_fresh_fact (include the source) for future reuse. For timeless facts (concepts, logic, code already present), answer directly.',
}

/** Nudge por-turno quando a mensagem é sensível a tempo. */
export function buildFreshnessNudge(lang: string, signals: string[]): string {
  const list = signals.slice(0, 6).join(', ')
  return lang === 'en'
    ? `[VERIFICATION RECOMMENDED] This request looks time-sensitive (signals: ${list}). Before answering, confirm the current facts with web_search/fetch_url instead of relying on memory, and cite the source.`
    : `[VERIFICAÇÃO RECOMENDADA] Esta pergunta parece sensível a tempo (sinais: ${list}). Antes de responder, confirme os fatos atuais com web_search/fetch_url em vez de confiar na memória, e cite a fonte.`
}
