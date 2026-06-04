import type { ParsedSlash } from '../utils/slashCommands'

interface SlashPopoverProps {
  /** Result of parseSlashInput(input); pass null to render nothing. */
  slash: ParsedSlash | null
  /** Index of the currently-selected suggestion (for ↑↓ nav). */
  selectedIdx: number
  /** Called when the user hovers a suggestion — updates selection. */
  onHover: (idx: number) => void
  /** Called when the user clicks a suggestion — executes the command. */
  onExecute: (name: string, arg: string) => void
  language: 'pt' | 'en'
}

/**
 * Popover that appears above the composer when the input parses as a
 * slash command. Keyboard handling (↑↓/Tab/Enter/Esc) lives in the
 * parent because it needs to coexist with the textarea's normal key
 * flow; this component only owns presentation + mouse interactions.
 */
export function SlashPopover({
  slash, selectedIdx, onHover, onExecute, language,
}: SlashPopoverProps) {
  if (!slash || slash.matches.length === 0) return null
  const isEn = language === 'en'

  return (
    <div className="slash-popover" role="listbox" aria-label={isEn ? 'Slash commands' : 'Comandos'}>
      <div className="slash-popover-header">
        {isEn ? 'Commands' : 'Comandos'}
        <span className="slash-popover-hint">
          ↑↓ {isEn ? 'nav' : 'navegar'} · Tab {isEn ? 'complete' : 'completar'} · Enter {isEn ? 'run' : 'executar'}
        </span>
      </div>
      {slash.matches.map((cmd, i) => {
        const active = i === selectedIdx
        const desc = isEn ? (cmd.descriptionEn || cmd.description) : cmd.description
        const hint = isEn ? (cmd.argHintEn || cmd.argHint) : cmd.argHint
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={active}
            className={`slash-popover-item ${active ? 'active' : ''}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onExecute(cmd.name, slash.arg)}
          >
            <span className="slash-popover-name">/{cmd.name}</span>
            {hint && <span className="slash-popover-arg">{hint}</span>}
            <span className="slash-popover-desc">{desc}</span>
          </button>
        )
      })}
    </div>
  )
}
