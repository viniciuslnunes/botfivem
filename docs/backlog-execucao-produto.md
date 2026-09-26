# Backlog de execução — botfivem multi-torcida

> **Estado (2026-09-24): F0 a F7 implementadas e verificadas** (309+ testes, lint sem
> avisos, guardião em zero, integração PGlite, teste de mutação 19/19). Ver a seção
> "Desvios e pendências" no fim. ☑ = feito, ☐ = não feito.

> Desdobra as etapas F0–F7 de [plano-produto-multi-torcida.md](plano-produto-multi-torcida.md)
> em tarefas. Premissas adotadas até o usuário dizer o contrário: **uma
> instância por torcida** (token + Postgres + `TENANT` próprios), **agentes =
> desenvolvimento (Claude Code)**, e Postgres mantido. Inventário medido em
> 2026-09-24.
>
> Regra de todas as etapas: **regressão visual zero para os Gaviões**. Cada
> tarefa termina com `npm test` verde; cada etapa termina em um commit próprio.

Legenda: ☑ feito · ☐ não feito · [T] tem teste automático · [R] revisão do usuário

---

## F0 — Rede de proteção  (1–2 dias)

Nada aqui muda comportamento do bot.

- ☑ **F0.1 ESLint de verdade.** Adicionar `eslint` + `eslint.config.js` (regras: `no-unused-vars`, `no-undef`, `eqeqeq` como aviso). Hoje `npm run lint` aponta para uma ferramenta que não existe. Corrigir só erros reais; o resto vira aviso.
- ☑ **F0.2 CI.** `.github/workflows/ci.yml`: Node 20, `npm ci`, `npm run lint`, `npm test`. (Testes não tocam banco — ver padrão 1.8.)
- ☑ **F0.3 Guardião v1** `test/conformidade.test.js` [T]. Varre `utils/ commands/ events/` e conta violações por regra, comparando com `test/conformidade.baseline.json`:
  1. literal de cor (`0x` + 6 hex ou `#` + 6 hex) — baseline hoje: **57 arquivos**;
  2. emoji de estado 🟢 ✅ 💚 🟩 — **20 arquivos**;
  3. marca (`GAVIÕES`, `GDF`, `R.S.J`, `RSJ`, `hoolibras`) — **24 arquivos**;
  4. ID Discord literal (17–20 dígitos) fora de `config/` — **0 hoje** (manter);
  5. caminho `img/` ou `fonts/` literal — **13 ocorrências**.
  O teste **falha se algum contador subir**; se descer, exige atualizar o baseline (trava o ganho).
- ☑ **F0.4 Separar `docs/padroes-e-canais.md`.** Criar `docs/padroes.md` (versionado: §0 regras, §1 padrões, §2 infra, §4 domínios — sem ID nenhum) e deixar em `docs/padroes-e-canais.md` (ignorado) só §3 (IDs). [R] confirmar que nenhum ID vazou para o versionado.
- ☑ **F0.5 Corrigir `.gitignore`/README** para apontar o novo doc.

**Pronto quando:** CI verde no GitHub, baseline commitado, `docs/padroes.md` sem nenhum número de 17+ dígitos.

---

## F1 — Tema e marca  (3–5 dias)

### F1.1 Módulo `tema` (base)
- ☑ Criar `tema/index.js` que exporta `cor`, `emoji`, `marca`, `grafico`, lendo do tenant ativo (por enquanto, de um `tema/gavioes.js`).
- ☑ Valores iniciais = exatamente os de hoje: `primaria 0x000000`, `perigo 0xFF0000`, `aviso 0xFFCC00`, `destaque 0xFFFFFF`, `neutro 0x808080`.
- ☑ **Unificar avisos:** existem `0xFFCC00` (3×) e `0xF1C40F` (3×) para "aviso" — escolher um, registrar no doc.
- ☑ **Teste de matiz proibido** [T]: converte cada token (cor de embed e hex de gráfico) para HSL; falha se cair em `proibido.matizes` (verde ≈ 75°–165°, com saturação > ~15% para não pegar cinza). Teste próprio com um tema verde de propósito deve **falhar**.
- ☑ Emojis: definir `emoji.ok`, `.online`, `.offline`, `.perigo`, `.aviso`, `.pendente`. Para os Gaviões: `ok ⚪`, `online 🦅`, `offline ⚫`. **Decisão [R]:** ✅ em botões (CONFIRMAR, ACEITAR, APROVAR) — trocar por `emoji.ok` também? Hoje contradiz a regra; a proposta é trocar.

### F1.2 Migração por lote (codemod + revisão)
Cada lote = 1 commit, baseline atualizado.

| Lote | Arquivos (cor ⟶ contagem) | Observação |
|---|---|---|
| L1 logsJogo | `alertas.js` 7, `painelFormato.js` (fonte de `F.COR`), `idsSemSocio.js` 4, `presencaInteracoes.js` 4, `consultas.js`, `relatorios.js`, `seguranca.js`, `registrosDiarios*.js` | `F.COR` passa a apontar para `tema.cor.primaria` — todos os `painel*` herdam |
| L2 gráficos | `graficoOcupacao.js` 9, `graficoTerritoriosPorDia.js` 7, `graficoFarmPorDia.js` 4 | hex de canvas/chart.js ⟶ `tema.grafico.*` (fundo, texto, texto fraco, grade, séries) |
| L3 imagens | `gerarCarteirinha.js` 15, `ticket.js` 21 | canvas da carteirinha e do ticket; texto `GAVIÕES DA FIEL TORCIDA` ⟶ `tema.marca` |
| L4 fluxos antigos | `events/interactionCreate.js` 11, `events/ready.js`, `events/messageCreate.js`, `recrutamento/*`, `alertaNovatos.js`, `mensagemNaoRecrutar.js` | |
| L5 módulos de área | `rifas/*`, `loja/*`, `eventos/*`, `memoria/*`, `caravana/*`, `escala/*`, `departamentos/*`, `carteirinha/*`, `antiSpam/*`, `hierarquiaEmbed.js`, `elenco.js`, `muralAssociados.js`, `quadroRecrutadores.js`, `topRecrutadores.js`, `logGestao.js`, `tarefas.js` | |
| L6 comandos | `commands/*.js` (rifa, patrimonio, setup-botoes, financeiro, evento, loja, carteirinhas, …) | |
| L7 emojis de estado | os 20 arquivos do inventário (`rifas/interacoes.js` 7, `convite/reenvio` 5, `memoria` 3, `eventos` 5, `escala` 3, `caravana` 2, `antiSpam` 2, painéis online, `carteirinha/regras.js`, `rifas/regras.js`, comandos) | `🟢/⚪` de online ⟶ `emoji.online/offline`; `carteirinha VIGENTE` e `rifa ABERTA` ⟶ `emoji.ok` |

**Pronto quando:** contadores de cor e de emoji de estado = 0 no baseline; trocar `tema/gavioes.js` por um tema de teste verde muda embed, gráfico e carteirinha **sem editar módulo**.

### F1.3 Marca (só o que é texto/asset — o resto fica para F2)
- ☑ `marca`: `{ nome, nomeCurto, sigla, nickPrefixo, emoji, logo, capa, faixa }`.
- ☑ Trocar os 13 caminhos `img/...` por `tema.marca.logo` etc.; mover imagens para `tenants/gavioes/assets/` (na F2).
- ☑ Títulos `… — GAVIÕES DA FIEL FIVEM` (bau, caixa, hierarquia, departamentos, ids-sem-discord…) ⟶ `${marca.nome}`.
- ☑ `formatarNick.js` (`'S GDF | '`) e o regex de nick em `estatisticas.js`/`idsSemSocio.js`/`consultas.js` ⟶ derivar de `marca.nickPrefixo`. **Cuidado:** é regra de negócio (extrai o ID do apelido) — teste com apelidos reais antes/depois [T].
- ☑ `interactionCreate.js` (48 menções) — fica para F3 quando o arquivo for quebrado; aqui só o que for texto/cor/logo.

---

## F2 — Tenant  (4–6 dias)

- ☑ **F2.1 Schema do tenant** (validação sem dependência nova, função `validar(tenant)`) [T]: campos obrigatórios (`discord.guildId`, cargos de liderança, `canais` mínimos, `marca`, `tema`), tipos, IDs no formato Discord, `modulos` conhecidos. Erro lista **todos** os campos faltando de uma vez.
- ☑ **F2.2 Extrair** `config/index.js` ⟶ `tenants/gavioes/tenant.js` (dados idênticos). `config/index.js` vira loader: `TENANT` (default `gavioes`), valida, `Object.freeze` profundo. Contrato antigo (`config.canais`, `config.cargos`…) **mantido como fachada** para os 65 importadores não quebrarem.
- ☑ **F2.3 Assets** para `tenants/<slug>/assets/`; resolver por `tema.marca`.
- ☑ **F2.4 Separar segredo de dado:** `.env` = `DISCORD_TOKEN`, `CLIENT_ID`, `DATABASE_URL`, `TENANT`. Atualizar `.env.example` e README.
- ☑ **F2.5 Tenant de teste** `tenants/_exemplo/` mínimo + teste que carrega e valida; teste negativo (falta `guildId` ⟶ erro claro) [T].
- ☑ **F2.6 Limpar `deploy-commands.js`** para ler `guildId` do tenant.

**Pronto quando:** `TENANT=gavioes npm start` idêntico a hoje; `TENANT=_exemplo` falha com mensagem legível listando o que falta.

---

## F3 — Módulos  (5–8 dias)

- ☑ **F3.1 Contrato de manifesto** `{ id, requer, comandos, paineis, migracoes, aoIniciar }` + `utils/plataforma/carregarModulos.js` que valida dependências e ordem [T].
- ☑ **F3.2 Migrar módulos por dependência**, do mais isolado para o mais entrelaçado: rifas ⟶ loja ⟶ patrimônio ⟶ caravana/escala/eventos ⟶ financeiro ⟶ memória/confiança ⟶ departamentos ⟶ carteirinha ⟶ recrutamento ⟶ logsJogo (por último).
- ☑ **F3.3 Quebrar `interactionCreate.js`** (1.063 linhas) nos módulos `ticket`, `recrutamento`, `advertencia`, `bloqueioId` usando `registrarModulo`. Cada fluxo mantém seus `customId` atuais — botões já postados no servidor **não podem quebrar** [T: teste lista de customIds antes/depois].
- ☑ **F3.4 Registry de painéis:** substituir os 12 `require` e `PAINEIS_POR_CATEGORIA` de `messageCreate.js` por `paineis.registrar({ categoria, agendar })` declarado no manifesto.
- ☑ **F3.5 Feature flags:** `tenant.modulos = { farm: false }` ⟶ comando não é registrado, painel não nasce, migração não roda [T].
- ☑ **F3.6 Painel declarativo (opcional):** os ~10 pares `painelX`/`painelXInteracoes` viram definição sobre `criarPainelCanal`. Só se F3.4 mostrar duplicação clara.

**Pronto quando:** `interactionCreate.js` < 150 linhas; tenant sem `rifas`/`farm` sobe sem carregar nada deles.

---

## F4 — Adapter de fonte de logs  (4–6 dias)

- ☑ **F4.1 Documentar o contrato** `docs/contratos/eventos-canonicos.md`: lista de `categoria`/`acao`, campos, quem consome. Gerar a partir de `logs_jogo` + `parser.js`.
- ☑ **F4.2 Snapshot de amostras reais** (`fontes/hoolibras/amostras/*.json`, anonimizadas) e teste [T] que garante `parser(amostra) == evento esperado` **antes** de mover qualquer coisa.
- ☑ **F4.3 Mover** `parser.js` + itens de farm + nomes de baú + `RE_PATRIMONIO_ANTIGO` para `fontes/hoolibras/`. Interface: `{ ehMensagemDeLog, registrosDaMensagem, categoriasDeBau, itensDeFarm }`.
- ☑ **F4.4 Tenant escolhe a fonte:** `tenant.jogo.fonte = 'hoolibras'`; lista de canais e categoria de origem continuam no tenant (a trava dupla de ingestão é preservada).
- ☑ **F4.5 Adapter fake** de teste alimentando um painel [T] — prova que nenhum painel importa de `fontes/*`.

**Pronto quando:** `grep -r "fontes/" utils/logsJogo` só aparece no ponto de injeção; suíte de amostras verde.

---

## F5 — Onboarding `/setup`  (5–7 dias)

- ☑ **F5.1 Diagnóstico:** `/setup diagnostico` — permissões do bot (Gerenciar Cargos/Canais, posição do cargo), IDs do tenant que **não existem** mais no servidor, módulos ligados sem config obrigatória.
- ☑ **F5.2 Mapeamento guiado:** select de cargo/canal existente por papel (sócio, liderança, recrutador…) ou "criar para mim"; grava em arquivo de tenant (ou `bot_config` se o usuário decidir que o tenant é editável em runtime — **decisão [R]**).
- ☑ **F5.3 Escolha de módulos** com dependências explicadas.
- ☑ **F5.4 Health-check contínuo:** `/status` (liderança) — módulos, últimas ingestões por canal, tarefas agendadas, versão.

---

## F6 — Agentes  (2–3 dias, em paralelo com F0)

- ☑ **F6.1** `docs/contratos/` — `tema.md`, `padroes-ui.md` (a partir de `padroes.md`), `regras-negocio.md` (invariantes 1.4–1.8), `filtros.md`, `eventos-canonicos.md`.
- ☑ **F6.2** `.claude/agents/`: `plataforma`, `tema-design`, `logs-jogo`, `recrutamento-disciplina`, `financas-patrimonio`, `eventos-operacao`, `guardiao`. Cada um: escopo de pastas, contratos que deve ler, o que **não** pode tocar, checklist de saída.
- ☑ **F6.3 Tarefa-piloto por agente** (exemplo: `tema-design` executa o lote L2 da F1; `logs-jogo` adiciona um campo em um painel só com o contrato). Ajustar o prompt do agente com o que falhar.
- ☑ **F6.4** `CLAUDE.md` na raiz apontando para os contratos e para "rodar o guardião antes de concluir".

---

## F7 — Comercial  (4–6 dias)

- ☑ **F7.1 Segurança:** `ssl` do pool com verificação real (CA do provedor); revisar segredos; `SECURITY.md` atualizado.
- ☑ **F7.2 Ops:** log estruturado (`LOG_FORMATO=json`, com tenant e módulo, sem reescrever os ~100 `console`), `GET /health`, backup e restauração documentados. ☐ **Não feito:** unificar os 10 `setInterval` soltos no `agendador` (risco alto, ganho baixo; cada timer já é `unref`/único por painel).
- ☑ **F7.3 Template de deploy por tenant:** variáveis, comandos e checklist em `docs/operacao.md`; `Dockerfile` e `.dockerignore` escritos, **mas a imagem não foi construída** (sem daemon do Docker na máquina de desenvolvimento).
- ☑ **F7.4 Jurídico/marca [R]:** levantado em `docs/comercial.md` como **decisões do dono** (licença MIT sem autor, ativos dos Gaviões, nome do servidor de jogo, LGPD). Nada disso foi decidido por mim; `TENANTS_DIR` permite tirar os dados do cliente do repositório.
- ☑ **F7.5 Documentação de venda:** o que a torcida recebe, o que precisa fornecer (logs do jogo em webhook, cargos, canais), SLA de adapter novo.

---

## Ordem, dependências e paralelismo

```
F0 ─┬─▶ F1 ─▶ F2 ─▶ F3 ─▶ F4 ─▶ F5 ─▶ F7
    └─▶ F6 (contratos + guardião; agentes assumem F1–F4)
```
F1 e F6 podem andar juntos. F5 só depois de F3 (precisa de manifestos). F4
pode subir de prioridade se algum cliente usar servidor de jogo diferente.

## Riscos por etapa
| Etapa | Risco | Mitigação |
|---|---|---|
| F1 | mudar cor/emoji de mensagens já publicadas sem querer | codemod por lote + revisão visual dos painéis fixos após cada lote |
| F1.3 | quebrar extração de ID do apelido | teste com apelidos reais antes/depois |
| F2 | 65 importadores do `config` | fachada com o mesmo formato |
| F3 | botões já postados pararem de responder | congelar lista de `customId` em teste |
| F4 | regex do parser regredir ao mover | amostras reais + teste antes de mover |

## Primeira sessão de trabalho (sugestão)
F0.1–F0.3 e o esqueleto de F1.1 (`tema` + teste de matiz). É pequeno, reversível
e já entrega o guardião que protege as etapas seguintes.

---

## Desvios e pendências (o que mudou do plano e o que ficou de fora)

**Desvios deliberados**
- **F1** — o "ok" do tema é ✔️ (não ⚪): mantém a leitura de confirmação sem ser verde. Onde o código usava ✅ para status/confirmação agora vem de `tema.emoji.ok`.
- **F2** — `config/index.js` continua com o **mesmo formato plano** (`config.canais`, `config.cargos`…): os 65 importadores não mudaram. O plano previa blocos `discord/marca/tema/…`; a fachada plana foi escolhida por segurança.
- **F3** — a regra "dependência antes na ordem" foi **removida**: handlers são roteados por prefixo, e a ordem do array só vale para hooks (ex.: log → anti-spam → texto → validar ID). A auditoria pegou um erro meu nessa ordem (`bloqueioId`), já corrigido e coberto por teste.
- **F3** — `elenco` e `testes` passaram a ser módulos **desligados por padrão** (o tenant Gaviões os liga).
- **F4** — o adapter isola o **parser e as regras de patrimônio**; o SQL de saldo por baú ainda lê o colchete do `titulo` (contrato declarado em `docs/contratos/eventos-canonicos.md`), não uma coluna normalizada.
- **F5** — "wizard" virou `/setup diagnostico | mapear | criar` + modo instalação + `npm run novo-tenant`; o tenant continua **arquivo** (não é editável em runtime), decisão marcada [R] no plano.
- **Tabelas que nenhuma migração criava** (`socios`, `bot_config`, `aprovacoes_recrutamento`): descobertas na auditoria e agora criadas (`IF NOT EXISTS`) — sem isso um banco vazio (torcida nova) quebrava.

**Feito depois (2026-09-26)**
- ☑ Cor por torcida: `proibido.tons` (preto/branco/cinza), erro de token herdado da base, contraste mínimo, guardião `emojiCor`, `--proibir` no `novo-tenant`, temas de teste Mancha/Máfia Azul/Galocura (`test/tema.torcidas.test.js`).
- ☑ Loja: `npm run catalogo`, batida de vida (`plataforma/heartbeat.js`), esquema do banco de controle testado (`docs/loja/`).

**Pendências**
- ☐ Construir e testar a imagem Docker (o `Dockerfile` existe, não verificado).
- ☐ Unificar timers no `agendador` (F7.2, ver acima).
- ☐ Decisões do dono em `docs/comercial.md` (licença, marca, LGPD, SLA, cobrança).
- ☐ Multi-guilda por processo (fora de escopo: modelo é uma instância por torcida).
- ☐ Normalizar o nome do baú no registro canônico (hoje é o colchete do título).
- ☐ `DATABASE_SSL=verify` em produção (o padrão continua `no-verify` por compatibilidade).
