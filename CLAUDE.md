# botfivem

Bot de Discord para torcidas em servidores de FiveM. Cada instância atende **uma
torcida** (um tenant): mesmo código, cores, marca, módulos e IDs próprios.

## Mapa do repositório

| Pasta | O que é |
|---|---|
| `tenants/<slug>/` | dados da torcida: `tenant.js` (IDs, limites, módulos), `tema.js` (cor, emoji, marca), `assets/` |
| `config/` | carrega e valida o tenant ativo (`TENANT`, default `gavioes`); devolve congelado |
| `tema/` | fábrica e validação do tema; **todo** código pede cor/emoji/marca aqui |
| `modulos/` | um manifesto por módulo (ligar/desligar por tenant) |
| `plataforma/` | resolve módulos, executa hooks, liga eventos do Discord |
| `fontes/` | adapters de servidor de jogo (`hoolibras`): webhook → registro canônico |
| `utils/` | regra de negócio por domínio (`regras.js` puro, `repositorio.js` SQL, `interacoes.js` Discord) |
| `commands/` | slash commands (cada arquivo pertence a um módulo) |
| `tools/` | conformidade, retrato de módulos, novo tenant |
| `docs/contratos/` | contratos compartilhados (leia antes de mexer) |
| `.claude/agents/` | agentes por área |

## Antes de mexer, leia

`docs/contratos/`: `tema.md`, `modulos.md`, `tenant.md`, `eventos-canonicos.md`,
`regras-negocio.md`, `padroes-ui.md`, `filtros.md`. Padrões e histórico:
`docs/padroes.md`. Plano do produto: `docs/plano-produto-multi-torcida.md`.

## Roteamento: toda pergunta e todo desenvolvimento passam por aqui

1. Descubra a área na tabela de agentes abaixo e siga o que o agente manda ler.
2. Leia `docs/contratos/regras-negocio.md` (invariantes) e `docs/contratos/reuso.md`
   (o que já existe: visual, fluxo, ferramentas). Reaproveite antes de criar.
3. Fluxo novo ou mexida em fluxo: teste ponta a ponta com `tools/banco-em-memoria.js`
   + `tools/discord-falso.js` (modelo: `test/fluxos.gavioes.test.js`).
4. Regra de negócio nova ou decisão do usuário → registre em `docs/contratos/regras-negocio.md`;
   utilitário/padrão reutilizável → `docs/contratos/reuso.md`.
5. Atualizar Node ou biblioteca: `docs/atualizacoes.md`.

Atalhos: `/duvida`, `/nova-funcionalidade`, `/atualizar-dependencias`.

## Regras que valem sempre

1. **Nenhum literal de cor, emoji de estado verde, marca de torcida, ID de Discord
   ou caminho de imagem em `utils/`, `commands/`, `modulos/`, `plataforma/`.**
   Vêm de `tema/` e `tenants/`. O guardião (`npm run conformidade`) mede e só
   deixa o número cair.
2. **Módulo desligado não deixa rastro** (comando, handler, painel, tabela):
   `require` preguiçoso nos manifestos.
3. **Nunca escreva no banco real em teste ou script.** Use PGlite ou intercepte
   `utils/db.js` e aborte se falhar.
4. **`customId` existente não muda** (botões já postados no servidor).
5. Permissão é conferida no handler; "resolvido" só depois da ação ter funcionado.
6. Dinheiro é sempre o do jogo.

## Comandos

```
npm test                    # tudo (inclui paridade, migrações em PGlite, deploy por tenant)
npm run lint                # zero avisos
npm run conformidade        # relatório do guardião (baseline em test/conformidade.baseline.json)
npm run conformidade:atualizar   # SÓ depois de migrar código (o número caiu)
npm run test:integracao     # repositórios contra Postgres em memória
npm run modulos             # retrato do que sobe: TENANT=<slug> npm run modulos
npm run novo-tenant -- --slug x --guild <ID> --nome "Nome"
npm run deploy              # registra os comandos dos módulos ligados (chama o Discord!)
npm start
```

## Agentes (`.claude/agents/`)

`plataforma` (tenants, módulos, migrações, onboarding) · `tema-design` (cor, emoji,
marca) · `logs-jogo` (fontes, parser, painéis, alertas) · `recrutamento-disciplina`
(sócio, ADV, carteirinha) · `financas-patrimonio` (caixa, loja, rifas, patrimônio) ·
`eventos-operacao` (eventos, escala, caravana, tarefas, anti-spam) · `guardiao`
(revisa contra os contratos).

Agentes de processo (qualquer área): `arquiteto-fluxos` (desenha fluxo novo ANTES de
codar) → `implementacao` (codifica o plano aprovado) → `qa-conformidade` (verifica
antes de dar como pronto) · `midias-sociais` (departamento de mídias).

## Terminado significa

`npm run lint` e `npm test` verdes, guardião sem violação nova, e — se mexeu em
SQL — `npm run test:integracao`. Diga o que rodou.
