import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ChatMessage from '../src/components/ChatMessage'
import { formatMarkdown } from '../src/utils/formatting'
import type { Message } from '../src/types'

// Wrap formatMarkdown in a spy (passthrough). ChatMessage calls it during
// render, so its call count is a render-count probe for the memo contract.
vi.mock('../src/utils/formatting', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/utils/formatting')>()
  return { ...mod, formatMarkdown: vi.fn(mod.formatMarkdown) }
})

const formatMarkdownMock = vi.mocked(formatMarkdown)

function msg(over: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ola **mundo**',
    timestamp: new Date('2026-01-01T12:00:00'),
    ...over,
  }
}

function baseProps() {
  return {
    language: 'pt',
    showThinking: true,
    mathReady: false,
    collapsedTools: new Set<string>(),
    onToggleCollapse: vi.fn(),
    onOpenArtifact: vi.fn(),
    onRegenerate: vi.fn(),
    onBranch: vi.fn(),
    onDelete: vi.fn(),
    onEditResend: vi.fn(),
    showToast: vi.fn(),
  }
}

beforeEach(() => {
  formatMarkdownMock.mockClear()
})

describe('ChatMessage - rendering (behavior preserved from the inline App map)', () => {
  it('renders markdown content and role class', () => {
    const { container } = render(<ChatMessage msg={msg()} {...baseProps()} />)
    expect(container.querySelector('.message-assistant')).toBeTruthy()
    expect(container.querySelector('.message-text')?.innerHTML).toContain('<strong>mundo</strong>')
  })

  it('shows the thinking block only when showThinking is true', () => {
    const m = msg({ thinking: 'pensei nisso' })
    const props = baseProps()
    const a = render(<ChatMessage msg={m} {...props} showThinking={true} />)
    expect(a.container.querySelector('.thinking-block')).toBeTruthy()
    const b = render(<ChatMessage msg={m} {...props} showThinking={false} />)
    expect(b.container.querySelector('.thinking-block')).toBeNull()
  })

  it('offers the artifact button for assistant messages with an html fence', () => {
    const props = baseProps()
    const m = msg({ content: '```html\n<h1>oi</h1>\n```' })
    const { getByText } = render(<ChatMessage msg={m} {...props} />)
    fireEvent.click(getByText(/Visualizar artefato/))
    expect(props.onOpenArtifact).toHaveBeenCalledTimes(1)
  })

  it('collapses long tool results by default and reports toggles upward', () => {
    const props = baseProps()
    const m = msg({
      toolCalls: [{ id: 't1', name: 'execute_command', arguments: { command: 'dir' } }],
      toolResults: [{ toolCallId: 't1', name: 'execute_command', result: 'x'.repeat(300) }],
    })
    const { container } = render(<ChatMessage msg={m} {...props} />)
    expect(container.querySelector('.tool-call-args')).toBeNull() // collapsed
    fireEvent.click(container.querySelector('.tool-call-header')!)
    expect(props.onToggleCollapse).toHaveBeenCalledWith('m1-0')
  })

  it('wires delete/branch/regenerate actions with the message id', () => {
    const props = baseProps()
    const { container, getByLabelText } = render(<ChatMessage msg={msg()} {...props} />)
    fireEvent.click(getByLabelText('Branch'))
    expect(props.onBranch).toHaveBeenCalledWith('m1')
    fireEvent.click(getByLabelText('Regenerate'))
    expect(props.onRegenerate).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('[title="Excluir mensagem"]')!)
    expect(props.onDelete).toHaveBeenCalledWith('m1')
  })

  it('does not offer Regenerate on user messages', () => {
    const { queryByLabelText } = render(<ChatMessage msg={msg({ role: 'user' })} {...baseProps()} />)
    expect(queryByLabelText('Regenerate')).toBeNull()
  })

  it('offers Edit only on user messages, never on assistant ones', () => {
    const userView = render(<ChatMessage msg={msg({ role: 'user', content: 'pergunta' })} {...baseProps()} />)
    expect(userView.container.querySelector('.msg-edit-btn')).toBeTruthy()
    const asstView = render(<ChatMessage msg={msg({ role: 'assistant', content: 'resposta' })} {...baseProps()} />)
    expect(asstView.container.querySelector('.msg-edit-btn')).toBeNull()
  })

  it('hides Edit when no onEditResend handler is provided', () => {
    const props = baseProps()
    const { queryByLabelText } = render(<ChatMessage msg={msg({ role: 'user', content: 'oi' })} {...props} onEditResend={undefined} />)
    expect(queryByLabelText('Editar mensagem')).toBeNull()
  })

  it('opens an in-place editor and saves the edited text upward', () => {
    const props = baseProps()
    const { container, getByLabelText } = render(<ChatMessage msg={msg({ id: 'u9', role: 'user', content: 'texto antigo' })} {...props} />)
    fireEvent.click(getByLabelText('Editar mensagem'))
    const area = container.querySelector('.message-edit-area') as HTMLTextAreaElement
    expect(area).toBeTruthy()
    expect(area.value).toBe('texto antigo')
    fireEvent.change(area, { target: { value: 'texto novo' } })
    fireEvent.click(container.querySelector('.message-edit-save')!)
    expect(props.onEditResend).toHaveBeenCalledWith('u9', 'texto novo')
    // editor closes back to the rendered bubble
    expect(container.querySelector('.message-edit-area')).toBeNull()
  })

  it('cancels the editor without calling onEditResend', () => {
    const props = baseProps()
    const { container, getByLabelText } = render(<ChatMessage msg={msg({ role: 'user', content: 'oi' })} {...props} />)
    fireEvent.click(getByLabelText('Editar mensagem'))
    fireEvent.click(container.querySelector('.message-edit-cancel')!)
    expect(props.onEditResend).not.toHaveBeenCalled()
    expect(container.querySelector('.message-edit-area')).toBeNull()
  })

  it('shows the main argument in the tool-call header (v2.12.52)', () => {
    const m = msg({
      toolCalls: [{ id: 't1', name: 'execute_command', arguments: { command: 'npm run build' } }],
      toolResults: [{ toolCallId: 't1', name: 'execute_command', result: 'ok' }],
    })
    const { container } = render(<ChatMessage msg={m} {...baseProps()} />)
    expect(container.querySelector('.tool-call-summary')?.textContent).toBe('npm run build')
  })

  it('flags a failed execute_command with the error badge', () => {
    const m = msg({
      toolCalls: [{ id: 't1', name: 'execute_command', arguments: { command: 'npm run biuld' } }],
      toolResults: [{ toolCallId: 't1', name: 'execute_command', result: 'npm ERR! missing script\n[exit code: 1]' }],
    })
    const { container } = render(<ChatMessage msg={m} {...baseProps()} />)
    expect(container.querySelector('.tool-call-badge-error')?.textContent).toBe('erro')
  })

  it('shows no badge on success and no summary when there is no primary arg', () => {
    const m = msg({
      toolCalls: [{ id: 't1', name: 'plan_tasks', arguments: {} }],
      toolResults: [{ toolCallId: 't1', name: 'plan_tasks', result: 'Task plan created' }],
    })
    const { container } = render(<ChatMessage msg={m} {...baseProps()} />)
    expect(container.querySelector('.tool-call-badge-error')).toBeNull()
    expect(container.querySelector('.tool-call-summary')).toBeNull()
  })
})

describe('ChatMessage - memo contract (the point of the extraction)', () => {
  it('does NOT re-render when re-rendered with identical props (streaming-chunk scenario)', () => {
    const props = baseProps()
    const m = msg()
    const { rerender } = render(<ChatMessage msg={m} {...props} />)
    const callsAfterMount = formatMarkdownMock.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)
    // App re-renders on every streaming chunk; past messages keep identical
    // prop identities and must bail out of rendering entirely.
    rerender(<ChatMessage msg={m} {...props} />)
    rerender(<ChatMessage msg={m} {...props} />)
    expect(formatMarkdownMock.mock.calls.length).toBe(callsAfterMount)
  })

  it('re-renders when the message object changes', () => {
    const props = baseProps()
    const m = msg()
    const { rerender } = render(<ChatMessage msg={m} {...props} />)
    const callsAfterMount = formatMarkdownMock.mock.calls.length
    rerender(<ChatMessage msg={{ ...m, content: 'novo texto' }} {...props} />)
    expect(formatMarkdownMock.mock.calls.length).toBeGreaterThan(callsAfterMount)
  })

  it('re-renders once when mathReady flips (lazy KaTeX upgrade path)', () => {
    const props = baseProps()
    const m = msg()
    const { rerender } = render(<ChatMessage msg={m} {...props} mathReady={false} />)
    const callsAfterMount = formatMarkdownMock.mock.calls.length
    rerender(<ChatMessage msg={m} {...props} mathReady={true} />)
    expect(formatMarkdownMock.mock.calls.length).toBeGreaterThan(callsAfterMount)
  })

  it('re-renders when collapsedTools identity changes (user toggle)', () => {
    const props = baseProps()
    const m = msg({
      toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'a.txt' } }],
      toolResults: [{ toolCallId: 't1', name: 'read_file', result: 'x'.repeat(300) }],
    })
    const { container, rerender } = render(<ChatMessage msg={m} {...props} />)
    expect(container.querySelector('.tool-call-args')).toBeNull()
    rerender(<ChatMessage msg={m} {...props} collapsedTools={new Set(['m1-0'])} />)
    expect(container.querySelector('.tool-call-args')).toBeTruthy() // expanded now
  })
})
