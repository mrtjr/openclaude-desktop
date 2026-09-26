import React from 'react'

interface ArtifactRendererProps {
  artifact: {
    type: string
    content: string
  } | null
}

export default function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  if (!artifact) return null

  if (artifact.type === 'html' || artifact.type === 'svg') {
    return (
      // SEM allow-same-origin: junto com allow-scripts ele ANULA o sandbox — o
      // srcDoc herda a origem do app, e o script do artefato (HTML escrito pelo
      // modelo) alcançava parent.electron: execCommand, writeFile, tudo sem
      // aprovação. Popups também ficam de fora: a janela nova herdaria o preload.
      <iframe
        srcDoc={artifact.content}
        sandbox="allow-scripts allow-forms"
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Artifact Preview"
      />
    )
  }

  return (
    <div style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
      Visualização não suportada para o tipo: {artifact.type}
    </div>
  )
}
