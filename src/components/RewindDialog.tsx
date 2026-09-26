// ─── Diálogo de rewind (v2.209.0) ───────────────────────────────────
//
// Reverter tinha só um `window.confirm`, que expressa duas saídas (sim/não).
// São TRÊS: cancelar, desfazer só os arquivos, ou desfazer arquivos E rebobinar
// a conversa até antes daquele turno. O default continua sendo "só arquivos" —
// rebobinar a conversa apaga mensagens e é a opção mais destrutiva das duas.

import { Undo2, History, X } from 'lucide-react'

export type RewindScope = 'files' | 'files+chat'

interface Props {
  files: number
  /** Quantas mensagens seriam removidas ao rebobinar a conversa. */
  messages: number
  language: 'pt' | 'en'
  onConfirm: (scope: RewindScope) => void
  onClose: () => void
}

export function RewindDialog({ files, messages, language, onConfirm, onClose }: Props) {
  const en = language === 'en'
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="rewind-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="rewind-header">
          <h3>{en ? 'Rewind this turn' : 'Rebobinar este turno'}</h3>
          <button className="rewind-close" onClick={onClose} title={en ? 'Close' : 'Fechar'} aria-label={en ? 'Close' : 'Fechar'}>
            <X size={16} />
          </button>
        </div>

        <p className="rewind-body">
          {en
            ? 'Files created in this turn are deleted; modified ones go back to their previous content. This cannot be undone.'
            : 'Os arquivos criados neste turno são apagados; os modificados voltam ao conteúdo anterior. Isto não tem desfazer.'}
        </p>

        <div className="rewind-actions">
          <button className="rewind-opt" onClick={() => onConfirm('files')}>
            <Undo2 size={15} />
            <span className="rewind-opt-body">
              <strong>{en ? 'Files only' : 'Somente os arquivos'}</strong>
              <small>
                {en
                  ? `Restore ${files} file(s). The conversation stays as it is.`
                  : `Restaura ${files} arquivo(s). A conversa fica como está.`}
              </small>
            </span>
          </button>

          <button className="rewind-opt" onClick={() => onConfirm('files+chat')} disabled={messages <= 0}>
            <History size={15} />
            <span className="rewind-opt-body">
              <strong>{en ? 'Files and conversation' : 'Arquivos e conversa'}</strong>
              <small>
                {messages > 0
                  ? (en
                    ? `Restore ${files} file(s) and remove the last ${messages} message(s), back to just before this turn.`
                    : `Restaura ${files} arquivo(s) e remove as últimas ${messages} mensagem(ns), voltando a antes deste turno.`)
                  : (en ? 'Nothing to rewind in the conversation.' : 'Não há o que rebobinar na conversa.')}
              </small>
            </span>
          </button>
        </div>

        <button className="rewind-cancel" onClick={onClose}>{en ? 'Cancel' : 'Cancelar'}</button>
      </div>
    </div>
  )
}
