import { useSyncExternalStore } from 'react'
import { Volume2, Square } from 'lucide-react'
import { ttsController, stripForSpeech, speechOutLang } from '../utils/speechOut'

/**
 * Botão "ler em voz alta" por mensagem (estilo ChatGPT, v2.144.0). Assina o
 * controlador singleton para saber se ESTA mensagem está falando (mostra o
 * ícone de parar). Encapsula a assinatura para o ChatMessage memoizado só
 * renderizar `<ReadAloudButton .../>` — durante o streaming nada muda aqui (o
 * store só muda em falar/parar). Não renderiza nada se o runtime não tem TTS.
 */
export function ReadAloudButton({ id, text, language }: { id: string; text: string; language: 'pt' | 'en' }) {
  const speakingId = useSyncExternalStore(ttsController.subscribe, ttsController.getSpeakingId, () => null)
  if (!ttsController.supported()) return null
  const speaking = speakingId === id
  const en = language === 'en'
  return (
    <button
      className={`msg-action-btn msg-tts-btn${speaking ? ' speaking' : ''}`}
      onClick={() => speaking ? ttsController.stop() : ttsController.speak(id, stripForSpeech(text), speechOutLang(language))}
      title={speaking ? (en ? 'Stop reading' : 'Parar leitura') : (en ? 'Read aloud' : 'Ler em voz alta')}
      aria-label={speaking ? (en ? 'Stop reading' : 'Parar leitura') : (en ? 'Read aloud' : 'Ler em voz alta')}
      aria-pressed={speaking}
    >
      {speaking ? <Square size={12} /> : <Volume2 size={12} />}
    </button>
  )
}

export default ReadAloudButton
