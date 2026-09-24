# Atualizar Node, bibliotecas e ferramentas

Regra: **nada sobe sem passar pela mesma régua que protege o servidor hoje** —
lint, `npm test` (inclui `test/fluxos.gavioes.test.js`, que roda os fluxos reais do
Gaviões) e `npm run test:integracao`. Atualizar é rotina, não evento.

## Node

- Suportado: 20.19+ (`engines`), testado em 20, 22, 24 e 26. Recomendado: **24 LTS** (`.nvmrc`).
- Node 20 já saiu de suporte; suba a produção para 24 quando quiser, sem mudar código.
- Testar uma versão sem instalar nada: `npm run testar:node -- 22 24 26`
  (baixa o binário de nodejs.org e roda `node --test` com ele).
- Para subir a versão de produção: passar `testar:node` na versão nova → atualizar
  `.nvmrc`, `engines` (se o piso mudar) e o `FROM` do `Dockerfile` → README (linha de requisitos).
- O CI roda a matriz 20/22/24 e um job `node-atual` (não bloqueia) para avisar cedo.

## Bibliotecas

1. `npm outdated` (ou espere o PR semanal do Dependabot, `.github/dependabot.yml`).
2. Uma biblioteca por vez: `npm install pacote@versao`.
3. `npm run lint && npm test && npm run test:integracao`.
4. `npm run auditar` (produção deve ficar em **0 vulnerabilidades**; o CI bloqueia `high`).
5. Major de `discord.js`, `pg` ou `canvas`: leia o changelog e rode também `npm run testar:node -- 22 24`.
6. npm 11 bloqueia scripts de instalação: `canvas` está liberado em `allowScripts`
   (`package.json`); outro pacote com binário nativo exige `npm approve-scripts`.

## Ferramenta ou biblioteca nova

Antes de adicionar: já existe algo equivalente em `docs/contratos/reuso.md`? Se
não, adicione, registre no catálogo e escreva o teste que a usa.

## O que os testes NÃO provam

Discord de verdade (permissões, rate limit, formato real de eventos) e o
desempenho com carga. Depois de subir Node ou `discord.js`, olhe os logs (`/status`,
`GET /health`) nas primeiras horas em produção.
