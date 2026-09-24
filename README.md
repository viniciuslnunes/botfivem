# botfivem

Bot de Discord para torcidas em servidores de FiveM. Opera a torcida dentro do
Discord: recrutamento, sócios e carteirinha, departamentos, agenda e caravanas,
loja, livro-caixa, patrimônio, rifas, confiança, memória e a leitura dos logs do
jogo. O dinheiro é sempre o do jogo.

**Uma instância por torcida.** O mesmo código serve a torcidas diferentes: cada
uma tem o seu *tenant* (`tenants/<slug>/`) com IDs do Discord, cores, emojis,
marca, módulos ligados e o servidor de jogo de onde vêm os logs. Mais sobre a
arquitetura em [docs/plano-produto-multi-torcida.md](docs/plano-produto-multi-torcida.md)
e nos contratos em [docs/contratos/](docs/contratos/).

## Requisitos

- Node.js 20.19 ou mais novo (testado em 20, 22, 24 e 26; recomendado: 24 LTS, ver `.nvmrc`)
- PostgreSQL (um por torcida)
- Variáveis no `.env` (copie o [.env.example](.env.example); nunca faça commit do `.env`):

```
DISCORD_TOKEN=token do bot
CLIENT_ID=id da aplicação no Discord
DATABASE_URL=postgres://usuario:senha@host:5432/banco
TENANT=gavioes            # pasta em tenants/ (default: gavioes)
```

`npm run deploy` precisa de `DISCORD_TOKEN` e `CLIENT_ID`; `npm start` precisa de
`DISCORD_TOKEN` e `DATABASE_URL`. Em produção (Railway) elas vêm do painel do serviço.

## Colocar no ar (torcida que já tem tenant)

1. `npm install`
2. `npm run deploy` — registra os comandos **dos módulos ligados** no servidor
3. `npm start` — valida o tenant e os módulos (lista tudo que faltar e não sobe), cria as tabelas dos módulos ligados (só acrescenta, nunca apaga), lê o histórico dos canais de log e reconcilia as carteirinhas
4. No Discord, o cargo do bot precisa de **Gerenciar Cargos** e **Gerenciar Canais** e ficar acima dos cargos que ele concede (o `/setup diagnostico` confere)
5. Como administrador, conforme os módulos ligados: `/departamentos` → `/loja setup` → `/rifa setup` → `/memoria setup`

## Torcida nova

```
npm run novo-tenant -- --slug mancha-verde --guild <ID do servidor> --nome "Mancha Verde"
```

Cria `tenants/mancha-verde/` em **modo instalação** (o bot sobe só com o `/setup`).
Depois: `/setup diagnostico` → `/setup mapear` → `/setup criar`, cole os IDs no
`tenant.js`, ajuste `tema.js` (cores, marca) e remova `instalacao: true`. Passo a
passo em [docs/contratos/tenant.md](docs/contratos/tenant.md).

## Comandos

| Módulo | Comandos | Quem usa |
|---|---|---|
| Onboarding | `/setup diagnostico · mapear · criar` | Administrador |
| Saúde | `/status`, `/botperms` | Liderança · administrador |
| Logs do jogo | `/logs`, `/estatisticas torcida · membro · categoria · inativos · recrutamento`, `/logs-sincronizar` | Liderança |
| Sócios | `/carteirinha`, `/carteirinhas situacao · renovar` | Sócio · liderança |
| Departamentos | `/departamentos` (criar/verificar); incluir, remover e quadro pelos botões | Gestor da área · presidência |
| Agenda | `/evento criar · lista · cancelar · relatorio` | Liderança e gestores |
| Escala | `/escala convocar · ver · remover` | Quem organiza o evento |
| Caravana | `/caravana veiculo · alocar · embarque · manifesto` | Quem organiza a caravana |
| Financeiro | `/financeiro lancar · extrato · balanco · publicar-balanco · excluir` | Liderança e área Financeiro |
| Loja | `/loja produto-adicionar · produto-editar · produtos · vendas · setup` | Gestão da loja |
| Patrimônio | `/patrimonio adicionar · lista · ver · retirar · devolver · editar · baixar · pendencias` | Patrimônio, Bandeiras e Bateria |
| Rifas | `/rifa …` | Social e Eventos |
| Confiança | `/confianca` | Todos |
| Memória | `/memoria registrar · dia · setup` | Sócios |
| Outros | `/bloquearid`, `/validarid`, `/hierarquia`, `/elenco`, `/mural`, `/toprecrutadores`, `/quadrorecrutadores`, `/setup-botoes` | — |

Recrutamento, advertências, carteirinha, tickets e vitrines funcionam pelos botões
fixos nos canais. Comando de módulo desligado no tenant não é registrado.

## Testes e verificações

```
npm test                    # regras puras, paridade de comandos, migrações (PGlite), deploy por tenant, docs em sincronia
npm run lint                # zero avisos
npm run conformidade        # guardião: cor, emoji verde, marca, ID e asset fora do tema/tenant
npm run test:integracao     # repositórios contra um Postgres real embutido (PGlite)
npm run modulos             # o que sobe para um tenant: TENANT=<slug> npm run modulos
```

Nenhum teste toca o banco real. O CI (`.github/workflows/ci.yml`) roda lint e testes.

## Estrutura

```
tenants/      uma pasta por torcida: tenant.js, tema.js, assets/
config/       carrega e valida o tenant ativo
tema/         cores, emojis e marca (todo código pede aqui)
modulos/      um manifesto por módulo (liga/desliga por tenant)
plataforma/   resolve módulos, executa hooks, liga os eventos do Discord
fontes/       adapters de servidor de jogo (webhook → registro canônico)
commands/     slash commands (cada arquivo pertence a um módulo)
utils/        um diretório por domínio: regras puras, repositório (SQL), interações
tools/        guardião de conformidade, retrato de módulos, novo tenant
integracao/   testes de integração com banco
test/         testes
docs/         contratos, padrões e plano
```
