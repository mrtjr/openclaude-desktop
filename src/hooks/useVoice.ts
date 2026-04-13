import { useState, useRef, useCallback } from 'react'
import type { Language } from '../types'

interface UseVoiceOptions {
  language: Language
  onToast: (message: string) => void
}

export function useVoice({ language, onToast }: UseVoiceOptions) {
  const [isListening, setIsListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const recognitionRef = useRef<any>(null)

  const toggleListening = useCallback((setInput: React.Dispatch<React.SetStateAction<string>>) => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      onToast('Speech Recognition not supported')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = language === 'en' ? 'en-US' : 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(prev => {
        const base = prev.replace(/\[.*?\]$/, '').trimEnd()
        if (event.results[event.results.length - 1].isFinal) {
          return (base ? base + ' ' : '') + transcript
        }
        return (base ? base + ' ' : '') + `[${transcript}]`
      })
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }, [isListening, language, onToast])

  const speakText = useCallback((text: string) => {
    if (!ttsEnabled) return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/[#*`_\[\]]/g, '').substring(0, 2000))
    utterance.lang = language === 'en' ? 'en-US' : 'pt-BR'
    utterance.rate = 1.1
    speechSynthesis.speak(utterance)
  }, [ttsEnabled, language])

  const toggleTTS = useCallback(() => {
    setTtsEnabled(prev => {
      if (prev) speechSynthesis.cancel()
      return !prev
    })
  }, [])

  return { isListening, ttsEnabled, toggleListening, speakText, toggleTTS }
}
