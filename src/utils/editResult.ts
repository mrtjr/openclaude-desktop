// ─── edit_file result formatting — pure ─────────────────────────────
//
// Turns the edit-file IPC result into an ACTIONABLE message for the model.
// A non-frontier model needs to know precisely WHY an edit failed (snippet
// not found vs. ambiguous vs. file missing) so it can recover in one step
// instead of flailing.

export interface EditIpcResult {
  error?: string | null
  replaced?: boolean
  occurrences?: number
}

export interface WriteIpcResult {
  error?: string | null
  /** O arquivo já existia antes da escrita (reescrita total). */
  existed?: boolean
  bytes?: number
}

/** A partir deste tamanho, reescrever um arquivo EXISTENTE inteiro ganha a
 *  nota de coaching — abaixo disso write_file é aceitável (arquivos pequenos
 *  de config etc.). */
export const COACH_REWRITE_MIN_CHARS = 1500

/** Formata o resultado do write_file. Quando o modelo reescreveu um arquivo
 *  existente grande, anexa a dica de usar edit_file — o feedback chega no
 *  tool result, exatamente onde um modelo não-frontier aprende in-context
 *  (Dev Insights: 9 write_file, 0 edit_file, montagens de 13 min). */
export function formatWriteResult(r: WriteIpcResult, path: string, contentLength: number): string {
  if (r?.error) return `Erro: ${r.error}`
  if (r?.existed && contentLength >= COACH_REWRITE_MIN_CHARS) {
    return `Arquivo escrito com sucesso: ${path}. NOTA: este arquivo já existia — você o reescreveu por inteiro. Para a próxima alteração parcial, use edit_file (old_string → new_string): é muito mais rápido e evita erros de regeneração.`
  }
  return 'Arquivo escrito com sucesso'
}

export function formatEditResult(r: EditIpcResult, path: string): string {
  if (r && r.replaced && !r.error) {
    return `Arquivo editado: ${path}`
  }
  switch (r?.error) {
    case 'not_found':
      return `Erro: o trecho (old_string) não foi encontrado em ${path}. Verifique o texto exato (espaços, indentação, quebras de linha) e tente de novo.`
    case 'ambiguous':
      return `Erro: o trecho (old_string) aparece ${r.occurrences ?? 'várias'}× em ${path} — precisa ser ÚNICO. Inclua mais contexto ao redor para identificar só a ocorrência desejada.`
    case 'file_not_found':
      return `Erro: o arquivo ${path} não existe. Use write_file para criá-lo.`
    case 'empty_old_string':
      return `Erro: old_string está vazio. Forneça o trecho exato a ser substituído.`
    default:
      return `Erro ao editar ${path}: ${r?.error || 'desconhecido'}`
  }
}
