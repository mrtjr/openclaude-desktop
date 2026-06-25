// ─── Ler em voz alta por mensagem (TTS, v2.144.0) ───────────────────
// Estilo ChatGPT: um botão 🔊 por resposta do assistente (antes só tínhamos o
// toggle GLOBAL de auto-fala). Usa a Web Speech API do Chromium (Electron).
// Aqui ficam o helper PURO (limpa o markdown p/ a fala) e um CONTROLADOR
// singleton observável (só uma fala por vez no app; os botões sabem qual
// mensagem está falando). O controlador é guardado para não quebrar em ambiente
// sem speechSynthesis (testes/jsdom).

/** BCP-47 para a síntese de voz. */
export function speechOutLang(lang: string | undefined): string {
  return lang === 'en' ? 'en-US' : 'pt-BR'
}

/**
 * Limpa o texto para a fala: tira blocos de código, marcadores de markdown,
 * imagens/links (mantém o rótulo do link) e colapsa espaços. Cap de tamanho
 * para não prender a fila de fala por minutos.
 */
export function stripForSpeech(text: string, maxLen = 4000): string {
  let t = String(text ?? '')
  t = t.replace(/```[\s\S]*?```/g, ' (bloco de código) ')   // blocos de código
  t = t.replace(/`([^`]+)`/g, '$1')                          // code inline
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                // imagens
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links → rótulo
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')                   // headers
  t = t.replace(/[*_~>#|]+/g, ' ')                            // marcadores
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
  return t.length > maxLen ? t.slice(0, maxLen) : t
}

// ─── Controlador singleton (observável) ─────────────────────────────
type Listener = () => void
let speakingId: string | null = null
const listeners = new Set<Listener>()

function emit() { for (const l of listeners) l() }

function hasTTS(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
}

export const ttsController = {
  /** Suportado neste runtime? */
  supported: hasTTS,
  /** Qual mensagem está falando agora (ou null). */
  getSpeakingId(): string | null { return speakingId },
  subscribe(l: Listener): () => void { listeners.add(l); return () => listeners.delete(l) },
  /** Fala `text` atribuído a `id`. Cancela qualquer fala anterior. */
  speak(id: string, text: string, lang: string): void {
    if (!hasTTS()) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = lang
      u.rate = 1.05
      u.onend = () => { if (speakingId === id) { speakingId = null; emit() } }
      u.onerror = () => { if (speakingId === id) { speakingId = null; emit() } }
      speakingId = id
      emit()
      window.speechSynthesis.speak(u)
    } catch { speakingId = null; emit() }
  },
  /** Para a fala atual. */
  stop(): void {
    if (hasTTS()) { try { window.speechSynthesis.cancel() } catch { /* noop */ } }
    if (speakingId !== null) { speakingId = null; emit() }
  },
}
