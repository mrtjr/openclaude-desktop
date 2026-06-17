import { describe, it, expect } from 'vitest'
import {
  topoOrder, findWorkflow, buildWorkflowRouterHint, formatWorkflowRun,
  type Workflow, type WfNode, type WfEdge,
} from '../src/utils/workflows'

const node = (id: string, type: WfNode['type'] = 'tool'): WfNode => ({ id, type, label: id, config: {} })

describe('topoOrder', () => {
  it('ordena por dependência (a→b→c)', () => {
    const nodes = [node('c'), node('a'), node('b')]
    const edges: WfEdge[] = [{ id: 'e1', fromId: 'a', toId: 'b' }, { id: 'e2', fromId: 'b', toId: 'c' }]
    expect(topoOrder(nodes, edges).map(n => n.id)).toEqual(['a', 'b', 'c'])
  })
  it('ignora edges com nós inexistentes', () => {
    const nodes = [node('a'), node('b')]
    const edges: WfEdge[] = [{ id: 'e', fromId: 'a', toId: 'ghost' }, { id: 'e2', fromId: 'a', toId: 'b' }]
    expect(() => topoOrder(nodes, edges)).not.toThrow()
    expect(topoOrder(nodes, edges).map(n => n.id)).toEqual(['a', 'b'])
  })
  it('nós sem dependência preservam-se', () => {
    expect(topoOrder([node('x'), node('y')], []).map(n => n.id)).toEqual(['x', 'y'])
  })
})

describe('findWorkflow', () => {
  const wfs: Workflow[] = [
    { id: 'w1', name: 'Backtest diário', nodes: [], edges: [] },
    { id: 'w2', name: 'Deploy', nodes: [], edges: [] },
  ]
  it('acha por nome (case-insensitive) e por id', () => {
    expect(findWorkflow(wfs, 'backtest diário')?.id).toBe('w1')
    expect(findWorkflow(wfs, 'DEPLOY')?.id).toBe('w2')
    expect(findWorkflow(wfs, 'w1')?.name).toBe('Backtest diário')
  })
  it('não acha → null; entrada inválida → null', () => {
    expect(findWorkflow(wfs, 'inexistente')).toBeNull()
    expect(findWorkflow(undefined, 'x')).toBeNull()
    expect(findWorkflow(wfs, '')).toBeNull()
  })
})

describe('buildWorkflowRouterHint', () => {
  it('vazio quando não há workflows', () => {
    expect(buildWorkflowRouterHint([], 'pt')).toBe('')
    expect(buildWorkflowRouterHint(undefined, 'en')).toBe('')
  })
  it('lista nomes+descrições e cita run_workflow + aprovação', () => {
    const hint = buildWorkflowRouterHint([{ name: 'Deploy', description: 'sobe o app' }], 'pt')
    expect(hint).toContain('Deploy')
    expect(hint).toContain('sobe o app')
    expect(hint).toContain('run_workflow')
    expect(hint.toLowerCase()).toContain('aprovação')
  })
})

describe('formatWorkflowRun', () => {
  it('mostra ícones por status + saída final', () => {
    const out = formatWorkflowRun('Deploy', [
      { label: 'build', status: 'done', output: 'ok' },
      { label: 'cond', status: 'skipped', output: 'falsa' },
      { label: 'push', status: 'error', output: 'falhou' },
    ], 'pronto')
    expect(out).toContain('Workflow "Deploy"')
    expect(out).toContain('✓ build')
    expect(out).toContain('⤳ cond')
    expect(out).toContain('✕ push')
    expect(out).toContain('Saída final:\npronto')
  })
})
