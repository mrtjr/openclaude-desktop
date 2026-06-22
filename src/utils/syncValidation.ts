// ─── Validação de payload de sync (puro) ────────────────────────────
//
// A varredura apontou que applySnapshot aplicava dados sincronizados sem validar
// a SHAPE dos elementos: um array de objetos malformados (sem id/name, vindos de
// uma linha corrompida no servidor ou de um payload adulterado) era gravado via
// replaceAll, deixando o estado local inconsistente. Aqui ficam os validadores
// PUROS; o App filtra antes de aplicar e avisa o que foi descartado.

/** Mantém só os elementos que são objetos com TODOS os `requiredStringFields`
 *  presentes como string não-vazia. Descarta o resto (corrompido). Devolve a
 *  lista limpa + quantos foram descartados. */
export function filterValidRecords(
  arr: any,
  requiredStringFields: string[],
): { valid: any[]; dropped: number } {
  if (!Array.isArray(arr)) return { valid: [], dropped: 0 }
  const valid = arr.filter((x) =>
    x && typeof x === 'object' && !Array.isArray(x) &&
    requiredStringFields.every((f) => typeof x[f] === 'string' && x[f].trim().length > 0),
  )
  return { valid, dropped: arr.length - valid.length }
}

/** Campos mínimos por tipo sincronizado (arrays de registros). */
export const SYNC_REQUIRED_FIELDS: Record<string, string[]> = {
  profiles: ['id', 'name'],
  personas: ['id', 'name'],
  scheduledTasks: ['id'],
}

/** Coage um valor de chave de API a string (descarta não-string — uma chave que
 *  veio como objeto/array é corrupção). null = inválido (não aplicar). */
export function validApiKey(v: any): string | null {
  return typeof v === 'string' ? v : null
}
