# Skill: Git Workflow and Self-Healing

## Descrição
Automação de versionamento e proteção do repositório para o agente autônomo, garantindo isolamento de tarefas complexas e fallback seguro em caso de falhas ("Self-Healing").

## Regras de Execução

1. **Antes de Alterar Arquivos:**
   - Execute `git status`.
   - Se a árvore estiver limpa e a tarefa for complexa, crie uma nova branch semântica: `git checkout -b feat/nome-da-tarefa` ou `fix/nome-do-bug`.

2. **Após Sucesso:**
   - Assim que o `plan_tasks` for concluído com sucesso e validado, execute:
     - `git add .`
     - `git commit -m "tipo(escopo): descrição cirúrgica"`

3. **Proteção Contra Falhas (Self-Healing):**
   - Se as edições quebrarem o código (verificado via linter ou testes) e não for possível consertar após 3 tentativas de edição consecutivas, VOCÊ DEVE abortar a operação:
     - Execute `git reset --hard` e `git clean -fd`
     - Avise o usuário sobre o fallback e a reversão de segurança.
