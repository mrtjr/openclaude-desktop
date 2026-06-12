// ─── search_files — pure helpers ────────────────────────────────────
//
// Content search across files. The agent had no grep-like tool, so "where is
// X / which file defines Y" forced either error-prone Select-String via
// execute_command (the #1 tool + #1 error source) or reading whole files one
// by one — long round-trip chains on a slow model. search_files answers that
// class in ONE round-trip. The walk/read lives in main; these pure pieces
// (glob → extensions, result → model text) are unit-tested here.

export interface SearchMatch {
  file: string
  line: number
  text: string
}

export interface SearchIpcResult {
  matches?: SearchMatch[]
  filesScanned?: number
  truncated?: boolean
  error?: string | null
}

/** Parse a filename filter ("*.ts", "ts", "ts,tsx", "*.{ts,tsx}") into a list
 *  of lowercase extensions with a leading dot, or null when no filter. */
export function parseSearchGlob(glob: unknown): string[] | null {
  if (typeof glob !== 'string') return null
  const raw = glob.trim()
  if (!raw) return null
  // pull tokens out of "{ts,tsx}" / "*.ts" / "ts, tsx"
  const tokens = raw
    .replace(/[*{}\s]/g, '')
    .split(/[,;|]/)
    .map((t) => t.trim().replace(/^\.+/, ''))
    .filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.map((t) => '.' + t.toLowerCase())
}

/** Render the search result as actionable text for the model. */
export function formatSearchResults(r: SearchIpcResult, query: string): string {
  if (r?.error) return `Erro na busca: ${r.error}`
  const matches = r?.matches || []
  if (matches.length === 0) {
    return `Nenhuma ocorrência de "${query}" encontrada${r?.filesScanned ? ` (${r.filesScanned} arquivos verificados)` : ''}.`
  }
  const lines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`)
  let out = lines.join('\n')
  if (r.truncated) {
    out += `\n\n[truncado: ${matches.length} ocorrências mostradas — refine a busca (query mais específica ou um glob) para ver o resto]`
  }
  return out
}
