// ─── Atomic JSON persistence ────────────────────────────────────────
//
// Every store in the main process used `fs.writeFileSync(PATH, json)`, which
// TRUNCATES the target before writing. A crash / full disk / power loss
// mid-write left the file half-written, so the next `JSON.parse` threw and
// the whole store (conversations, vault, personas, …) was lost.
//
// atomicWriteJSON writes to a sibling `.tmp`, fsyncs it, then *renames* it
// over the target. rename is atomic on a single filesystem, so a reader
// always sees either the old complete file or the new one — never a
// truncated one. The previous file is rotated to `.bak` first (a cheap
// metadata rename, no data copy), giving one-version-back recovery that
// readJSONWithFallback uses when the primary file is missing or corrupt.

const fs = require('fs')

/** Atomically serialize `data` to `filePath`. Never leaves the target
 *  truncated; keeps the prior version at `${filePath}.bak`.
 *  `pretty=false` writes compact JSON (used for the large RAG index). */
function atomicWriteJSON(filePath, data, pretty = true) {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  const tmp = filePath + '.tmp'
  const bak = filePath + '.bak'

  // Write the full new content to a temp sibling and flush it to disk
  // before we touch the live file.
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, json, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  // Rotate the current file out to .bak (cheap rename, no copy), then swap
  // the temp in. If a crash lands in the tiny gap between the two renames,
  // the target is briefly absent but .bak still holds the old content —
  // readJSONWithFallback recovers it.
  try {
    if (fs.existsSync(filePath)) fs.renameSync(filePath, bak)
  } catch { /* best-effort backup rotation */ }
  fs.renameSync(tmp, filePath)
}

/** Read + parse JSON from `filePath`, falling back to its `.bak` and then
 *  to `fallback` if the primary is missing or corrupt. Never throws. */
function readJSONWithFallback(filePath, fallback) {
  for (const p of [filePath, filePath + '.bak']) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch { /* corrupt — try the next candidate */ }
  }
  return fallback
}

module.exports = { atomicWriteJSON, readJSONWithFallback }
