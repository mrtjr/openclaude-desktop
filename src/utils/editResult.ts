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
