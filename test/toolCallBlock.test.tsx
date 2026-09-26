// ─── ToolCallBlock: status por estado (v2.213.0) ────────────────────
//
// O commit 59d56af tinha uma intenção boa — pendente/erro abertos, sucesso
// fechado, ícone de estado — implementada com estado local, <details> e classes
// Tailwind de um projeto que não tem Tailwind. A reescrita mantém a intenção;
// estes testes a travam, junto dos contratos que o commit tinha quebrado.

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ToolCallBlock from '../src/components/ToolCallBlock'
import type { ToolCall, ToolResult } from '../src/types'

const tc: ToolCall = { id: 't1', name: 'execute_command', arguments: { command: 'npm test' } } as ToolCall
const ok: ToolResult = { toolCallId: 't1', name: 'execute_command', result: 'All tests passed' }
const fail: ToolResult = { toolCallId: 't1', name: 'execute_command', result: 'npm ERR! missing script\n[exit code: 1]' }

const renderBlock = (result?: ToolResult, opts: { language?: string; toggled?: boolean } = {}) => {
  const onToggle = vi.fn()
  const r = render(
    <ToolCallBlock tc={tc} result={result} toolKey="k1" language={opts.language}
      collapsedTools={new Set(opts.toggled ? ['k1'] : [])} onToggleCollapse={onToggle} />,
  )
  return { ...r, onToggle }
}

describe('padrão de abertura por estado (a intenção do 59d56af)', () => {
  it('pendente: aberto, com spinner e "executando…"', () => {
    const { container } = renderBlock(undefined)
    expect(container.querySelector('.tool-call--pending')).toBeTruthy()
    expect(container.querySelector('.tool-call-args')).toBeTruthy()
    expect(container.querySelector('.tool-call-status')?.textContent).toBe('executando…')
  })

  it('erro: ABERTO por padrão — o usuário precisa ver o que falhou', () => {
    const { container } = renderBlock(fail)
    expect(container.querySelector('.tool-call--error')).toBeTruthy()
    expect(container.querySelector('.tool-result')).toBeTruthy()
    expect(container.querySelector('.tool-call-badge-error')?.textContent).toBe('erro')
  })

  it('sucesso: fechado por padrão — limpa o chat', () => {
    const { container } = renderBlock(ok)
    expect(container.querySelector('.tool-call--ok')).toBeTruthy()
    expect(container.querySelector('.tool-call-badge-error')).toBeNull()
  })

  it('o usuário alternar inverte o padrão (e é o PAI quem guarda isso)', () => {
    expect(renderBlock(ok, { toggled: true }).container.querySelector('.tool-call-args')).toBeTruthy()
    expect(renderBlock(fail, { toggled: true }).container.querySelector('.tool-call-args')).toBeNull()
  })
})

describe('contratos que o 59d56af tinha quebrado', () => {
  it('colapsado = FORA do DOM (não <details> fechado com tudo montado)', () => {
    const { container } = renderBlock(ok)
    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('.tool-call-args')).toBeNull()
    expect(container.querySelector('.tool-result')).toBeNull()
  })

  it('o clique sobe para o pai via onToggleCollapse (sem estado local)', () => {
    const { container, onToggle } = renderBlock(ok)
    fireEvent.click(container.querySelector('.tool-call-header')!)
    expect(onToggle).toHaveBeenCalledWith('k1')
  })

  it('o cabeçalho é um <button> com aria-expanded — funciona pelo teclado', () => {
    const aberto = renderBlock(fail).container.querySelector('.tool-call-header')!
    expect(aberto.tagName).toBe('BUTTON')
    expect(aberto.getAttribute('aria-expanded')).toBe('true')
    const fechado = renderBlock(ok).container.querySelector('.tool-call-header')!
    expect(fechado.getAttribute('aria-expanded')).toBe('false')
  })

  it('respeita o idioma (o texto era fixo em português)', () => {
    expect(renderBlock(fail, { language: 'en' }).container.querySelector('.tool-call-badge-error')?.textContent).toBe('error')
    expect(renderBlock(undefined, { language: 'en' }).container.querySelector('.tool-call-status')?.textContent).toBe('running…')
  })

  it('não usa classes Tailwind (o projeto não tem Tailwind)', () => {
    const html = renderBlock(fail).container.innerHTML
    for (const tw of ['border-l-4', 'border-red-500', 'bg-red-50', 'rounded-md', 'rotate-180', 'max-h-96'])
      expect(html, tw).not.toContain(tw)
  })

  it('erro no campo `error` do resultado também conta como falha', () => {
    const { container } = renderBlock({ toolCallId: 't1', name: 'execute_command', result: '', error: 'timeout' })
    expect(container.querySelector('.tool-call--error')).toBeTruthy()
  })
})
