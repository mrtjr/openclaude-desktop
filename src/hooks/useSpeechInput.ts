// ─── useSpeechInput (v2.103.0) ──────────────────────────────────────
//
// Push-to-talk: ditado de voz para o composer via Web Speech API (Chromium/
// Electron). Best-effort — se a API não existir, `supported` é false e o botão
// some. A lógica pura (idioma/junção) vive em utils/speech.ts.

import { useCallback, useEffect, useRef, useState } from 'react'
import { speechLang, isSpeechRecognitionSupported } from '../utils/speech'

interface UseSpeechInputOpts {
  language?: string
  /** Recebe o trecho FINAL reconhecido (já pronto para acrescentar ao input). */
  onTranscript: (text: string) => void
}

export function useSpeechInput({ language, onTranscript }: UseSpeechInputOpts) {
  const supported = isSpeechRecognitionSupported(typeof window !== 'undefined' ? window : null)
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const stop = useCallback(() => {
    try { recRef.current?.stop() } catch { /* já parou */ }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    if (!supported || listening) return
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    let rec: any
    try { rec = new Ctor() } catch { return }
    rec.lang = speechLang(language)
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          const text = String(r[0]?.transcript || '').trim()
          if (text) onTranscriptRef.current(text)
        }
      }
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { setListening(false) }
  }, [supported, listening, language])

  const toggle = useCallback(() => { listening ? stop() : start() }, [listening, start, stop])

  // Para o reconhecimento ao desmontar.
  useEffect(() => () => { try { recRef.current?.stop() } catch { /* noop */ } }, [])

  return { supported, listening, start, stop, toggle }
}
