import { describe, it, expect } from 'vitest'
import { applyPlanToolCalls, planIsIncomplete, type LocalTask } from '../src/utils/planTracker'

const call = (name: string, args: any) => ({ function: { name, arguments: JSON.stringify(args) } })

describe('applyPlanToolCalls', () => {
  it('plan_tasks substitui o plano com status default pending', () => {
    const out = applyPlanToolCalls([], [call('plan_tasks', { goal: 'g', tasks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', status: 'in_progress' }] })])
    expect(out).toEqual([{ id: 'a', status: 'pending' }, { id: 'b', status: 'in_progress' }])
  })
  it('update_task_status muda o status pela id', () => {
    const base: LocalTask[] = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }]
    const out = applyPlanToolCalls(base, [call('update_task_status', { task_id: 'b', status: 'done' })])
    expect(out).toEqual([{ id: 'a', status: 'pending' }, { id: 'b', status: 'done' }])
  })
  it('aplica várias calls em sequência (plano + updates)', () => {
    const out = applyPlanToolCalls([], [
      call('plan_tasks', { tasks: [{ id: '1' }, { id: '2' }] }),
      call('update_task_status', { task_id: '1', status: 'done' }),
      call('update_task_status', { task_id: '2', status: 'failed' }),
    ])
    expect(out).toEqual([{ id: '1', status: 'done' }, { id: '2', status: 'failed' }])
  })
  it('aceita arguments como objeto (não-string) e ignora calls irrelevantes', () => {
    const out = applyPlanToolCalls([{ id: 'x', status: 'pending' }], [
      { function: { name: 'web_search', arguments: '{}' } },
      { function: { name: 'update_task_status', arguments: { task_id: 'x', status: 'done' } } },
    ])
    expect(out).toEqual([{ id: 'x', status: 'done' }])
  })
  it('tolera JSON inválido sem quebrar', () => {
    const out = applyPlanToolCalls([{ id: 'x', status: 'pending' }], [{ function: { name: 'plan_tasks', arguments: '{bad json' } }])
    expect(out).toEqual([])
  })
  it('update_task_status sem status não altera nada', () => {
    const base: LocalTask[] = [{ id: 'a', status: 'pending' }]
    expect(applyPlanToolCalls(base, [call('update_task_status', { task_id: 'a' })])).toEqual(base)
  })
})

describe('planIsIncomplete', () => {
  it('false para lista vazia (nada a concluir)', () => {
    expect(planIsIncomplete([])).toBe(false)
  })
  it('true quando há pending ou in_progress', () => {
    expect(planIsIncomplete([{ status: 'done' }, { status: 'pending' }])).toBe(true)
    expect(planIsIncomplete([{ status: 'in_progress' }])).toBe(true)
  })
  it('false quando tudo done/failed', () => {
    expect(planIsIncomplete([{ status: 'done' }, { status: 'failed' }])).toBe(false)
  })
})
