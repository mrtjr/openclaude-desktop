// ─── Caminho das ferramentas memory_* (puro) ────────────────────────
//
// memory_write/memory_append estão em SAFE_TOOLS (rodam sem aprovação) — o que
// só é aceitável porque escrevem DENTRO de .claude/memory. O caminho vem do
// modelo e só perdia as barras iniciais: `../../src/App.tsx`, ou a pasta
// Inicializar do Windows, virava escrita em qualquer lugar sem o usuário ver.
// Aqui ele é relativo à pasta de memória e não tem como sair dela.

export const MEMORY_DIR = '.claude/memory'

/** `{ rel }` normalizado (segmentos separados por `/`) ou `{ error }` quando o
 *  caminho sairia da pasta de memória: `..` (ou só pontos), drive (`C:`),
 *  stream NTFS (`a:b`) — ou quando está vazio. */
export function resolveMemoryPath(raw: unknown): { rel: string } | { error: string } {
  const segs = String(raw ?? '').replace(/\\/g, '/').split('/').map((s) => s.trim()).filter((s) => s && s !== '.')
  if (!segs.length) return { error: 'informe o arquivo dentro da memória (ex.: /perfil.md).' }
  if (segs.some((s) => /^\.{2,}$/.test(s) || s.includes(':'))) {
    return { error: `caminho fora da pasta de memória recusado: "${String(raw)}".` }
  }
  return { rel: segs.join('/') }
}
