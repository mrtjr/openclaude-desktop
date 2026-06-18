/**
 * Slash commands for the composer (v2.11.0).
 *
 * When the composer input begins with "/", a popover offers quick
 * actions that bypass the send pipeline. Inspired by ChatGPT canvas
 * and Claude Desktop slash commands — we keep the surface small
 * because each command is also reachable via menus or shortcuts.
 */

export interface SlashCommand {
  /** token that matches at the start of input, no slash */
  name: string
  /** argument hint shown in the popover */
  argHint?: string
  /** short description for the popover */
  description: string
  /** i18n hook — return PT vs EN text */
  descriptionEn?: string
  argHintEn?: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Iniciar nova conversa (limpa histórico)',
    descriptionEn: 'Start a new conversation (clears history)',
  },
  {
    name: 'model',
    argHint: '[nome]',
    argHintEn: '[name]',
    description: 'Trocar modelo ativo',
    descriptionEn: 'Switch active model',
  },
  {
    name: 'system',
    argHint: '<prompt>',
    argHintEn: '<prompt>',
    description: 'Definir system prompt da sessão',
    descriptionEn: 'Set session system prompt',
  },
  {
    name: 'regen',
    description: 'Regenerar última resposta',
    descriptionEn: 'Regenerate last answer',
  },
  {
    name: 'theme',
    argHint: '[dark|light|oled]',
    argHintEn: '[dark|light|oled]',
    description: 'Alternar tema',
    descriptionEn: 'Toggle theme',
  },
  {
    name: 'compact',
    argHint: '[instruções]',
    argHintEn: '[instructions]',
    description: 'Resumir mensagens antigas para liberar contexto',
    descriptionEn: 'Summarize older messages to free context',
  },
  {
    name: 'context',
    description: 'Abrir painel da janela de contexto',
    descriptionEn: 'Open the context window panel',
  },
  {
    name: 'config',
    argHint: 'chave=valor',
    argHintEn: 'key=value',
    description: 'Mudar uma configuração (ex.: temperature=0.3 effort=high)',
    descriptionEn: 'Change a setting (e.g. temperature=0.3 effort=high)',
  },
]

export interface ParsedSlash {
  kind: 'slash'
  name: string           // token after slash (may be partial)
  arg: string            // everything after first space
  matches: SlashCommand[] // commands matching the current prefix
}

/**
 * Parse composer input. Returns a ParsedSlash only when the input
 * clearly looks like a command invocation (starts with a single "/").
 */
export function parseSlashInput(input: string): ParsedSlash | null {
  if (!input.startsWith('/')) return null
  if (input.startsWith('//')) return null // escape: "//" = literal "/"
  const rest = input.slice(1)
  const spaceIdx = rest.indexOf(' ')
  const name = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)
  const arg = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1)
  const lower = name.toLowerCase()
  const matches = SLASH_COMMANDS.filter(c => c.name.startsWith(lower))
  return { kind: 'slash', name: lower, arg, matches }
}
