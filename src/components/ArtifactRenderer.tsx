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
      <iframe
        srcDoc={artifact.content}
        sandbox="allow-scripts allow-forms allow-same-origin"
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
