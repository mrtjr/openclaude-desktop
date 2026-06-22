import { describe, it, expect } from 'vitest'
import { filterValidRecords, validApiKey, SYNC_REQUIRED_FIELDS } from '../src/utils/syncValidation'

describe('filterValidRecords (v2.123.0)', () => {
  it('mantém objetos com os campos obrigatórios (string não-vazia)', () => {
    const r = filterValidRecords([
      { id: 'a', name: 'Perfil A' },
      { id: 'b', name: 'Perfil B' },
    ], ['id', 'name'])
    expect(r.valid.length).toBe(2)
    expect(r.dropped).toBe(0)
  })
  it('descarta elementos corrompidos (faltando campo, vazio, não-objeto)', () => {
    const r = filterValidRecords([
      { id: 'a', name: 'ok' },
      { id: 'b' },              // sem name
      { name: 'sem id' },       // sem id
      { id: '', name: 'x' },    // id vazio
      'string solta',           // não-objeto
      null,
      ['array'],
    ], ['id', 'name'])
    expect(r.valid).toEqual([{ id: 'a', name: 'ok' }])
    expect(r.dropped).toBe(6)
  })
  it('entrada não-array → vazio', () => {
    expect(filterValidRecords(undefined, ['id'])).toEqual({ valid: [], dropped: 0 })
    expect(filterValidRecords('x', ['id'])).toEqual({ valid: [], dropped: 0 })
  })
})

describe('validApiKey', () => {
  it('aceita só string', () => {
    expect(validApiKey('sk-123')).toBe('sk-123')
    expect(validApiKey({ malicioso: 1 })).toBeNull()
    expect(validApiKey(['a'])).toBeNull()
    expect(validApiKey(123)).toBeNull()
  })
})

describe('SYNC_REQUIRED_FIELDS', () => {
  it('cobre profiles/personas/scheduledTasks', () => {
    expect(SYNC_REQUIRED_FIELDS.profiles).toContain('id')
    expect(SYNC_REQUIRED_FIELDS.personas).toContain('name')
    expect(SYNC_REQUIRED_FIELDS.scheduledTasks).toContain('id')
  })
})
