// ─── Comandos em background (copiado do Bash run_in_background — v2.83.0) ──
//
// Paridade com o Bash do Claude Code (run_in_background + BashOutput +
// KillShell): execute_command roda síncrono (até 600s) e a IA ESPERA. Para um
// servidor de dev, watcher ou backtest longo, isto deixa a IA DISPARAR e seguir
// trabalhando, consultando a saída (incremental) quando quiser e matando o
// processo ao terminar. O processo no main (spawn + buffer capado + cleanup no
// quit) NÃO é unit-testável aqui; estes helpers de FORMATAÇÃO são puros/testáveis.

export interface BgStartResult { id?: string; pid?: number; error?: string | null }
export interface BgOutputResult {
  found?: boolean
  running?: boolean
  exitCode?: number | null
  killedByUser?: boolean
  stdout?: string
  stderr?: string
  elapsedMs?: number
}

function secs(ms: number | undefined): string {
  const s = Math.max(0, Math.round((ms || 0) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** Mensagem de início — instrui a IA a consultar/matar pelo id. */
export function formatBackgroundStart(res: BgStartResult, command: string): string {
  if (!res || res.error || !res.id) return `Não consegui iniciar o comando em background: ${res?.error || 'erro desconhecido'}.`
  const cmd = command.replace(/\s+/g, ' ').trim().slice(0, 80)
  return `Comando iniciado em BACKGROUND (id: ${res.id}${res.pid ? `, pid ${res.pid}` : ''}): "${cmd}". Continue com outro trabalho; chame get_command_output com id="${res.id}" para ver a saída nova, e kill_background_command id="${res.id}" para parar.`
}

/** Saída INCREMENTAL + status de um comando em background. */
export function formatCommandOutput(r: BgOutputResult | null | undefined, id: string): string {
  if (!r || !r.found) {
    return `Nenhum comando em background com id "${id}" — ele já terminou e foi coletado, ou o id é inválido.`
  }
  const out = (r.stdout || '').replace(/\s+$/, '')
  const err = (r.stderr || '').replace(/\s+$/, '')
  const parts: string[] = []
  if (out) parts.push(out)
  if (err) parts.push(`--- stderr ---\n${err}`)
  const t = secs(r.elapsedMs)
  if (r.killedByUser) {
    parts.push(`[bg ${id}] interrompido (${t}).`)
  } else if (r.running) {
    parts.push(out || err
      ? `[bg ${id}] AINDA RODANDO (${t}) — chame get_command_output de novo depois para mais saída.`
      : `[bg ${id}] rodando (${t}), sem saída nova ainda — aguarde e consulte de novo.`)
  } else {
    parts.push(`[bg ${id}] terminou com exit code ${r.exitCode ?? '?'} (${t}).`)
  }
  return parts.join('\n')
}
