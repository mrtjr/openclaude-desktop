// ─── Matching semântico (Fase 5, v2.56.0) ──────────────────────────
//
// Casa skills por SIGNIFICADO, não só por palavra-gatilho exata: "servidor de
// Tibia alternativo" deve puxar a skill de otserv mesmo sem a palavra "otserv".
// Usa embeddings locais (Ollama, via ragEmbed) — best-effort: se o Ollama não
// estiver disponível, a I/O retorna vazio e o app cai no matchSkillsByText
// (keyword) de sempre. Aqui só a matemática pura/testável.

/** Similaridade de cosseno entre dois vetores. 0 se incompatíveis/vazios. */
export function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Top-k itens por similaridade ao query, acima de um piso de score. */
export function rankBySimilarity<T>(
  query: number[],
  items: { item: T; vec: number[] }[],
  k = 3,
  minScore = 0.6,
): { item: T; score: number }[] {
  if (!query || query.length === 0) return []
  return items
    .map(x => ({ item: x.item, score: cosineSim(query, x.vec) }))
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
