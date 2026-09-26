/**
 * ipc-postgres.js
 * postgres_query: consultas SOMENTE-LEITURA no banco do NovoPdv (PostgreSQL).
 * Loaded by main.js via: require('./ipc-postgres')(ipcMain, app)
 *
 * Camadas, nesta ordem — cada uma segura o que a anterior deixar passar:
 *  1. guard léxico (sql-guard.js): bloqueia ANTES de ler o .env ou conectar;
 *  2. transação READ ONLY: o próprio Postgres recusa qualquer escrita;
 *  3. protocolo estendido: o servidor recusa mais de uma instrução, então um
 *     `; COMMIT; DROP ...` escondido não roda nem se o guard errar a leitura;
 *  4. statement_timeout / lock_timeout: o caixa não trava por uma consulta;
 *  5. teto de linhas (LIMIT externo): o resultado nunca estoura a memória.
 * A connection string (DATABASE_URL) fica só no processo principal: nunca vai
 * ao renderer, ao modelo nem ao log, e é redigida de qualquer mensagem de erro.
 * O .env que a guarda é registrado como caminho PROTEGIDO (path-safety): sem
 * isso, read_file — que roda sem aprovação — lia a senha e a dava ao modelo.
 * O ideal continua sendo um usuário SÓ-LEITURA no banco (GRANT SELECT) — é a
 * única camada que vale também para funções do próprio banco.
 */

const path = require('path')
const fs = require('fs')
const { Client, types: pgTypes } = require('pg')
const { validateReadOnlyQuery, wrapWithLimit } = require('./sql-guard')
const { protectPath } = require('./path-safety')

const MAX_ROWS = 200
const STATEMENT_TIMEOUT_MS = 15000
const LOCK_TIMEOUT_MS = 3000
const CONNECT_TIMEOUT_MS = 8000

// Datas/horas/intervalos voltam como o TEXTO do banco: o parser padrão do pg
// cria Date no fuso local e um `date` 2026-09-26 viraria 2026-09-26T03:00Z.
// date, time, timestamp, timestamptz, interval, timetz + os arrays deles.
const RAW_TEXT_OIDS = new Set([1082, 1083, 1114, 1184, 1186, 1266, 1182, 1183, 1115, 1185, 1187, 1270])
const TYPES = {
  getTypeParser: (oid, format) => (RAW_TEXT_OIDS.has(oid) && format !== 'binary' ? (v) => v : pgTypes.getTypeParser(oid, format)),
}

/** Lê o .env tolerando BOM UTF-8 e UTF-16 (o `>` do PowerShell 5 grava UTF-16). */
function readEnvText(file) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf-8')
  return buf.toString('utf-8')
}

/** Parser mínimo de .env: KEY=VALOR, `export` opcional, aspas opcionais,
 *  comentário com # (linha inteira, ou após espaço num valor sem aspas). */
function parseEnv(text) {
  const vars = {}
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    const q = v[0]
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    vars[m[1]] = v
  }
  return vars
}

/** DATABASE_URL do primeiro .env que a tiver; senão, da variável de ambiente. */
function loadDatabaseUrl(envFiles) {
  for (const file of envFiles) {
    try {
      if (!fs.existsSync(file)) continue
      const url = String(parseEnv(readEnvText(file)).DATABASE_URL || '').trim()
      if (url) return url
    } catch { /* ilegível: tenta o próximo */ }
  }
  return String(process.env.DATABASE_URL || '').trim() || null
}

/** Tira da mensagem a connection string e a senha (crua e decodificada). */
function redact(message, connectionString) {
  let m = String(message || 'falha desconhecida')
  const secrets = []
  if (connectionString) {
    secrets.push(connectionString)
    try {
      const pw = new URL(connectionString).password
      if (pw && pw.length >= 4) { secrets.push(pw); try { secrets.push(decodeURIComponent(pw)) } catch { /* % inválido */ } }
    } catch { /* não é URL */ }
  }
  for (const s of secrets) if (s) m = m.split(s).join('***')
  return m.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[DATABASE_URL]')
}

/** Valor de célula → algo que o JSON e o IPC transportam sem surpresa. */
function toJsonSafe(v) {
  if (v === null || v === undefined) return null
  if (Buffer.isBuffer(v)) return `<bytea ${v.length} bytes>`
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(toJsonSafe)
  return v
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => { setTimeout(resolve, ms).unref() })])

/**
 * Executa `query` no banco, só leitura. `resolveConnection` só é chamado DEPOIS
 * do guard aprovar — uma consulta bloqueada não lê o .env nem abre conexão.
 * Devolve `{ columns, rows, rowCount, truncated, ms, error: null }` ou
 * `{ error, blocked? }`.
 */
async function runReadOnlyQuery(query, { resolveConnection, envHint, ClientImpl = Client } = {}) {
  const check = validateReadOnlyQuery(query)
  if (!check.ok) return { error: check.error, blocked: true }

  const connectionString = resolveConnection ? resolveConnection() : null
  if (!connectionString) {
    return {
      error: 'DATABASE_URL não configurada. Crie o arquivo ' + (envHint ? `"${envHint}"` : '.env') +
        ' com a linha DATABASE_URL=postgres://usuario:senha@host:5432/banco (de preferência um usuário só-leitura).',
    }
  }

  const client = new ClientImpl({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5000,       // backstop do lado do cliente
    application_name: 'openclaude-analytics',
    types: TYPES,
  })
  const t0 = Date.now()
  let connected = false
  try {
    await client.connect()
    connected = true
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
    await client.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`)
    // O guard lê strings no padrão SQL (\ é literal fora de E'...'); força o
    // servidor a ler igual, mesmo num banco legado com essa opção desligada.
    await client.query('SET LOCAL standard_conforming_strings = on')
    const res = await client.query({ text: wrapWithLimit(check.query, MAX_ROWS + 1), rowMode: 'array', queryMode: 'extended' })
    const truncated = res.rows.length > MAX_ROWS
    const rows = res.rows.slice(0, MAX_ROWS).map((r) => r.map(toJsonSafe))
    return { columns: res.fields.map((f) => f.name), rows, rowCount: rows.length, truncated, ms: Date.now() - t0, error: null }
  } catch (e) {
    const code = e && e.code && /^[0-9A-Z]{5}$/.test(e.code) ? ` (SQLSTATE ${e.code})` : ''
    return { error: redact(e && e.message, connectionString) + code }
  } finally {
    if (connected) { try { await withTimeout(client.query('ROLLBACK'), 2000) } catch { /* conexão já caiu */ } }
    try { await withTimeout(client.end(), 2000) } catch { /* já fechado */ }
  }
}

function registerPostgresHandlers(ipcMain, app) {
  const userEnv = () => path.join(app.getPath('userData'), '.env')
  // Em dev, o .env da raiz do projeto vem primeiro; instalado, só o do userData
  // (nada de .env dentro do pacote — o electron-builder nem o empacota).
  const envFiles = () => (app.isPackaged ? [userEnv()] : [path.join(app.getAppPath(), '.env'), userEnv()])
  for (const f of envFiles()) protectPath(f)

  ipcMain.handle('postgres-query', async (event, { query } = {}) => {
    try {
      return await runReadOnlyQuery(query, { resolveConnection: () => loadDatabaseUrl(envFiles()), envHint: userEnv() })
    } catch (e) {
      return { error: 'Falha inesperada no postgres_query: ' + redact(e && e.message, null) }
    }
  })
}

module.exports = registerPostgresHandlers
module.exports.runReadOnlyQuery = runReadOnlyQuery
