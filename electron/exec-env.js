// ─── Sanitização do env extra do exec-command (puro) ────────────────
//
// A varredura apontou que exec-command mesclava `env` no process.env sem
// validar as CHAVES. Mesmo que hoje os hooks usem chaves fixas, uma chave
// controlável poderia sobrescrever PATH (hijack de binário) ou injetar
// NODE_OPTIONS/LD_PRELOAD/PSModulePath (carregar código no filho). Aqui só
// passam chaves com formato seguro, fora da denylist de hijack, com valor
// limitado em tamanho. Puro/testável.

// Variáveis que mudam QUE código o processo filho carrega/executa.
const BLOCKED_ENV_KEYS = new Set([
  'path', 'node_options', 'electron_run_as_node', 'psmodulepath',
  'ld_preload', 'ld_library_path', 'dyld_insert_libraries', 'dyld_library_path',
  'pythonpath', 'pythonstartup', 'comspec', 'shell',
])

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_VAL = 16384

/** Filtra o env extra: só chaves com formato válido, fora da denylist, com
 *  valor coagido a string e limitado. Devolve null se nada sobra. */
function sanitizeChildEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return null
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (!KEY_RE.test(k)) continue
    if (BLOCKED_ENV_KEYS.has(k.toLowerCase())) continue
    out[k] = String(v == null ? '' : v).slice(0, MAX_VAL)
  }
  return Object.keys(out).length ? out : null
}

module.exports = { sanitizeChildEnv, BLOCKED_ENV_KEYS }
