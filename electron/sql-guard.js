// ─── Guard de SQL somente-leitura do postgres_query (puro) ──────────
//
// Protege o banco de PRODUÇÃO do PDV de uma consulta vinda do agente. Um filtro
// de palavras-chave sozinho NÃO garante leitura: no Postgres ele deixa passar
// `COPY ... TO PROGRAM` (executa comando no servidor), `SELECT pg_read_file(...)`
// (lê arquivo do servidor), `SELECT ... INTO nova_tabela` (cria tabela) e
// `SELECT pg_terminate_backend(pid)` (derruba sessões do próprio caixa). Por isso
// este guard é só a PRIMEIRA camada — as outras ficam em ipc-postgres.js:
// transação READ ONLY (a trava de verdade), protocolo estendido (o servidor
// recusa mais de uma instrução), timeouts e teto de linhas.
//
// O guard analisa o SQL com um léxico mínimo: palavras proibidas são buscadas
// no CÓDIGO, fora de strings e comentários — senão `WHERE acao = 'DELETE'` seria
// bloqueado à toa, e `"pg_read_file"(...)` com aspas passaria despercebido.
// Regra do léxico: na dúvida, trata o texto como CÓDIGO (visível). Achar que é
// string o que o Postgres lê como código esconderia um `; COMMIT; DROP ...`.

const MAX_QUERY_CHARS = 20000

// Buscadas em QUALQUER ponto do código. As 7 primeiras são as pedidas; as
// demais causam dano DENTRO de um SELECT/WITH: CTE que modifica dados, e
// `SELECT ... INTO` (cria tabela). Comandos de nível de instrução (COPY, CALL,
// DO, SET, VACUUM, LOCK...) ficam barrados pela exigência de começar com
// SELECT/WITH — checá-los como palavra solta só geraria falso positivo em
// colunas chamadas `comment`, `lock`, `copy`...
// Bordas: antes, só letra/_ impede (um dígito não: o Postgres antigo lê `1INTO`
// como `1 INTO`); depois, qualquer caractere de identificador impede.
const FORBIDDEN_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT',
  'REVOKE', 'CREATE', 'MERGE', 'INTO']
const FORBIDDEN_RE = new RegExp('(?<![A-Za-z_])(' + FORBIDDEN_KEYWORDS.join('|') + ')(?![A-Za-z0-9_$])')

// `FOR SHARE` / `FOR KEY SHARE` travam linhas do PDV (o `FOR UPDATE` e o
// `FOR NO KEY UPDATE` já caem no UPDATE acima).
const ROW_LOCK_RE = /(?<![A-Za-z_])FOR\s+(KEY\s+SHARE|SHARE)(?![A-Za-z0-9_$])/

// Funções que saem do alcance do READ ONLY ou atrapalham o caixa:
//  - leem/escrevem ARQUIVOS no servidor: pg_read_file, pg_ls_dir, pg_file_*, lo_*
//  - executam SQL numa OUTRA conexão (fora da nossa transação): dblink*
//  - executam SQL recebido em STRING — o léxico apaga strings, então o que vem
//    dentro delas não é inspecionado: query_to_xml*, ts_stat, ts_rewrite
//  - derrubam/prendem sessões e locks: pg_terminate_backend, pg_*advisory*, pg_sleep*
//  - consomem sequência (buraco na numeração de venda/NFC-e): nextval, setval
//  - mexem em configuração, estatística, backup, replicação: set_config,
//    pg_reload_conf, pg_stat_*reset*, pg_*backup*, pg_create_*...
//  - extensões que escrevem por fora: cron.* (agenda SQL para depois),
//    pg_surgery (heap_force_*), pg_visibility (pg_truncate_visibility_map)
const FORBIDDEN_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_\\w+', 'pg_stat_file', 'pg_file_\\w+', 'lo_\\w+',
  'dblink\\w*', 'query_to_xml\\w*', 'ts_stat', 'ts_rewrite',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_sleep\\w*', 'pg_(?:try_)?advisory\\w*', 'pg_notify',
  'nextval', 'setval',
  'set_config', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_promote', 'pg_switch_wal', 'pg_wal_replay_\\w+',
  'pg_stat_\\w*reset\\w*', 'pg_\\w*backup\\w*', 'pg_create_\\w+', 'pg_drop_\\w+', 'pg_replication_\\w+',
  'pg_logical_\\w+', 'pg_copy_\\w+', 'pg_import_system_collations', 'pg_log_backend_memory_contexts',
  'cron\\s*\\.\\s*\\w+', 'heap_force_\\w+', 'pg_truncate_visibility_map',
]
const FORBIDDEN_FUNCTIONS_RE = new RegExp('(?<![A-Za-z_])(' + FORBIDDEN_FUNCTIONS.join('|') + ')\\s*\\(', 'i')

/** Caractere que continua um identificador no Postgres (inclui `$` e qualquer
 *  não-ASCII). Sem escape unicode no fonte de propósito: compara o código. */
function isIdentChar(ch) {
  return typeof ch === 'string' && ch.length > 0 && (/[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127)
}

/**
 * Léxico mínimo do SQL do Postgres. Devolve duas versões "só código":
 *  - `code`: strings e comentários viram espaço, identificadores entre aspas
 *    viram um marcador neutro — base para palavras-chave e contagem de `;`;
 *  - `idents`: igual, mas com identificadores entre aspas DESEMBRULHADOS —
 *    base para as funções, para que `"pg_read_file"(...)` não escape.
 * Também marca escapes unicode (U&"..." / U&'...') e a posição, no texto
 * ORIGINAL, de cada `;` que é código (não string/comentário).
 */
function lexSql(sql) {
  let code = '', idents = '', unicodeEscape = false
  const semicolons = []
  let i = 0
  const n = sql.length
  const emit = (a, b) => { code += a; idents += (b === undefined ? a : b) }
  while (i < n) {
    const c = sql[i], d = sql[i + 1]
    if (c === '-' && d === '-') {                               // comentário de linha: termina em \n OU \r
      let j = i + 2
      while (j < n && sql[j] !== '\n' && sql[j] !== '\r') j++
      i = j; emit(' '); continue
    }
    if (c === '/' && d === '*') {                               // bloco (o Postgres ANINHA)
      let depth = 1; i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
      emit(' '); continue
    }
    if ((c === 'U' || c === 'u') && d === '&' && (sql[i + 2] === '"' || sql[i + 2] === "'")) {
      unicodeEscape = true; emit(' '); i += 2; continue          // recusado adiante
    }
    if (c === "'") {                                            // string; E'...' aceita \ como escape
      const L = code.length
      const eString = (code[L - 1] === 'e' || code[L - 1] === 'E') && !isIdentChar(code[L - 2])
      i++
      while (i < n) {
        if (eString && sql[i] === '\\') { i += 2; continue }
        if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue } i++; break }
        i++
      }
      emit(" '' "); continue
    }
    if (c === '$' && !isIdentChar(code[code.length - 1])) {     // $tag$ ... $tag$ (colado num
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80)) // identificador, o $ é
      if (m) {                                                  // parte do nome: abc$x$)
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        i = end < 0 ? n : end + tag.length
        emit(" '' "); continue
      }
    }
    if (c === '"') {                                            // "identificador"
      let j = i + 1, name = ''
      while (j < n) {
        if (sql[j] === '"') { if (sql[j + 1] === '"') { name += '"'; j += 2; continue } j++; break }
        name += sql[j]; j++
      }
      i = j; emit(' __qid__ ', ' ' + name + ' '); continue
    }
    if (c === ';') semicolons.push(i)
    emit(c); i++
  }
  return { code, idents, unicodeEscape, semicolons }
}

function block(motivo) {
  return { ok: false, error: 'Bloqueado: apenas consultas de leitura (SELECT) são permitidas — ' + motivo }
}

/**
 * Valida uma consulta para o postgres_query. Devolve `{ ok: true, query }` —
 * a consulta ORIGINAL (comentários e strings intactos), só sem o `;` final —
 * ou `{ ok: false, error }`.
 */
function validateReadOnlyQuery(input) {
  const sql = typeof input === 'string' ? input : ''
  if (!sql.trim()) return { ok: false, error: 'Consulta vazia.' }
  if (sql.length > MAX_QUERY_CHARS) return { ok: false, error: `Consulta longa demais (${sql.length} caracteres; máximo ${MAX_QUERY_CHARS}).` }

  const { code, idents, unicodeEscape, semicolons } = lexSql(sql)
  const CODE = code.toUpperCase()

  // 1) Palavras que escrevem, mudam esquema ou permissões — checadas primeiro:
  //    é o motivo mais informativo para quem mandou `DROP TABLE x;`.
  const kw = FORBIDDEN_RE.exec(CODE)
  if (kw) return block(`palavra-chave proibida: ${kw[1]}.`)
  const lock = ROW_LOCK_RE.exec(CODE)
  if (lock) return block(`FOR ${lock[1].replace(/\s+/g, ' ')} trava linhas do PDV.`)

  // 2) UMA instrução só. Um `;` é aceito apenas no fim (nada de código depois).
  let query = sql
  if (semicolons.length > 1) return block('envie uma consulta por vez (há mais de um `;`).')
  if (semicolons.length === 1) {
    const idx = semicolons[0]
    if (lexSql(sql.slice(idx + 1)).code.trim()) return block('envie uma consulta por vez (há código depois do `;`).')
    query = sql.slice(0, idx) + sql.slice(idx + 1)
  }

  // 3) Tem de COMEÇAR com SELECT ou WITH (parênteses iniciais permitidos).
  const lead = /^[\s(]*([A-Z_]+)/.exec(CODE)
  const first = lead ? lead[1] : ''
  if (first !== 'SELECT' && first !== 'WITH') return block(`a consulta começa com ${first || '(nada)'}.`)

  // 4) Escape unicode: nenhuma consulta analítica precisa, e ele esconderia o
  //    nome de uma função proibida.
  if (unicodeEscape) return block('escape unicode (U&"..." / U&\'...\') não é aceito.')

  // 5) Funções que escapam do READ ONLY ou atrapalham o caixa.
  const fn = FORBIDDEN_FUNCTIONS_RE.exec(idents)
  if (fn) return block(`função não permitida: ${fn[1].replace(/\s+/g, '').toLowerCase()}().`)

  return { ok: true, query: query.trim() }
}

/** Envolve a consulta num SELECT externo com LIMIT: protege a memória do app e
 *  do banco de um resultado gigante. As quebras de linha ao redor importam — um
 *  `-- comentário` no fim da consulta comentaria o `)` se estivesse na mesma
 *  linha. */
function wrapWithLimit(query, limit) {
  const n = Math.max(1, Math.floor(Number(limit) || 1))
  return `SELECT * FROM (\n${query}\n) AS __oc_q LIMIT ${n}`
}

module.exports = { validateReadOnlyQuery, wrapWithLimit, lexSql, MAX_QUERY_CHARS, FORBIDDEN_KEYWORDS }
