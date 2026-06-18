// ─── Entrada por voz (v2.103.0) ─────────────────────────────────────
//
// Porta o "voice mode / push-to-talk" do Claude Code (lado de ENTRADA — já temos
// TTS de saída). Usa a Web Speech API do Chromium (Electron). Aqui ficam os
// helpers PUROS (mapa de idioma + junção do texto ditado); o hook
// useSpeechInput cuida do reconhecimento. Testável sem depender da API.

/** Mapeia o idioma do app para a tag BCP-47 do reconhecimento de fala. */
export function speechLang(lang: string | undefined): string {
  return lang === 'en' ? 'en-US' : 'pt-BR'
}

/** Acrescenta o trecho ditado ao texto já existente no composer, cuidando do
 *  espaçamento (não cola palavras nem duplica espaços). */
export function appendTranscript(current: string, transcript: string): string {
  const cur = String(current ?? '')
  const add = String(transcript ?? '').trim()
  if (!add) return cur
  if (!cur.trim()) return add
  return /\s$/.test(cur) ? cur + add : cur + ' ' + add
}

/** True se a Web Speech API de reconhecimento existe neste runtime. */
export function isSpeechRecognitionSupported(win: any): boolean {
  return !!(win && (win.SpeechRecognition || win.webkitSpeechRecognition))
}
