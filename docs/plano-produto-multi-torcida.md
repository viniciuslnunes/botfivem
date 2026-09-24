# Plano de produto — botfivem para várias torcidas

> **Estado (2026-09-24): as etapas F0–F7 foram implementadas.** Este documento é o
> plano e a auditoria de partida (os números da §2 são de antes das mudanças). O
> que foi feito, os desvios e as pendências estão em
> [backlog-execucao-produto.md](backlog-execucao-produto.md); o funcionamento atual,
> em [contratos/](contratos/) e [operacao.md](operacao.md); o lado comercial, em
> [comercial.md](comercial.md).

> Auditoria feita em 2026-09-24 sobre o código na `main` (≈24 mil linhas de JS,
> 18 arquivos de teste). Os números abaixo saem de `grep` no repositório, não
> de estimativa. Objetivo: transformar o bot de "o bot dos Gaviões" em um
> produto que outra torcida (com outras cores, outra marca, outro servidor de
> jogo) consegue usar sem editar código.

---

## 1. Como o projeto funciona hoje

**Entrada.** `index.js` valida `DISCORD_TOKEN` e `DATABASE_URL`, carrega todo
arquivo de `commands/` e de `events/` por `readdir` e liga no `Client`.

**Configuração.** Um único objeto em `config/index.js` (253 linhas), importado
direto por 65 arquivos: IDs de cargo/canal/categoria, `guildId`, links,
departamentos, limites de negócio (farm, caixa, anti-spam, presença…). Trocar
qualquer coisa exige editar código e fazer deploy.

**Fluxo de webhook (o coração do produto).**
```
FiveM ──webhook──▶ canal de log do Discord (4 canais, dentro de LOGS HOOLIBRAS)
                        │ events/messageCreate.js
                        ▼
   ingestao.js  (trava de canal/categoria → parser.js → INSERT idempotente em logs_jogo)
                        │
        ┌───────────────┼────────────────────────┐
        ▼               ▼                        ▼
   alertas.js     painéis reativos         correlações
 (regra → embed   (PAINEIS_POR_CATEGORIA   (ids-sem-discord,
  @liderança)      → debounce → edita       advertência×jogo,
                   a mensagem fixa)         retenção recrutador)
```
O painel nunca lê o webhook: lê `logs_jogo` (Postgres) por período. Os
padrões de painel (mensagem fixa curta + exploração ephemeral, edição manual
botão→select→modal, ajuste automático sobre valor manual) estão em
`docs/padroes-e-canais.md`.

**Interações.** `utils/modulos.js` roteia `customId` no formato
`<modulo>:<acao>:…`. Todo módulo novo usa isso. Os fluxos antigos (ticket,
recrutamento, advertência, bloqueio de ID) continuam dentro de
`events/interactionCreate.js` (1.063 linhas).

**Regra de negócio.** Cada domínio é uma pasta em `utils/` com a mesma
anatomia: `regras.js` (função pura, testada), `repositorio.js` (SQL),
`interacoes.js` (Discord), às vezes `permissoes.js`. Essa separação é o melhor
ativo do projeto — é ela que permite extrair "inteligência por fluxo".

**Persistência.** Postgres via `pg`, `utils/migracoes.js` (um arquivo, só
acrescenta), tabela `bot_config` como chave/valor para IDs criados pelo bot.

---

## 2. Achados da auditoria (o que impede vender hoje)

| # | Achado | Evidência | Gravidade |
|---|---|---|---|
| A1 | **Cor é literal espalhada.** `0x000000` ×80, `0xFF0000` ×27, `0xFFCC00`/`0xF1C40F`, hex em canvas e gráficos, em 57 arquivos. Só `logsJogo` tem `F.COR`; o resto repete o número. Gráficos têm paleta própria. | grep `0x[0-9A-F]{6}` | Alta |
| A2 | **A regra "nada verde" é violada pelo próprio código.** 37 ocorrências de 🟢/✅ (carteirinha VIGENTE, online, rifa ABERTA, confirmar presença, caravana…). A regra só existe como texto em doc, não como verificação. | grep emoji | Média (prova de que regra sem teste apodrece) |
| A3 | **Marca dos Gaviões cravada no código.** ≈262 menções (`GAVIÕES DA FIEL FIVEM` em títulos de embed, `S GDF \|` como prefixo de nick, `GDF Sócio` como nome de baú, `[R.S.J]`, logo `gavioesdafielfivem_logo.png` em 3 lugares, texto do canvas da carteirinha, `🦅` ×61). 48 só em `interactionCreate.js`. | grep marca | Alta |
| A4 | **Config é um singleton importado por 65 arquivos**, sem schema. Um ID faltando só quebra em runtime, na hora do uso. | `require('config/index')` ×65 | Alta |
| A5 | **Parser acoplado a UM servidor de FiveM (Hoolibras).** 698 linhas de regex sobre o texto exato do log, códigos de spawn `hoolibras_*`, nomes de baú, lista de itens de farm. Outra torcida em outro servidor de jogo teria logs diferentes. | `parser.js`, `estatisticas.js` | Alta (é o maior risco técnico) |
| A6 | **Sem isolamento de tenant.** Nenhuma tabela tem `guild_id`; `db.js` é um pool global. Hoje isso é *ok* se cada torcida rodar sua própria instância — mas precisa ser decisão explícita. | 0 `guild_id` em `migracoes.js` | Decisão |
| A7 | **Sem liga/desliga de módulo.** Todo `commands/*.js` e todo painel sobe sempre. Torcida sem farm/rifas/caravana ainda recebe tudo. | `index.js` readdir | Média |
| A8 | **Deuses de arquivo.** `interactionCreate.js` (1.063) mistura ticket/recrutamento/advertência; `messageCreate.js` importa e chama 12 painéis à mão; `repositorio.js` 831. Cada painel = 2 arquivos quase idênticos (`painelX` + `painelXInteracoes`). | wc -l | Média |
| A9 | **Qualidade sem rede de proteção.** `npm run lint` existe mas não há config de ESLint (script quebrado); sem CI; testes só cobrem funções puras (nenhum teste de embed/painel/fluxo). | ausência de `eslint.config.*` | Média |
| A10 | **Segurança/ops para vender.** `ssl: { rejectUnauthorized: false }` no pool; sem observabilidade além de `console.error`; timers `setInterval` espalhados além do `agendador`. | `db.js`, grep setInterval | Média |
| A11 | **Ativo de conhecimento fora do Git.** `docs/padroes-e-canais.md` (o melhor documento do projeto) está no `.gitignore` por causa dos IDs de canal. Mistura padrão genérico (valioso e reutilizável) com dado de tenant (IDs). | `.gitignore` | Média |
| A12 | **Assets do tenant no repositório.** `img/` com logo/capa dos Gaviões e da R.S.J. | `img/` | Baixa |

**O que já está bom e deve ser preservado:** separação regra pura/SQL/Discord;
`registrarModulo`; `criarPainelCanal` (motor genérico de painel);
`painelFormato.js`/`painelComponentesFixos.js`; trava dupla de ingestão;
`agendador` persistente; testes de regra sem banco; a disciplina de "regra
vira lição documentada".

---

## 3. Arquitetura-alvo

### 3.1 Tenant = um arquivo de dados, não código

```
tenants/
  gavioes/
    tenant.js        ← tudo que hoje está em config/index.js
    assets/          ← logo, capa (saem de img/)
  <outra-torcida>/
config/index.js      ← só um LOADER: lê TENANT=<slug>, valida com schema, congela
```
`tenant.js` tem blocos: `discord` (guildId, cargos, canais, categorias),
`marca`, `tema`, `modulos` (quais estão ligados), `jogo` (fonte de logs) e
`negocio` (limites: caixa, farm, presença…). O loader **falha na subida** se
faltar campo obrigatório — nunca em runtime.

**Modelo de tenancy recomendado (decisão A6):** *uma instância por torcida*
(cada uma com seu token de bot, seu Postgres, seu `TENANT`). É o caminho mais
barato, mais seguro (dados nunca se misturam), e permite vender rápido. Só
migrar para "um processo, várias guilds" (`guild_id` em todas as tabelas,
contexto por interação) se o número de clientes justificar o custo.

### 3.2 Tema e marca como tokens (o que você descreveu das cores)

```js
tema: {
  marca:   { nome: 'GAVIÕES DA FIEL FIVEM', sigla: 'GDF', nickPrefixo: 'S GDF | ', emoji: '🦅', logo: 'assets/logo.png' },
  cor:     { primaria: 0x000000, perigo: 0xFF0000, aviso: 0xFFCC00, neutro: 0x808080, destaque: 0xFFFFFF },
  emoji:   { ok: '⚪', online: '🦅', offline: '⚫', perigo: '🔴', aviso: '⚠️' },
  grafico: { fundo: '#111214', texto: '#f0f0f0', serie: ['#FFFFFF', '#FF0000', '#999999'] },
  proibido: { matizes: ['verde'] },   // regra da torcida, verificada por teste
}
```
- Código de módulo **nunca** escreve `0x…`, `#…` nem emoji de estado: pede
  `tema.cor.primaria`, `tema.emoji.online`. Torcida de mancha verde troca o
  arquivo e o `proibido`, e o servidor inteiro muda.
- `proibido` vira um **teste automático**: converte cada token para HSL e
  falha se cair no matiz proibido (verde: matiz ~75°–165°). É assim que "essa
  torcida odeia verde" deixa de ser um parágrafo de doc e vira garantia.
- Carteirinha, hierarquia, gráficos (chart.js e canvas) leem o mesmo tema.

### 3.3 Módulos como manifesto

```js
// utils/farm/modulo.js
module.exports = {
  id: 'farm',
  requer: ['logsJogo'],
  comandos: [...], paineis: [...], migracoes: [...],
  configSchema: {...},            // o que o tenant precisa informar
  aoIniciar(client, tenant) {...},
};
```
`index.js` carrega só os módulos listados em `tenant.modulos`, registra
comandos/painéis/migrações deles e valida dependências. Substitui os
`readdir` cegos, a lista manual de painéis em `messageCreate` e o deploy de
todos os comandos.

### 3.4 Fonte de logs como adapter

Contrato estável = **evento canônico** (`categoria`, `acao`, `ator`, `alvo`,
`valor`, `quando`) que hoje já existe na tabela `logs_jogo`. Painéis e
alertas só conhecem isso. O parser vira um adapter:
```
fontes/hoolibras/   parser.js, itens.js (farm, baús, patrimônio), formatos.md
fontes/<outro>/     …
```
Ganho extra: o risco de "servidor de jogo mudou o texto do log" fica isolado
em um diretório com testes de amostra real.

### 3.5 Onboarding (`/setup`)
Wizard para a torcida nova: escolhe módulos, mapeia cargos/canais existentes
ou deixa o bot criar, valida permissões do bot, grava tudo no tenant. Hoje o
equivalente é editar `config/index.js` à mão e rodar `/departamentos setup`.

---

## 4. Agentes por fluxo

Interpretação adotada: **agentes de desenvolvimento** (subagentes do Claude
Code em `.claude/agents/`), cada um dono de um domínio, todos lendo os mesmos
arquivos de contrato. Não é IA dentro do bot em produção (ver pergunta em §7).

**Arquivos compartilhados (a "inteligência extraída"):**
```
docs/contratos/
  tema.md            tokens de cor/emoji/marca, regra de matiz proibido
  padroes-ui.md      painel fixo, ephemeral no fim, botão→select→modal, paginação
  regras-negocio.md  invariantes (marcar resolvido só após ação, fonte parada ≠ zero…)
  eventos-canonicos.md  categorias/ações de logs_jogo (o contrato dos adapters)
  filtros.md         períodos, busca por nome (fuzzy), correlação sem ID
docs/padroes-e-canais.md → separar em (a) padrões genéricos, VERSIONADOS e
                            (b) mapa de IDs do tenant, local/ignorado.
```

**Agentes (um arquivo `.claude/agents/<nome>.md` cada; escopo = pastas que possui):**

| Agente | Dono de | Conhece |
|---|---|---|
| `plataforma` | `config/`, `tenants/`, loader, manifestos, migrações, `agendador` | schema de tenant, ordem de subida, feature flags |
| `tema-design` | `tema`, embeds, canvas, gráficos, `painelFormato` | tokens, matiz proibido, padrões de UI |
| `logs-jogo` | parser/adapters, ingestão, painéis de log, alertas | eventos canônicos, trava de categoria, fonte parada |
| `recrutamento-disciplina` | recrutamento, advertência, carteirinha, ticket | funil, níveis de ADV, fichas cruzadas |
| `financas-patrimonio` | financeiro, loja, rifas, patrimônio, farm/caixa | dinheiro é do jogo, edição manual, limites |
| `eventos-operacao` | eventos, caravana, escala, departamentos | séries, lembretes, gestores de área |
| `guardiao` | **revisão transversal** | executa a checklist abaixo em todo diff |

**Guardião = regras viram código, não texto.** Um teste (`test/conformidade.test.js`)
que roda em `npm test` e no CI:
1. nenhum literal de cor (`0x…`/`#…`) fora de `tema`/`tenants`;
2. nenhum emoji de estado fora de `tema.emoji`;
3. nenhuma marca (`GAVIÕES`, `GDF`, `R.S.J`) fora de `tenants/`;
4. nenhum ID Discord (17–20 dígitos) fora de `tenants/`;
5. tokens de tema fora do matiz `proibido`;
6. `customId` de módulo novo segue `<modulo>:<acao>`.
Começa com **baseline de exceções** (as ocorrências de hoje) e o teste só
deixa o número cair — assim a migração é gradual e nunca regride.

---

## 5. Etapas

Cada etapa é entregável sozinha, com testes verdes, e não muda o
comportamento visível dos Gaviões (regressão zero é o critério de aceite).

| Etapa | Entrega | Critério de pronto | Esforço |
|---|---|---|---|
| **F0 Rede de proteção** | ESLint real + CI; `test/conformidade.test.js` com baseline; separar `padroes-e-canais.md` em genérico (versionado) e IDs (local) | `npm run lint` e `npm test` verdes no CI; baseline registrada | 1–2 dias |
| **F1 Tema/marca** | `tema` como tokens; codemod dos 57 arquivos de cor e ~37 emojis de estado; canvas/chart.js/carteirinha/hierarquia lendo o tema; teste de matiz proibido | baseline de cor = 0; trocar `tema` de teste para verde muda embeds e gráficos sem tocar em módulo | 3–5 dias |
| **F2 Tenant** | `tenants/gavioes/`, loader com schema e fail-fast, assets fora de `img/`, marca fora do código (títulos, `nickPrefixo`, nomes de baú, `interactionCreate`) | subir com `TENANT=gavioes` idêntico ao atual; segundo tenant de teste sobe (mesmo vazio) e falha com erro claro se faltar campo | 4–6 dias |
| **F3 Módulos** | manifestos; quebrar `interactionCreate` em módulos (`ticket`, `recrutamento`, `advertencia`, `bloqueioId`); registry de painéis no lugar da lista de `messageCreate`; feature flags | `tenant.modulos` desliga farm/rifas e nada deles sobe (comando, painel, migração) | 5–8 dias |
| **F4 Adapter de fonte** | mover parser/itens/baús para `fontes/hoolibras/`; interface + `eventos-canonicos.md`; testes com amostras reais de log | painéis não importam nada de `fontes/*`; adapter fake de teste alimenta um painel | 4–6 dias |
| **F5 Onboarding** | `/setup` (módulos, mapeamento de cargos/canais, validação de permissão, health-check) | torcida nova configurada em uma sessão, sem editar código | 5–7 dias |
| **F6 Agentes** | `.claude/agents/*` + `docs/contratos/*` (pode começar em paralelo com F0 pelo `guardiao` e `tema-design`) | cada agente executa uma tarefa-piloto do seu domínio respeitando contrato | 2–3 dias |
| **F7 Comercial** | pool com TLS verificado, backup, logging estruturado + health, template de deploy por tenant, revisão de licença (logos, marca Hoolibras, fontes), documentação de venda | checklist de deploy repetível; segurança revisada | 4–6 dias |

**Ordem e por quê:** F0 primeiro porque protege todo o resto. F1 antes de F2
porque cor/marca é o que você já quer ver funcionando e o `tema` alimenta o
`tenant`. F3 antes de F4 porque o adapter precisa do registry de módulos.
F6 acompanha desde cedo porque os agentes é que vão executar F1–F4 com
segurança.

---

> **Tarefas detalhadas por etapa:** [backlog-execucao-produto.md](backlog-execucao-produto.md).

## 6. Riscos e decisões que mudam o plano

1. **Banco de dados.** A direção anotada antes era eliminar o Postgres e
   consultar via canal/webhook do Discord. Para vender, isso pesa contra:
   isolamento, backup, performance de agregação (os painéis somam meses de
   log) e limites de API do Discord. Recomendação: manter Postgres
   (um por instância) até o produto estar de pé; reavaliar depois.
2. **Fonte de logs é dependência de terceiro.** O produto só funciona com
   logs no formato do servidor de jogo. Vender para torcida de outro servidor
   custa um adapter novo (F4) — isso precisa entrar no preço.
3. **Marca/licença.** Logos dos Gaviões saem do repo; confirmar se é ok
   nomear o servidor de jogo (Hoolibras) na documentação comercial.
4. **Escopo de cada torcida.** Este projeto sempre assumiu "um servidor = uma
   torcida". Continua valendo: multi-tenant aqui é *instância por cliente*,
   não hierarquia Sede/Subsede.

---

## 7. Perguntas em aberto (respostas mudam F2 e F6)

1. **Tenancy:** instância por torcida (recomendado) ou um bot único atendendo
   várias guilds?
2. **"Agentes":** confirma que são agentes de desenvolvimento (Claude Code)?
   Ou você também quer IA em produção dentro do bot (ex.: resumir logs,
   classificar ticket)?
3. **Clientes-alvo:** outras torcidas rodam no **mesmo servidor de FiveM**
   (Hoolibras) ou em servidores diferentes? Define se F4 é urgente.
