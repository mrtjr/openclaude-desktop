import { useEffect, useRef, useState } from 'react'
import { X, Plus, Edit3, Trash2, Check, Zap, ZapOff, Pin, PinOff, Download, Upload, BookOpen, FileText, AlertTriangle, Sparkles, Loader2 } from 'lucide-react'
import type { Skill } from './types/skill'
import { BUILTIN_SKILLS } from './utils/skills'
import { isDangerousFact } from './utils/memoryInduction'
import { generateId } from './utils/formatting'
import { parseSkillMarkdown, toSkillMarkdown, sanitizeSkillName, lintSkill, buildImportedSkills } from './utils/skillImport'

interface Props {
  isOpen: boolean
  onClose: () => void
  skills: Skill[]
  onSave: (skills: Skill[]) => void
  language: 'pt' | 'en'
  /** v2.107.0 — projetos para o seletor de escopo da skill. */
  projects?: { id: string; name: string }[]
  /** v2.154.0 — pede ao modelo uma versão melhorada da skill (auto-evolução).
   *  Retorna a proposta (revisada no editor antes de salvar) ou um erro. */
  onEvolve?: (skill: Skill) => Promise<{ description: string; instructions: string; examples?: string } | { error: string }>
}

const empty = (): Skill => ({
  id: generateId(), name: '', description: '', instructions: '',
  triggers: [], enabled: true, pinned: false, isBuiltIn: false, createdAt: Date.now(),
})

/** Gestão de skills — capacidades invocadas pelo modelo via load_skill, com pin
 *  manual e gatilhos por palavra-chave. Persistência via onSave (IPC no App). */
export default function SkillManager({ isOpen, onClose, skills, onSave, language, projects, onEvolve }: Props) {
  const pt = language === 'pt'
  const [editing, setEditing] = useState<Skill | null>(null)
  const [evolvingId, setEvolvingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mdFileRef = useRef<HTMLInputElement>(null)
  // Auto-evolução (v2.154.0): pede a proposta à IA e abre no editor p/ revisão.
  const handleEvolve = async (s: Skill) => {
    if (!onEvolve || evolvingId) return
    setEvolvingId(s.id)
    try {
      const r = await onEvolve(s)
      if ('error' in r) { alert((pt ? 'Não foi possível evoluir: ' : "Couldn't evolve: ") + r.error); return }
      // Abre a proposta no editor p/ o usuário revisar e salvar (staging seguro).
      setEditing({ ...s, triggers: s.triggers || [], description: r.description || s.description, instructions: r.instructions, ...(r.examples ? { examples: r.examples } : {}) })
    } catch (e: any) { alert((pt ? 'Falha: ' : 'Failed: ') + (e?.message || e)) }
    finally { setEvolvingId(null) }
  }

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
  // Importa um SKILL.md no padrão aberto (v2.150.0): destrava o ecossistema de
  // skills da comunidade (anthropics/skills, marketplaces, Claude Code/Codex…).
  const handleImportSkillMd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const r = parseSkillMarkdown(String(reader.result))
      if (!r.skill) { alert((pt ? 'Falha ao importar SKILL.md: ' : 'SKILL.md import failed: ') + r.errors.join(' ')); return }
      const skill: Skill = { ...empty(), ...r.skill, id: generateId(), enabled: true, pinned: false, isBuiltIn: false, kind: 'user' }
      onSave([...skills, skill])
      alert((pt ? 'Skill importada: ' : 'Imported skill: ') + skill.name + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''))
    }
    reader.readAsText(file)
    e.target.value = ''
  }
  // Importação EM MASSA (v2.153.0): aponta numa pasta (repos da comunidade
  // clonados — anthropics/skills, awesome-agent-skills…) e importa todos os
  // SKILL.md. Vêm DESATIVADAS (importar 1000+ não pode inundar o contexto).
  const [bulkBusy, setBulkBusy] = useState(false)
  const handleBulkImport = async () => {
    const el = (window as any).electron
    if (!el?.importSkillsDir) return
    setBulkBusy(true)
    try {
      const res = await el.importSkillsDir()
      if (res?.error) { alert((pt ? 'Erro: ' : 'Error: ') + res.error); return }
      if (!res?.files?.length) { alert(pt ? 'Nenhum SKILL.md encontrado na pasta.' : 'No SKILL.md found in that folder.'); return }
      const { skills: parsed, imported, invalid, duplicates } = buildImportedSkills(res.files, skills.map((s: Skill) => s.name))
      if (!imported) { alert(pt ? `Nada novo (${duplicates} duplicadas, ${invalid} inválidas).` : `Nothing new (${duplicates} dupes, ${invalid} invalid).`); return }
      const newSkills: Skill[] = parsed.map(p => ({ ...empty(), ...p, id: generateId(), enabled: false, pinned: false, isBuiltIn: false, kind: 'user' as const }))
      onSave([...skills, ...newSkills])
      alert(pt
        ? `${imported} skill(s) importada(s)! (${duplicates} duplicadas, ${invalid} inválidas ignoradas).\nVêm DESATIVADAS — ative as que quiser.`
        : `${imported} skill(s) imported! (${duplicates} dupes, ${invalid} invalid skipped).\nThey're DISABLED — enable the ones you want.`)
    } catch (e: any) { alert((pt ? 'Falha: ' : 'Failed: ') + (e?.message || e)) }
    finally { setBulkBusy(false) }
  }
  // Exporta UMA skill como SKILL.md (padrão aberto) — portável p/ Claude Code/
  // Codex/Cursor (v2.151.0).
  const downloadSkillMd = (s: Skill) => {
    const blob = new Blob([toSkillMarkdown(s)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${sanitizeSkillName(s.name) || 'skill'}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  // Skills aprendidas em rascunho (Fase 4) ficam numa seção de revisão separada;
  // as demais na lista normal.
  const stagingSkills = skills.filter(s => s.status === 'staging')
  const regularSkills = skills.filter(s => s.status !== 'staging')
  // Revalida o CORPO da skill aprendida antes de ativar (v2.115.0): o usuário
  // pode editar o rascunho em staging e injetar execução/injeção. Não valida
  // allowed/disallowedTools (esses nomeiam tools de propósito).
  const approve = (id: string) => {
    const sk = skills.find(s => s.id === id)
    const body = `${sk?.instructions || ''}\n${sk?.examples || ''}`
    if (sk && isDangerousFact(body)) {
      alert(pt
        ? 'Esta skill contém instruções de execução de comando ou de injeção e não pode ser aprovada. Edite o corpo para remover antes.'
        : 'This skill contains command-execution or injection instructions and cannot be approved. Edit the body to remove them first.')
      return
    }
    patch(id, { status: 'active', enabled: true })
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
            <SkillForm skill={editing} pt={pt} projects={projects || []} onCancel={() => setEditing(null)} onSave={upsert} />
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
                  <Upload size={14} /> {pt ? 'Importar (.json)' : 'Import (.json)'}
                </button>
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => mdFileRef.current?.click()}
                  title={pt ? 'Importar uma skill no padrão aberto SKILL.md (Claude Code/Codex/Cursor…)' : 'Import a skill in the open SKILL.md standard (Claude Code/Codex/Cursor…)'}>
                  <FileText size={14} /> {pt ? 'Importar SKILL.md' : 'Import SKILL.md'}
                </button>
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleBulkImport} disabled={bulkBusy}
                  title={pt ? 'Importar EM MASSA: aponte numa pasta com repositórios da comunidade clonados (anthropics/skills, awesome-agent-skills) e importe todos os SKILL.md de uma vez' : 'Bulk import: point at a folder of cloned community repos and import all SKILL.md at once'}>
                  <BookOpen size={14} /> {bulkBusy ? (pt ? 'Importando…' : 'Importing…') : (pt ? 'Importar pasta (em massa)' : 'Bulk import folder')}
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleImport} />
                <input ref={mdFileRef} type="file" accept=".md,.markdown,text/markdown" style={{ display: 'none' }} onChange={handleImportSkillMd} />
              </div>

              {/* Seção de revisão das skills aprendidas (staging) — Fase 4 */}
              {stagingSkills.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, margin: '2px 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    ✨ {pt ? `Skills aprendidas — revisar (${stagingSkills.length})` : `Learned skills — review (${stagingSkills.length})`}
                  </div>
                  <p style={{ fontSize: 11, opacity: 0.6, margin: '0 0 8px' }}>
                    {pt ? 'Rascunhos gerados automaticamente de conhecimento de domínio. Ficam INATIVOS até você aprovar.'
                        : 'Auto-generated drafts from domain knowledge. They stay INACTIVE until you approve.'}
                  </p>
                  {stagingSkills.map(s => {
                    const facts = (s.instructions || '').split('\n').filter(l => l.startsWith('- ')).length
                    const conf = Math.round((s.provenance?.confidence ?? 0) * 100)
                    return (
                      <div key={s.id} style={{ ...row, background: 'color-mix(in srgb, var(--accent) 7%, transparent)', borderRadius: 8, padding: '10px 8px', border: '1px solid var(--accent-border)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{s.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
                          <div style={{ fontSize: 11, opacity: 0.55 }}>
                            {pt ? `${facts} fato(s) · confiança ${conf}% · origem: agente` : `${facts} fact(s) · confidence ${conf}% · source: agent`}
                          </div>
                        </div>
                        <button style={iconBtn} title={pt ? 'Ver/editar antes de aprovar' : 'View/edit before approving'} onClick={() => setEditing({ ...s, triggers: s.triggers || [] })}><Edit3 size={15} /></button>
                        <button style={iconBtn} title={pt ? 'Aprovar (ativar)' : 'Approve (activate)'} onClick={() => approve(s.id)}><Check size={16} style={{ color: 'var(--success, #46a758)' }} /></button>
                        <button style={iconBtn} title={pt ? 'Rejeitar (excluir)' : 'Reject (delete)'} onClick={() => remove(s.id)}><Trash2 size={15} /></button>
                      </div>
                    )
                  })}
                </div>
              )}

              {skills.length === 0 && <p style={{ opacity: 0.6 }}>{pt ? 'Nenhuma skill.' : 'No skills.'}</p>}
              {regularSkills.map(s => (
                <div key={s.id} style={row}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.enabled ? 'var(--success, #46a758)' : 'rgba(127,127,127,0.4)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace' }}>{s.name || '(sem nome)'}</span>
                      {s.isBuiltIn && <span style={{ fontSize: 10, opacity: 0.5 }}>builtin</span>}
                      {s.pinned && <Pin size={11} style={{ color: 'var(--accent)' }} />}
                      {(() => { const issues = s.isBuiltIn ? [] : lintSkill(s); return issues.length > 0 ? (
                        <span title={(pt ? 'Avisos de qualidade (padrão SKILL.md):\n• ' : 'Quality warnings (SKILL.md standard):\n• ') + issues.join('\n• ')}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#f59e0b', fontSize: 11, cursor: 'help' }}>
                          <AlertTriangle size={12} />{issues.length}
                        </span>
                      ) : null })()}
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
                  {onEvolve && (
                    <button style={iconBtn} disabled={!!evolvingId}
                      title={pt ? `Evoluir com IA — propõe uma versão melhorada${s.usageCount ? ` (usada ${s.usageCount}×)` : ''} p/ você revisar` : `Evolve with AI — proposes an improved version${s.usageCount ? ` (used ${s.usageCount}×)` : ''} for you to review`}
                      onClick={() => handleEvolve(s)}>
                      {evolvingId === s.id ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} style={{ color: 'var(--accent)' }} />}
                    </button>
                  )}
                  <button style={iconBtn} title={pt ? 'Baixar como SKILL.md (padrão aberto)' : 'Download as SKILL.md (open standard)'} onClick={() => downloadSkillMd(s)}><FileText size={15} /></button>
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

function SkillForm({ skill, pt, projects, onCancel, onSave }: { skill: Skill; pt: boolean; projects: { id: string; name: string }[]; onCancel: () => void; onSave: (s: Skill) => void }) {
  const [name, setName] = useState(skill.name)
  const [description, setDescription] = useState(skill.description)
  const [instructions, setInstructions] = useState(skill.instructions)
  const [triggers, setTriggers] = useState((skill.triggers || []).join(', '))
  const [disallowed, setDisallowed] = useState((skill.disallowedTools || []).join(', '))
  const [allowed, setAllowed] = useState((skill.allowedTools || []).join(', '))
  const [examples, setExamples] = useState(skill.examples || '')
  const [projectId, setProjectId] = useState(skill.projectId || '')

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
      <label style={lbl}>{pt ? 'Ferramentas proibidas enquanto ativa (separadas por vírgula)' : 'Disallowed tools while active (comma-separated)'}</label>
      <input className="settings-input" value={disallowed} onChange={(e) => setDisallowed(e.target.value)} placeholder="browser_navigate, execute_command" />
      <label style={lbl}>{pt ? 'Allowlist: SÓ estas ferramentas enquanto ativa (opcional, mais forte)' : 'Allowlist: ONLY these tools while active (optional, stronger)'}</label>
      <input className="settings-input" value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder="read_file, search_files, web_search" />
      <label style={lbl}>{pt ? 'Exemplos / few-shot (opcional — ajuda modelos pequenos)' : 'Examples / few-shot (optional — helps small models)'}</label>
      <textarea className="settings-input" style={{ minHeight: 80, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                value={examples} onChange={(e) => setExamples(e.target.value)} />
      {projects.length > 0 && (<>
        <label style={lbl}>{pt ? 'Escopo (projeto)' : 'Scope (project)'}</label>
        <select className="settings-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">{pt ? 'Global (todos os projetos)' : 'Global (all projects)'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </>)}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="settings-close" style={{ width: 'auto', padding: '6px 14px', opacity: canSave ? 1 : 0.5 }} disabled={!canSave}
                onClick={() => onSave({ ...skill, name: name.trim(), description: description.trim(), instructions, triggers: triggers.split(',').map(t => t.trim()).filter(Boolean), disallowedTools: disallowed.split(',').map(t => t.trim()).filter(Boolean), allowedTools: allowed.split(',').map(t => t.trim()).filter(Boolean), examples: examples.trim() || undefined, projectId: projectId || undefined })}>
          {pt ? 'Salvar' : 'Save'}
        </button>
        <button className="settings-close" style={{ width: 'auto', padding: '6px 14px' }} onClick={onCancel}>{pt ? 'Cancelar' : 'Cancel'}</button>
      </div>
    </div>
  )
}
