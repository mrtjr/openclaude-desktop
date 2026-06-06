import { useState } from 'react'
import { X } from 'lucide-react'
import type { Project } from '../types'

interface Props {
  project: Project
  onSave: (patch: { name: string; instructions: string; cwd: string }) => void
  onClose: () => void
}

/** Edit a project's name + custom instructions. The instructions are injected
 *  into the system prompt of every conversation in the project (Projects ciclo 2). */
export function ProjectEditModal({ project, onSave, onClose }: Props) {
  const [name, setName] = useState(project.name)
  const [instructions, setInstructions] = useState(project.instructions || '')
  const [cwd, setCwd] = useState(project.cwd || '')

  const save = () => {
    if (!name.trim()) return
    onSave({ name: name.trim(), instructions: instructions.trim(), cwd: cwd.trim() })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="project-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="project-edit-header">
          <h3>Editar projeto</h3>
          <button className="project-edit-close" onClick={onClose} title="Fechar"><X size={16} /></button>
        </div>

        <label className="project-edit-label">Nome</label>
        <input
          className="project-edit-input"
          value={name}
          maxLength={60}
          onChange={e => setName(e.target.value)}
          placeholder="Nome do projeto"
        />

        <label className="project-edit-label">
          Instruções do projeto
          <small> — injetadas no system prompt de toda conversa deste projeto</small>
        </label>
        <textarea
          className="project-edit-textarea"
          value={instructions}
          rows={8}
          onChange={e => setInstructions(e.target.value)}
          placeholder={'Ex: Você é um especialista em estratégias de trading para MetaTrader 5. Sempre responda com código MQL5 comentado e explique a lógica de entrada/saída...'}
        />

        <label className="project-edit-label">
          Pasta de trabalho <small>— opcional; comandos e arquivos deste projeto rodam a partir daqui</small>
        </label>
        <input
          className="project-edit-input"
          value={cwd}
          onChange={e => setCwd(e.target.value)}
          placeholder="Ex: D:\\robos\\scalping"
        />

        <div className="project-edit-actions">
          <button className="project-edit-btn secondary" onClick={onClose}>Cancelar</button>
          <button className="project-edit-btn primary" onClick={save}>Salvar</button>
        </div>
      </div>
    </div>
  )
}

export default ProjectEditModal
