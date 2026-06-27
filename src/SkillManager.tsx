import { useEffect, useRef, useState } from 'react'
import { X, Plus, Edit3, Trash2, Check, Zap, ZapOff, Pin, PinOff, Download, Upload, BookOpen, FileText, AlertTriangle, Sparkles, Loader2, Github, Search } from 'lucide-react'
import type { Skill } from './types/skill'
import { BUILTIN_SKILLS, filterAndSortSkills } from './utils/skills'
import { isDangerousFact } from './utils/memoryInduction'
import { generateId } from './utils/formatting'
import { parseSkillMarkdown, toSkillMarkdown, sanitizeSkillName, lintSkill, buildImportedSkills, parseRepoSpec, parseSkillIndex, SKILL_REPO_PRESETS } from './utils/skillImport'

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
  // Ações em massa (v2.167.0): com a auto-criação agressiva a biblioteca cresce —
  // ativar/desativar/excluir o conjunto filtrado de uma vez. Excluir só pega
  // não-builtin. `targets` = ids visíveis no filtro atual.
  const bulkSetEnabled = (ids: Set<string>, enabled: boolean) => {
    if (!ids.size) return
    onSave(skills.map(s => ids.has(s.id) ? { ...s, enabled } : s))
  }
  const bulkDelete = (ids: Set<string>) => {
    const delible = skills.filter(s => ids.has(s.id) && !s.isBuiltIn)
    if (!delible.length) return
    if (confirm(pt ? `Excluir ${delible.length} skill(s) filtrada(s)? (builtins são preservadas)` : `Delete ${delible.length} filtered skill(s)? (builtins kept)`)) {
      const del = new Set(delible.map(s => s.id))
      onSave(skills.filter(s => !del.has(s.id)))
    }
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
  // Instalar do GitHub SEM git clone (v2.155.0): baixa os SKILL.md de um repo
  // p/ a pasta padrão e instala. Vêm DESATIVADAS.
  const [ghRepo, setGhRepo] = useState(SKILL_REPO_PRESETS[0] || 'anthropics/skills')
  const [ghBusy, setGhBusy] = useState(false)
  // Seguidor de ÍNDICE (v2.156.0): quando o repo é um "awesome-*" (sem SKILL.md),
  // listamos os repositórios catalogados no README p/ o usuário escolher.
  const [indexRepos, setIndexRepos] = useState<{ owner: string; repo: string }[]>([])
  const [indexSource, setIndexSource] = useState('')
  const [indexSelected, setIndexSelected] = useState<Set<string>>(new Set())
  const [indexProgress, setIndexProgress] = useState('')
  const repoKey = (r: { owner: string; repo: string }) => `${r.owner}/${r.repo}`.toLowerCase()
  const handleGithubInstall = async () => {
    const el = (window as any).electron
    if (!el?.fetchGithubSkills) return
    const spec = parseRepoSpec(ghRepo)
    if (!spec) { alert(pt ? 'Repositório inválido. Use owner/repo ou a URL do GitHub.' : 'Invalid repo. Use owner/repo or a GitHub URL.'); return }
    setGhBusy(true)
    setIndexRepos([]); setIndexProgress('')
    try {
      const res = await el.fetchGithubSkills(spec)
      if (res?.error) { alert((pt ? 'Erro: ' : 'Error: ') + res.error); return }
      if (!res?.files?.length) {
        // Sem SKILL.md: talvez seja um índice (awesome-*) — seguir o README.
        if (el.fetchGithubIndex) {
          const idx = await el.fetchGithubIndex(spec)
          const repos = idx?.content ? parseSkillIndex(idx.content, spec).slice(0, 200) : []
          if (repos.length) {
            setIndexSource(`${spec.owner}/${spec.repo}`)
            setIndexRepos(repos)
            setIndexSelected(new Set())
            return
          }
        }
        alert(pt ? 'Nenhum SKILL.md neste repositório (e nenhum repo de skills catalogado no README).' : 'No SKILL.md here (and no skill repos catalogued in the README).')
        return
      }
      const { skills: parsed, imported, invalid, duplicates } = buildImportedSkills(res.files, skills.map((s: Skill) => s.name))
      if (!imported) { alert(pt ? `Nada novo (${duplicates} duplicadas, ${invalid} inválidas).` : `Nothing new (${duplicates} dupes, ${invalid} invalid).`); return }
      const newSkills: Skill[] = parsed.map(p => ({ ...empty(), ...p, id: generateId(), enabled: false, pinned: false, isBuiltIn: false, kind: 'user' as const }))
      onSave([...skills, ...newSkills])
      alert(pt
        ? `${imported} skill(s) instalada(s) de ${spec.owner}/${spec.repo}! (${duplicates} duplicadas, ${invalid} ignoradas)\nSalvas em: ${res.dir}\nVêm DESATIVADAS — ative as que quiser.`
        : `${imported} skill(s) installed from ${spec.owner}/${spec.repo}! (${duplicates} dupes, ${invalid} skipped)\nSaved to: ${res.dir}\nThey're DISABLED — enable the ones you want.`)
    } catch (e: any) { alert((pt ? 'Falha: ' : 'Failed: ') + (e?.message || e)) }
    finally { setGhBusy(false) }
  }
  // Instala as skills dos repositórios escolhidos no índice. SEQUENCIAL (a API
  // não-autenticada do GitHub limita ~60 req/h) — para se bater o limite e
  // reporta o parcial. Deduplica entre repos e contra as já instaladas.
  const handleInstallSelected = async () => {
    const el = (window as any).electron
    if (!el?.fetchGithubSkills) return
    const chosen = indexRepos.filter(r => indexSelected.has(repoKey(r)))
    if (!chosen.length) return
    setGhBusy(true)
    const existing = new Set(skills.map((s: Skill) => sanitizeSkillName(s.name)))
    const collected: Skill[] = []
    let okRepos = 0, failedRepos = 0, rateLimited = false
    try {
      for (let i = 0; i < chosen.length; i++) {
        const r = chosen[i]
        setIndexProgress(`${i + 1}/${chosen.length} · ${r.owner}/${r.repo}`)
        let res: any
        try { res = await el.fetchGithubSkills(r) } catch { failedRepos++; continue }
        if (res?.error) { if (/limite|rate|403/i.test(String(res.error))) { rateLimited = true; break } failedRepos++; continue }
        if (!res?.files?.length) { failedRepos++; continue }
        const { skills: parsed, imported } = buildImportedSkills(res.files, Array.from(existing))
        for (const p of parsed) { existing.add(sanitizeSkillName(p.name)); collected.push({ ...empty(), ...p, id: generateId(), enabled: false, pinned: false, isBuiltIn: false, kind: 'user' as const }) }
        if (imported) okRepos++
      }
      if (collected.length) onSave([...skills, ...collected])
      const head = pt
        ? `${collected.length} skill(s) instalada(s) de ${okRepos} repositório(s)${failedRepos ? `, ${failedRepos} sem skills/falharam` : ''}.`
        : `${collected.length} skill(s) installed from ${okRepos} repo(s)${failedRepos ? `, ${failedRepos} empty/failed` : ''}.`
      const tail = rateLimited ? (pt ? '\nLimite de requisições do GitHub atingido — instale o restante mais tarde.' : '\nGitHub rate limit hit — install the rest later.') : ''
      alert(head + (collected.length ? (pt ? '\nVêm DESATIVADAS — ative as que quiser.' : '\nThey arrive DISABLED — enable the ones you want.') : '') + tail)
      setIndexRepos([]); setIndexSource('')
    } catch (e: any) { alert((pt ? 'Falha: ' : 'Failed: ') + (e?.message || e)) }
    finally { setGhBusy(false); setIndexProgress('') }
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
  // Busca + filtro (v2.167.0) — essencial com a biblioteca crescendo.
  const [skillSearch, setSkillSearch] = useState('')
  const [skillFilter, setSkillFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  // Ordenação (v2.168.0): 'default' preserva a ordem atual (builtins→criação) p/
  // não mudar o comportamento existente; demais são opt-in.
  const [skillSort, setSkillSort] = useState<'default' | 'name' | 'recent' | 'used'>('default')
  const q = skillSearch.trim().toLowerCase()
  const visibleRegular = filterAndSortSkills(regularSkills, skillSearch, skillFilter, skillSort)
  const visibleIds = new Set(visibleRegular.map(s => s.id))
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

              {/* Instalar direto do GitHub, sem git clone (v2.155.0) */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <Github size={15} style={{ opacity: 0.6, flexShrink: 0 }} />
                <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} disabled={ghBusy}
                  onKeyDown={e => { if (e.key === 'Enter') handleGithubInstall() }}
                  placeholder={pt ? 'owner/repo ou URL (ex.: anthropics/skills)' : 'owner/repo or URL (e.g. anthropics/skills)'}
                  style={{ flex: '1 1 240px', minWidth: 160, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'inherit' }} />
                <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleGithubInstall} disabled={ghBusy}
                  title={pt ? 'Baixa os SKILL.md do repositório p/ a pasta padrão e instala (sem git clone)' : 'Downloads the repo SKILL.md to the default folder and installs (no git clone)'}>
                  {ghBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {ghBusy ? (pt ? 'Instalando…' : 'Installing…') : (pt ? 'Instalar do GitHub' : 'Install from GitHub')}
                </button>
                {SKILL_REPO_PRESETS.map(r => (
                  <button key={r} className="settings-close" style={{ width: 'auto', padding: '4px 9px', fontSize: 11, opacity: 0.85 }} onClick={() => setGhRepo(r)} disabled={ghBusy}>{r}</button>
                ))}
              </div>

              {/* Seguidor de ÍNDICE (v2.156.0): repos catalogados num awesome-* */}
              {indexRepos.length > 0 && (
                <div style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                      {pt
                        ? `${indexSource} é um índice — ${indexRepos.length} repositório(s) de skills`
                        : `${indexSource} is an index — ${indexRepos.length} skill repo(s)`}
                    </div>
                    <button className="settings-close" style={{ width: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={() => { if (!ghBusy) { setIndexRepos([]); setIndexSource('') } }} disabled={ghBusy}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 11.5, opacity: 0.85 }}>
                    <button className="settings-close" style={{ width: 'auto', padding: '2px 8px', fontSize: 11 }} disabled={ghBusy}
                      onClick={() => setIndexSelected(new Set(indexRepos.map(repoKey)))}>{pt ? 'Marcar todos' : 'Select all'}</button>
                    <button className="settings-close" style={{ width: 'auto', padding: '2px 8px', fontSize: 11 }} disabled={ghBusy}
                      onClick={() => setIndexSelected(new Set())}>{pt ? 'Nenhum' : 'None'}</button>
                    <span>{pt ? `${indexSelected.size} marcado(s)` : `${indexSelected.size} selected`}</span>
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
                    {indexRepos.map(r => {
                      const k = repoKey(r)
                      return (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: ghBusy ? 'default' : 'pointer', padding: '2px 4px', opacity: ghBusy ? 0.6 : 1 }}>
                          <input type="checkbox" checked={indexSelected.has(k)} disabled={ghBusy}
                            onChange={e => setIndexSelected(prev => { const n = new Set(prev); if (e.target.checked) n.add(k); else n.delete(k); return n })} />
                          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{r.owner}/{r.repo}</span>
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="settings-close" style={{ width: 'auto', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleInstallSelected} disabled={ghBusy || indexSelected.size === 0}>
                      {ghBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {pt ? `Instalar selecionados (${indexSelected.size})` : `Install selected (${indexSelected.size})`}
                    </button>
                    {ghBusy && indexProgress && <span style={{ fontSize: 11.5, opacity: 0.8 }}>{indexProgress}</span>}
                    {!ghBusy && indexSelected.size > 20 && <span style={{ fontSize: 11, opacity: 0.7 }}>{pt ? '⚠ muitos repos podem esgotar o limite do GitHub (~60/h)' : '⚠ many repos may hit GitHub\'s ~60/h limit'}</span>}
                  </div>
                </div>
              )}

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

              {/* Busca + filtro + ações em massa (v2.167.0) */}
              {regularSkills.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 140 }}>
                      <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                      <input value={skillSearch} onChange={e => setSkillSearch(e.target.value)}
                        placeholder={pt ? 'Buscar por nome/descrição…' : 'Search name/description…'}
                        style={{ width: '100%', padding: '6px 10px 6px 28px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'inherit' }} />
                    </div>
                    {([
                      ['all', pt ? 'Todas' : 'All', regularSkills.length],
                      ['enabled', pt ? 'Ativas' : 'Enabled', regularSkills.filter(s => s.enabled).length],
                      ['disabled', pt ? 'Desativadas' : 'Disabled', regularSkills.filter(s => !s.enabled).length],
                    ] as const).map(([key, label, count]) => {
                      const active = skillFilter === key
                      return (
                        <button key={key} className="settings-close" style={{ width: 'auto', padding: '4px 10px', fontSize: 11.5, opacity: active ? 1 : 0.6, border: active ? '1px solid var(--accent)' : undefined, color: active ? 'var(--accent)' : undefined }}
                          onClick={() => setSkillFilter(key)}>{label} ({count})</button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, opacity: 0.8 }}>
                    <span>{pt ? 'Ordenar:' : 'Sort:'}</span>
                    {([
                      ['default', pt ? 'Padrão' : 'Default'],
                      ['name', 'A–Z'],
                      ['recent', pt ? 'Recentes' : 'Recent'],
                      ['used', pt ? 'Mais usadas' : 'Most used'],
                    ] as const).map(([k, l]) => (
                      <button key={k} className="settings-close" style={{ width: 'auto', padding: '3px 8px', fontSize: 11, opacity: skillSort === k ? 1 : 0.55, color: skillSort === k ? 'var(--accent)' : undefined }}
                        onClick={() => setSkillSort(k)}>{l}</button>
                    ))}
                  </div>
                  {visibleRegular.length > 0 && (skillFilter !== 'all' || q) && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, opacity: 0.85 }}>
                      <span>{pt ? `${visibleRegular.length} filtrada(s):` : `${visibleRegular.length} filtered:`}</span>
                      <button className="settings-close" style={{ width: 'auto', padding: '3px 9px', fontSize: 11 }} onClick={() => bulkSetEnabled(visibleIds, true)}>{pt ? 'Ativar todas' : 'Enable all'}</button>
                      <button className="settings-close" style={{ width: 'auto', padding: '3px 9px', fontSize: 11 }} onClick={() => bulkSetEnabled(visibleIds, false)}>{pt ? 'Desativar todas' : 'Disable all'}</button>
                      <button className="settings-close" style={{ width: 'auto', padding: '3px 9px', fontSize: 11, color: '#ef4444' }} onClick={() => bulkDelete(visibleIds)}>{pt ? 'Excluir filtradas' : 'Delete filtered'}</button>
                    </div>
                  )}
                </div>
              )}
              {regularSkills.length > 0 && visibleRegular.length === 0 && (
                <p style={{ opacity: 0.6, fontSize: 12.5 }}>{pt ? 'Nenhuma skill corresponde ao filtro.' : 'No skills match the filter.'}</p>
              )}
              {visibleRegular.map(s => (
                <div key={s.id} style={row}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: s.enabled ? 'var(--success, #46a758)' : 'rgba(127,127,127,0.4)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'monospace' }}>{s.name || '(sem nome)'}</span>
                      {s.isBuiltIn && <span style={{ fontSize: 10, opacity: 0.5 }}>builtin</span>}
                      {s.pinned && <Pin size={11} style={{ color: 'var(--accent)' }} />}
                      {!!s.usageCount && <span title={pt ? `Usada em ${s.usageCount} turno(s)` : `Used in ${s.usageCount} turn(s)`} style={{ fontSize: 10, opacity: 0.5 }}>{s.usageCount}×</span>}
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
