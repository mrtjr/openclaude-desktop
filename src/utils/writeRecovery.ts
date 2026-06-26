// ─── Recuperar uma escrita TRUNCADA (v2.161.0) ──────────────────────
// Quando o modelo escreve um arquivo grande via write_file e a resposta é
// cortada pelo limite de tokens, os ARGUMENTOS da chamada (JSON) chegam
// incompletos → JSON.parse falha (o renderer guarda o cru em raw_invalid_json).
// Antes, write_file então gravava lixo/vazio e NADA parcial era salvo → ao pedir
// "continuar" o modelo recomeçava do zero. Aqui recuperamos o `path` e o trecho
// de `content` que chegou, p/ salvar o parcial e mandar o modelo CONTINUAR
// ANEXANDO (append) em vez de recomeçar. Puro/testável.

export interface SalvagedWrite {
  path: string
  content: string
  /** O JSON (parcial) já declarava append:true antes do corte? */
  appendHint: boolean
}

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
 * Recupera { path, content, appendHint } de um JSON de argumentos de write_file
 * TRUNCADO. Null se não der p/ achar o caminho (ex.: o corte veio antes do
 * `path`) — aí não há onde salvar e o caller orienta a escrever em pedaços.
 */
export function salvageTruncatedWrite(raw: string): SalvagedWrite | null {
  const s = String(raw || '')
  const pm = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s)
  if (!pm) return null
  const path = unescapeJsonString(pm[1])
  if (!path) return null
  const cm = /"content"\s*:\s*"/.exec(s)
  // Sem nenhum content ainda (cortou antes) → salva vazio só p/ criar o arquivo.
  const rawContent = cm ? cutAtUnescapedQuote(s.slice(cm.index + cm[0].length)) : ''
  const appendHint = /"append"\s*:\s*true/.test(s)
  return { path, content: unescapeJsonString(rawContent), appendHint }
}
