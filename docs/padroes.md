# Padrões — inteligência do projeto

> Documento versionado, **sem IDs de Discord**. O mapa de canais/categorias/IDs
> do servidor de cada torcida vive em `docs/padroes-e-canais.md` (ignorado
> pelo Git por decisão do usuário) — ver `docs/contratos/` para os contratos
> compartilhados entre agentes. Antes de desenvolver módulo, painel, comando ou
> fluxo novo, **ler a seção 1**: se for variação de um padrão daqui, replica.
>
> **Depois da reestruturação de 2026-09** (tenant, tema, módulos, fontes): os
> contratos operacionais estão em `docs/contratos/`; onde este documento diz
> `events/…` leia `plataforma/` + `modulos/` + o `utils/` do domínio, e onde diz
> `config/index.js` como fonte de valores leia `tenants/<slug>/tenant.js`.
>
> Mantido à mão. Atualizar quando um padrão novo nascer ou uma regra de negócio
> central mudar. Data de referência: 2026-09-24.

---

## 0. Regra de cor: vem do tema, nunca de literal

Cor, emoji de estado e marca **não são escritos no módulo**: vêm de `tema/`
(ver `docs/contratos/tema.md`). Cada torcida declara no tema quais matizes
são **proibidos** (`proibido.matizes`) e um teste falha se algum token cair
neles. O guardião (`npm test` → `test/conformidade.test.js`) impede literal
novo de cor, emoji de estado, marca, ID ou caminho de asset fora de
`config/`, `tenants/` e `tema/`.

**Tenant Gaviões da Fiel:** não pode ter verde em lugar nenhum (embed,
gráfico, emoji de status 🟢 ✅ 🟩 💚). Paleta: preto (primária), vermelho
(perigo), branco (destaque), cinza; amarelo só pra aviso. "Sucesso" não é
verde — o texto já diz que deu certo. Nem o verde de marca de terceiros vale.

---

## 1. Padrões de fluxo/UI já estabelecidos

Antes de desenhar uma tela ou um fluxo novo, checar se ele já é uma destas
variações. Todos vividos primeiro em `utils/logsJogo/`, mas valem pra
qualquer módulo do bot.

### 1.1 Canal-painel interativo (mensagem fixa curta + exploração ephemeral)

**O que é:** um canal com 1–2 mensagens fixas (editadas no lugar, nunca
reenviadas) mostrando só o resumo/estado atual, mais um bloco de componentes
(select de período, select de busca, botões) **sempre no fim do canal**. Quem
interage recebe a resposta ephemeral (`flags: 64`) — que só existe embaixo de
tudo, nunca escondida atrás de uma listagem longa (bug já vivido em
🆔・socio-sem-id e 🔗・ids-sem-discord antes de virar padrão).

**Motor genérico (não reescrever):** `utils/logsJogo/painelCanal.js` →
`criarPainelCanal({ slug, nomeCanal, razao, publico, intervaloMin, debounceMs,
montarBlocos, montarAcao, canalVizinhoId })`. Resolve sozinho: criar o canal
na primeira vez (reaproveita se já existe, guarda o ID em `bot_config`),
reeditar mensagens no lugar, apagar sobra quando a lista encolhe, retry em
rate limit (`comRetry`), ciclo por tempo como rede de segurança +
`agendarAtualizacaoReativa` (debounce) pra reagir rápido a um log novo sem
esperar o ciclo.

**Componentes reutilizáveis:** `utils/logsJogo/painelComponentesFixos.js`
(`selectPeriodo`, `selectBuscarJogador`, `linhaBotao`, `linhaPaginacao`) e
formatação em `utils/logsJogo/painelFormato.js` (`rodape`, `nomeCanal`,
`avisoFonteParada`, `nomeSeguro`, `pessoa`, `campoLista`, `embedComLista`,
`embedsDeLista`).

**Roteamento de interação:** `utils/modulos.js` — `registrarModulo(prefixo,
handler)` associa um módulo (`customId` no formato `<modulo>:<acao>:...`) a
um handler só, despachado por `despacharInteracao`. Módulo novo não mexe em
`interactionCreate.js`, só chama `registrarModulo` no próprio arquivo.

**Exemplos já implementados** (copiar a estrutura de um destes pra um canal
novo): `painelBau.js`/`painelBauInteracoes.js` (📦・estoque-bau),
`painelCaixa.js`/`painelCaixaInteracoes.js` (🏦・caixa-do-jogo),
`painelDisciplina.js` (⚖️・disciplina-jogo), `painelFechaduras.js`
(🔐・fechaduras), `painelRestricoes.js` (⛔・banidos-e-impedidos),
`painelTags.js` (🏷️・tags-do-jogo), `painelTerritorio.js`
(🗺️・dominacao-territorios). Doc de referência mais longa:
`docs/inteligencia-logs-jogo.md` § "Padrão de UI".

### 1.2 Edição de dado manual num painel fixo (botão → select → modal)

**O que é:** painel mistura número automático (calculado dos logs) com
número batido à mão pela liderança a partir do painel/ranking do próprio
jogo — os dois divergem por perda de webhook, então o painel mostra os dois
lado a lado em vez de fingir que é um só.

**Fluxo (sempre os mesmos 3 passos, mesmos 3 customIds):**
1. Botão **EDITAR** (`<modulo>:editar`) — visível pra todo mundo, mas o
   handler confere `ehLideranca` nele mesmo, nunca só escondendo o botão.
2. Select ephemeral (`<modulo>:editarcampo`) com um campo por opção
   (`CAMPOS_MANUAIS`).
3. Modal de um campo só (`<modulo>:editarmodal:<campo>`), valor atual já
   preenchido; vazio ao salvar remove o valor.
4. No submit: valida, grava em `bot_config` (JSON por campo, chave própria
   do módulo, `{ valor, atualizadoPor, atualizadoEm }`, sempre lido/gravado
   com `jsonb_set` atômico — nunca ler-objeto-inteiro/somar/gravar em JS,
   porque webhook manda log em rajada e duas chamadas concorrentes perdem
   incremento uma da outra) e atualiza o painel na hora.

**Implementações:** `presencaInteracoes.js` (`CAMPOS_MANUAIS`: sócios
setados, maior bonde mensal — chave `painel_jogadores_manual`) e
`painelCaixaInteracoes.js` (saldo no banco da torcida — chave
`painel_caixa_manual`, único que também reage sozinho a webhook novo, ver
1.3). Doc de referência: `docs/plano-modulos-torcida.md` § "Edição de dado
manual num painel fixo".

### 1.3 Ajuste automático por cima de um valor manual

Variante de 1.2: além do botão EDITAR, o valor **soma/diminui sozinho** a
cada log novo que bate com ele (recrutamento → sócios setados; depósito/
saque → saldo do caixa), sem esperar a liderança editar de novo. Só ajusta
`incrementarXManual` — nunca cria o campo do zero a partir de um delta
parcial (sem baseline setada pela liderança, não tem o que corrigir).
Chamado pelo painel dono (`modulos/painelCaixa.js` e `utils/logsJogo/pipeline.js`), sempre com um `UPDATE`/`jsonb_set`
atômico (mesmo motivo do item acima). Exemplos:
`incrementarSociosManual` (`presencaInteracoes.js`),
`incrementarSaldoCaixaManual` + `deltaCaixa` (`painelCaixaInteracoes.js`).

### 1.4 Correlação de jogador por nome, não por ID

O ID do FiveM troca a cada season (mesmo jogador pode aparecer com IDs
diferentes ao longo do tempo) — nunca usar ID puro pra "é a mesma pessoa
entre períodos"; correlacionar por nome (fuzzy/normalizado), com ID como
detalhe de exibição, não de identidade. Ver `estatisticas.js`
(`idFivemDoNick`, normalização de nome) e uso em `idsSemSocio.js`.

### 1.5 Marcar "resolvido" só depois da ação de fato ter funcionado

Bug real vivido em 🔗・ids-sem-discord: marcava a associação como resolvida
mesmo quando `setNickname` falhava, escondendo um pendente real pra sempre.
Regra: **nunca marcar resolvido/concluído antes de confirmar que a operação
que resolveria (grava no banco, `setNickname`, envia DM, etc.) realmente
funcionou** — em caso de erro, deixa pendente e loga, nunca finge sucesso.

### 1.6 Fonte de log parada não vira zero silencioso

Um canal de log que o jogo parou de usar (webhook trocado/desligado) não
pode fazer o painel mostrar "0" como se nada tivesse acontecido — vivido de
verdade quando logs-liderança parou em 2026-07-26 e advertência/banco/
fechadura da sede ficaram congelados sem ninguém notar por semanas. Padrão:
`painelFormato.js#avisoFonteParada(ultimaOcorrencia)` — acima de
`config.logsJogo.fonteParadaDias` (3 dias) sem log daquele tipo, o painel
avisa no topo em vez de mostrar zero.

**Exceção (2026-09-14):** isso vale pra "fonte de dado inteira parou"
(canal de log trocado/desligado). É diferente de **um item individual**
ficar velho dentro de uma fonte que continua viva — caso real: painel de
🔐・fechaduras listava "PORTÃO — desde 28/01/2026 (destrancada)" mesmo com
logs-registros ativo todo dia, só que sem log de portão específico há
meses (4.139 registros de 24–28/01, depois nada — mecânica abandonada no
jogo). Ali o aviso "sem log" virou ruído permanente, não sinal de alerta.
Decisão: manter os logs no banco (inteligência intacta — ranking, ficha de
jogador, auditoria) e só tirar da VISÃO DE ESTADO ATUAL o que não é mais
atual de verdade (`painelFechadurasInteracoes.js#embedEstadoAtual` não
lista mais o grupo "sem log"). Regra geral: **nunca apagar dado histórico
só porque ficou visualmente chato — cortar a exibição, preservar a fonte.**

### 1.7 Categoria de origem sempre confere antes de entrar na ingestão

Incidente real (2026-09-13): um canal de log de OUTRA comunidade
(`logs-liderança`, categoria "LOGS FANÁTICOS/ARENA") ficou 2 meses
misturado com os canais do Hoolibras (`categoriaLogs`), contaminando
painéis com dado de outro servidor. Todo canal em
`config.logsJogo.canais` **precisa** estar dentro de
`config.logsJogo.categoriaLogs` — `ingestao.sincronizarCanaisDeLog` recusa e
avisa qualquer um que não esteja. Checar isso de novo sempre que adicionar
um canal de log novo à lista.

**Reforçado em 2026-09-14** (usuário reportou suspeita de nova mistura —
diagnóstico ao vivo no banco não achou contaminação nenhuma; DB e API do
Discord confirmaram que só os 4 canais abaixo, todos dentro de ⏰・LOGS
HOOLIBRAS, alimentam a categoria 📋・ESTATÍSTICAS onde os painéis vivem —
os IDs ficam no mapa local de canais, fora do Git). Mesmo assim, virou uma segunda trava, mais forte
que a primeira: `ingestao.js#gravarRegistros` agora recusa gravar qualquer
registro cujo `canalId` não esteja em `config.logsJogo.canais`, **mesmo que
`ehMensagemDeLog`/`sincronizarCanal` mudem no futuro e deixem passar algo
por engano** — é o último ponto antes do INSERT, não só o primeiro filtro
na entrada. Nenhuma das ~20 queries de leitura em `repositorio.js` filtra
por `canal_id` (dependem inteiramente desse gate de escrita) — se um canal
novo for adicionado a `config.logsJogo.canais` sem estar em
`categoriaLogs`, a sincronização recusa; se `categoriaLogs` mudar de
categoria de verdade (canal se move no Discord), atualizar aqui também.

### 1.8 Scripts de teste/integração nunca escrevem no banco real

Incidente real (2026-09-13): scripts de integração escreveram no Postgres de
produção. Regra: todo script de teste/investigação intercepta `utils/db.js`
antes de rodar qualquer query, e **aborta** se a interceptação falhar — não
seguir "sem querer" pro banco real. `npm test` (`node --test`) só roda
funções puras (sem banco) — ver `test/*.js`.

### 1.9 Ranking com várias colunas: tabela/lista em texto (item a item) + gráfico por DIA (tendência)

Quando uma linha tem 2+ números lado a lado (domínio, conquistas, coins —
caso real: ranking de território), uma lista markdown numerada vira parede
de texto difícil de comparar item a item — mas um gráfico de barras UMA
barra por item (ex.: uma barra por território) também não resolve tudo: some
o detalhe (não é copiável/buscável) e não mostra a dimensão que geralmente
importa mais, que é o TEMPO (quando aconteceu, com que frequência). Histórico
real: o ranking de território passou por três formatos até chegar aqui —
lista de texto simples (2026-09-14) → gráfico de barras por item (mesmo dia,
"pouco intuitivo" no feedback do usuário) → volta pra texto detalhado por
item (2026-09-15) **mais** um gráfico separado por dia. Não existe "o melhor
formato" fixo — o texto serve pra listar itens, o gráfico serve pra mostrar
tendência ao longo do tempo; use os dois juntos quando o caso pedir ambos:

1. **Lista/tabela em texto, por item** — `painelFormato.js#campoLista` (linha
   numerada por item, cada `field`) ou `#tabela(colunas, linhas)` (bloco de
   código com colunas alinhadas, quando cabe em `description`). Cobre o
   detalhe por item: nome, horas, conquistas, coins, última ocorrência — tudo
   que só cabe em texto (imagem não é copiável/buscável, nem lida por leitor
   de tela). Ver `painelTerritorioInteracoes.js#linhaTerritorio`.
2. **Gráfico por DIA (tendência)** — `graficoTerritoriosPorDia.js`, com
   `chartjs-node-canvas` (Chart.js renderizado em PNG server-side, NÃO
   `canvas` desenhado à mão) por ter séries com eixo Y próprio prontas,
   testadas e legendadas — esse é o único caso do projeto que trocou o
   `canvas` manual (usado em `graficoOcupacao.js`/`gerarCarteirinha.js`) por
   uma lib de gráfico de verdade; adicionou `chart.js`+`chartjs-node-canvas`
   como dependência nova. Eixo X = dia (não item/território), TRÊS séries:
   barra de horas de domínio, linha de conquistas (soma de todos os
   territórios no dia) e linha tracejada de "maior disputa" (o MAIOR total de
   um único território naquele dia — `repo.conquistasPorDiaEAlvo` +
   `disputaPorDia`). A terceira série existe porque as duas primeiras sozinhas
   não distinguem "5 conquistas espalhadas em 5 territórios" de "o mesmo
   território retomado 5x" — só a quebra por território revela disputa ativa
   de verdade (pedido do usuário em 2026-09-15: essa informação precisa estar
   DENTRO do gráfico, não só numa frase de destaque acima dele — `textoDisputa`
   continua existindo como resumo em texto do pico do período, mas a série é
   o dado por dia). Zero-fill dos dias sem log via `estatisticas.js#serieDiaria`
   pras três séries — sem isso um dia parado sumiria do eixo em vez de
   aparecer como barra/ponto zerado. Testado sem banco em
   `test/logsJogo.inteligencia.test.js` (zero-fill, alinhamento das três
   séries no mesmo dia, distinção disputa-vs-soma, período "tudo" sem
   `inicio` fixo).
3. **Gráfico de barras por ITEM (uma barra por território/pessoa/etc.)** —
   existiu (`graficoTerritorios.js`, removido em 2026-09-15) mas não é mais o
   padrão pra ranking: sem detalhe copiável e sem eixo de tempo, ficou
   "pouco intuitivo" no uso real. Continua válido como ferramenta pontual
   (ex.: `graficoOcupacao.js`, que É por tempo — hora/dia — não por item) —
   o que não vale mais é usar barra-por-item como resposta padrão pra "várias
   colunas por linha".

### 1.10 Departamento novo com cargo que JÁ existe no servidor: seed em vez de deixar o setup criar

`/departamentos` (`utils/departamentos/setup.js#garantirCargo`) só reaproveita
um cargo existente de duas formas: ID já salvo na tabela `departamentos`, ou
nome EXATO igual ao gerado (`MEMBRO • <NOME>`/`GESTOR • <NOME>`). Caso real
(farm, 2026-09-21): a torcida já tinha os cargos "EQUIPE FARM ・🦅" e
"RESPONSÁVEL FARM ・🦅" com nome diferente do padrão — sem ação, o setup
teria criado dois cargos novos duplicados. Solução: antes de rodar
`/departamentos`, gravar a linha em `departamentos` com os IDs reais
(`UPDATE departamentos SET cargo_membro_id=..., cargo_gestor_id=... WHERE
slug=...`, ou `INSERT ... ON CONFLICT`), pra `garantirCargo` achar o ID salvo
e reaproveitar (`criado: false`). Regra: sempre que o usuário disser "já tem
cargo pra isso", pedir o ID e fazer esse seed — nunca confiar no
match-por-nome pra cargo que já existia antes do departamento entrar no bot.

### 1.11 Limite editável + alerta só na transição + atalho pra fluxo manual já existente

**O que é:** variante de 1.2 (edição de dado manual) pra um TETO que dispara
alerta ao ser ultrapassado, em vez de um número exibido — caso real: limite
diário de retirada de droga do baú (painel-farm, pedido do usuário em
2026-09-21: "às vezes tem dia de pista mais puxado, quero liberar mais").

1. **Limite editável, não hardcoded**: mesmo fluxo de 3 passos de 1.2 (botão
   `EDITAR LIMITES` → select do item → modal de um campo só), mas o valor
   "automático" não vem dos logs — é o padrão do tenant (`tenants/<slug>/tenant.js`)
   (`config.logsJogo.farm.limitePadraoDroga`), sobreposto pelo que a
   liderança salvar em `bot_config` (`farm_limite_diario_retirada`, mesmo
   `jsonb_set` atômico). `limitesEfetivosFarm()` (`utils/logsJogo/farmLimites.js`) é
   a função que resolve "manual ?? padrão" — todo lugar que precisa do
   limite (card fixo, alerta) chama essa função, nunca lê `bot_config` nem
   o tenant direto.
2. **Alerta só na TRANSIÇÃO**: comparar SÓ "total de hoje ultrapassou o
   limite" dispararia de novo a cada retirada seguinte no mesmo dia (spam).
   Em vez disso, calcula total ANTES desta retirada (total de hoje menos o
   `valor` deste registro) e total DEPOIS (total de hoje); só alerta quando
   `antes < limite <= depois` — a pessoa já sabe que estourou depois do
   primeiro aviso, avisos repetidos no mesmo dia não ajudam em nada. Ver
   `alertas.js#montarAlertaLimiteDiarioFarm`.
3. **Atalho pro fluxo manual que já existe, sem duplicar lógica**: o alerta
   tem um botão que abre o MESMO select (`select_prazo_adv:<membroId>`) que
   `utils/advertencia/interacoes.js` já trata por inteiro (nível de ADV, cargo,
   canal de histórico, agendamento de vencimento) — só pula o passo de
   escolher o membro, porque o alerta já sabe quem foi. Nenhuma lógica de
   advertência foi extraída/duplicada: o botão só monta o mesmo componente
   que o fluxo manual monta depois de escolher o membro. Ver
   `painelFarmInteracoes.js#registrarModulo` (ação `advertir`) e
   `docs/padroes.md` § 2 (`advertenciaDiscord.js` é só LEITURA do
   nível atual — não existe função reutilizável de "aplicar advertência",
   então automatizar 100% exigiria extrair o handler `modal_registrar_advertencia` de
   `utils/advertencia/interacoes.js`; o atalho de botão evita essa extração).

**Por que não automatizar a punição**: o próprio código já documenta a regra
("Alerta avisa quem decide; não pune nem concede nada sozinho", topo de
`alertas.js`) — o limite diário segue essa mesma separação: alerta, oferece o
atalho, quem decide aplicar é sempre um humano da liderança.

**Pegadinha do Discord ao reeditar mensagem com imagem (`files`), vale pra
qualquer canal-painel/resposta que suba anexo mais de uma vez na MESMA
mensagem** (`msg.edit`, `interaction.update`, `interaction.editReply`): sem
`attachments: []` explícito no payload, o Discord **mantém** o anexo da
edição anterior e só ACRESCENTA o novo — nunca substitui sozinho. Um painel
fixo reeditado a cada ciclo/log novo (às vezes a cada 30s) empilha um PNG a
mais por edição até estourar o limite de anexos por mensagem e parar de
atualizar **sem erro visível** (só o log do `catch` de `atualizar`, se
alguém for olhar). Sempre mandar `attachments: []` junto com `files` em
TODA edição que carregue imagem — mesmo quando não tem imagem naquele ciclo
(`files: []` sozinho não limpa o anexo velho).

---

## 2. Ferramentas/infra reutilizáveis (não reescrever)

| Arquivo | O que resolve |
|---|---|
| `utils/modulos.js` | Roteador de interações por módulo (`registrarModulo`/`despacharInteracao`), customId `<modulo>:<acao>:...` |
| `utils/logsJogo/painelCanal.js` | Motor de canal-painel fixo (criar/reaproveitar canal, reeditar mensagem, debounce reativo, retry) — ver 1.1 |
| `utils/logsJogo/painelComponentesFixos.js` | Componentes repetidos (select de período, busca de jogador nativa, botão simples, paginação) |
| `utils/logsJogo/painelFormato.js` | Formatação compartilhada (rodapé, nome seguro contra markdown do jogo, aviso de fonte parada, listas/embeds, `tabela` — bloco de código com colunas alinhadas, ver 1.9) |
| `utils/logsJogo/graficoOcupacao.js` | Imagem gerada com `canvas` (já dependência do projeto) pra visual por tempo (hora/dia) que texto não resolve — gráfico de barras, paleta preto/branco/cinza da torcida |
| `utils/logsJogo/graficoTerritoriosPorDia.js` | Imagem gerada com `chart.js`+`chartjs-node-canvas` (dependências novas, ver 1.9) — domínio de território por dia, três séries (horas em barra, conquistas totais em linha, maior disputa por território em linha tracejada) |
| `utils/logsJogo/graficoFarmPorDia.js` | Mesma lib de `graficoTerritoriosPorDia.js`, uma série só (barra) — volume guardado de item de farm por dia |
| `utils/logsJogo/estatisticas.js` | Formatação de número/dinheiro/data, períodos, duração, extração de ID do apelido |
| `fontes/<id>/` + `utils/logsJogo/fonte.js` | Adapter da fonte de logs (hoje `fontes/hoolibras/`): embeds do webhook → registro canônico (`acao`, `valor`, IDs). Contrato em `docs/contratos/eventos-canonicos.md` |
| `utils/logsJogo/pipeline.js` | Mensagem de log → grava → alertas → acorda os painéis dos módulos ligados |
| `utils/logsJogo/ingestao.js` | Grava registros novos (idempotente), sincroniza histórico de um canal |
| `utils/logsJogo/repositorio.js` | Queries agregadas sobre os registros (somas, tops, últimas ocorrências) por período |
| `utils/botConfig.js` | `lerConfig`/`gravarConfig` — chave/valor persistente do bot (IDs de mensagem/canal criados dinamicamente) |
| `utils/permissoes.js` | `ehLideranca`, `ehPresidencia`, `MSG_SO_LIDERANCA` — checar sempre no handler, nunca só esconder botão |
| `utils/db.js` | Conexão Postgres — sempre interceptado em teste/script avulso (ver 1.8) |
| `utils/logsJogo/advertenciaDiscord.js` | Só LEITURA do nível de ADV¹/²/³ atual de um membro (`advertenciaAtivaDoMembro`, `linhaAdvertenciaDiscord`) — aplicar advertência é fluxo manual inteiro em `utils/advertencia/interacoes.js` (botão→select→select→modal), sem função reutilizável (ver 1.11) |

---

## 3. Domínios de negócio (fora de logsJogo) — mapa rápido

Cada pasta em `utils/` é um domínio; regra de negócio detalhada mora no
código de cada uma, não duplicada aqui. Só o mapa "existe e mora onde":

| Domínio | Pasta | O que é |
|---|---|---|
| Recrutamento | `utils/recrutamento/` | Funil de entrada de sócio novo, aprovação, ficha |
| Financeiro | `utils/financeiro/` | Regras de dinheiro/multa da torcida (fora do jogo) |
| Loja | `utils/loja/` | Catálogo, estoque, pedidos |
| Rifas | `utils/rifas/` | Criação, venda de números, sorteio |
| Eventos | `utils/eventos/` | Série de eventos, confirmação, lembrete |
| Carteirinha | `utils/carteirinha*.js` | Emissão/vencimento de carteirinha de sócio |
| Departamentos | `utils/departamentos/` | Áreas da torcida (setup de canal/cargo por área) |
| Patrimônio | `utils/patrimonio/` | Acervo de bandeiras/bateria/material, empréstimo |
| Caravana | `utils/caravana/` | Viagem pra jogo fora: veículo, vaga, embarque |
| Escala | `utils/escala/` | Coordenação/recusa de escala |
| Confiança | `utils/confianca/` | Nível de confiança do sócio (cosmético) |
| Memória | `utils/memoria/` | Registro histórico de fatos da torcida |
| Anti-spam | `utils/antiSpam/` | Detecção de conta hackeada espalhando golpe |
| Logs do jogo | `utils/logsJogo/` | Tudo listado nas seções 1–3 acima |

Docs mais longas já existentes (não duplicar conteúdo, só linkar):
`docs/inteligencia-logs-jogo.md` (padrão de UI dos canais de log, mais
fundo), `docs/plano-modulos-torcida.md` (histórico de decisão módulo a
módulo, auditoria de fonte).
