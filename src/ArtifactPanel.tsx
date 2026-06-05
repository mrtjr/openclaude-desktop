import { useEffect } from 'react'
import { X, Code2 } from 'lucide-react'
import { artifactSrcDoc, type Artifact } from './utils/artifacts'

interface Props {
  artifact: Artifact | null
  onClose: () => void
  language: 'pt' | 'en'
}

/** Live preview of a chat artifact (html/svg) in a sandboxed iframe — the
 *  sandbox runs the artifact's scripts but with no same-origin access, so it
 *  can't read the app, cookies, or storage. */
export default function ArtifactPanel({ artifact, onClose, language }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!artifact) return null
  const pt = language === 'pt'

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="analytics-modal" style={{ width: '82vw', height: '82vh', maxWidth: 1200, display: 'flex', flexDirection: 'column' }}>
        <div className="analytics-header">
          <div className="analytics-title-group">
            <Code2 size={20} />
            <div>
              <h2>{pt ? 'Artefato' : 'Artifact'} · {artifact.title}</h2>
              <p className="analytics-subtitle">{pt ? 'Preview ao vivo, em sandbox isolado.' : 'Live preview, isolated sandbox.'}</p>
            </div>
          </div>
          <button className="settings-close" onClick={onClose}><X size={18} /></button>
        </div>
        <iframe
          title="artifact-preview"
          sandbox="allow-scripts allow-modals allow-popups"
          srcDoc={artifactSrcDoc(artifact)}
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff', borderRadius: '0 0 10px 10px' }}
        />
      </div>
    </div>
  )
}
