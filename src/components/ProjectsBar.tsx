import { useState } from 'react'
import { Plus, X, Check, Pencil } from 'lucide-react'
import type { Project } from '../types'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  counts: Record<string, number>
  /** When true, the bar is in "assign" mode: clicking a chip moves the pending
   *  conversation into that project instead of filtering. */
  assigning: boolean
  onSelect: (projectId: string | null) => void
  onCreate: (name: string) => void
  onDelete: (projectId: string) => void
  onEdit: (project: Project) => void
  onCancelAssign: () => void
}

/** Workspace chips at the top of the sidebar (Projects, v2.12.42). Doubles as
 *  the conversation→project picker when `assigning` is set — reusing the chips
 *  avoids a separate popover. */
export function ProjectsBar({
  projects, activeProjectId, counts, assigning,
  onSelect, onCreate, onDelete, onEdit, onCancelAssign,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const submit = () => {
    const n = name.trim()
    if (n) onCreate(n)
    setName('')
    setCreating(false)
  }

  // Nothing to show yet, and not mid-action → a single compact entry point.
  if (projects.length === 0 && !creating && !assigning) {
    return (
      <div className="projects-bar empty">
        <button className="project-chip new" onClick={() => setCreating(true)} title="Criar projeto">
          <Plus size={12} /> Projeto
        </button>
      </div>
    )
  }

  return (
    <div className={`projects-bar ${assigning ? 'assigning' : ''}`}>
      {assigning && <span className="projects-assign-hint">Mover para:</span>}
      <button
        className={`project-chip ${!activeProjectId && !assigning ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        {assigning ? 'Sem projeto' : 'Todas'}
      </button>

      {projects.map(p => (
        <span key={p.id} className={`project-chip-wrap ${activeProjectId === p.id && !assigning ? 'active' : ''}`}>
          <button className="project-chip" onClick={() => onSelect(p.id)} title={p.name}>
            <span className="project-dot" style={{ background: p.color || '#888' }} />
            <span className="project-name">{p.name}</span>
            {counts[p.id] ? <span className="project-count">{counts[p.id]}</span> : null}
          </button>
          {!assigning && (
            <>
              <button
                className="project-edit"
                title="Editar projeto (nome + instruções)"
                onClick={() => onEdit(p)}
              >
                <Pencil size={9} />
              </button>
              <button
                className="project-del"
                title="Excluir projeto (as conversas são preservadas)"
                onClick={() => onDelete(p.id)}
              >
                <X size={10} />
              </button>
            </>
          )}
        </span>
      ))}

      {assigning ? (
        <button className="project-chip cancel" onClick={onCancelAssign}>Cancelar</button>
      ) : creating ? (
        <span className="project-create">
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Nome do projeto"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') { setCreating(false); setName('') }
            }}
          />
          <button onClick={submit} title="Criar"><Check size={12} /></button>
        </span>
      ) : (
        <button className="project-chip new" onClick={() => setCreating(true)} title="Criar projeto">
          <Plus size={12} />
        </button>
      )}
    </div>
  )
}

export default ProjectsBar
