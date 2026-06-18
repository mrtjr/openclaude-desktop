import { describe, it, expect } from 'vitest'
import { speechLang, appendTranscript, isSpeechRecognitionSupported } from '../src/utils/speech'

describe('speechLang', () => {
  it('mapeia o idioma do app para BCP-47', () => {
    expect(speechLang('pt')).toBe('pt-BR')
    expect(speechLang('en')).toBe('en-US')
    expect(speechLang(undefined)).toBe('pt-BR')
  })
})

describe('appendTranscript', () => {
  it('acrescenta com espaço quando necessário', () => {
    expect(appendTranscript('olá', 'mundo')).toBe('olá mundo')
    expect(appendTranscript('olá ', 'mundo')).toBe('olá mundo')
  })
  it('sem texto atual → só o ditado', () => {
    expect(appendTranscript('', 'oi')).toBe('oi')
    expect(appendTranscript('   ', 'oi')).toBe('oi')
  })
  it('ditado vazio → mantém o atual', () => {
    expect(appendTranscript('oi', '   ')).toBe('oi')
  })
})

describe('isSpeechRecognitionSupported', () => {
  it('detecta a API (padrão ou webkit)', () => {
    expect(isSpeechRecognitionSupported({ SpeechRecognition: function () {} })).toBe(true)
    expect(isSpeechRecognitionSupported({ webkitSpeechRecognition: function () {} })).toBe(true)
    expect(isSpeechRecognitionSupported({})).toBe(false)
    expect(isSpeechRecognitionSupported(null)).toBe(false)
  })
})
