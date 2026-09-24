---
description: Implementa algo novo reaproveitando o que o projeto já tem (visual, fluxo, ferramentas) e provando com teste
argument-hint: <o que construir>
---
Construir: $ARGUMENTS

1. Roteie para o agente dono (CLAUDE.md). Leia `docs/contratos/reuso.md` e `docs/contratos/padroes-ui.md`: encaixe em padrão existente; só invente padrão novo se nenhum servir (e registre em `docs/padroes.md`).
2. Cor/emoji/marca vêm do tema; IDs do tenant; `customId` existente não muda.
3. Escreva teste que exerce o fluxo (`tools/banco-em-memoria.js` + `tools/discord-falso.js`, modelo em `test/fluxos.gavioes.test.js`).
4. Feche com `npm run lint`, `npm test` (+ `npm run test:integracao` se mexeu em SQL) e diga o que rodou. Regras novas → `docs/contratos/regras-negocio.md`; utilitário reutilizável → `docs/contratos/reuso.md`.
