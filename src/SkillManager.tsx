import { useEffect, useRef, useState } from 'react'
import { X, Plus, Edit3, Trash2, Check, Zap, ZapOff, Pin, PinOff, Download, Upload, BookOpen } from 'lucide-react'
import type { Skill } from './types/skill'
import { BUILTIN_SKILLS } from './utils/skills'
import { generateId } from './utils/formatting'

interface Props {
  isOpen: boolean
  onClose: () => void
  skills: Skill[]
  onSave: (skills: Skill[]) => void
  language: 'pt' | 'en'
}

const empty = (): Skill => ({
  id: generateId(), name: '', description: '', instructions: '',
  triggers: [], enabled: true, pinned: false, isBuiltIn: false, createdAt: Date.now(),
})

/** Gestão de skills — capacidades invocadas pelo modelo via load_skill, com pin
 *  manual e gatilhos por palavra-chave. Persistência via onSave (IPC no App). */
export default function SkillManager({ isOpen, onClose, skills, onSave, language }: Props) {
  const pt = language === 'pt'
  const [editing, setEditing] = useState<Skill | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!isOpen) setEditing(null) }, [isOpen])
  if (!isOpen) return null

  const upsert = (s: Skill) => {
    const exists = skills.some(x => x.id === s.id)
    onSave(exists ? skills.map(x => x.id === s.id ? s : x) : [...skills, s])
    setEditing(null)
  }
  const patch = (id: string, p: Partial<Skill>) => onSave(skills.map(s => s.id === id ? { ...s, ...p } : s))
  const remove = (id: string) => {
    if (confirm(pt ? 'Excluir esta skill?' : 'Delete this skill?')) onSave(skills.filter(s => s.id !== id))
  }
  const resetBuiltin = (id: string) => {
    const b = BUILTIN_SKILLS.find(x => x.id === id)
    if (b) onSave(skills.map(s => s.id === id ? { ...b } : s))
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(skills.filter(s => !s.isBuiltIn), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'openclaude-skills.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const arr = JSON.parse(String(reader.result))
        if (!Array.isArray(arr)) throw new Error('formato inválido')
        // Importa com novos ids, evitando colisão; ignora não-objetos.
        const imported: Skill[] = arr.filter((x: any) => x && x.name).map((x: any) => ({
          ...empty(), ...x, id: generateId(), isBuiltIn: false,
          triggers: Array.isArray(x.triggers) ? x.triggers : [],
        }))
        onSave([...skills, ...imported])
        alert(pt ? `${imported.length} skill(s) importada(s).` : `${imported.length} skill(s) imported.`)
      } catch (err: any) {
        alert((pt ? 'Falha ao importar: ' : 'Import failed: ') + (err?.message || err))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(127,127,127,0.12)' }
  const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4, display: 'inline-flex' }

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="analytics-modal">
        <div className="analytics-header">
          <div className="analytics-title-group">
            <BookOpen size={20} />
            <div>
              <h2>Skills</h2>
              <p className="analytics-subtitle">
                {pt ? 'Capacidades reutilizáveis que o modelo carrega sob demanda (load_skill) ou que você fixa.'
                    : 'Reusable capabilities the model loads on demand (load_skill) or you pin.'}
              </p>
            </div>
          </div>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
          {editing ? (
            <SkillForm skill={editing} pt={pt} onCancel={() => setEditing(null)} onSave={upsert} />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setEditing(empty())}>
                  <Plus size={14} /> {pt ? 'Nova skill' : 'New skill'}
                </button>
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExport}>
                  <Download size={14} /> {pt ? 'Exportar' : 'Export'}
                </button>
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> {pt ? 'Importar' : 'Import'}
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImport} />
              </div>

              {skills.length === 0 && <p style={{ opacity: 0.6 }}>{pt ? 'Nenhuma skill.' : 'No skills.'}</p>}
              {skills.map(s => (
                <div key={s.id} style={row}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.enabled ? 'var(--success, #46a758)' : 'rgba(127,127,127,0.4)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace' }}>{s.name || '(sem nome)'}</span>
                      {s.isBuiltIn && <span style={{ fontSize: 10, opacity: 0.5 }}>builtin</span>}
                      {s.pinned && <Pin size={11} style={{ color: 'var(--accent)' }} />}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
                  </div>
                  <button style={iconBtn} title={s.enabled ? (pt ? 'Desativar' : 'Disable') : (pt ? 'Ativar' : 'Enable')}
                          onClick={() => patch(s.id, { enabled: !s.enabled })}>
                    {s.enabled ? <Zap size={15} style={{ color: 'var(--accent)' }} /> : <ZapOff size={15} />}
                  </button>
                  <button style={iconBtn} title={s.pinned ? (pt ? 'Desafixar' : 'Unpin') : (pt ? 'Fixar (injeta sempre)' : 'Pin (always inject)')}
                          onClick={() => patch(s.id, { pinned: !s.pinned })}>
                    {s.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  <button style={iconBtn} title={pt ? 'Editar' : 'Edit'} onClick={() => setEditing({ ...s, triggers: s.triggers || [] })}><Edit3 size={15} /></button>
                  {s.isBuiltIn
                    ? <button style={iconBtn} title={pt ? 'Restaurar builtin' : 'Reset builtin'} onClick={() => resetBuiltin(s.id)}><Check size={15} /></button>
                    : <button style={iconBtn} title={pt ? 'Excluir' : 'Delete'} onClick={() => remove(s.id)}><Trash2 size={15} /></button>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SkillForm({ skill, pt, onCancel, onSave }: { skill: Skill; pt: boolean; onCancel: () => void; onSave: (s: Skill) => void }) {
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [instructions, setInstructions] = useState(skill.instructions)
  const [triggers, setTriggers] = useState((skill.triggers || []).join(', '))

  const canSave = name.trim().length > 0 && description.trim().length > 0 && instructions.trim().length > 0
  const lbl: React.CSSProperties = { fontSize: 12, opacity: 0.7, display: 'block', margin: '10px 0 4px' }

  return (
    <div>
      <label style={lbl}>{pt ? 'Nome (usado em load_skill, sem espaços)' : 'Name (used in load_skill, no spaces)'}</label>
      <input className="settings-input" value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))}
             placeholder="code-review" disabled={skill.isBuiltIn} />
      <label style={lbl}>{pt ? 'Descrição (quando usar — aparece no manifesto)' : 'Description (when to use — shown in manifest)'}</label>
      <input className="settings-input" value={description} onChange={(e) => setDescription(e.target.value)} />
      <label style={lbl}>{pt ? 'Instruções (carregadas sob demanda)' : 'Instructions (loaded on demand)'}</label>
      <textarea className="settings-input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <label style={lbl}>{pt ? 'Gatilhos (palavras separadas por vírgula — auto-sugerem a skill)' : 'Triggers (comma-separated keywords — auto-suggest the skill)'}</label>
      <input className="settings-input" value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder="revisar, review, pr" />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="settings-close" style={{ width: 'auto', padding: '6px 14px', opacity: canSave ? 1 : 0.5 }} disabled={!canSave}
                onClick={() => onSave({ ...skill, name: name.trim(), description: description.trim(), instructions, triggers: triggers.split(',').map(t => t.trim()).filter(Boolean) })}>
          {pt ? 'Salvar' : 'Save'}
        </button>
        <button className="settings-close" style={{ width: 'auto', padding: '6px 14px' }} onClick={onCancel}>{pt ? 'Cancelar' : 'Cancel'}</button>
      </div>
    </div>
  )
}
