---
name: gui_automation
description: "Playbook de orquestração Vision-to-Action para uso do computador."
---

# Orquestração de Automação de GUI (Vision-to-Action Workflow)

Regras absolutas para governar qualquer interação de "Computer Use":

- **REGRA 1 (Mapeamento Visual Inicial)**: NUNCA tente adivinhar coordenadas às cegas. Antes de qualquer interação, invoque `take_screenshot` para obter o estado atual do desktop.
- **REGRA 2 (Análise Espacial)**: Leia a análise retornada pelo `take_screenshot` — elementos visíveis com a posição (X, Y) do centro de cada um, em pixels da tela (as mesmas coordenadas do `mouse_move`). Para achar um alvo específico, passe `prompt` (ex.: "onde está o botão Salvar?").
- **REGRA 3 (Execução Precisa)**: Invoque `mouse_move(x, y)` seguido da ação necessária (`mouse_click` ou `keyboard_type`).
- **REGRA 4 (Verificação de Estado - CRÍTICO)**: Após o clique ou digitação, invoque `take_screenshot` OBRIGATORIAMENTE para validar se a interface respondeu (ex: o menu abriu? o texto apareceu?). Se falhar, recalibre as coordenadas e repita o ciclo.
