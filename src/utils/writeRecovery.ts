// ─── Recuperar uma escrita/criação TRUNCADA (v2.161.0 / v2.162.0) ───────────
// Quando o modelo escreve um arquivo grande (write_file) ou cria uma skill
// grande (save_skill) e a resposta é cortada pelo limite de tokens, os
// ARGUMENTOS da chamada (JSON) chegam incompletos → JSON.parse falha (o renderer
// guarda o cru em raw_invalid_json). Antes, gravávamos lixo/vazio e NADA parcial
// era salvo → ao pedir "continuar" o modelo recomeçava do zero. Aqui recuperamos
// os campos que chegaram, p/ salvar o parcial e mandar CONTINUAR ANEXANDO
// (append) em vez de recomeçar. Puro/testável.

/** Desescapa uma string JSON (\n \t \" \\ \uXXXX …) de forma TOLERANTE: uma
 *  barra invertida solta no fim (corte no meio de um escape) é descartada, e um
 *  \u incompleto é ignorado — nunca lança. */
function unescapeJsonString(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') { out += c; continue }
    const n = s[i + 1]
    if (n === undefined) break // barra solta no fim (truncado) → descarta
    i++
    switch (n) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      case '/': out += '/'; break
      case 'u': {
        const hex = s.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4 }
        // \u incompleto no fim (truncado) → ignora
        break
      }
      default: out += n
    }
  }
  return out
}

/** Retorna o trecho de `s` até a primeira aspa NÃO-escapada (fim do valor JSON),
 *  ou `s` inteiro se não houver (valor truncado, sem aspa de fechamento). */
function cutAtUnescapedQuote(s: string): string {
  let backslashes = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') { backslashes++; continue }
    if (c === '"' && backslashes % 2 === 0) return s.slice(0, i)
    backslashes = 0
  }
  return s
}

/**
 * Extrai o valor (string) de um campo de um JSON possivelmente TRUNCADO.
 * `complete` indica se havia aspa de fechamento (campo veio inteiro) ou se o
 * valor foi cortado no meio. Null se o campo não aparece. v2.162.0.
 */
export function extractJsonStringField(raw: string, field: string): { value: string; complete: boolean } | null {
  const s = String(raw || '')
  const re = new RegExp('"' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s*:\\s*"')
  const m = re.exec(s)
  if (!m) return null
  const after = s.slice(m.index + m[0].length)
  const cut = cutAtUnescapedQuote(after)
  const complete = cut.length < after.length // achou a aspa de fechamento
  return { value: unescapeJsonString(cut), complete }
}

export interface SalvagedWrite {
  path: string
  content: string
  /** O JSON (parcial) já declarava append:true antes do corte? */
  appendHint: boolean
}

/**
 * Recupera { path, content, appendHint } de um JSON de argumentos de write_file
 * TRUNCADO. Null se não der p/ achar um caminho COMPLETO (ex.: o corte veio antes
 * do `path`) — aí não há onde salvar e o caller orienta a escrever em pedaços.
 */
export function salvageTruncatedWrite(raw: string): SalvagedWrite | null {
  const p = extractJsonStringField(raw, 'path')
  if (!p || !p.complete || !p.value) return null
  const c = extractJsonStringField(raw, 'content')
  const appendHint = /"append"\s*:\s*true/.test(String(raw || ''))
  return { path: p.value, content: c ? c.value : '', appendHint }
}

export interface SalvagedSkill {
  name: string
  description?: string
  instructions: string
  appendHint: boolean
}

/**
 * Recupera { name, description?, instructions, appendHint } de um JSON de
 * argumentos de save_skill TRUNCADO. Null se não der p/ achar um nome COMPLETO.
 * v2.162.0 — paridade com salvageTruncatedWrite p/ skills grandes.
 */
export function salvageTruncatedSkill(raw: string): SalvagedSkill | null {
  const n = extractJsonStringField(raw, 'name')
  if (!n || !n.complete || !n.value) return null
  const d = extractJsonStringField(raw, 'description')
  const ins = extractJsonStringField(raw, 'instructions')
  const appendHint = /"append"\s*:\s*true/.test(String(raw || ''))
  return {
    name: n.value,
    ...(d && d.complete ? { description: d.value } : {}),
    instructions: ins ? ins.value : '',
    appendHint,
  }
}
