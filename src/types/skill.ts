// ─── Skills — capacidades reutilizáveis invocadas pelo modelo (v2.27.0) ──────
//
// Uma skill é diferente de uma persona (que troca a identidade inteira, uma por
// vez) e do prompt-vault (trechos manuais). É uma capacidade ON-DEMAND: nome +
// descrição ficam sempre num manifesto barato no system prompt; as instruções
// completas só entram no contexto quando o modelo chama load_skill (ou quando a
// skill está "pinned"/casada por palavra-chave). Espelha o padrão de
// progressive disclosure do tool-deferral.

export interface Skill {
  id: string
  /** Identificador curto que o modelo usa em load_skill (ex.: "code-review"). */
  name: string
  /** "Quando usar" — sempre visível no manifesto. */
  description: string
  /** Corpo detalhado — carregado sob demanda. */
  instructions: string
  /** Palavras-gatilho: se aparecem na mensagem, a skill é auto-sugerida/fixada
   *  naquele turno (Fase 3). Opcional. */
  triggers?: string[]
  /** v2.92.0 — ferramentas REMOVIDAS do modelo enquanto a skill está ativa
   *  (porta o frontmatter `disallowed-tools` das skills do Claude Code). Nomes de
   *  tool (ex.: "browser_navigate", "execute_command"). Restringe/foca a skill.
   *  Opcional; ausente = não remove nada. Ver utils/skills.collectDisallowedTools. */
  disallowedTools?: string[]
  /** v2.105.0 — allowlist POSITIVA: se preenchida, enquanto a skill está ativa o
   *  modelo só recebe ESTAS ferramentas (+ load_skill). Mais forte que
   *  disallowedTools. Opcional; ausente = não restringe por allowlist. */
  allowedTools?: string[]
  /** v2.106.0 — exemplos/few-shot opcionais anexados às instruções (modelos
   *  pequenos seguem muito melhor com 1 exemplo concreto). */
  examples?: string
  /** v2.107.0 — ESCOPO de projeto: se definido, a skill só fica disponível
   *  quando a conversa está nesse projeto. Ausente = global (sempre). */
  projectId?: string
  /** Aparece no manifesto (disponível para o modelo). */
  enabled: boolean
  /** Injeta as instruções completas SEMPRE (sem depender de load_skill) —
   *  fallback confiável para modelos pequenos. */
  pinned: boolean
  /** Skill que vem de fábrica (não pode ser excluída, só desativada). */
  isBuiltIn?: boolean
  createdAt: number
  // ─── Auto-aprendizado (Fase 1, v2.52.0) — campos OPCIONAIS, retrocompatíveis ───
  /** Origem: 'builtin' de fábrica, 'user' criada pelo usuário, 'learned'
   *  induzida automaticamente de memória de domínio (Fase 3). Ausente = user. */
  kind?: 'builtin' | 'user' | 'learned'
  /** Skills APRENDIDAS nascem em 'staging' (não entram no manifesto até
   *  aprovação 1-clique — guarda-rail contra skill-poisoning). Ausente = active. */
  status?: 'active' | 'staging'
  /** Proveniência de uma skill aprendida: de onde veio e quão reforçada. */
  provenance?: { sourceConvIds: string[]; confidence: number }
  // ─── Auto-evolução (v2.154.0) ───────────────────────────────────────────
  /** Quantas vezes a skill ficou ativa num turno — informa o "Evoluir com IA"
   *  ("de acordo que for usada") e pode nudge a evolução. */
  usageCount?: number
}
