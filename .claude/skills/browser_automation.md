# Skill: Browser Automation & Context Bloat Prevention

## Regras Absolutas

- **REGRA 1 (Anti-Context Bloat):** NUNCA carregue ou imprima no terminal o HTML bruto (`innerHTML` ou `outerHTML`) de uma página inteira. Extraia APENAS o texto visível (`document.body.innerText`) ou construa uma Árvore de Acessibilidade limpa.
- **REGRA 2 (Seletores Resilientes):** Para interagir com a UI (clicar/digitar), NÃO use seletores CSS complexos ou gerados automaticamente. Priorize XPath por texto visível (ex: `//button[contains(text(), 'Login')]`), atributos `aria-label` ou `data-testid`.
- **REGRA 3 (Espera Explícita):** Após qualquer ação de navegação ou clique, você DEVE aguardar a página carregar (network idle ou waitForSelector) antes de emitir o próximo comando. 
- **REGRA 4 (Fallbacks):** Se um seletor não for encontrado, não tente "adivinhar" outro às cegas. Interrompa, faça um dump das tags `<button>` e `<a>` visíveis e recalibre.
