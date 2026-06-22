// ─── Episódio de memória do agente (v2.117.0) ──────────────────────
//
// A varredura encontrou o auto-aprendizado MORTO: appendEpisode nunca era
// chamado, então o bucket `episodic` ficava vazio e o memory-dreaming
// (lightDream/deepDream) consolidava sobre o nada — todo o investimento em
// "memory dreaming" só gerava decaimento, nunca consolidação. Aqui mora o
// resumo PURO de um turno concluído; o App grava no agent-memory (fire-and-
// forget) e o dreaming passa a ter material real para consolidar.

/** Resumo conciso e auto-contido de um turno (pedido → resultado), para virar
 *  um episódio. '' quando o turno não foi substantivo (sem pedido ou sem uma
 *  resposta real — erro/vazio). Puro/determinístico. */
export function buildEpisodeSummary(userText: string, assistantText: string, maxLen = 280): string {
  const u = String(userText || '').replace(/\s+/g, ' ').trim()
  const a = String(assistantText || '').replace(/\s+/g, ' ').trim()
  if (!u) return ''
  if (a.length < 20) return '' // sem resposta substantiva (erro/vazio/só-tool)
  // Não captura turnos que terminaram em interceptação de sistema/erro.
  if (/^\[(SYSTEM|USER DENIED|BLOCKED|CANCELADO)/i.test(a)) return ''
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
  const reqPart = `Pediu: ${clip(u, 120)}`
  const ansPart = `Resultado: ${clip(a, Math.max(40, maxLen - reqPart.length - 4))}`
  return `${reqPart} · ${ansPart}`
}
