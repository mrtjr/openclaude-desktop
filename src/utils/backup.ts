// ─── Backup / restore — pure helpers ────────────────────────────────
//
// The user's whole corpus (conversations, memory, vault, personas, projects,
// settings) lived only under userData with no way to export or migrate it —
// reinstalling, switching machines, or a crash meant losing everything. These
// pure helpers build/parse the backup envelope and bundle the localStorage
// half (the file half is read/written by main via IPC). Purely additive: no
// existing flow changes, so nothing can regress.

export const BACKUP_VERSION = 1
export const BACKUP_APP_ID = 'openclaude-desktop'

/** All app localStorage keys use one of these prefixes. */
export const LOCALSTORAGE_PREFIXES = ['openclaude-', 'oc.']

export interface BackupEnvelope {
  app: string
  version: number
  exportedAt: string
  localStorage: Record<string, string>
  files: Record<string, unknown>
}

function isAppKey(key: string): boolean {
  return LOCALSTORAGE_PREFIXES.some((p) => key.startsWith(p))
}

/** Collect every app-owned localStorage entry into a plain map. */
export function collectLocalStorageBackup(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && isAppKey(key)) {
      const v = storage.getItem(key)
      if (v !== null) out[key] = v
    }
  }
  return out
}

/** Build the export envelope. `exportedAt` is passed in (ISO string) so this
 *  stays pure/testable. */
export function buildBackup(
  localStorageData: Record<string, string>,
  files: Record<string, unknown>,
  exportedAt: string,
): BackupEnvelope {
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt,
    localStorage: localStorageData || {},
    files: files || {},
  }
}

/** Parse + validate a backup file. Throws a user-facing (pt) error when the
 *  file isn't a recognizable OpenClaude backup. */
export function parseBackup(json: string): BackupEnvelope {
  let data: any
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Arquivo inválido: não é um JSON válido.')
  }
  if (!data || data.app !== BACKUP_APP_ID) {
    throw new Error('Este arquivo não é um backup do OpenClaude.')
  }
  if (typeof data.version !== 'number') {
    throw new Error('Backup sem versão — arquivo corrompido.')
  }
  return {
    app: data.app,
    version: data.version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    localStorage: data.localStorage && typeof data.localStorage === 'object' ? data.localStorage : {},
    files: data.files && typeof data.files === 'object' ? data.files : {},
  }
}

/** Restore app-owned localStorage entries from a backup. Ignores foreign keys
 *  defensively. Returns how many were applied. */
export function applyLocalStorageBackup(storage: Storage, entries: Record<string, unknown>): number {
  let n = 0
  for (const [k, v] of Object.entries(entries || {})) {
    if (isAppKey(k) && typeof v === 'string') {
      storage.setItem(k, v)
      n++
    }
  }
  return n
}
