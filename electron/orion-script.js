// ─── ORION — construção SEGURA do script PowerShell (puro) ──────────
//
// O handler orion-run-action monta um script .ps1 a partir de params vindos do
// MODELO (não confiáveis) e o executa. O bug (varredura v2.111): dentro de uma
// string PowerShell de aspas DUPLAS, `$(...)` e `$var` são EXPANDIDOS — então
// SendWait("$(whoami)") executava `whoami`. Além disso o SendKeys do .NET
// interpreta +^%~(){}[] como teclas especiais, e open_app usava aspas duplas
// (expansível). Aqui ficam os escapes PUROS + a montagem do script, testáveis
// sem Electron. main.js só escreve e executa o que buildOrionScript devolve.

/** Escapa para DENTRO de uma string PowerShell de aspas DUPLAS: neutraliza
 *  backtick, $ (impede $()/$var) e a aspa dupla. */
function psEscapeDouble(s) {
  return String(s == null ? '' : s)
    .replace(/`/g, '``')   // backtick primeiro (senão re-escaparia os que adicionamos)
    .replace(/\$/g, '`$')  // $ → `$  (impede expansão de subexpressão/variável)
    .replace(/"/g, '`"')   // aspa dupla → `"
}

/** Escapa ' dobrando-a, para uso DENTRO de string PowerShell de aspas SIMPLES
 *  (que NÃO expande nada). */
function psSingleQuote(s) {
  return String(s == null ? '' : s).replace(/'/g, "''")
}

/** Escapa para SendKeys: +^%~(){}[] viram literais ({+}, {(}, …); então mapeia
 *  as sequências de controle desejadas (\n→{ENTER}, \t→{TAB}). A ordem importa:
 *  os metacaracteres são escapados ANTES, e os {ENTER}/{TAB} são adicionados
 *  DEPOIS (suas chaves não devem ser re-escapadas). */
function sendKeysEscape(s) {
  let t = String(s == null ? '' : s)
  t = t.replace(/[+^%~(){}\[\]]/g, (c) => `{${c}}`)
  t = t.replace(/\r\n|\r|\n/g, '{ENTER}').replace(/\t/g, '{TAB}')
  return t
}

/** Coage para inteiro FINITO (default 0) — garante que nenhum token estranho
 *  (NaN, string) vaze para o script numérico. */
function num(v) {
  const x = Math.round(Number(v))
  return Number.isFinite(x) ? x : 0
}

/** Monta o script PowerShell para uma ação ORION. params numéricos são
 *  coagidos a inteiro finito (sem injeção); texto/app passam pelos escapes
 *  acima. Devolve a string do script, ou null se o tipo é desconhecido. */
function buildOrionScript(type, params = {}) {
  switch (type) {
    case 'move_mouse':
      return `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${num(params.x)}, ${num(params.y)})`
    case 'click': {
      const cx = num(params.x), cy = num(params.y)
      return `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${cx}, ${cy})\nAdd-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices;\npublic class MC18 { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int c,int e); }\n"@\n[MC18]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 80; [MC18]::mouse_event(4,0,0,0,0)`
    }
    case 'type_text': {
      // Texto LITERAL: escapa metacaracteres do SendKeys e então o contexto PS.
      const safeText = psEscapeDouble(sendKeysEscape(params.text || ''))
      return `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait("${safeText}")`
    }
    case 'key_press': {
      // `key` é uma sequência SendKeys intencional (ex.: {ENTER}, ^c) — preserva
      // a sintaxe SendKeys mas neutraliza expansão PS ($()/backtick).
      const safeKey = psEscapeDouble(params.key || '{ENTER}')
      return `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait("${safeKey}")`
    }
    case 'wait':
      return `Start-Sleep -Milliseconds ${Math.min(Math.max(0, num(params.ms == null ? 1000 : params.ms)), 30000)}`
    case 'scroll':
      return `Add-Type -TypeDefinition @"\nusing System; using System.Runtime.InteropServices;\npublic class SC18 { [DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int c,int e); }\n"@\n[SC18]::mouse_event(0x0800,0,0,${num((params.delta == null ? 3 : params.delta) * 120)},0)`
    case 'open_app':
      // Aspas SIMPLES (não expandem) + escape de ' → impede injeção de args.
      return `Start-Process '${psSingleQuote(params.app || '')}'`
    default:
      return null
  }
}

module.exports = { psEscapeDouble, psSingleQuote, sendKeysEscape, buildOrionScript }
