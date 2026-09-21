# Inteligência dos logs do jogo (canais-painel)

O FiveM publica tudo o que acontece com a torcida em canais de webhook do
Discord. O bot lê esses canais, grava cada log em `logs_jogo` e transforma
cada **tipo de informação** num canal-painel próprio, sempre atualizado. Este
documento explica de onde vem cada dado, como ele vira painel e como criar o
próximo.

## Fontes

| Canal (Discord) | ID | O que traz | Situação |
|---|---|---|---|
| 🦅・logs-registros | `1439061028515090524` | `#ID Nome …`: recrutou, promoveu/rebaixou, expulsou, saiu, tag, blacklist/suspensão/impedimento, multa, arena, sede/portão, config | ativo |
| 🦅・logs-painel | `1531478268975251496` | entrada/saída do servidor | ativo |
| 🦅・logs-baú | `1198743171765637123` | `Guardou/Removeu [GDF Sócio\|Diretoria\|Presidência]`: ID, item, quantidade | ativo, **lido a partir de 2026-09-13** |
| 🦅・logs-banco | `1518021496662917216` | Coins (dominação/conquista), dinheiro (depósito/saque/staff), honra | ativo, **lido a partir de 2026-09-13** |
| 🦅・logs-liderança | `1461544673825783929` | `O jogador X (ID: n) …`: advertência, banco em R$ (antigo), roupa, fechaduras da sede | **parado desde 2026-07-26** |

Os nomes ficam em `config.logsJogo.nomesCanais` e aparecem no rodapé dos
painéis como origem do dado.

## Do log ao painel

1. **Parser** (`utils/logsJogo/parser.js`): uma regra por família de log. Quase
   todas leem só a descrição; baú e banco leem também o **título**, porque é
   nele que o jogo diz o que aconteceu (`Guardou [GDF Sócio]`, `Sacou dinheiro`).
   O que não casa com nenhuma regra vira `desconhecido`, mas nunca é descartado.
2. **Gravação** (`ingestao.js`): um registro por embed, com o embed cru em `bruto`.
3. **Reprocessamento** (`ingestao.reprocessarDesconhecidos`): relê pelo parser
   atual todo registro que ainda está como `desconhecido` e corrige a linha no
   lugar. Roda no arranque do bot e no `/logs-sincronizar`. É o que faz uma regra
   nova valer também pro histórico (a sincronização não atualiza linha existente).
4. **Painel reativo** (`events/messageCreate.js`): cada log novo acorda só o
   painel da categoria dele (`PAINEIS_POR_CATEGORIA`), com debounce próprio.
5. **Alertas na hora** (`alertas.js`): retirada grande do baú
   (`bau.alertaRetiradaQtd`) e saque grande do banco (`caixa.alertaSaqueValor`).

## Família → painel

| Família de log | Ações | Categoria | Canal-painel |
|---|---|---|---|
| Baú | `bau_guardou`, `bau_removeu` | `bau` | 📦・estoque-bau |
| Dinheiro e honra | `banco_depositou`, `banco_sacou`, `dinheiro_adicionado`, `dinheiro_conquista`, `honra_adicionada`, `honra_gastou`, `comprou_roupa`, `comprou_item` | `economia` | 🏦・caixa-do-jogo |
| Território | `coins_dominacao`, `coins_conquista` | `territorio` | 🗺️・dominacao-territorios *(público)* |
| Disciplina | `advertido`, `adv_finalizou`, `adv_removida`, `multou` | `disciplina` | ⚖️・disciplina-jogo |
| Restrições | `blacklist_*`, `suspensao_*`, `impedimento_*` | `restricao` | ⛔・banidos-e-impedidos |
| Fechaduras | `sede_*`, `portao_*`, `fechadura_*`, `arena_*`, `protecao_alternou` | `patrimonio` | 🔐・fechaduras |
| Tags | `tag_adicionou`, `tag_removeu` | `tag` | 🏷️・tags-do-jogo *(público)* |
| Configuração | `config_alterou`, `tag_alterou`, `cargo_editado` | `config` | ⚙️・auditoria-config |
| Não reconhecido | `desconhecido` | — | 🧩・logs-nao-reconhecidos |

Os canais são criados pelo bot na primeira execução, na mesma categoria do
📊・painel-jogadores, visíveis só pra liderança (exceto os marcados como públicos).

## Regras de honestidade do dado

Estas regras existem por casos reais. Painel novo deve seguir todas.

- **O jogo publica evento, não estado.** Quem está banido, quem tem cada tag e
  quem tem advertência aberta sai do **último evento de cada chave**
  (`analises.js`). Por isso a ordem tem desempate por `message_id`/`embed_indice`:
  vários eventos da mesma mensagem têm o mesmo `ocorrido_em`.
- **Não existe saldo, só movimento.** Nem o baú nem o banco informam o que já
  havia antes. O painel diz "saldo líquido desde <data>", nunca "estoque" ou
  "saldo da conta".
- **Moedas não se somam.** A coluna `valor` guarda R$, coins, honra ou
  quantidade de item, conforme a ação. Toda soma filtra por ação; o "dinheiro
  movimentado" genérico usa `repositorio.ACOES_DINHEIRO`.
- **Fonte parada é avisada.** Sem log de um tipo há mais de
  `logsJogo.fonteParadaDias`, o painel mostra `F.avisoFonteParada` em cima: "0
  advertências" de uma fonte morta não pode parecer "ninguém punido". No painel
  de fechaduras, uma fechadura sem log recente aparece como ⚪ último estado
  conhecido, e não conta como destrancada agora.
- **Nome vem cru do jogo.** Todo nome passa por `F.nomeSeguro` (markdown
  escapado, mojibake corrigido). Os logs do baú e do banco só trazem o ID, e o
  nome é emprestado dos outros canais por `F.comNomes`.

## Esqueleto de um painel

- `painelCanal.js`: `criarPainelCanal({ slug, nomeCanal, montarBlocos, montarAcao, … })`.
  Cuida de criar o canal, reeditar as mensagens no lugar, apagar sobras, ciclo
  por tempo e debounce.
- `painelFormato.js`: `embedsDeLista` (pagina lista longa respeitando 4096),
  `pessoa`, `nomeSeguro`, `comNomes`, `haQuantoTempo`, `avisoFonteParada`, `nomeCanal`.
- `analises.js`: reduções puras e testadas (estado atual a partir de eventos).
- `consultasEmMemoria.js`: `criarArmazemConsultas()` — Map + TTL + dono da
  consulta, pra qualquer canal-painel interativo (ver abaixo) guardar uma lista
  grande em memória sem reimplementar isso.
- `painelConsulta.js` (`registrarConsulta`/`selectPeriodo`, prefixo `logstat:`):
  mecanismo ANTIGO, de resposta ephemeral única sem paginação. Só os 8 canais
  ainda não migrados pro padrão interativo (ver abaixo) o usam; painel novo não
  deve mais partir daqui.

## Padrão de UI: canal-painel interativo (piloto: 📦・estoque-bau, 2026-09-13)

Os 9 canais nasceram despejando listas inteiras direto no canal (várias
mensagens, sempre visíveis, sem filtro). Ficou poluído. O padrão novo — igual
ao 📊・painel-jogadores (`presencaInteracoes.js`), que já existia antes destes
9 canais — é: **a mensagem fixa do canal fica curta** (só números-chave, uma
mensagem só) e **toda exploração é botão/select que abre uma resposta
EPHEMERAL** (só quem clicou vê), com paginação de verdade.

Peças do padrão (ver `painelBauInteracoes.js` como referência completa):

1. **Mensagem fixa** (`painelX.js`): um embed com 3–5 números-chave + `linhaComponentesX()`
   com 3 linhas de componente:
   - `selectPeriodo` (StringSelect) → abre a consulta paginada.
   - `UserSelectMenuBuilder` "🔎 BUSCAR JOGADOR (DISCORD)" → ficha direta a
     partir do ID no apelido (`E.idFivemDoNick`), sem pedir período.
   - Botão(ões) de ação (ex.: RANKING) → normalmente abre outro select de
     período antes de mostrar o resultado (mesmo fluxo do botão RANKING do
     painel de jogadores).
2. **Consulta paginada** (`painelXInteracoes.js`): ao escolher o período,
   `armazem.salvar(userId, dados)` guarda a lista inteira e devolve um
   `consultaId` curto (cabe no customId, que tem limite de 100 caracteres).
   A resposta ephemeral mostra uma página (25 itens), com:
   - Select de filtro adicional quando fizer sentido (ex.: por compartimento/
     categoria) — reaplica o mesmo `consultaId`, sem nova consulta.
   - Botões ◀ ANTERIOR / PRÓXIMA ▶ (desabilitados na ponta) e 🔎 BUSCAR.
   - 🔎 BUSCAR abre um modal; o resultado vira um select (até 25 opções) que,
     ao escolher, mostra a "ficha" daquele item/pessoa.
3. **Toda ação que mexe numa consulta** chama `armazem.obter(id, userId)`
   primeiro — devolve `{ erro: 'expirada' | 'outro_usuario' }` ou `{ consulta
   }`. `mensagemErroConsulta(erro)` dá a mensagem pronta. Nunca pular essa
   checagem: é o que impede um botão de consulta expirada silenciosamente
   mostrar dado errado, e uma consulta de outro usuário.

Migrado em 2026-09-13 para os 9 canais (piloto 📦・estoque-bau + réplica nos
outros 8). `painelComponentesFixos.js` reúne os builders comuns
(`selectPeriodo`, `selectBuscarJogador`, `linhaBotao`, `linhaPaginacao`) — todo
`painelXInteracoes.js` monta a mensagem fixa com eles em vez de escrever
`ActionRowBuilder` cru. O select que abre a exploração nem sempre é por
período: cada canal usa o eixo que faz sentido pro dado dele —

| Canal | 1º select/botão | 2º (buscar jogador) | 3º |
|---|---|---|---|
| estoque-bau | período (histórico cronológico paginado + filtro por baú, período inteiro) | sim | RANKING → período |
| caixa-do-jogo | período (resumo, sem paginação) | sim | RANKING → período |
| disciplina-jogo | sem 1º select/botão (advertências abertas já saem na mensagem fixa) | sim | período → fluxo |
| banidos-e-impedidos | tipo (blacklist/suspensão/impedimento, paginado) | sim (cruza c/ não-recrutar) | período → fluxo |
| fechaduras | sem 1º select/botão (mensagem fixa já é o estado atual) | sim | período → histórico paginado (período inteiro, cronológico) |
| tags-do-jogo | tag (dinâmico, paginado) | sim | período → fluxo |
| auditoria-config | botão HISTÓRICO COMPLETO (paginado) | sim | período → fluxo |
| logs-nao-reconhecidos | período (paginado) | não se aplica | botão TODO O HISTÓRICO |
| dominacao-territorios | período (paginado) | não se aplica (sem ator) | botão TERRITÓRIOS PERDIDOS |

tags-do-jogo e dominacao-territorios são públicos (referência/orgulho da
torcida, não auditoria) — os handlers de interação deles não checam
`ehLideranca`, diferente dos outros 7.

Painel novo do zero: regra(s) no parser com teste usando **exemplo real** →
consulta no repositório se precisar (`eventosDoAtor`/`eventosDoAlvo` cobrem a
maioria das "fichas de jogador") → `painelX.js` (resumo curto) +
`painelXInteracoes.js` (exploração, usando `painelComponentesFixos.js` e
`consultasEmMemoria.js`) → `iniciar` em `events/ready.js` → categoria em
`PAINEIS_POR_CATEGORIA` (events/messageCreate.js).

## Formato de log novo

Aparece sozinho no 🧩・logs-nao-reconhecidos, agrupado por formato, com
contagem e exemplo. Para resolver:

1. Escrever a regra em `parser.js` e o teste com o exemplo real (`test/logsJogo.inteligencia.test.js`).
2. Reiniciar o bot ou rodar `/logs-sincronizar`. O reprocessamento corrige o histórico.

## Decisões registradas

- **Sede e portão** mantêm as ações antigas (`sede_trancou` etc.): elas estão
  em 14 mil registros e o módulo de segurança vigia por elas. As outras
  fechaduras usam `fechadura_*` com o nome em `alvo_nome`.
- **Formatos antigos do logs-banco** (até 2026-07-19: `Dinheiro`/`Honra` com
  sinal no valor e `Banco` para prêmio de conquista) viram as mesmas ações dos
  títulos atuais. O histórico soma junto sem o painel saber da troca de texto.
- **Expulsão com motivo** (`removeu #ID Nome (Traidor)`) é `expulso_torcida`.
  Antes só passava com parênteses vazios, e 66 expulsões ficaram fora do churn.
- `comprou_item` (logs-registros) e `honra_gastou` (logs-banco) são a **mesma
  compra** vista de dois canais. O painel de caixa só soma o valor de honra, que
  é quem traz o preço.
- **Baú de Recompensas** (`Baú de Recompensas [GDF] - Depósito/Retirada`, no
  logs-baú) usa as mesmas ações do baú comum, e o compartimento é "Recompensas".
  O colchete `[GDF]` desse título é da torcida, não do baú, então
  `E.bauDoTitulo` e `repositorio.saldoBau` tratam esse caso nos dois lugares.
- **Baú ordena por volume** (guardou + removeu), não por saldo. Ordenado por
  saldo, dezenas de camisas com saldo 0 escondiam tecido, maconha e cocaína.
- **Baú: histórico cronológico, não saldo agregado** (pedido do usuário em
  2026-09-15, mesma virada já feita em fechaduras). Um saldo por item
  ("entrou 95 · saiu 89") não diz QUEM guardou nem QUEM retirou — só o total.
  Escolher um período no canal 📦・estoque-bau abre a lista de EVENTOS
  individuais (quem, ação, item, quantidade, baú, quando), período inteiro,
  paginada; o filtro por compartimento e a busca (por item, ID ou nome) atuam
  sobre essa mesma lista de eventos, não sobre um resumo por item.
- **Cruzamento com o não-recrutar é só blacklist.** Suspensão é temporária, e
  impedimento é ligado e desligado com segundos de diferença, inclusive entre
  líderes (visto nos logs de 2026-09-13). Tratar os dois como "não recrutar"
  seria falso alarme.
- **Tags**: grafias da mesma tag (`R.S.J.` → `RSJ`) são uma tag só, exibida com
  a grafia mais recente. Tag recebida antes da última saída ou expulsão da pessoa
  não vale, porque o jogo não publica "removeu tag" quando alguém sai. A lista
  antiga tinha gente que já estava na blacklist. Essa regra é **dedução**, não
  vem de documentação do jogo: se a tag sobreviver à saída, ela deve ser tirada
  de `analises.tagsAtivas`.
- **Advertência do Discord (cargo ADV¹/²/³) cruzada com a inteligência do jogo**
  (pedido do usuário em 2026-09-21): a advertência de sócio não vem de log do
  jogo, é cargo Discord direto no membro (`config.cargos.adv`), sem tabela nem
  histórico próprio (só os embeds do canal `historico-advertencia`). Criado
  `utils/logsJogo/advertenciaDiscord.js` (`advertenciaAtivaDoMembro`,
  `linhaAdvertenciaDiscord`) e plugado nas 3 fichas que já existiam: ficha de
  `⚖️・disciplina-jogo`, ficha de `⛔・banidos-e-impedidos` e o resumo de
  `📜・historico-do-associado` (campo CONDUTA). `linhaAdvertenciaDiscord`
  devolve `null` sem `membro` em mãos (nunca finge "nenhuma advertência" sem
  ter checado o cargo de verdade — mesma regra de "marcar resolvido só depois
  da ação de fato", ver `docs/padroes-e-canais.md` § 1.5) — por isso só
  aparece nos 3 pontos com o `GuildMember` vivo na hora (busca direta por
  UserSelect); o detalhe de disciplina/restrições aberto a partir do
  histórico (que só tem `idFivem`/nome guardados, sem `membro`) fica sem essa
  linha.
- **Alerta automático em `🚨・associado-em-atenção`** (pedido do usuário em
  2026-09-21, depois de confirmado): o canal (`config.canais.associadoEmAtencao`,
  `1547740103097589811`) agora recebe alerta nas DUAS direções, ambas em
  `utils/logsJogo/alertas.js`:
  1. **Jogo → Discord** (regra `restricao_jogo_socio_ativo`, reativa a cada
     log novo de blacklist/suspensão/impedimento `_adicionou`): só dispara se
     o alvo correlacionar por nome (ver 1.4) com um membro que TEM o cargo de
     sócio agora — quem já saiu não é mais "associado em atenção", fica só na
     ficha manual de `⛔・banidos-e-impedidos`.
  2. **Discord → Jogo** (`verificarRestricaoAoAdvertir`, chamada de
     `events/interactionCreate.js` ao registrar advertência de sócio): se o
     sócio advertido já está com restrição ativa no jogo, avisa na hora — sem
     isso a liderança só saberia das duas coisas juntas se fosse conferir os
     dois canais na mão.
  Um debounce só (`ultimosAlertasAtencao`, chave `tipo:idFivem`, mesma janela
  de 6h de `id_bloqueado_no_jogo`) cobre as duas direções — evita repetir o
  aviso quando impedimento liga/desliga em segundos (ver acima) e evita
  alertar duas vezes a mesma restrição se as duas direções dispararem perto
  uma da outra. Embed compartilhado (`embedAtencaoSocio`) sempre traz: sócio,
  tipo de restrição, nível de advertência Discord (`advertenciaDiscord.js`) e,
  só pra blacklist, se já está bloqueado no `❌・nao-recrutar`.
