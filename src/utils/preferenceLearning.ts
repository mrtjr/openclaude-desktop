// ─── Aprendizado de preferências (Fase 2, v2.53.0) ──────────────────
//
// Objetivo (1) do plano de auto-aprendizado: conforme o usuário conversa, o
// agente aprende o GOSTO/estilo dele e passa a aplicá-lo. Guarda-rail central
// (da própria Anthropic): gosto = MEMÓRIA DE PREFERÊNCIA (injetada sempre,
// barata), NUNCA uma skill nova por gosto. E nada é aplicado na 1ª vez —
// promove só após REFORÇO (visto em ≥2 conversas), evitando capturar um
// comentário solto ("memória errada se auto-propagando").
//
// NOTA de arquitetura: o pipeline de "memory dreaming" (agent-memory.json) está
// dormente (o episódico nunca é alimentado — addEpisodic não é chamado em lugar
// nenhum), então a extração roda direto da mensagem do usuário e promove ao
// bucket 'preferences' do persistentMemory (que renderPersistentMemory injeta
// todo turno). Heurística CONSERVADORA de propósito; melhorias por LLM ficam
// para um passo futuro em background.
//
// Tudo aqui é PURO/determinístico. A I/O (localStorage + loadMemory/saveMemory)
// fica no useChat, fora do caminho quente (fire-and-forget).

export interface PrefCandidate {
  text: string
  count: number
  sources: string[]   // conversationIds distintos onde apareceu
  lastSeen: number
}
export type PrefCandidateStore = Record<string, PrefCandidate>

/** Quantas FONTES (conversas) distintas antes de promover ao bucket. Conservador. */
export const PREF_MIN_SOURCES = 2
/** Teto de candidatas rastreadas (poda as mais antigas). */
export const PREF_CANDIDATE_CAP = 60
/** Tamanho máximo de uma preferência capturada (evita capturar parágrafos). */
const MAX_PREF_LEN = 180

// Marcadores de preferência/instrução permanente dirigidos ao assistente.
// Conservador: só frases com um marcador claro viram candidatas.
const MARKERS: RegExp[] = [
  /\b(eu\s+)?prefiro\b/i,
  /\bprefira\b/i,
  /\b(eu\s+)?gosto\s+(de|que|quando)\b/i,
  /\b(eu\s+)?n[ãa]o\s+gosto\b/i,
  /\bde agora em diante\b/i,
  /\ba partir de agora\b/i,
  /\bquero que (voc[êe]|tu)\b/i,
  /\b(sempre|nunca)\s+(responda|use|fa[çc]a|gere|escreva|comente|me\b)/i,
  /\b(n[ãa]o|nunca)\s+use\b/i,
  /\buse sempre\b/i,
  /\bresponda\s+(sempre\s+)?(em|com|de|usando)\b/i,
  /\bi(?:'| woul| 'd| d)?\s*prefer\b/i,
  /\bi (?:really )?like (?:it )?when\b/i,
  /\bi don'?t like\b/i,
  /\bfrom now on\b/i,
  /\b(always|never)\s+(use|respond|write|do|give|make|format|answer)\b/i,
  /\bplease (always|never)\b/i,
  /\bi want you to (always|never)\b/i,
]

/** Normaliza para chave de dedup (case-insensitive, espaços colapsados). */
function keyOf(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Extrai preferências EXPLÍCITAS da mensagem do usuário. [] para mensagens
 *  normais. Quebra em sentenças/linhas; uma sentença vira candidata se casa um
 *  marcador, não é pergunta e cabe no tamanho. Cap de 3 por mensagem. */
export function extractPreferenceCandidates(text: string): string[] {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const sentences = raw.split(/(?<=[.!?\n])\s+|\n+/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of sentences) {
    const trimmed = s.trim().replace(/\s+/g, ' ')
    if (!trimmed || trimmed.length > MAX_PREF_LEN) continue
    if (trimmed.endsWith('?')) continue // pergunta não é preferência
    if (!MARKERS.some(m => m.test(trimmed))) continue
    const k = keyOf(trimmed)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(trimmed.replace(/[.!]+$/, ''))
    if (out.length >= 3) break
  }
  return out
}

/** Registra candidatas no store: incrementa contagem, agrega a conversa como
 *  fonte distinta, atualiza lastSeen. Poda ao teto (mais antigas saem). */
export function recordCandidates(
  store: PrefCandidateStore,
  candidates: string[],
  conversationId: string,
  now: number,
): PrefCandidateStore {
  const next: PrefCandidateStore = { ...store }
  for (const c of candidates) {
    const k = keyOf(c)
    if (!k) continue
    const prev = next[k]
    if (prev) {
      next[k] = {
        ...prev,
        count: prev.count + 1,
        sources: conversationId && !prev.sources.includes(conversationId)
          ? [...prev.sources, conversationId]
          : prev.sources,
        lastSeen: now,
      }
    } else {
      next[k] = { text: c, count: 1, sources: conversationId ? [conversationId] : [], lastSeen: now }
    }
  }
  // Poda ao teto: descarta as candidatas mais antigas (menor lastSeen).
  const keys = Object.keys(next)
  if (keys.length > PREF_CANDIDATE_CAP) {
    keys.sort((a, b) => next[a].lastSeen - next[b].lastSeen)
    for (const k of keys.slice(0, keys.length - PREF_CANDIDATE_CAP)) delete next[k]
  }
  return next
}

/** Candidatas prontas para promover: reforçadas em ≥ minSources conversas
 *  distintas (ou, no fallback, vistas count vezes na mesma conversa). */
export function selectPromotable(
  store: PrefCandidateStore,
  opts: { minSources?: number } = {},
): string[] {
  const minSources = opts.minSources ?? PREF_MIN_SOURCES
  return Object.values(store)
    .filter(c => c.sources.length >= minSources || c.count >= minSources + 1)
    .map(c => c.text)
}

/** Remove candidatas (após promovidas) do store. */
export function removeCandidates(store: PrefCandidateStore, texts: string[]): PrefCandidateStore {
  const drop = new Set(texts.map(keyOf))
  const next: PrefCandidateStore = {}
  for (const [k, v] of Object.entries(store)) if (!drop.has(k)) next[k] = v
  return next
}
