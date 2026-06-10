// ─── Dropped-file attachment formatting ─────────────────────────────
//
// Files dragged into the chat become a fenced block in the composer. The old
// inline code clipped content at 5 000 chars with NO marker — for this user's
// MT5 logs and backtest CSVs that silently discarded 99% of the file and the
// model answered as if it had seen everything. Pure + tested here.

/** Max characters of file content injected into the composer (~5k tokens). */
export const DROPPED_FILE_MAX_CHARS = 20_000

/** Build the composer text for a dropped file. Content beyond `max` is
 *  clipped WITH an explicit marker so neither the user nor the model can
 *  mistake a partial file for the whole thing. */
export function formatDroppedFile(name: string, content: string, max = DROPPED_FILE_MAX_CHARS): string {
  const body = content.length > max ? content.slice(0, max) : content
  const marker = content.length > max
    ? `\n[TRUNCADO: mostrando ${max} de ${content.length} caracteres do arquivo]`
    : ''
  return `[Arquivo: ${name}]\n\`\`\`\n${body}${marker}\n\`\`\`\n`
}
