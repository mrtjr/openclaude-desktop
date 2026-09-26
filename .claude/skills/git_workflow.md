# Skill: Git Workflow and Self-Healing

## Descrição
Automação de versionamento e proteção do repositório para o agente autônomo, garantindo isolamento de tarefas complexas e fallback seguro em caso de falhas ("Self-Healing").

## Regras de Execução

1. **Antes de Alterar Arquivos:**
   - Execute `git status`.
   - Se a árvore estiver limpa e a tarefa for complexa, crie uma nova branch semântica: `git checkout -b feat/nome-da-tarefa` ou `fix/nome-do-bug`.

2. **Após Sucesso:**
   - Assim que o `plan_tasks` for concluído com sucesso e validado, execute:
     - `git add <arquivos que você alterou>` — nunca `git add .`: ele leva junto arquivos soltos do usuário e segredos que não estejam no `.gitignore`.
     - `git commit -m "tipo(escopo): descrição cirúrgica"`

3. **Proteção Contra Falhas (Self-Healing):**
   - Se as edições quebrarem o código (verificado via linter ou testes) e não for possível consertar após 3 tentativas de edição consecutivas, VOCÊ DEVE abortar a operação de forma REVERSÍVEL:
     - Execute `git stash push --include-untracked -m "self-healing: <tarefa>"` — nunca `git reset --hard` nem `git clean -fd`, que apagam para sempre também o trabalho não commitado do usuário.
     - Avise o usuário sobre a reversão e diga como recuperar: `git stash pop`.
