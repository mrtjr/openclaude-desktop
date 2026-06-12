// ─── read_file pagination — pure ────────────────────────────────────
//
// read_file returns the whole file; truncateToolOutput then clips the MIDDLE
// blindly for big files, leaving the model blind to the cut part with no way
// to ask for it. offset/limit (by line) make a long file navigable. STRICTLY
// opt-in: with neither offset nor limit the content is returned UNCHANGED, so
// existing behavior is byte-identical (zero regression).

/** Slice `content` to the requested line window. Returns the content unchanged
 *  when neither offset nor limit is given. When paginating, prepends a header
 *  with the shown range / total and how to continue. */
export function paginateFileContent(
  content: string,
  offset?: unknown,
  limit?: unknown,
): string {
  const hasOffset = offset !== undefined && offset !== null && offset !== ''
  const hasLimit = limit !== undefined && limit !== null && limit !== ''
  if (!hasOffset && !hasLimit) return content

  const lines = content.split('\n')
  const total = lines.length
  const off = Math.max(1, Math.floor(Number(offset)) || 1)         // 1-based start line
  const lim = hasLimit ? Math.max(1, Math.floor(Number(limit)) || 0) : total
  const start = Math.min(off, total + 1)
  const end = Math.min(total, start - 1 + lim)

  if (start > total) {
    return `[arquivo tem ${total} linhas; offset ${off} está além do fim]`
  }
  const slice = lines.slice(start - 1, end).join('\n')
  const more = end < total ? ` — continue com offset=${end + 1}` : ''
  return `[linhas ${start}–${end} de ${total}${more}]\n${slice}`
}
