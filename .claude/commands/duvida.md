---
description: Responde uma dúvida sobre o botfivem passando pelo agente dono da área e pelo conhecimento acumulado
argument-hint: <pergunta>
---
Dúvida: $ARGUMENTS

1. Identifique a área (tabela "Roteamento" do CLAUDE.md) e leia `docs/contratos/regras-negocio.md`, `docs/contratos/reuso.md` e o que o agente da área manda ler.
2. Responda com base no código e nos contratos — cite arquivo:linha. Se a resposta depender de algo que só o servidor real mostra, diga.
3. Se surgir regra de negócio nova ou decisão do usuário, proponha registrá-la em `docs/contratos/regras-negocio.md`.
